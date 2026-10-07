#!/usr/bin/env python3
"""Compares secrets between two Vault folders to find customers that appear
to have one but not the other -- in BOTH directions: an admin credential in
PSAdminCreds with no corresponding read-only credential in
CustomerReadCreds ("missing in read"), and vice versa ("missing in
write").

Matching is USERNAME-based first: each secret's real (username, endpoint)
pair is decrypted the same way the rotation script resolves it, and two
secrets are a CONFIRMED match if they share the same username on the same
host. This is exact, not heuristic, and fixes the real misses the old
name-only matching had (e.g. "New-ClickIT"/"New-Interwor"/"New-Tigloo" vs
"cs.support.ingrammicroeu.read" -- names share no text at all, but they are
the same live account).

When a secret's username can't be decrypted/resolved (unrecognized schema,
no stored URL to resolve an endpoint for, etc.) or has no username-based
match, we fall back to the old NAME heuristic as a lower-confidence
secondary signal: names are normalized -- camelCase boundaries and
punctuation split apart, common prefixes/suffixes and generic/region words
stripped, lowercased -- into a set of significant words, and two secrets
are a "likely match (name only)" if they share at least one such word (3+
characters, not purely numeric). This still has false positives/negatives
on ambiguous or very short names -- treat name-only matches as a starting
point for manual review, not a guaranteed-accurate audit. (Confirmed bugs
fixed here: "USEast" wasn't being split into "US"+"East" before, so two
unrelated same-region secrets matched on the leftover "useast" token alone;
and "tech" alone matched unrelated customers -- both fixed below. Username
matching makes these moot for any secret where both sides resolve.)

Needs ZOHO_VAULT_MASTER_PASSWORD too, not just the OAuth env vars: both the
username and some secrets' URLs (stored as an encrypted "Additional Field"
rather than the plaintext secreturl field, confirmed earlier this session)
require decryption.

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
    # Generic corporate-name/legal-entity fragments -- too common across
    # UNRELATED customers to be a reliable match signal on their own
    # (confirmed bug: "New-Converge_Tech" matched "Trusted Tech Read" on
    # "tech" alone). Deliberately conservative -- only words with a
    # confirmed false-match, plus the unambiguous legal-entity suffixes,
    # not broader guesses that could hide a real match instead.
    "tech", "technology", "technologies", "solutions", "consulting",
    "inc", "corp", "corporation", "ltd", "llc",
}


def normalize(name):
    # Split camelCase boundaries BEFORE lowercasing/punctuation-collapsing,
    # so e.g. "USEast" becomes "US East" (then "us"/"east", both already
    # noise words) instead of surviving as one unmatched-by-noise-list
    # token "useast" that two unrelated same-region secrets would share.
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    words = []
    for w in s.split():
        if len(w) < 3 or w.isdigit() or w in _NOISE_WORDS:
            continue
        words.append(w)
    return words


def joined(name):
    # Concatenates normalize()'s significant words with no separator --
    # catches the case where one side's secret name is written as a single
    # compound word and the other's camelCase/punctuation splits it into
    # pieces, so the word-set check above finds no shared token at all.
    # Confirmed real misses of exactly this shape: "New-ConRes" (splits to
    # "con"+"res") vs "cs.support.conres.read" (one token "conres");
    # "New-Taylor_Farms" ("taylor"+"farms") vs "...taylorfarms.read" (one
    # token). A short min-length guard (below) keeps this from matching on
    # trivial short fragments.
    return "".join(normalize(name))


# Minimum length for the joined/substring comparison -- below this, short
# fragments ("ps", "cmp") would substring-match all over the place. 5 was
# picked so a single filtered word just above the per-word 3-char floor
# doesn't alone qualify, but two combined ("con"+"res" = "conres", 6
# chars) does.
_MIN_JOINED_LEN = 5


def names_match(name_a, name_b):
    words_a, joined_a = set(normalize(name_a)), joined(name_a)
    words_b, joined_b = set(normalize(name_b)), joined(name_b)
    if words_a and (words_a & words_b):
        return True
    if len(joined_a) >= _MIN_JOINED_LEN and len(joined_b) >= _MIN_JOINED_LEN:
        return joined_a in joined_b or joined_b in joined_a
    return False


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
    master_password = os.environ.get("ZOHO_VAULT_MASTER_PASSWORD")
    if not master_password:
        sys.exit("Set ZOHO_VAULT_MASTER_PASSWORD -- needed to decrypt URLs stored in an encrypted Additional Field")
    master_key, org_key = m.derive_keys(dc, token, master_password)

    read_rows = m.list_secrets(dc, token, folder_id=args.read_folder_id)
    admin_rows = m.list_secrets(dc, token, folder_id=args.admin_folder_id)

    def url_of(row):
        # candidate_urls(), not resolve_app_endpoint() -- the latter only
        # returns a URL when it ALSO matches a known region in
        # REGION_ENDPOINTS, which would hide the real URL for secrets on
        # an unmapped domain (e.g. kyndryl.corestack.io, next.yotascale.io)
        # even though it was found and decrypted just fine.
        key = org_key if row.get("isshared") == "YES" else master_key
        candidates = m.candidate_urls(row, key=key)
        return candidates[0] if candidates else ""

    def identity_of(row):
        # Returns (username_lower, host) if both decrypt/resolve cleanly,
        # else None. host is the normalized hostname of the secret's own
        # URL (not the REGION_ENDPOINTS-mapped endpoint) so two secrets on
        # the same real host match even if that host isn't in
        # REGION_ENDPOINTS yet.
        try:
            username, _password, _key, _data, _uf, _pf = m.decrypt_credentials(row, master_key, org_key)
        except Exception:
            return None
        if not username:
            return None
        urls = url_of(row)
        host = m._normalize_host(urls) if urls else ""
        return (username.strip().lower(), host)

    def name_of(row):
        return row.get("secretname") or row["secretid"]

    read_entries = [(name_of(r), url_of(r), identity_of(r)) for r in read_rows]
    admin_entries = [(name_of(r), url_of(r), identity_of(r)) for r in admin_rows]

    # Username match requires the same username; when BOTH sides also have
    # a resolved host, the hosts must agree too (a shared username on two
    # different hosts is a coincidence, not the same account). When either
    # side has no resolvable host, there's nothing to conflict with, so a
    # plain username match is still accepted -- that's exact, not
    # heuristic, just missing the extra host confirmation.
    read_identity_rows = [(ident[0], ident[1], name, url) for name, url, ident in read_entries if ident]

    def username_match(admin_username, admin_host):
        exact = [(name, url) for u, h, name, url in read_identity_rows if u == admin_username and h and admin_host and h == admin_host]
        if exact:
            return exact
        return [(name, url) for u, h, name, url in read_identity_rows if u == admin_username and (not h or not admin_host)]

    unmatched = []
    matched_by_username = []
    matched_by_name = []
    matched_read_names = set()
    for admin_name, admin_url, admin_ident in admin_entries:
        username_candidates = username_match(*admin_ident) if admin_ident else []
        if username_candidates:
            matched_by_username.append((admin_name, admin_url, admin_ident[0], username_candidates))
            matched_read_names.update(cname for cname, _curl in username_candidates)
            continue

        name_candidates = [(read_name, read_url) for read_name, read_url, _ident in read_entries if names_match(admin_name, read_name)]
        if name_candidates:
            matched_by_name.append((admin_name, admin_url, name_candidates))
            matched_read_names.update(cname for cname, _curl in name_candidates)
        else:
            unmatched.append((admin_name, admin_url))

    # A read entry counts as "found in write" if it showed up as a
    # candidate for ANY admin match above (username or name) -- both match
    # relations are symmetric, so this is equivalent to re-running the
    # whole match search from the read side, without doing it twice.
    missing_in_write = [(name, url) for name, url, _ident in read_entries if name not in matched_read_names]

    print(f"PSAdminCreds (write): {len(admin_entries)} secrets. CustomerReadCreds (read): {len(read_entries)} secrets.\n")

    print(f"=== {len(unmatched)} secret(s) in WRITE with no read counterpart found -- MISSING IN READ ===")
    print("(no shared username/host, and no shared-word name match either -- verify manually)\n")
    for name, url in sorted(unmatched):
        print(f"  {name}  |  {url or '(no URL stored)'}")

    print(f"\n=== {len(missing_in_write)} secret(s) in READ with no write counterpart found -- MISSING IN WRITE ===")
    print("(no shared username/host, and no shared-word name match either -- verify manually)\n")
    for name, url in sorted(missing_in_write):
        print(f"  {name}  |  {url or '(no URL stored)'}")

    print(f"\n=== {len(matched_by_username)} secret(s) in WRITE matched to READ by USERNAME (confirmed, same account) ===")
    for name, url, username, candidates in sorted(matched_by_username):
        candidate_str = ", ".join(f"{cname} | {curl or '(no URL stored)'}" for cname, curl in candidates)
        print(f"  {name}  |  {url or '(no URL stored)'}  |  username: {username}  ->  {candidate_str}")

    print(f"\n=== {len(matched_by_name)} secret(s) in WRITE matched to READ by NAME only (heuristic -- verify manually) ===")
    for name, url, candidates in sorted(matched_by_name):
        candidate_str = ", ".join(f"{cname} | {curl or '(no URL stored)'}" for cname, curl in candidates)
        print(f"  {name}  |  {url or '(no URL stored)'}  ->  {candidate_str}")


if __name__ == "__main__":
    try:
        main()
    except m.NetworkError as e:
        sys.exit(str(e))
