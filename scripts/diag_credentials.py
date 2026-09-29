#!/usr/bin/env python3
"""Diagnose why a specific secret's stored credentials might be failing
app authentication even though they're known to be correct -- checks for
(a) stray whitespace/invisible characters from decryption, and (b) which
API endpoint the script actually resolved for it, in case that's wrong
rather than the credential itself.

Never prints the full password -- only its length and first/last 2
characters, enough to sanity-check against what you tested manually
without putting the real value in this output.

Setup: same environment variables as zoho_vault_rotate_password.py.

Usage:
  python3 scripts/diag_credentials.py --folder-id 2052000001420065 \
    cs.support.ingram.read cs.support.kyndryl-saas.read cs.support.neurealm.read
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zoho_vault_rotate_password as m


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True)
    p.add_argument("names", nargs="+", help="Exact secretname(s) to inspect")
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

    for name in args.names:
        row = by_name.get(name)
        print(f"--- {name} ---")
        if not row:
            print("  NOT FOUND in this folder")
            print()
            continue

        username, password, key, secret_data, username_field, password_field = m.decrypt_credentials(row, master_key, org_key)
        endpoint, matched_url, reason = m.resolve_app_endpoint(row, key=key)

        weird_username_chars = [c for c in username if c.isspace() or not c.isprintable()]
        weird_password_chars = [c for c in password if c.isspace() or not c.isprintable()]

        print(f"  isshared: {row.get('isshared')!r}  (key used: {'org_key' if row.get('isshared') == 'YES' else 'master_key'})")
        print(f"  secretData fields used: username={username_field!r}, password={password_field!r}")
        print(f"  username: {username!r}  (len={len(username)})")
        print(f"  username has whitespace/invisible chars: {[repr(c) for c in weird_username_chars] or 'none'}")
        print(f"  password: {mask(password)!r}  (len={len(password)})")
        print(f"  password has whitespace/invisible chars: {[repr(c) for c in weird_password_chars] or 'none'}")
        print(f"  resolved endpoint: {endpoint}")
        print(f"  matched via URL: {matched_url}")
        if reason:
            print(f"  endpoint resolution failed: {reason}")
        print()


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
