#!/usr/bin/env python3
"""Find secrets within a folder that share the same (username, endpoint)
pair -- strong evidence they're the SAME live application account
referenced by multiple separate Vault entries. Rotating each one
independently would overwrite the live account's password repeatedly,
leaving every entry but the last one processed stale.

Setup: same environment variables as zoho_vault_rotate_password.py.

Usage:
  python3 scripts/diag_duplicate_accounts.py --folder-id 2052000001537904
"""

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zoho_vault_rotate_password as m


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True)
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"))
    return p.parse_args()


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
    groups = defaultdict(list)
    skipped = []

    for row in rows:
        name = row.get("secretname") or row["secretid"]
        try:
            username, password, key, secret_data, uf, pf = m.decrypt_credentials(row, master_key, org_key)
        except Exception as e:
            skipped.append((name, f"decrypt error: {e}"))
            continue
        endpoint, matched_url, reason = m.resolve_app_endpoint(row, key=key)
        if not endpoint:
            skipped.append((name, reason))
            continue
        groups[(username, endpoint)].append(name)

    duplicates = {k: v for k, v in groups.items() if len(v) > 1}

    print(f"Checked {len(rows)} secrets in folder {args.folder_id}.\n")

    if not duplicates:
        print("No (username, endpoint) pairs shared by more than one secret -- every secret maps to a distinct account.")
    else:
        total_duplicate_secrets = sum(len(v) for v in duplicates.values())
        print(f"Found {len(duplicates)} account(s) shared across multiple secrets ({total_duplicate_secrets} secrets total):\n")
        for (username, endpoint), names in sorted(duplicates.items(), key=lambda kv: -len(kv[1])):
            print(f"  {username!r} @ {endpoint}  ({len(names)} secrets):")
            for n in names:
                print(f"    - {n}")
            print()

    if skipped:
        print(f"\n{len(skipped)} secret(s) skipped (couldn't determine username/endpoint):")
        for name, reason in skipped:
            print(f"  - {name}: {reason}")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
