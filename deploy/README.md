# Deploying Zenith Ticketing to a plain server (AWS EC2)

This app was pulled from Lovable, which builds it for Cloudflare Workers by
default (Nitro preset `cloudflare-module`). For a plain Linux server, build
with the `node-server` preset instead — that produces a standalone Node.js
server at `.output/server/index.mjs` that respects `HOST`/`PORT` env vars.
This has been verified to build and serve correctly.

## Server requirements

- **OS**: Ubuntu 22.04/24.04 LTS (or any recent Debian/RHEL-family distro)
- **Size**: 2 vCPU / 2–4 GB RAM is comfortable for build + run; the build step
  is the heaviest part (bundles ~600 packages)
- **Software**: Node.js 22.x, `git`. Optional: `bun` (faster installs; the
  repo's lockfile is `bun.lock`) or plain `npm`.
- **Security group / firewall (inbound)**:
  - 22/tcp — SSH (restrict to your IP)
  - 3000/tcp — the app itself, for the "just use the IP" phase (or 80/tcp if
    you front it with a reverse proxy — see below)
- **Outbound**: must reach the public internet (npm registry, Supabase)

## One-time setup

```bash
# as a sudo-capable user
sudo useradd -r -m -d /opt/zenith-ticketing -s /usr/sbin/nologin zenith || true
sudo mkdir -p /opt/zenith-ticketing
sudo chown "$USER" /opt/zenith-ticketing
git clone <this-repo-url> /opt/zenith-ticketing
cd /opt/zenith-ticketing
git checkout claude/zenith-ticketing-deploy-bz2o23

# Create the env file (not committed to git — see below for the variable names)
sudo -u zenith tee /opt/zenith-ticketing/.env > /dev/null <<'EOF'
SUPABASE_PROJECT_ID=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_URL=...
EOF

sudo chown -R zenith:zenith /opt/zenith-ticketing
sudo cp deploy/zenith-ticketing.service /etc/systemd/system/zenith-ticketing.service
sudo systemctl daemon-reload
sudo systemctl enable zenith-ticketing
```

Then run `deploy/deploy.sh` (as a user in the `sudo` group, or adjust the
script if you'd rather run the build as the `zenith` user directly) to build
and start it for the first time, and again on every future update.

The `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`/`VITE_*` values are the same
ones already in this project's local `.env` (get them from whoever has the
Lovable project, or the Supabase dashboard for project
`oypxpodvjjxwhzkawhnx`) — they're publishable/anon keys, not secret, but are
still kept out of git as a matter of hygiene.

`SUPABASE_SERVICE_ROLE_KEY` **is** a real secret (Project Settings -> API in
the Supabase dashboard) — never commit it. It's required for any server-side
code that bypasses RLS, including reading secrets from the Vault below.

## Roles and the Vault

The app has four roles, each a superset of the one before: **Guest**
(customer/requester) < **Agent** (support staff) < **Admin** (desk
configuration — SLA, fields, macros, departments, sharing) < **Superadmin**
(everything Admin can do, plus the only role that can manage the **Vault** —
this workspace's store of encrypted secrets like API keys — and the only
role that can grant or revoke Superadmin itself).

**Apply the DB migration once** — this repo doesn't have a live `drizzle
migrate` wired up (Lovable applied these directly; see `drizzle/migrations/`
for the plain SQL files). Run the new one against your Supabase Postgres
connection, e.g. via the Supabase Dashboard's SQL Editor, or:

```bash
psql "$SUPABASE_DB_URL" -f drizzle/migrations/0003_vault_and_superadmin.sql
```

If it errors on `create extension if not exists supabase_vault`, enable
"Vault" first under Supabase Dashboard -> Database -> Extensions, then
re-run the file.

**Bootstrap the first superadmin** — nobody gets this role automatically (by
design). Sign up normally, find your user id (Supabase Dashboard -> Auth ->
Users, or `select id from auth.users where email = '...'`), then:

```sql
insert into public.user_roles (user_id, role) values ('<your-auth-uid>', 'superadmin');
```

From there, a superadmin can promote others from the Settings -> People &
roles tab, and manage secrets from the new Settings -> Vault tab — values are
write-only in the UI (masked as `••••••••`, never shown again once saved).

`ANTHROPIC_API_KEY` (for the AI Copilot — ticket insight, reply drafting, KB
article generation, calling the Claude API directly) can be set either way:
as an env var in `.env` (checked first), or by a superadmin via the Vault UI
(checked as a fallback, cached 30s). Get a key from
[console.anthropic.com](https://console.anthropic.com). Without it set
either way, the rest of the app works fine — only Copilot returns a
"not configured" error.

## Verifying

```bash
curl -I http://localhost:3000/
```

should return `HTTP/1.1 200 OK`. From outside, `http://<server-ip>:3000/`.

## Later: fronting with Cloudflare / a domain

Once you're ready to move off the bare IP, put Cloudflare (or nginx +
Let's Encrypt) in front of port 3000 on 80/443, and switch the security
group to only allow 3000 from localhost/the reverse proxy. Nothing about the
Node build changes for that step.
