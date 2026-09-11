#!/usr/bin/env node
// Rotates a Zoho Vault secret's password.
//
// Finds the secret(s) in a given Vault folder whose username matches,
// records the current password into the secret's notes as a
// "old password: <value>" line (existing notes are kept below it), then
// sets the new password.
//
// IMPORTANT — verify before relying on this in production:
// Outbound access to zoho.com was blocked in the environment this script
// was written in, so the exact endpoint paths / payload shapes below
// (grouped in ZOHO_API) follow Zoho Vault's documented REST API v1
// conventions from https://www.zoho.com/vault/api/ but were NOT verified
// against a live account. Run with --dry-run (the default) first, check
// the printed request plan against your own Vault API docs, and only add
// --apply once you've confirmed a single secret behaves as expected.
//
// Setup:
//   1. In the Zoho API Console (https://api-console.zoho.com), create a
//      Self Client (or server-based app) and generate a refresh token with
//      scope `ZohoVault.secrets.ALL`.
//   2. Export:
//        ZOHO_VAULT_CLIENT_ID
//        ZOHO_VAULT_CLIENT_SECRET
//        ZOHO_VAULT_REFRESH_TOKEN
//        ZOHO_VAULT_DC          (optional, default "com"; use "eu"/"in"/"com.au"/"jp"/"ca"
//                                 to match your Zoho data center)
//   3. Provide the new password via --new-password, or the
//      ZOHO_VAULT_NEW_PASSWORD env var, or omit both and you'll be
//      prompted (input is hidden if the terminal supports `stty`).
//
// Usage:
//   node scripts/zoho-vault-rotate-password.mjs \
//     --folder "Production Servers" --username jdoe [--new-password '...'] [--apply]
//
// Flags:
//   --folder <name>        Vault folder name to search in (required)
//   --username <name>      Username on the secret to match (required)
//   --new-password <value> New password to set (else env var / prompt)
//   --generate              Generate a random new password instead of asking
//   --secret-id <id>        Disambiguate when the folder+username match is not unique
//   --all                   Rotate every match instead of requiring exactly one
//   --dc <code>             Zoho data center (default "com")
//   --dry-run               Print what would happen without writing (default)
//   --apply                 Actually perform the notes + password update

import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const DC_HOSTS = {
  com: { accounts: "accounts.zoho.com", vault: "vault.zoho.com" },
  eu: { accounts: "accounts.zoho.eu", vault: "vault.zoho.eu" },
  in: { accounts: "accounts.zoho.in", vault: "vault.zoho.in" },
  "com.au": { accounts: "accounts.zoho.com.au", vault: "vault.zoho.com.au" },
  jp: { accounts: "accounts.zoho.jp", vault: "vault.zoho.jp" },
  ca: { accounts: "accounts.zohocloud.ca", vault: "vault.zohocloud.ca" },
};

function parseArgs(argv) {
  const args = { dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--folder":
        args.folder = argv[++i];
        break;
      case "--username":
        args.username = argv[++i];
        break;
      case "--new-password":
        args.newPassword = argv[++i];
        break;
      case "--secret-id":
        args.secretId = argv[++i];
        break;
      case "--dc":
        args.dc = argv[++i];
        break;
      case "--generate":
        args.generate = true;
        break;
      case "--all":
        args.all = true;
        break;
      case "--apply":
        args.dryRun = false;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!args.folder) throw new Error("--folder is required");
  if (!args.username) throw new Error("--username is required");
  return args;
}

function generatePassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const canMute = process.stdin.isTTY && spawnSync("stty", ["-echo"]).status === 0;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", (answer) => {
      rl.close();
      if (canMute) spawnSync("stty", ["echo"]);
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function resolveNewPassword(args) {
  if (args.newPassword) return args.newPassword;
  if (process.env.ZOHO_VAULT_NEW_PASSWORD) return process.env.ZOHO_VAULT_NEW_PASSWORD;
  if (args.generate) return generatePassword();
  return promptHidden("New password: ");
}

async function getAccessToken(dc) {
  if (process.env.ZOHO_VAULT_ACCESS_TOKEN) return process.env.ZOHO_VAULT_ACCESS_TOKEN;

  const { clientId, clientSecret, refreshToken } = {
    clientId: process.env.ZOHO_VAULT_CLIENT_ID,
    clientSecret: process.env.ZOHO_VAULT_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_VAULT_REFRESH_TOKEN,
  };
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Set ZOHO_VAULT_ACCESS_TOKEN, or all of ZOHO_VAULT_CLIENT_ID / " +
        "ZOHO_VAULT_CLIENT_SECRET / ZOHO_VAULT_REFRESH_TOKEN",
    );
  }

  const res = await fetch(`https://${dc.accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Failed to refresh Zoho access token: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

// Centralizing the raw request shapes here — this is the part to check
// against your own Zoho Vault API docs (see the header comment above).
const ZOHO_API = {
  listSecrets: (dc) => ({ method: "GET", path: "/secrets" }),
  getSecret: (dc, secretId) => ({ method: "GET", path: `/secrets/${secretId}` }),
  updateNotes: (secretId, notes) => ({
    method: "PUT",
    path: `/secrets/${secretId}`,
    body: { input_data: JSON.stringify({ secretData: { notes } }) },
  }),
  updatePassword: (secretId, newPassword) => ({
    method: "PUT",
    path: `/secrets/${secretId}/updatepassword`,
    body: { input_data: JSON.stringify({ passwordData: { newPassword } }) },
  }),
};

async function zohoRequest(dc, token, { method, path, body }) {
  const res = await fetch(`https://${dc.vault}/api/rest/json/v1${path}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(
      `Zoho Vault API error (${method} ${path}): ${res.status} ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

// Field names (FOLDERNAME/USERNAME/SECRETID/…) follow the shape Zoho Vault
// examples use for list/detail responses — double check against a real
// response from your account, since the API may nest these differently.
function extractSecretSummary(row) {
  return {
    id: row.SECRETID ?? row.secretId ?? row.id,
    name: row.SECRETNAME ?? row.secretName,
    folderName: row.FOLDERNAME ?? row.folderName,
    username: row.USERNAME ?? row.username,
  };
}

function extractSecretDetail(row) {
  return {
    password: row.PASSWORD ?? row.password,
    notes: row.NOTES ?? row.notes ?? "",
  };
}

function composeNotes(existingNotes, oldPassword) {
  const line = `old password: ${oldPassword}`;
  return existingNotes && existingNotes.trim().length > 0 ? `${line}\n${existingNotes}` : line;
}

async function findMatches(dc, token, folder, username) {
  const list = await zohoRequest(dc, token, ZOHO_API.listSecrets(dc));
  const rows = Array.isArray(list) ? list : (list.secrets ?? list.data ?? []);
  return rows
    .map(extractSecretSummary)
    .filter((s) => s.folderName === folder && s.username === username);
}

async function rotateSecret(dc, token, summary, newPassword, dryRun) {
  const detail = extractSecretDetail(
    await zohoRequest(dc, token, ZOHO_API.getSecret(dc, summary.id)),
  );
  const newNotes = composeNotes(detail.notes, detail.password);

  console.log(
    `\n[${summary.name ?? summary.id}] folder="${summary.folderName}" username="${summary.username}"`,
  );
  console.log(`  old password: ${detail.password}`);
  console.log(`  notes will become:\n    ${newNotes.replace(/\n/g, "\n    ")}`);

  if (dryRun) {
    console.log("  (dry run — no changes made; re-run with --apply to write)");
    return;
  }

  await zohoRequest(dc, token, ZOHO_API.updateNotes(summary.id, newNotes));
  await zohoRequest(dc, token, ZOHO_API.updatePassword(summary.id, newPassword));
  console.log("  updated notes and password");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dcCode = args.dc ?? process.env.ZOHO_VAULT_DC ?? "com";
  const dc = DC_HOSTS[dcCode];
  if (!dc) throw new Error(`Unknown data center "${dcCode}". Known values: ${Object.keys(DC_HOSTS).join(", ")}`);

  const token = await getAccessToken(dc);
  const matches = await findMatches(dc, token, args.folder, args.username);

  if (matches.length === 0) {
    throw new Error(`No secret found in folder "${args.folder}" with username "${args.username}"`);
  }

  let targets = matches;
  if (args.secretId) {
    targets = matches.filter((m) => String(m.id) === String(args.secretId));
    if (targets.length === 0)
      throw new Error(`--secret-id ${args.secretId} did not match any of the found secrets`);
  } else if (matches.length > 1 && !args.all) {
    console.error(
      `Found ${matches.length} secrets matching folder "${args.folder}" + username "${args.username}":`,
    );
    for (const m of matches) console.error(`  - id=${m.id} name="${m.name}"`);
    throw new Error("Pass --secret-id to pick one, or --all to rotate every match");
  }

  const newPassword = await resolveNewPassword(args);
  if (!newPassword) throw new Error("No new password provided");

  if (args.dryRun) console.log("Running in DRY RUN mode (pass --apply to write changes)");

  for (const target of targets) {
    await rotateSecret(dc, token, target, newPassword, args.dryRun);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
