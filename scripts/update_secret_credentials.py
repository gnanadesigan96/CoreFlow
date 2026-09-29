#!/usr/bin/env python3
"""Manually set the username and/or password Vault stores for ONE secret,
to whatever is now actually correct on the application side -- e.g. after
investigating a rotation failure and finding the real current credential
(a manually-set password, a corrected username) rather than what Vault has.

This script does NOT call the application at all -- it only writes to
Vault. Use --new-username and/or --new-password depending on what needs
fixing; give just one if only one field is wrong.

Setup: same environment variables as zoho_vault_rotate_password.py
  (ZOHO_VAULT_CLIENT_ID/SECRET/REFRESH_TOKEN, ZOHO_VAULT_DC,
  ZOHO_VAULT_MASTER_PASSWORD).

Usage:
  # Password only:
  python3 scripts/update_secret_credentials.py --folder-id 2052000001420065 \
    --secret-name cs.support.blackstone.read --new-password

  # Username only (given directly, since a username isn't normally secret):
  python3 scripts/update_secret_credentials.py --folder-id 2052000001420065 \
    --secret-name Redington --new-username cs.support.redington.read@corestack.io

  # Both:
  python3 scripts/update_secret_credentials.py --folder-id 2052000001420065 \
    --secret-name cs.support.hitachi.read \
    --new-username cs.support.hitachi.read@corestack.io --new-password

--new-password with no value prompts for it (typed twice, not echoed).
"""

import argparse
import getpass
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zoho_vault_rotate_password as m
import zvcrypto


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True, help="Vault chamberId (folder ID) the secret lives in")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--secret-name", help="Exact secretname to fix (must match exactly one secret in the folder)")
    group.add_argument("--secret-id", help="Vault secretid to fix, if the name is ambiguous or unknown")
    p.add_argument("--new-username", help="New username to store. Omit to leave the username unchanged.")
    p.add_argument("--new-password", action="store_true", help="Prompt for a new password (typed twice, not echoed) to store. Omit to leave the password unchanged.")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"), help="Zoho data center (default: com, or $ZOHO_VAULT_DC)")
    return p.parse_args()


def find_row(rows, args):
    if args.secret_id:
        matches = [r for r in rows if str(r.get("secretid")) == str(args.secret_id)]
        if not matches:
            sys.exit(f"No secret with secretid {args.secret_id!r} found in folder {args.folder_id}")
    else:
        matches = [r for r in rows if r.get("secretname") == args.secret_name]
        if not matches:
            sys.exit(f"No secret named {args.secret_name!r} found in folder {args.folder_id}")
        if len(matches) > 1:
            ids = ", ".join(str(r.get("secretid")) for r in matches)
            sys.exit(f"Multiple secrets named {args.secret_name!r} found (secretids: {ids}) -- rerun with --secret-id instead")
    return matches[0]


def main():
    args = parse_args()
    if not args.new_username and not args.new_password:
        sys.exit("Nothing to do -- pass --new-username and/or --new-password")

    dc = m.DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(m.DC_HOSTS)}")

    token = m.get_access_token(dc)
    master_password = os.environ.get("ZOHO_VAULT_MASTER_PASSWORD")
    if not master_password:
        sys.exit("Set ZOHO_VAULT_MASTER_PASSWORD (your Vault account's actual Master Password)")
    master_key, org_key = m.derive_keys(dc, token, master_password)

    rows = m.list_secrets(dc, token, folder_id=args.folder_id)
    row = find_row(rows, args)
    name = row.get("secretname") or row["secretid"]

    current_username, current_password, key, secret_data, username_field, password_field = m.decrypt_credentials(row, master_key, org_key)
    print(f"Found: {name}  (secretid={row['secretid']})")
    print(f"  Current username in Vault: {current_username!r}")
    print(f"  Current password in Vault: {current_password!r}")
    print()

    new_username = current_username
    new_password_plain = current_password
    changes = []

    if args.new_username:
        new_username = args.new_username
        changes.append(f"username -> {new_username!r}")

    if args.new_password:
        print("Enter the new password to store. Not echoed.")
        pw1 = getpass.getpass("New password: ")
        pw2 = getpass.getpass("Confirm new password: ")
        if pw1 != pw2:
            sys.exit("Passwords did not match -- nothing written. Rerun and try again.")
        if not pw1:
            sys.exit("Empty password entered -- nothing written.")
        new_password_plain = pw1
        changes.append("password -> (hidden)")

    print(f"About to update {name!r}: {', '.join(changes)}")
    confirm = input("Type 'yes' to proceed: ")
    if confirm.strip().lower() != "yes":
        sys.exit("Aborted -- nothing written.")

    new_secret_data = {
        **secret_data,
        username_field: zvcrypto.aes_encrypt(new_username, key),
        password_field: zvcrypto.aes_encrypt(new_password_plain, key),
    }
    field_summary = " and ".join(c.split(" -> ")[0] for c in changes)
    description = f"{field_summary.capitalize()} manually updated: {datetime.now(timezone.utc).strftime('%B %Y')}"
    m.update_secret(dc, token, row["secretid"], m.build_full_update_payload(row, secretdata=new_secret_data, description=description))
    print(f"Done -- Vault updated for {name!r}.")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
