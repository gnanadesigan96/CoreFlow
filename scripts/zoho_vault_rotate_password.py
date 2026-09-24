#!/usr/bin/env python3
"""Set a new password on a Zoho Vault secret, matched by folder + secret name.

Does NOT read/display the current password -- Vault's own "History" panel on
the secret already keeps every past password automatically, so there's no
need to fetch and decrypt it here.

STATUS: description updates and secret lookup are confirmed working against
a live account (real, verified writes). The encryption piece
(encrypt_secret_data(), get_login(), open_vault(), derive_keys()) uses
zvcrypto.py, which was ported from Zoho's official crypto files (shared
privately via support ticket #167197808) and unit-tested for correctness in
isolation (PBKDF2, AES-CTR round-trip, RSA-OAEP round-trip all verified).
BUT the get_login()/open_vault() calls themselves -- the two API calls that
feed real account data into that crypto -- are NOT yet verified end-to-end
against a live account; their response shape is inferred from Zoho's PDF
description plus an old community-forum example, not something we've seen a
real response for. Test with --apply on a throwaway secret first.

IMPORTANT PREREQUISITE: per Zoho's own docs, deriving these keys needs the
'ZohoVault.user.READ' OAuth scope in addition to the secrets scope already
in use -- if your refresh token was generated without it, you'll need to
redo the Self Client grant-code -> refresh-token exchange with that scope
added before get_login()/open_vault() will work (expect INVALID_OAUTHSCOPE
otherwise, the same error we hit earlier on the /secrettypes endpoint).

Matching is done by folder + the secret's *display name* (secretname), not
by the login username -- the username field lives inside the encrypted
secretData blob, so matching on it would require decrypting every candidate
first (the same blocker as above). secretname is one of the few fields Zoho
does NOT encrypt (confirmed by their support: "except secretname,
description, tags, & secreturls"), so it's usable today with zero
decryption. This only works if your secrets are named to match the
credential they hold (e.g. a secret literally named "cs.support.vault").

Confirmed today against a live account (DC: in):
  - OAuth: POST https://accounts.zoho.<dc>/oauth/v2/token, params in form body,
    grant_type=refresh_token, scope ZohoVault.secrets.ALL
  - List:  GET https://vault.zoho.<dc>/api/rest/json/v1/secrets
           required params: isAsc, pageNum, rowPerPage (NOT sortColumn -- that
           param does not exist and causes EXTRA_PARAM_FOUND)
           pageNum is 0-INDEXED -- pageNum=1 silently skips the first page
           (returns Success with an empty Details array, easy to miss).
           optional: passwordName, filter, passwordType, chamberId (= folder ID,
           must be exactly "chamberId" -- lowercase "chamberid" is rejected
           with EXTRA_PARAM_FOUND even though that's how the web UI's own
           URL spells it)
  - Response envelope: {"operation": {"result": {...}, "Details": [ {...secret...} ]}}
    Each secret row includes secretid, secretname (plaintext -- but this is
    the secret's *display name*, e.g. "Test"; it is NOT the login username,
    which lives encrypted inside secretData below), description (plaintext),
    notes (encrypted -- this is the separate "secure note" field), and a
    secretData field which is a JSON *string* (not a nested object) shaped
    like '{"password":"<encrypted>","file":"","username":"<encrypted>"}'.
  - Folder ("chamber") ID can be read straight out of the Vault web UI's URL
    when browsing that folder, e.g.
    .../passwords/list?...&chamberid=2052000000005364 -- no separate API call
    needed if you're doing this by hand once per folder.

Update endpoint -- CONFIRMED against a live account (a real, verified write,
not a guess):
  PUT /api/rest/json/v1/secrets/{secretid}
  Content-Type: application/x-www-form-urlencoded
  body: INPUT_DATA=<JSON>, where the JSON is a FULL resend of the secret's
  fields, not a partial patch -- omitting secrettypeid, for example, fails
  with LESS_THAN_MIN_OCCURANCE ("Please fill 'INPUT_DATA.secrettypeid'").
  Required-in-practice fields: secrettypeid, secretname, policyid,
  classification, isshared, secretdata ({username, password, file}),
  securenote, description, tags.

  secrettypeid is NOT returned by either GET endpoint under that name --
  but the GET response's "accounttype" field is confirmed to be the same
  value (tested: reusing accounttype as secrettypeid succeeds). Likewise
  GET's "notes" field is the same content as the write payload's
  "securenote", and GET's "secretData" (capital D) is the same content as
  the write payload's "secretdata" (lowercase d) -- just re-parse the JSON
  string and pass it straight through.

  Since we're not re-encrypting password/username here, this lets us
  update description today by copying every other field from the row we
  already fetched, unchanged -- no crypto library needed for that part.
  build_full_update_payload() below does exactly this.

Setup:
  export ZOHO_VAULT_CLIENT_ID=...
  export ZOHO_VAULT_CLIENT_SECRET=...
  export ZOHO_VAULT_REFRESH_TOKEN=...      # needs ZohoVault.secrets.ALL + ZohoVault.user.READ
  export ZOHO_VAULT_DC=in                  # or com/eu/com.au/jp/ca
  export ZOHO_VAULT_MASTER_PASSWORD=...    # your Vault account's actual Master Password

Usage:
  python3 scripts/zoho_vault_rotate_password.py \
    --folder-id 2052000000005364 --secret-name cs.support.vault \
    --old-password '...' [--new-password '...'] [--apply]
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

import zvcrypto

DC_HOSTS = {
    "com": {"accounts": "accounts.zoho.com", "vault": "vault.zoho.com"},
    "eu": {"accounts": "accounts.zoho.eu", "vault": "vault.zoho.eu"},
    "in": {"accounts": "accounts.zoho.in", "vault": "vault.zoho.in"},
    "com.au": {"accounts": "accounts.zoho.com.au", "vault": "vault.zoho.com.au"},
    "jp": {"accounts": "accounts.zoho.jp", "vault": "vault.zoho.jp"},
    "ca": {"accounts": "accounts.zohocloud.ca", "vault": "vault.zohocloud.ca"},
}


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", required=True, help="Vault chamberId (folder ID) -- read it from the folder's URL in the Vault web UI")
    p.add_argument("--secret-name", required=True, help="Secret's display name (secretname) to match -- NOT the encrypted login username")
    p.add_argument("--new-password", help="New password to set (else prompted)")
    p.add_argument("--old-password", help="Current password value (you supply it -- the API can't decrypt it for us). Written into the secret's description as 'old password: <value>'")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"), help="Zoho data center (default: com, or $ZOHO_VAULT_DC)")
    p.add_argument("--apply", action="store_true", help="Actually write the new password (default: dry run)")
    return p.parse_args()


def http_request(url, method="GET", data=None, headers=None):
    headers = headers or {}
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def get_access_token(dc):
    token = os.environ.get("ZOHO_VAULT_ACCESS_TOKEN")
    if token:
        return token

    client_id = os.environ.get("ZOHO_VAULT_CLIENT_ID")
    client_secret = os.environ.get("ZOHO_VAULT_CLIENT_SECRET")
    refresh_token = os.environ.get("ZOHO_VAULT_REFRESH_TOKEN")
    if not (client_id and client_secret and refresh_token):
        sys.exit("Set ZOHO_VAULT_ACCESS_TOKEN, or all of ZOHO_VAULT_CLIENT_ID / ZOHO_VAULT_CLIENT_SECRET / ZOHO_VAULT_REFRESH_TOKEN")

    status, body = http_request(
        f"https://{dc['accounts']}/oauth/v2/token",
        method="POST",
        data={
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        },
    )
    if status != 200 or "access_token" not in body:
        sys.exit(f"Failed to refresh Zoho access token: {body}")
    return body["access_token"]


def list_secrets(dc, token, folder_id=None):
    # pageNum is 0-indexed -- confirmed against a live account. Passing "1"
    # here (an easy off-by-one assumption) skips the first page of results.
    #
    # No server-side name search: "passwordName" is documented as a valid
    # param but every casing we tried (passwordName/passwordname/PASSWORDNAME)
    # was rejected with EXTRA_PARAM_FOUND against a live account. Not needed
    # anyway -- we filter by secretname locally in find_secret_by_name().
    params = {"isAsc": "true", "pageNum": "0", "rowPerPage": "200"}
    if folder_id:
        params["chamberId"] = folder_id

    url = f"https://{dc['vault']}/api/rest/json/v1/secrets?{urllib.parse.urlencode(params)}"
    status, body = http_request(url, headers={"Authorization": f"Zoho-oauthtoken {token}"})
    result = body.get("operation", {}).get("result", {})
    if status != 200 or result.get("status") != "Success":
        sys.exit(f"Zoho Vault API error listing secrets: {body}")
    return body["operation"].get("Details", [])


def find_secret_by_name(secrets, secret_name):
    return [row for row in secrets if row.get("secretname") == secret_name]


# NOT YET VERIFIED against a live account -- see module docstring. Uses a
# different, older API path (/api/json/login, not /api/rest/json/v1/...)
# and, per Zoho's PDF example, a standard OAuth "Bearer" scheme rather than
# the "Zoho-oauthtoken" scheme every other endpoint in this file uses.
def get_login(dc, token):
    url = f"https://{dc['vault']}/api/json/login?OPERATION_NAME=GET_LOGIN"
    return http_request(url, headers={"Authorization": f"Bearer {token}"})


def open_vault(dc, token):
    url = f"https://{dc['vault']}/api/json/login?OPERATION_NAME=OPEN_VAULT"
    return http_request(url, headers={"Authorization": f"Bearer {token}"})


def _find_field(body, *keys):
    """Confirmed against a live account: GET_LOGIN/OPEN_VAULT responses are
    shaped {"operation": {"result": {...}, "name": ..., "details": {...}}}
    -- note lowercase "details" nested INSIDE "operation", unlike the
    /api/rest/json/v1/... endpoints elsewhere in this file which use a
    top-level capital-D "Details". The other candidates below are kept as
    fallbacks in case OPEN_VAULT's shape ever differs from GET_LOGIN's.
    """
    candidates = [body]
    if isinstance(body, dict):
        candidates.append(body.get("operation", {}).get("details", {}))
        candidates.append(body.get("details", {}))
        candidates.append(body.get("Details", {}))
        candidates.append(body.get("operation", {}).get("Details", {}))
        candidates.append(body.get("operation", {}).get("result", {}))
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        for key in keys:
            if key in candidate:
                return candidate[key]
    return None


def derive_keys(dc, token, master_password):
    """Derive the Master Key and Org Key for this account.

    NOT YET VERIFIED end-to-end against a live account -- see module
    docstring. If this fails with INVALID_OAUTHSCOPE, your refresh token
    needs the ZohoVault.user.READ scope added (see module docstring).
    """
    status, login_body = get_login(dc, token)
    if status != 200:
        sys.exit(f"GET_LOGIN failed ({status}): {login_body}")
    salt = _find_field(login_body, "SALT")
    iterations = _find_field(login_body, "ITERATION") or 310000
    if not salt:
        sys.exit(f"Could not find SALT in GET_LOGIN response -- response shape may differ from what we expected: {login_body}")
    master_key = zvcrypto.pbkdf2(master_password, salt, int(iterations))

    status, vault_body = open_vault(dc, token)
    if status != 200:
        sys.exit(f"OPEN_VAULT failed ({status}): {vault_body}")
    enc_private_key = _find_field(vault_body, "PRIVATEKEY")
    enc_sharing_key = _find_field(vault_body, "SHARINGKEY")
    if not (enc_private_key and enc_sharing_key):
        sys.exit(f"Could not find PRIVATEKEY/SHARINGKEY in OPEN_VAULT response -- response shape may differ from what we expected: {vault_body}")

    private_key = zvcrypto.aes_decrypt(enc_private_key, master_key)
    org_key = zvcrypto.rsa_decrypt(enc_sharing_key, private_key)
    return master_key, org_key


# Confirmed against a live account: the update endpoint wants a full resend
# of the secret's fields, not a partial patch. Build that payload from a row
# already fetched via list_secrets(), overriding only what actually changed.
# See the module docstring for the accounttype->secrettypeid / notes->
# securenote / secretData->secretdata field-name mapping this relies on.
def build_full_update_payload(row, **overrides):
    payload = {
        "secrettypeid": row["accounttype"],
        "secretname": row["secretname"],
        "policyid": row["policyid"],
        "classification": row.get("classification", "E"),
        "isshared": row.get("isshared", "YES"),
        "secretdata": json.loads(row["secretData"]),
        "securenote": row.get("notes", ""),
        "description": row.get("description", ""),
        "tags": row.get("tags", ""),
    }
    payload.update(overrides)
    return payload


def update_secret(dc, token, secret_id, payload):
    status, body = http_request(
        f"https://{dc['vault']}/api/rest/json/v1/secrets/{secret_id}",
        method="PUT",
        data={"INPUT_DATA": json.dumps(payload)},
        headers={"Authorization": f"Zoho-oauthtoken {token}"},
    )
    result = body.get("operation", {}).get("result", {})
    if status != 200 or result.get("status") != "Success":
        sys.exit(f"Zoho Vault API error updating secret: {body}")


def main():
    args = parse_args()
    dc = DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(DC_HOSTS)}")

    token = get_access_token(dc)
    secrets = list_secrets(dc, token, folder_id=args.folder_id)
    matches = find_secret_by_name(secrets, args.secret_name)

    if not matches:
        sys.exit(f"No secret named \"{args.secret_name}\" found in folder {args.folder_id}")
    if len(matches) > 1:
        sys.exit(f"Multiple secrets named \"{args.secret_name}\" found in folder {args.folder_id} -- refine the match")

    row = matches[0]
    print(f"Found secret: {row['secretname']} (id={row['secretid']})")

    new_password = args.new_password or input("New password: ")
    old_password = args.old_password or input("Old password (for the description, or leave blank to skip): ")
    description = f"old password: {old_password}" if old_password else None

    if not args.apply:
        print("(dry run -- pass --apply to actually write changes)")
        if description:
            print(f"  would set description to: {description!r}")
        print("  would derive Master/Org Key and set a new password (get_login/open_vault not yet verified live -- see module docstring)")
        return

    # description is plaintext -- works today, no crypto library needed.
    if description:
        update_secret(dc, token, row["secretid"], build_full_update_payload(row, description=description))
        print("Description updated.")

    master_password = os.environ.get("ZOHO_VAULT_MASTER_PASSWORD")
    if not master_password:
        sys.exit("Set ZOHO_VAULT_MASTER_PASSWORD (your Vault account's actual Master Password)")

    master_key, org_key = derive_keys(dc, token, master_password)
    # ISSHARED=YES (enterprise/shared) uses the Org Key; ISSHARED=NO
    # (personal) uses the Master Key -- see zvcrypto.py / module docstring.
    encryption_key = org_key if row.get("isshared") == "YES" else master_key

    existing_secret_data = json.loads(row["secretData"])
    encrypted_password = zvcrypto.aes_encrypt(new_password, encryption_key)
    new_secret_data = {**existing_secret_data, "password": encrypted_password}
    update_secret(dc, token, row["secretid"], build_full_update_payload(row, secretdata=new_secret_data))
    print("Password updated.")


if __name__ == "__main__":
    main()
