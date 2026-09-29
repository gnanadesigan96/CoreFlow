#!/usr/bin/env python3
"""Dump every raw field Zoho returns for specific named secrets, to look for
credentials stored somewhere other than the standard secretData
username/password fields (e.g. a custom "Additional Field", the way some
secrets in this account store their URL under encryptedurls instead of the
standard secreturl field).

Redacts secretData (shows only its keys and each value's length, not the
ciphertext itself) since that's the field most likely to actually hold
something sensitive-shaped; every other field is printed as-is, since
Zoho's own encrypted fields are ciphertext (not directly usable without the
account's key) and everything else here is plain metadata.

Setup: same environment variables as zoho_vault_rotate_password.py.

Usage:
  python3 scripts/diag_secret_raw_fields.py --folder-id 2052000001420065 \
    cs.support.ingram.read cs.support.kyndryl-saas.read
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zoho_vault_rotate_password as m


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True)
    p.add_argument("names", nargs="+", help="Exact secretname(s) to dump")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"))
    return p.parse_args()


def main():
    args = parse_args()
    dc = m.DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(m.DC_HOSTS)}")

    token = m.get_access_token(dc)
    rows = m.list_secrets(dc, token, folder_id=args.folder_id)
    by_name = {r.get("secretname"): r for r in rows}

    for name in args.names:
        row = by_name.get(name)
        print(f"--- {name} ---")
        if not row:
            print("  NOT FOUND in this folder")
            print()
            continue

        for k, v in row.items():
            if k.lower() == "secretdata":
                try:
                    parsed = json.loads(v)
                    shown = {field: f"<ciphertext, len={len(val)}>" if val else "<empty>" for field, val in parsed.items()}
                except (TypeError, ValueError):
                    shown = f"<unparsable, len={len(str(v))}>"
                print(f"  {k}: {shown}")
            else:
                print(f"  {k}: {v!r}")
        print()


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
