#!/usr/bin/env python3
"""Step through the SAME two HTTP calls change_app_password() makes --
(1) auth: POST /v1/auth/tokens, (2) change-password: PUT
/users/change_password/{user_id} -- for ONE secret, printing the full
request shape and full response (status, headers, body) at each step, so
we can see exactly which call fails and with what detail, beyond the
one-line summary the main script prints.

Uses the secret's REAL current password, decrypted from Vault. Step 2 is
a REAL password-change attempt, not a simulation -- if it unexpectedly
succeeds where a previous run failed, this script immediately writes the
new password to Vault (same safety as the main rotation script), so it
never leaves Vault stale even if this diagnostic run happens to work.

Setup: same environment variables as zoho_vault_rotate_password.py.

Usage:
  python3 scripts/diag_change_password_steps.py --folder-id 2052000001420065 \
    --secret-name cs.support.blackstone.read
"""

import argparse
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import requests

import zoho_vault_rotate_password as m
import zvcrypto


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True)
    p.add_argument("--secret-name", required=True)
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"))
    return p.parse_args()


def mask(value):
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * (len(value) - 4) + value[-2:]


def print_response(resp):
    print(f"  status: {resp.status_code}")
    print(f"  headers:")
    for k, v in resp.headers.items():
        print(f"    {k}: {v}")
    print(f"  body: {resp.text}")


def main():
    args = parse_args()
    dc = m.DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(m.DC_HOSTS)}")

    token = m.get_access_token(dc)
    master_password = os.environ.get("ZOHO_VAULT_MASTER_PASSWORD")
    if not master_password:
        sys.exit("Set ZOHO_VAULT_MASTER_PASSWORD")
    master_key, org_key = m.derive_keys(dc, token, master_password)

    rows = m.list_secrets(dc, token, folder_id=args.folder_id)
    row = next((r for r in rows if r.get("secretname") == args.secret_name), None)
    if not row:
        sys.exit(f"No secret named {args.secret_name!r} found in folder {args.folder_id}")

    username, current_password, key, secret_data, username_field, password_field = m.decrypt_credentials(row, master_key, org_key)
    endpoint, matched_url, reason = m.resolve_app_endpoint(row, key=key)
    if not endpoint:
        sys.exit(f"Could not resolve an endpoint: {reason}")

    print(f"Secret: {args.secret_name}  (secretid={row['secretid']})")
    print(f"Endpoint: {endpoint}  (via {matched_url})")
    print(f"Username: {username!r}")
    print(f"Password: {mask(current_password)!r}  (len={len(current_password)})")
    print()

    print("=== STEP 1: auth (POST /v1/auth/tokens) ===")
    print(f"  request body: {{'username': {username!r}, 'password': {mask(current_password)!r}}}")
    auth_resp = requests.post(
        f"https://{endpoint}/v1/auth/tokens",
        headers={"accept": "application/json", "Content-Type": "application/json"},
        json={"username": username, "password": current_password},
        timeout=30,
    )
    print_response(auth_resp)
    print()

    if auth_resp.status_code // 100 != 2:
        sys.exit("STEP 1 (auth) failed -- stopping here, step 2 was never attempted.")

    auth_body = auth_resp.json()
    app_token = (auth_body.get("token") or {}).get("access_token")
    user_id = (auth_body.get("user") or {}).get("id")
    print(f"  extracted token: {mask(app_token) if app_token else None}")
    print(f"  extracted user_id: {user_id!r}")
    print()

    if not app_token or not user_id:
        sys.exit("STEP 1 succeeded but the response is missing token/user id -- stopping here.")

    print("STEP 1 succeeded. Proceeding to STEP 2 -- this is a REAL password change attempt.")
    confirm = input("Type 'yes' to proceed with the real change_password call: ")
    if confirm.strip().lower() != "yes":
        sys.exit("Aborted before step 2 -- nothing was changed.")

    new_password = m.generate_password()
    print()
    print("=== STEP 2: change password (PUT /users/change_password/{user_id}) ===")
    print(f"  request body: {{'current_password': {mask(current_password)!r}, 'new_password': {mask(new_password)!r}}}")
    change_resp = requests.put(
        f"https://{endpoint}/users/change_password/{user_id}",
        headers={"accept": "application/json", "X-Auth-Token": app_token, "Content-Type": "application/json"},
        json={"current_password": current_password, "new_password": new_password},
        timeout=30,
    )
    print_response(change_resp)
    print()

    if change_resp.status_code != 200:
        print("STEP 2 failed -- Vault was NOT touched (current_password in Vault is still correct).")
        return

    print("STEP 2 SUCCEEDED -- the live app password just changed for real.")
    print("Writing the new password to Vault now so it doesn't go stale...")
    new_secret_data = {**secret_data, password_field: zvcrypto.aes_encrypt(new_password, key)}
    description = f"Password rotated: {datetime.now(timezone.utc).strftime('%B %Y')}"
    m.update_secret(dc, token, row["secretid"], m.build_full_update_payload(row, secretdata=new_secret_data, description=description))
    print("Vault updated successfully -- this secret is now fully in sync.")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
