#!/usr/bin/env python3
"""Recover secrets left stale after a shared-account sibling's Vault sync
failed (e.g. the PATTERN_NOT_MATCHED bug from embedding a secret name in
the description, fixed in zoho_vault_rotate_password.py). The live app
password is already correct -- it was changed once, successfully, by the
PRIMARY secret in the group -- but one or more SIBLING secrets' Vault
entries never got updated to match. Since every secret in the group
shares the exact same live account, the correct password is simply
whatever the primary's Vault entry currently has.

This does NOT call the application at all -- it reads the primary's
current (already correct) password from Vault and writes that exact
value into each listed sibling's Vault entry, re-encrypted with that
sibling's own key.

Setup: same environment variables as zoho_vault_rotate_password.py.

Usage (one primary + all of its affected siblings per run):
  python3 scripts/resync_siblings_from_primary.py --folder-id 2052000001537904 \
    --primary "New-ACP_CreativIT" \
    --sibling "New-admin.hensen" --sibling "New-Aliando" --sibling "New-BlueMantis_CSP"
"""

import argparse
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zoho_vault_rotate_password as m
import zvcrypto


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True)
    p.add_argument("--primary", required=True, help="Secret name whose Vault entry already has the correct (live) password")
    p.add_argument("--sibling", action="append", required=True, help="Secret name(s) to sync to match the primary. Repeatable.")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"))
    return p.parse_args()


def mask(value):
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * (len(value) - 4) + value[-2:]


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
    by_name = {r.get("secretname"): r for r in rows}

    primary_row = by_name.get(args.primary)
    if not primary_row:
        sys.exit(f"Primary secret {args.primary!r} not found in folder {args.folder_id}")

    _, primary_password, _, _, _, _ = m.decrypt_credentials(primary_row, master_key, org_key)
    print(f"Primary: {args.primary}  (secretid={primary_row['secretid']})")
    print(f"Current password there (masked): {mask(primary_password)!r}  (len={len(primary_password)})")
    print()

    missing = [s for s in args.sibling if s not in by_name]
    if missing:
        print("NOT FOUND in this folder, skipped:")
        for s in missing:
            print(f"  - {s}")
        print()

    present_siblings = [s for s in args.sibling if s in by_name]
    if not present_siblings:
        sys.exit("No valid sibling names given -- nothing to do.")

    print(f"Will sync {len(present_siblings)} sibling(s) to the primary's current password:")
    for s in present_siblings:
        print(f"  - {s}")
    confirm = input("Type 'yes' to proceed: ")
    if confirm.strip().lower() != "yes":
        sys.exit("Aborted -- nothing written.")

    description = f"Password rotated: {datetime.now(timezone.utc).strftime('%B %Y')}"
    succeeded, failed = [], []
    for name in present_siblings:
        row = by_name[name]
        try:
            _, _, key, secret_data, username_field, password_field = m.decrypt_credentials(row, master_key, org_key)
            new_secret_data = {**secret_data, password_field: zvcrypto.aes_encrypt(primary_password, key)}
            m.update_secret(dc, token, row["secretid"], m.build_full_update_payload(row, secretdata=new_secret_data, description=description))
            print(f"  [ok] {name}")
            succeeded.append(name)
        except Exception as e:
            print(f"  [FAILED] {name} -- {e}")
            failed.append(name)

    print()
    print(f"Done: {len(succeeded)} succeeded, {len(failed)} failed.")
    if failed:
        print("Failed (still stale -- rerun once the issue is fixed):")
        for n in failed:
            print(f"  - {n}")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
