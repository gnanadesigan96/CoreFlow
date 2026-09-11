#!/usr/bin/env python3
"""Rotate a Zoho Vault secret's password: read the current password, then set a new one.

Finds the secret in a given Vault folder (chamberId) whose username matches, decrypts
its current password (for your own record-keeping -- Vault's own "History" panel on
the secret already keeps every past password automatically), then encrypts and sets
a new password.

STATUS: the two functions below -- decrypt_secret_data() and encrypt_secret_data() --
are NOT implemented. Zoho Vault uses a host-proof-hosting / zero-knowledge scheme:
the API only ever stores/returns encrypted values, and Zoho does not publish the
client-side crypto routines -- they only hand them out on request via
support@zohovault.com (confirmed directly by their support team in their community
forum). Everything else in this script (auth, listing, matching, the request shapes)
is wired up and tested against the real API today; only those two functions are
waiting on Zoho's response.

Confirmed today against a live account (DC: in):
  - OAuth: POST https://accounts.zoho.<dc>/oauth/v2/token, params in form body,
    grant_type=refresh_token, scope ZohoVault.secrets.ALL
  - List:  GET https://vault.zoho.<dc>/api/rest/json/v1/secrets
           required params: isAsc, pageNum, rowPerPage (NOT sortColumn -- that
           param does not exist and causes EXTRA_PARAM_FOUND)
           optional: passwordName, filter, passwordType, chamberId (= folder ID)
  - Response envelope: {"operation": {"result": {...}, "Details": [ {...secret...} ]}}
    Each secret row includes secretid, secretname, notes, userid, and a
    secretData field which is a JSON *string* (not a nested object) shaped like
    '{"password":"<encrypted>","file":"","username":"<encrypted>"}'.
  - Folder ("chamber") ID can be read straight out of the Vault web UI's URL when
    browsing that folder, e.g. .../passwords/list?...&chamberid=2052000000005364
    -- no separate API call needed if you're doing this by hand once per folder.

NOT yet confirmed (best guess, needs verification once we have real docs/crypto):
  - The exact "Update Passwords" endpoint/payload shape. Based on the "Create
    Secret" example Zoho support shared publicly, it likely follows the same
    INPUT_DATA=<url-encoded JSON> convention, e.g.:
      PUT /api/rest/json/v1/secrets/{secretid}
      Content-Type: application/x-www-form-urlencoded
      body: INPUT_DATA=<url-encoded JSON: {"secretData": {"password": "<ENCRYPTED>"}}>
    Update ZOHO_API["update_password"] below once confirmed.

Setup (same as the OAuth flow already validated):
  export ZOHO_VAULT_CLIENT_ID=...
  export ZOHO_VAULT_CLIENT_SECRET=...
  export ZOHO_VAULT_REFRESH_TOKEN=...
  export ZOHO_VAULT_DC=in                 # or com/eu/com.au/jp/ca
  export ZOHO_VAULT_MASTER_PASSWORD=...   # needed once decrypt/encrypt are implemented

Usage:
  python3 scripts/zoho_vault_rotate_password.py \
    --folder-id 2052000000005364 --username cs.support.vault [--new-password '...'] [--apply]
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

DC_HOSTS = {
    "com": {"accounts": "accounts.zoho.com", "vault": "vault.zoho.com"},
    "eu": {"accounts": "accounts.zoho.eu", "vault": "vault.zoho.eu"},
    "in": {"accounts": "accounts.zoho.in", "vault": "vault.zoho.in"},
    "com.au": {"accounts": "accounts.zoho.com.au", "vault": "vault.zoho.com.au"},
    "jp": {"accounts": "accounts.zoho.jp", "vault": "vault.zoho.jp"},
    "ca": {"accounts": "accounts.zohocloud.ca", "vault": "vault.zohocloud.ca"},
}


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True, help="Vault chamberId (folder ID) -- read it from the folder's URL in the Vault web UI")
    p.add_argument("--username", required=True, help="Username on the secret to match")
    p.add_argument("--new-password", help="New password to set (else prompted)")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"), help="Zoho data center (default: com, or $ZOHO_VAULT_DC)")
    p.add_argument("--apply", action="store_true", help="Actually write the new password (default: dry run)")
    return p.parse_args()


def http_request(url, method="GET", data=None, headers=None):
    headers = headers or {}
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def get_access_token(dc):
    token = os.environ.get("ZOHO_VAULT_ACCESS_TOKEN")
    if token:
        return token

    client_id = os.environ.get("ZOHO_VAULT_CLIENT_ID")
    client_secret = os.environ.get("ZOHO_VAULT_CLIENT_SECRET")
    refresh_token = os.environ.get("ZOHO_VAULT_REFRESH_TOKEN")
    if not (client_id and client_secret and refresh_token):
        sys.exit("Set ZOHO_VAULT_ACCESS_TOKEN, or all of ZOHO_VAULT_CLIENT_ID / ZOHO_VAULT_CLIENT_SECRET / ZOHO_VAULT_REFRESH_TOKEN")

    status, body = http_request(
        f"https://{dc['accounts']}/oauth/v2/token",
        method="POST",
        data={
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        },
    )
    if status != 200 or "access_token" not in body:
        sys.exit(f"Failed to refresh Zoho access token: {body}")
    return body["access_token"]


def list_secrets(dc, token, folder_id=None, password_name=None):
    params = {"isAsc": "true", "pageNum": "1", "rowPerPage": "200"}
    if folder_id:
        params["chamberId"] = folder_id
    if password_name:
        params["passwordName"] = password_name

    url = f"https://{dc['vault']}/api/rest/json/v1/secrets?{urllib.parse.urlencode(params)}"
    status, body = http_request(url, headers={"Authorization": f"Zoho-oauthtoken {token}"})
    result = body.get("operation", {}).get("result", {})
    if status != 200 or result.get("status") != "Success":
        sys.exit(f"Zoho Vault API error listing secrets: {body}")
    return body["operation"].get("Details", [])


def find_secret_by_username(secrets, username):
    matches = []
    for row in secrets:
        secret_data = json.loads(row["secretData"])
        # secret_data["username"] is still ENCRYPTED at this point -- see
        # decrypt_secret_data() below. Matching by plaintext username therefore
        # requires decrypting every candidate first; this is a placeholder until
        # that function is implemented.
        matches.append((row, secret_data))
    return matches


def decrypt_secret_data(encrypted_value, master_password):
    """TODO: implement with Zoho's official crypto library once received.

    Community forum threads describe the outline (PBKDF2/AES, a per-account
    SALT + ITERATION count fetched via a GET_LOGIN-style call, master key
    derivation from the master password), but not the full algorithm --
    Zoho's support team confirmed the actual crypto files are only shared
    privately on request. Do not guess at this; get the real files first.
    """
    raise NotImplementedError(
        "decrypt_secret_data() needs Zoho's official crypto library -- "
        "see the module docstring and email support@zohovault.com"
    )


def encrypt_secret_data(plaintext_value, master_password):
    """TODO: implement with Zoho's official crypto library once received (see above)."""
    raise NotImplementedError(
        "encrypt_secret_data() needs Zoho's official crypto library -- "
        "see the module docstring and email support@zohovault.com"
    )


# Endpoint/payload NOT yet confirmed against real docs -- see module docstring.
def update_password(dc, token, secret_id, encrypted_new_password):
    input_data = json.dumps({"secretData": {"password": encrypted_new_password}})
    status, body = http_request(
        f"https://{dc['vault']}/api/rest/json/v1/secrets/{secret_id}",
        method="PUT",
        data={"INPUT_DATA": input_data},
        headers={"Authorization": f"Zoho-oauthtoken {token}"},
    )
    result = body.get("operation", {}).get("result", {})
    if status != 200 or result.get("status") != "Success":
        sys.exit(f"Zoho Vault API error updating password: {body}")


def main():
    args = parse_args()
    dc = DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(DC_HOSTS)}")

    token = get_access_token(dc)
    secrets = list_secrets(dc, token, folder_id=args.folder_id)
    candidates = find_secret_by_username(secrets, args.username)

    if not candidates:
        sys.exit(f"No secrets found in folder {args.folder_id}")

    master_password = os.environ.get("ZOHO_VAULT_MASTER_PASSWORD")
    if not master_password:
        sys.exit("Set ZOHO_VAULT_MASTER_PASSWORD (needed once decrypt/encrypt are implemented)")

    for row, secret_data in candidates:
        username = decrypt_secret_data(secret_data["username"], master_password)
        if username != args.username:
            continue

        old_password = decrypt_secret_data(secret_data["password"], master_password)
        print(f"[{row['secretname']}] current password: {old_password}")

        if not args.apply:
            print("  (dry run -- pass --apply to write a new password)")
            continue

        new_password = args.new_password or input("New password: ")
        encrypted = encrypt_secret_data(new_password, master_password)
        update_password(dc, token, row["secretid"], encrypted)
        print("  password updated")
        return

    sys.exit(f"No secret with username \"{args.username}\" found in folder {args.folder_id}")


if __name__ == "__main__":
    main()
