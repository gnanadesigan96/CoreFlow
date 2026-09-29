#!/usr/bin/env python3
"""Batch version of resync_stale_secret.py: writes the SAME new password
into MANY Vault secrets in one shot -- for the case where several secrets
got stuck in the "app password already changed, Vault write failed" state
(e.g. the description PATTERN_NOT_MATCHED incident) and were all reset to
one shared password on the application side.

This script does NOT call the application at all -- same as
resync_stale_secret.py, it assumes the new password is already live on
each application account (e.g. via an admin-level force-reset), and only
writes that known password into the matching Vault secrets.

Setup: same environment variables as zoho_vault_rotate_password.py
  (ZOHO_VAULT_CLIENT_ID/SECRET/REFRESH_TOKEN, ZOHO_VAULT_DC,
  ZOHO_VAULT_MASTER_PASSWORD).

Usage (repeat --secret-name for each one):
  python3 scripts/resync_stale_secrets_batch.py --folder-id 2052000001420065 \
    --secret-name admin.ishift.read \
    --secret-name cs.support.blackstone.read \
    --secret-name cs.support.clicko.read

Or put one secret name per line in a text file and pass it instead:
  python3 scripts/resync_stale_secrets_batch.py --folder-id 2052000001420065 \
    --names-file stale_secrets.txt

You'll be prompted ONCE for the shared new password (typed twice, not
echoed), shown the full list of matched secrets for review, and asked for
one final 'yes' before anything is written.
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
    p.add_argument("--folder-id", required=True, help="Vault chamberId (folder ID) the secrets live in")
    p.add_argument("--secret-name", action="append", default=[], help="Exact secretname to fix. Repeat for each secret.")
    p.add_argument("--names-file", help="Path to a text file with one exact secretname per line (blank lines and lines starting with # are ignored)")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"), help="Zoho data center (default: com, or $ZOHO_VAULT_DC)")
    return p.parse_args()


def load_names(args):
    names = list(args.secret_name)
    if args.names_file:
        with open(args.names_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    names.append(line)
    # De-duplicate while preserving order.
    seen = set()
    deduped = []
    for n in names:
        if n not in seen:
            seen.add(n)
            deduped.append(n)
    if not deduped:
        sys.exit("No secret names given -- use --secret-name (repeatable) and/or --names-file")
    return deduped


def match_rows(rows, names):
    """Returns (matched: [(name, row)], missing: [name], duplicates: {name: [rows]})."""
    by_name = {}
    for row in rows:
        by_name.setdefault(row.get("secretname"), []).append(row)

    matched = []
    missing = []
    duplicates = {}
    for name in names:
        candidates = by_name.get(name, [])
        if not candidates:
            missing.append(name)
        elif len(candidates) > 1:
            duplicates[name] = candidates
        else:
            matched.append((name, candidates[0]))
    return matched, missing, duplicates


def main():
    args = parse_args()
    names = load_names(args)
    dc = m.DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(m.DC_HOSTS)}")

    token = m.get_access_token(dc)
    master_password = os.environ.get("ZOHO_VAULT_MASTER_PASSWORD")
    if not master_password:
        sys.exit("Set ZOHO_VAULT_MASTER_PASSWORD (your Vault account's actual Master Password)")
    master_key, org_key = m.derive_keys(dc, token, master_password)

    rows = m.list_secrets(dc, token, folder_id=args.folder_id)
    matched, missing, duplicates = match_rows(rows, names)

    if missing:
        print("NOT FOUND in this folder (fix the name or --folder-id, nothing written for these):")
        for n in missing:
            print(f"  - {n}")
        print()
    if duplicates:
        print("AMBIGUOUS -- multiple secrets share this name, skipped (use resync_stale_secret.py --secret-id for these instead):")
        for n, dup_rows in duplicates.items():
            ids = ", ".join(str(r.get("secretid")) for r in dup_rows)
            print(f"  - {n}  (secretids: {ids})")
        print()

    if not matched:
        sys.exit("Nothing to do -- no names matched exactly one secret in this folder.")

    print(f"Will update {len(matched)} secret(s) with the SAME new password:")
    for name, row in matched:
        print(f"  - {name}  (secretid={row['secretid']})")
    print()

    print("Enter the NEW password that is now actually set on ALL of the")
    print("application accounts listed above. Not echoed.")
    new_password = getpass.getpass("New password (shared by all): ")
    new_password_confirm = getpass.getpass("Confirm new password: ")
    if new_password != new_password_confirm:
        sys.exit("Passwords did not match -- nothing written. Rerun and try again.")
    if not new_password:
        sys.exit("Empty password entered -- nothing written.")

    confirm = input(f"About to overwrite Vault's password for {len(matched)} secret(s) with the value you just entered. Type 'yes' to proceed: ")
    if confirm.strip().lower() != "yes":
        sys.exit("Aborted -- nothing written.")

    description = f"Password manually resynced: {datetime.now(timezone.utc).strftime('%B %Y')}"
    succeeded, failed = [], []
    for name, row in matched:
        try:
            _, _, key, secret_data, username_field, password_field = m.decrypt_credentials(row, master_key, org_key)
            new_secret_data = {**secret_data, password_field: zvcrypto.aes_encrypt(new_password, key)}
            m.update_secret(dc, token, row["secretid"], m.build_full_update_payload(row, secretdata=new_secret_data, description=description))
            print(f"  [ok] {name}")
            succeeded.append(name)
        except Exception as e:
            print(f"  [FAILED] {name} -- {e}")
            failed.append(name)

    print()
    print(f"Done: {len(succeeded)} succeeded, {len(failed)} failed.")
    if failed:
        print("Failed (Vault still stale for these -- rerun for just these once the issue is fixed):")
        for n in failed:
            print(f"  - {n}")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
