#!/usr/bin/env python3
"""Rotate every password in one or more Zoho Vault folders, propagating the
new password to the real application account first, then to Vault.

For each secret in each given folder, in order:
  1. Decrypt its current username + password from Vault.
  2. Generate a new strong password (15 chars: upper/lower/digit/!@#$&).
  3. Authenticate to the application with the current username + password,
     then call its change-password endpoint with the new password.
  4. ONLY if that succeeds: update the Vault secret -- new (encrypted)
     password, and description set to "old password: <the password from
     step 1>".
  5. Track success/failure per secret (a Vault-write failure AFTER the app
     password already changed is flagged loudly -- that's a real mismatch
     needing manual attention, not just a skipped secret).

After a real (--apply) run, emails a summary (total/succeeded/failed, with
per-failure reasons) via SMTP.

STATUS: the crypto (zvcrypto.py, ported from Zoho's officially-shared crypto
files) and the whole read -> app-call -> Vault-write pipeline are verified
against a live account end-to-end (including the legacy RSA-1024/PKCS1v1.5
path some older accounts still use). See zvcrypto.py for the crypto details.

IMPORTANT PREREQUISITE: per Zoho's docs, deriving the encryption keys needs
the 'ZohoVault.user.READ' OAuth scope in addition to 'ZohoVault.secrets.ALL'.

Confirmed today against a live account (DC: in):
  - OAuth: POST https://accounts.zoho.<dc>/oauth/v2/token, params in form body,
    grant_type=refresh_token
  - List:  GET https://vault.zoho.<dc>/api/rest/json/v1/secrets
           required params: isAsc, pageNum, rowPerPage (NOT sortColumn --
           that param does not exist and causes EXTRA_PARAM_FOUND)
           pageNum is 0-INDEXED -- pageNum=1 silently skips the first page.
           chamberId (folder ID) must be exactly that casing -- lowercase
           "chamberid" is rejected, even though that's the web UI's own URL
           spelling.
  - Response envelope: {"operation": {"result": {...}, "Details": [ {...} ]}}
    secretData is a JSON *string*: '{"password":"<enc>","username":"<enc>"}'.
    accounttype (GET) == secrettypeid (write); notes (GET) == securenote
    (write); secretData (GET, capital D) == secretdata (write, lowercase d).
  - Update: PUT /api/rest/json/v1/secrets/{secretid}, INPUT_DATA=<JSON>
    form-encoded, needs a FULL resend of the secret's fields (secrettypeid,
    secretname, policyid, classification, isshared, secretdata, securenote,
    description, tags) -- not a partial patch.
  - GET_LOGIN/OPEN_VAULT: GET https://vault.zoho.<dc>/api/json/login?OPERATION_NAME=...,
    Authorization: Bearer <token> (not Zoho-oauthtoken). Response shape is
    {"operation": {"result": {...}, "name": ..., "details": {...}}} --
    lowercase "details" nested INSIDE "operation".
  - RSA: dispatches on ciphertext length (<=256 -> legacy RSA-1024 +
    comma-separated hex components + PKCS1v1.5; else modern RSA-OAEP-SHA256
    + base64 PKCS8) -- see zvcrypto.py.

Setup:
  pip install cryptography requests

  export ZOHO_VAULT_CLIENT_ID=...
  export ZOHO_VAULT_CLIENT_SECRET=...
  export ZOHO_VAULT_REFRESH_TOKEN=...      # ZohoVault.secrets.ALL + ZohoVault.user.READ
  export ZOHO_VAULT_DC=in                  # or com/eu/com.au/jp/ca
  export ZOHO_VAULT_MASTER_PASSWORD=...    # your Vault account's actual Master Password

  export SMTP_HOST=smtp.office365.com      # defaults shown are already this
  export SMTP_PORT=587
  export SMTP_USER=productsupport@corestack.io
  export SMTP_FROM=productsupport@corestack.io
  export SMTP_PASSWORD=...                 # required to actually send the email

Usage:
  python3 scripts/zoho_vault_rotate_password.py \
    --folder-id 2052000000005364 --folder-id 2052000000009999 \
    [--app-endpoint api.corestack.io] [--apply]

Without --apply this is a dry run: it decrypts and reports what would
happen for every secret, but makes no calls to the application and no
writes to Vault. Add --apply to actually rotate passwords for real.
"""

import argparse
import html
import json
import os
import re
import smtplib
import string
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from secrets import choice as _secure_choice

import requests

import zvcrypto

# Region -> API host, keyed by the customer-facing URL stored on each Vault
# secret (its "URL"), mapping to the API host to actually call for that
# region (its "API Endpoint"). Given directly by the user.
REGION_ENDPOINTS = {
    "cloud.corestack.io": "api.corestack.io",
    "portal.corestack.io": "portal-api.corestack.io",
    "mea.corestack.io": "mea-api.corestack.io",
    "msprod.corestack.io": "api-msprod.corestack.io",
    "cmp.hootstack.com": "api-cmp.hootstack.com",
    "in.corestack.io": "api-in.corestack.io",
    "useast.corestack.io": "api-useast.corestack.io",
    "us3.corestack.io": "api-us3.corestack.io",
}

DC_HOSTS = {
    "com": {"accounts": "accounts.zoho.com", "vault": "vault.zoho.com"},
    "eu": {"accounts": "accounts.zoho.eu", "vault": "vault.zoho.eu"},
    "in": {"accounts": "accounts.zoho.in", "vault": "vault.zoho.in"},
    "com.au": {"accounts": "accounts.zoho.com.au", "vault": "vault.zoho.com.au"},
    "jp": {"accounts": "accounts.zoho.jp", "vault": "vault.zoho.jp"},
    "ca": {"accounts": "accounts.zohocloud.ca", "vault": "vault.zohocloud.ca"},
}

PASSWORD_LENGTH = 15
PASSWORD_SYMBOLS = "!@#$&"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", action="append", required=True, help="Vault chamberId (folder ID) -- read it from the folder's URL in the Vault web UI. Repeat for multiple folders.")
    p.add_argument("--app-endpoint", default=os.environ.get("APP_ENDPOINT"), help="Fallback API host (no scheme) used only if a secret's stored URL doesn't match a known region in REGION_ENDPOINTS. Omit to fail those secrets instead of guessing.")
    p.add_argument("--dc", default=os.environ.get("ZOHO_VAULT_DC", "com"), help="Zoho data center (default: com, or $ZOHO_VAULT_DC)")
    p.add_argument("--apply", action="store_true", help="Actually change app + Vault passwords (default: dry run)")
    p.add_argument("--email-to", default="gnanadesigan@corestack.io", help="Summary email recipient")
    p.add_argument("--no-email", action="store_true", help="Skip the summary email even on --apply")
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
    # here (an easy off-by-one assumption) silently skips the first page.
    params = {"isAsc": "true", "pageNum": "0", "rowPerPage": "200"}
    if folder_id:
        params["chamberId"] = folder_id

    url = f"https://{dc['vault']}/api/rest/json/v1/secrets?{urllib.parse.urlencode(params)}"
    status, body = http_request(url, headers={"Authorization": f"Zoho-oauthtoken {token}"})
    result = body.get("operation", {}).get("result", {})
    if status != 200 or result.get("status") != "Success":
        sys.exit(f"Zoho Vault API error listing secrets in folder {folder_id}: {body}")
    return body["operation"].get("Details", [])


def get_folder_names(dc, token):
    """Maps chamberId -> folder display name, so reports can show a name
    instead of a raw numeric ID.

    NOT YET VERIFIED against a live account -- field casing (chambername/
    chamberid) is inferred from the "Create Folders" payload shape in
    Zoho's PDF, not a real GET /chambers response we've seen. Deliberately
    non-fatal: if this endpoint or field names don't match, it just returns
    an empty mapping and callers fall back to showing the raw folder ID.
    """
    try:
        params = {"isAsc": "false", "pageNum": "0", "rowPerPage": "200"}
        url = f"https://{dc['vault']}/api/rest/json/v1/chambers?{urllib.parse.urlencode(params)}"
        status, body = http_request(url, headers={"Authorization": f"Zoho-oauthtoken {token}"})
        result = body.get("operation", {}).get("result", {})
        if status != 200 or str(result.get("status", "")).lower() != "success":
            return {}
        rows = body.get("operation", {}).get("Details", [])
        mapping = {}
        for row in rows:
            chamber_id = row.get("chamberid") or row.get("CHAMBERID") or row.get("id")
            chamber_name = row.get("chambername") or row.get("CHAMBERNAME") or row.get("name")
            if chamber_id and chamber_name:
                mapping[str(chamber_id)] = chamber_name
        return mapping
    except Exception:
        return {}


def get_login(dc, token):
    url = f"https://{dc['vault']}/api/json/login?OPERATION_NAME=GET_LOGIN"
    return http_request(url, headers={"Authorization": f"Bearer {token}"})


def open_vault(dc, token):
    url = f"https://{dc['vault']}/api/json/login?OPERATION_NAME=OPEN_VAULT"
    return http_request(url, headers={"Authorization": f"Bearer {token}"})


def _find_field(body, *keys):
    """Confirmed against a live account: GET_LOGIN/OPEN_VAULT responses are
    shaped {"operation": {"result": {...}, "name": ..., "details": {...}}}
    -- lowercase "details" nested INSIDE "operation".
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
    """Derive the Master Key and Org Key for this account. Verified against
    a live account, including the legacy RSA-1024 path -- see zvcrypto.py.
    """
    status, login_body = get_login(dc, token)
    if status != 200:
        sys.exit(f"GET_LOGIN failed ({status}): {login_body}")
    salt = _find_field(login_body, "SALT")
    iterations = _find_field(login_body, "ITERATION") or 310000
    if not salt:
        sys.exit(f"Could not find SALT in GET_LOGIN response: {login_body}")
    master_key = zvcrypto.pbkdf2(master_password, salt, int(iterations))

    status, vault_body = open_vault(dc, token)
    if status != 200:
        sys.exit(f"OPEN_VAULT failed ({status}): {vault_body}")
    enc_private_key = _find_field(vault_body, "PRIVATEKEY")
    enc_sharing_key = _find_field(vault_body, "SHARINGKEY")
    if not (enc_private_key and enc_sharing_key):
        sys.exit(f"Could not find PRIVATEKEY/SHARINGKEY in OPEN_VAULT response: {vault_body}")

    private_key = zvcrypto.aes_decrypt(enc_private_key, master_key)
    org_key = zvcrypto.rsa_decrypt(enc_sharing_key, private_key)
    return master_key, org_key


def build_full_update_payload(row, **overrides):
    """The update endpoint wants a full resend of the secret's fields, not a
    partial patch -- confirmed against a live account. Build that payload
    from a row already fetched via list_secrets(), overriding only what
    actually changed.
    """
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
        raise RuntimeError(f"Zoho Vault API error updating secret {secret_id}: {body}")


def generate_password(length=PASSWORD_LENGTH):
    """15 chars by default, guaranteed at least one uppercase, one lowercase,
    one digit, and one of !@#$&, and STARTS WITH A LETTER (the app's own
    password policy requires this: "must start with an alphabetic
    character"). Uses `secrets` (CSPRNG), not `random`.
    """
    letters = string.ascii_uppercase + string.ascii_lowercase
    alphabet = letters + string.digits + PASSWORD_SYMBOLS
    while True:
        candidate = _secure_choice(letters) + "".join(_secure_choice(alphabet) for _ in range(length - 1))
        if (
            any(c in string.ascii_uppercase for c in candidate)
            and any(c in string.ascii_lowercase for c in candidate)
            and any(c in string.digits for c in candidate)
            and any(c in PASSWORD_SYMBOLS for c in candidate)
        ):
            return candidate


def decrypt_credentials(row, master_key, org_key):
    """Returns (username, password, key_used, secret_data_dict)."""
    secret_data = json.loads(row["secretData"])
    key = org_key if row.get("isshared") == "YES" else master_key
    username = zvcrypto.aes_decrypt(secret_data.get("username", ""), key)
    password = zvcrypto.aes_decrypt(secret_data.get("password", ""), key)
    return username, password, key, secret_data


def _normalize_host(value):
    value = value.strip().lower()
    value = re.sub(r"^[a-z]+://", "", value)
    return value.split("/")[0]


def resolve_app_endpoint(row, fallback=None):
    """Match the secret's stored URL (secreturl, or any entry in
    secretmultipleurl -- both plaintext fields, no crypto involved) against
    REGION_ENDPOINTS to find which API host to call for this account.
    Returns `fallback` (the --app-endpoint override) if no candidate URL on
    the secret matches a known region, or None if there's no fallback
    either -- callers should treat None as "can't safely proceed" rather
    than silently guessing a region.
    """
    candidates = []
    if row.get("secreturl"):
        candidates.append(row["secreturl"])
    for url in row.get("secretmultipleurl") or []:
        if url:
            candidates.append(url)

    for candidate in candidates:
        host = _normalize_host(candidate)
        for known_url, endpoint in REGION_ENDPOINTS.items():
            if host == known_url or host.endswith("." + known_url):
                return endpoint

    return fallback


def change_app_password(app_endpoint, username, current_password, new_password):
    """Calls the application's auth + change-password endpoints. Returns
    (ok: bool, detail: str). Ported from the API code shared for this --
    note the original used the user_id extracted from the auth response
    for the change-password URL, not a hardcoded one.
    """
    try:
        auth_resp = requests.post(
            f"https://{app_endpoint}/v1/auth/tokens",
            headers={"accept": "application/json", "Content-Type": "application/json"},
            json={"username": username, "password": current_password},
            timeout=30,
        )
    except requests.RequestException as e:
        return False, f"auth request error: {e}"

    if auth_resp.status_code // 100 != 2:
        return False, f"auth failed: HTTP {auth_resp.status_code} {auth_resp.text[:200]}"

    auth_body = auth_resp.json()
    token = (auth_body.get("token") or {}).get("access_token")
    user_id = (auth_body.get("user") or {}).get("id")
    if not token or not user_id:
        return False, f"auth response missing token/user id: {auth_body}"

    try:
        change_resp = requests.put(
            f"https://{app_endpoint}/users/change_password/{user_id}",
            headers={"accept": "application/json", "X-Auth-Token": token, "Content-Type": "application/json"},
            json={"current_password": current_password, "new_password": new_password},
            timeout=30,
        )
    except requests.RequestException as e:
        return False, f"change_password request error: {e}"

    if change_resp.status_code == 200:
        return True, "ok"
    return False, f"change_password failed: HTTP {change_resp.status_code} {change_resp.text[:200]}"


def rotate_secret(dc, token, row, master_key, org_key, app_endpoint, apply):
    name = row.get("secretname") or row["secretid"]

    try:
        username, current_password, key, secret_data = decrypt_credentials(row, master_key, org_key)
    except Exception as e:
        return {"name": name, "endpoint": None, "status": "failed", "detail": f"decrypt error: {e}"}

    endpoint = resolve_app_endpoint(row, fallback=app_endpoint)
    if not endpoint:
        return {
            "name": name,
            "endpoint": None,
            "status": "failed",
            "detail": "no API endpoint match for this secret's stored URL, and no --app-endpoint fallback given",
        }

    if not apply:
        return {
            "name": name,
            "endpoint": endpoint,
            "status": "dry-run",
            "detail": f"would authenticate as {username!r} against {endpoint}, change the app password, then update Vault",
        }

    new_password = generate_password()

    ok, detail = change_app_password(endpoint, username, current_password, new_password)
    if not ok:
        return {"name": name, "endpoint": endpoint, "status": "failed", "detail": f"app password change failed: {detail}"}

    try:
        new_secret_data = {**secret_data, "password": zvcrypto.aes_encrypt(new_password, key)}
        description = f"old password: {current_password}"
        update_secret(dc, token, row["secretid"], build_full_update_payload(row, secretdata=new_secret_data, description=description))
    except Exception as e:
        return {
            "name": name,
            "endpoint": endpoint,
            "status": "failed",
            "detail": (
                "APP PASSWORD WAS ALREADY CHANGED but the Vault update failed afterward -- "
                f"Vault now shows a STALE password for this account and needs a manual fix: {e}"
            ),
        }

    return {"name": name, "endpoint": endpoint, "status": "success", "detail": ""}


def rotate_folder(dc, token, folder_id, master_key, org_key, app_endpoint, apply):
    rows = list_secrets(dc, token, folder_id=folder_id)
    results = []
    for row in rows:
        result = rotate_secret(dc, token, row, master_key, org_key, app_endpoint, apply)
        results.append(result)
        suffix = f" -- {result['detail']}" if result["detail"] else ""
        print(f"  [{result['status']}] {result['name']}{suffix}")
    return results


def build_summary(all_results, folder_names):
    total = succeeded = failed = 0
    folder_lines = []
    failure_lines = []
    for folder_id, results in all_results.items():
        folder_name = folder_names.get(str(folder_id), folder_id)
        folder_total = len(results)
        folder_succeeded = sum(1 for r in results if r["status"] == "success")
        folder_failed = sum(1 for r in results if r["status"] == "failed")
        folder_lines.append(f"  {folder_name}: {folder_succeeded}/{folder_total} succeeded, {folder_failed} failed")

        total += folder_total
        succeeded += folder_succeeded
        failed += folder_failed
        for r in results:
            if r["status"] == "failed":
                failure_lines.append(f"  - [{folder_name}] {r['name']}: {r['detail']}")

    lines = [
        f"Total secrets processed: {total}",
        f"Succeeded: {succeeded}",
        f"Failed: {failed}",
        "",
        "By folder:",
        *folder_lines,
    ]
    if failure_lines:
        lines.append("")
        lines.append("Failure details:")
        lines.extend(failure_lines)
    return "\n".join(lines), total, succeeded, failed


# Table-based layout (nested <table>s, no divs/flexbox) so it renders
# reliably in Outlook/Office365 -- matching the house style used by the
# team's other automated reports (CS_Daily_Incident_Report).
_STATUS_PILL = {
    "success": ("#F0FDF4", "#15803D", "&#9989; Success"),
    "failed": ("#FEE2E2", "#B91C1C", "&#10060; Failed"),
    "dry-run": ("#EFF6FF", "#1D4ED8", "&#128337; Dry Run"),
}
_SECTION_LABEL = 'style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94A3B8;padding-bottom:10px;"'
_TH = 'style="padding:6px 10px;font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;text-align:left;border-bottom:1px solid #E4E8EF;"'
_TD_BASE = "padding:7px 10px;font-size:11px;color:#334155;border-bottom:1px solid #F1F5F9;"
_TD = f'style="{_TD_BASE}"'


def _td(extra_style=""):
    """A <td ...> style attribute with extra CSS appended -- never emit two
    separate style="" attributes on one element (HTML only honors the
    first, so the second silently gets dropped by real mail clients).
    """
    return f'style="{_TD_BASE}{extra_style}"'


def _stat_card(value, label, color):
    return f"""<td width="33%" style="padding-right:10px;" valign="top">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #E4E8EF;border-radius:10px;border-top:3px solid {color};">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:10px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;">{label}</div>
          <div style="font-size:30px;font-weight:700;color:{color};line-height:1.1;margin:6px 0 2px;">{value}</div>
        </td></tr>
      </table>
    </td>"""


def _folder_breakdown_table(all_results, folder_names):
    rows = []
    for folder_id, results in all_results.items():
        folder_name = folder_names.get(str(folder_id), str(folder_id))
        folder_total = len(results)
        folder_succeeded = sum(1 for r in results if r["status"] == "success")
        folder_failed = sum(1 for r in results if r["status"] == "failed")
        row_bg = "#FFFBF0" if folder_failed else "#FFFFFF"
        failed_color = "#B91C1C" if folder_failed else "#94A3B8"
        rows.append(f"""<tr style="background:{row_bg};">
          <td {_td("font-weight:600;")}>&#128193;&nbsp;{html.escape(folder_name)}</td>
          <td {_TD} align="center">{folder_total}</td>
          <td {_TD} align="center"><span style="font-weight:700;color:#15803D;">{folder_succeeded}</span></td>
          <td {_TD} align="center"><span style="font-weight:700;color:{failed_color};">{folder_failed}</span></td>
        </tr>""")

    return f"""<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #E4E8EF;border-radius:10px;">
      <tr style="background:#F8FAFC;">
        <th {_TH} width="55%">Folder</th>
        <th {_TH} width="15%" align="center">Total</th>
        <th {_TH} width="15%" align="center">Succeeded</th>
        <th {_TH} width="15%" align="center">Failed</th>
      </tr>{"".join(rows)}
    </table>"""


def _folder_card(folder_name, results):
    folder_succeeded = sum(1 for r in results if r["status"] == "success")
    folder_failed = sum(1 for r in results if r["status"] == "failed")
    badges = []
    if folder_succeeded:
        badges.append(f'<span style="font-size:10px;font-weight:600;background:#F0FDF4;color:#15803D;padding:2px 8px;border-radius:10px;margin-left:4px;">{folder_succeeded} Succeeded</span>')
    if folder_failed:
        badges.append(f'<span style="font-size:10px;font-weight:600;background:#FEE2E2;color:#B91C1C;padding:2px 8px;border-radius:10px;margin-left:4px;">{folder_failed} Failed</span>')

    body_rows = []
    for i, r in enumerate(results):
        bg, fg, label = _STATUS_PILL.get(r["status"], ("#F1F5F9", "#475569", r["status"].title()))
        if r["status"] == "failed":
            row_bg = "#FFFBF0"
        else:
            row_bg = "#FFFFFF" if i % 2 == 0 else "#FAFBFC"
        body_rows.append(f"""<tr style="background:{row_bg};">
          <td {_td("font-weight:600;")}>{html.escape(r.get("name") or "")}</td>
          <td {_td("font-family:monospace;font-size:10px;")}>{html.escape(r.get("endpoint") or "-")}</td>
          <td {_TD}><span style="font-size:10px;font-weight:600;background:{bg};color:{fg};padding:2px 8px;border-radius:10px;white-space:nowrap;">{label}</span></td>
          <td {_td("color:#64748B;")}>{html.escape(r.get("detail") or "")}</td>
        </tr>""")

    return f"""<tr><td style="padding-bottom:14px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #E4E8EF;border-radius:10px;">
        <tr><td style="background:#F8FAFC;border-bottom:1px solid #E4E8EF;padding:9px 14px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:700;color:#0F172A;">&#128193;&nbsp;{html.escape(folder_name)}</td>
            <td align="right">{"".join(badges)}</td>
          </tr></table>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr style="background:#F8FAFC;">
              <th {_TH} width="28%">Secret</th>
              <th {_TH} width="20%">Endpoint</th>
              <th {_TH} width="14%">Status</th>
              <th {_TH} width="38%">Detail</th>
            </tr>{"".join(body_rows)}
          </table>
        </td></tr>
      </table>
    </td></tr>"""


def build_html_summary(all_results, folder_names, run_started_at, total, succeeded, failed):
    folder_cards = "".join(
        _folder_card(folder_names.get(str(folder_id), str(folder_id)), results)
        for folder_id, results in all_results.items()
    )
    breakdown_table = _folder_breakdown_table(all_results, folder_names)

    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Zoho Vault Password Rotation Report</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:Arial,sans-serif;font-size:13px;color:#1A2035;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6F9;"><tr><td align="center" style="padding:20px 16px 40px;">
<table width="900" cellpadding="0" cellspacing="0" border="0" style="max-width:900px;width:100%;">

<tr><td style="background:#fff;border:1px solid #E4E8EF;border-radius:10px;padding:18px 28px 16px;">
  <div style="font-size:17px;font-weight:700;color:#0F172A;">&#128274;&nbsp;Zoho Vault Password Rotation Report</div>
  <div style="font-size:11px;color:#64748B;margin-top:3px;"><b style="color:#334155;">Run at:</b>&nbsp;{html.escape(run_started_at)}</div>
</td></tr>
<tr><td height="14"></td></tr>

<tr><td {_SECTION_LABEL}>Summary</td></tr>
<tr><td style="padding-bottom:20px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    {_stat_card(total, "Total", "#3B82F6")}
    {_stat_card(succeeded, "Succeeded", "#10B981")}
    {_stat_card(failed, "Failed", "#EF4444")}
  </tr></table>
</td></tr>

<tr><td {_SECTION_LABEL}>Folder Breakdown</td></tr>
<tr><td style="padding-bottom:20px;">{breakdown_table}</td></tr>

<tr><td {_SECTION_LABEL}>Results by Folder</td></tr>
{folder_cards}

</table>
</td></tr></table>
</body></html>"""


def send_summary_email(to_addr, subject, text_body, html_body):
    smtp_host = os.environ.get("SMTP_HOST", "smtp.office365.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "productsupport@corestack.io")
    smtp_from = os.environ.get("SMTP_FROM", smtp_user)
    smtp_password = os.environ.get("SMTP_PASSWORD")
    if not smtp_password:
        print("SMTP_PASSWORD not set -- skipping summary email", file=sys.stderr)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to_addr
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.sendmail(smtp_from, [to_addr], msg.as_string())


def main():
    args = parse_args()
    dc = DC_HOSTS.get(args.dc)
    if not dc:
        sys.exit(f"Unknown data center \"{args.dc}\". Known values: {', '.join(DC_HOSTS)}")

    run_started_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    token = get_access_token(dc)

    master_password = os.environ.get("ZOHO_VAULT_MASTER_PASSWORD")
    if not master_password:
        sys.exit("Set ZOHO_VAULT_MASTER_PASSWORD (your Vault account's actual Master Password)")
    master_key, org_key = derive_keys(dc, token, master_password)
    folder_names = get_folder_names(dc, token)

    if not args.apply:
        print("DRY RUN -- no app passwords or Vault secrets will be changed. Pass --apply to run for real.\n")

    all_results = {}
    for folder_id in args.folder_id:
        print(f"Folder {folder_names.get(str(folder_id), folder_id)}:")
        all_results[folder_id] = rotate_folder(dc, token, folder_id, master_key, org_key, args.app_endpoint, args.apply)
        print()

    summary, total, succeeded, failed = build_summary(all_results, folder_names)
    print(summary)

    if args.apply and not args.no_email:
        html_body = build_html_summary(all_results, folder_names, run_started_at, total, succeeded, failed)
        send_summary_email(
            args.email_to,
            subject=f"Zoho Vault password rotation report -- {succeeded}/{total} succeeded, {failed} failed",
            text_body=summary,
            html_body=html_body,
        )
        print(f"\nSummary email sent to {args.email_to}")


if __name__ == "__main__":
    main()
