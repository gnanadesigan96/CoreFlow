#!/usr/bin/env python3
"""Compares secret NAMES between two Vault folders (no decryption needed --
only secretname is used) to find customers that appear to have one but not
the other -- e.g. an admin credential in PSAdminCreds with no corresponding
read-only credential in CustomerReadCreds.

Matching is NAME-based and heuristic, not exact: the two folders use very
different naming conventions (e.g. "cs.support.hitachi.read" vs
"New-Hitachi"), so secret names are normalized -- common prefixes/suffixes
and generic words stripped, punctuation collapsed to spaces, lowercased --
into a set of significant words; two secrets are considered a likely match
if they share at least one such word (3+ characters, not purely numeric).
This WILL have false positives/negatives on ambiguous or very short names
-- treat the output as a starting point for manual review, not a
guaranteed-accurate audit.

Setup: ZOHO_VAULT_CLIENT_ID/SECRET/REFRESH_TOKEN, ZOHO_VAULT_DC env vars
only -- no master password needed, since this never decrypts anything.

Usage:
  python3 scripts/compare_folder_coverage.py \
    --read-folder-id 2052000001420065 --admin-folder-id 2052000001537904
"""

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zoho_vault_rotate_password as m

_NOISE_WORDS = {
    "read", "new", "cs", "support", "pssupport", "admin", "us3", "us", "east", "eu",
    "poc", "assesments", "assessments", "services", "service", "group", "csp", "saas",
    "customers", "customer", "systems", "system", "team", "env", "ps", "automate",
    "the", "and", "pov", "cmp",
}


def normalize(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    words = []
    for w in s.split():
        if len(w) < 3 or w.isdigit() or w in _NOISE_WORDS:
            continue
        words.append(w)
    return words


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--read-folder-id", required=True, help="The read-only credentials folder (e.g. CustomerReadCreds)")
    p.add_argument("--admin-folder-id", required=True, help="The admin credentials folder (e.g. PSAdminCreds)")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"))
    args = p.parse_args()

    dc = m.DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(m.DC_HOSTS)}")

    token = m.get_access_token(dc)
    read_rows = m.list_secrets(dc, token, folder_id=args.read_folder_id)
    admin_rows = m.list_secrets(dc, token, folder_id=args.admin_folder_id)

    def url_of(row):
        if row.get("secreturl"):
            return row["secreturl"]
        for u in row.get("secretmultipleurl") or []:
            if u:
                return u
        return ""

    read_entries = [(r.get("secretname") or r["secretid"], url_of(r)) for r in read_rows]
    admin_entries = [(r.get("secretname") or r["secretid"], url_of(r)) for r in admin_rows]
    read_word_sets = [(name, url, set(normalize(name))) for name, url in read_entries]

    unmatched = []
    matched = []
    for admin_name, admin_url in admin_entries:
        admin_words = set(normalize(admin_name))
        candidates = [(read_name, read_url) for read_name, read_url, read_words in read_word_sets if admin_words and (admin_words & read_words)]
        if candidates:
            matched.append((admin_name, admin_url, candidates))
        else:
            unmatched.append((admin_name, admin_url))

    print(f"PSAdminCreds (write): {len(admin_entries)} secrets. CustomerReadCreds (read): {len(read_entries)} secrets.\n")

    print(f"=== {len(unmatched)} secret(s) in WRITE with no read counterpart found -- MISSING IN READ ===")
    print("(heuristic name match -- verify manually; a few known misses exist where the names share no text at all)\n")
    for name, url in sorted(unmatched):
        print(f"  {name}  |  {url or '(no URL stored)'}")

    print(f"\n=== {len(matched)} secret(s) in WRITE with a likely match already in READ ===")
    for name, url, candidates in sorted(matched):
        candidate_str = ", ".join(f"{cname} | {curl or '(no URL stored)'}" for cname, curl in candidates)
        print(f"  {name}  |  {url or '(no URL stored)'}  ->  {candidate_str}")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
