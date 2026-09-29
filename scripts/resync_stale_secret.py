#!/usr/bin/env python3
"""Manually resync ONE Vault secret after its live application password was
already changed successfully but the Vault write failed afterward, leaving
Vault showing a STALE (now-invalid) password -- e.g. the PATTERN_NOT_MATCHED
incident from the description field on 2026-09-28.

This script does NOT call the application at all. It assumes you have
already set a new, KNOWN password on the live application side -- normally
via an admin-level force-reset, since the app's self-service change-password
flow needs the CURRENT password, and the app no longer accepts the one
still stored in Vault. This script's only job is to write that known new
password into the correct Vault secret, encrypted with the right key, using
the same safe (letters/digits/space/colon only) description format as the
main rotation script.

Setup: same environment variables as zoho_vault_rotate_password.py
  (ZOHO_VAULT_CLIENT_ID/SECRET/REFRESH_TOKEN, ZOHO_VAULT_DC,
  ZOHO_VAULT_MASTER_PASSWORD).

Usage:
  python3 scripts/resync_stale_secret.py --folder-id 2052000001420065 --secret-name admin.ishift.read
  python3 scripts/resync_stale_secret.py --folder-id 2052000001420065 --secret-id 2052000001420068

You'll be prompted to paste the new password twice (not echoed to the
terminal) to guard against a typo permanently locking Vault out of an
account that was just recovered.
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
    group.add_argument("--secret-id", help="Vault secretid to fix, e.g. from a 'Zoho Vault API error updating secret <id>' message")
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

    username, current_vault_password, key, secret_data, username_field, password_field = m.decrypt_credentials(row, master_key, org_key)
    print(f"Found: {name}  (secretid={row['secretid']})")
    print(f"  Username in Vault: {username!r}")
    print(f"  Password Vault currently has (STALE, no longer valid on the app): {current_vault_password!r}")
    print()
    print("Enter the NEW password that is now actually set on the live application")
    print("(e.g. the one you just set via an admin force-reset). Not echoed.")
    new_password = getpass.getpass("New password: ")
    new_password_confirm = getpass.getpass("Confirm new password: ")
    if new_password != new_password_confirm:
        sys.exit("Passwords did not match -- nothing written. Rerun and try again.")
    if not new_password:
        sys.exit("Empty password entered -- nothing written.")

    confirm = input(f"About to overwrite Vault's password for {name!r} with the value you just entered. Type 'yes' to proceed: ")
    if confirm.strip().lower() != "yes":
        sys.exit("Aborted -- nothing written.")

    new_secret_data = {**secret_data, password_field: zvcrypto.aes_encrypt(new_password, key)}
    description = f"Password manually resynced: {datetime.now(timezone.utc).strftime('%B %Y')}"
    m.update_secret(dc, token, row["secretid"], m.build_full_update_payload(row, secretdata=new_secret_data, description=description))
    print(f"Done -- Vault's password for {name!r} now matches what you entered.")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
