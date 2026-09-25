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


def build_summary(all_results):
    total = succeeded = failed = 0
    failure_lines = []
    for folder_id, results in all_results.items():
        for r in results:
            total += 1
            if r["status"] == "success":
                succeeded += 1
            elif r["status"] == "failed":
                failed += 1
                failure_lines.append(f"  - [folder {folder_id}] {r['name']}: {r['detail']}")

    lines = [
        f"Total secrets processed: {total}",
        f"Succeeded: {succeeded}",
        f"Failed: {failed}",
    ]
    if failure_lines:
        lines.append("")
        lines.append("Failure details:")
        lines.extend(failure_lines)
    return "\n".join(lines), total, succeeded, failed


_STATUS_STYLE = {
    "success": ("#e6f4ea", "#1a7f37", "SUCCESS"),
    "failed": ("#fdecea", "#c0392b", "FAILED"),
}


def build_html_summary(all_results, run_started_at, total, succeeded, failed):
    row_html = []
    for folder_id, results in all_results.items():
        for r in results:
            bg, fg, label = _STATUS_STYLE.get(r["status"], ("#eef1f5", "#555", r["status"].upper()))
            row_html.append(f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;">{html.escape(str(folder_id))}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">{html.escape(r.get("name") or "")}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">{html.escape(r.get("endpoint") or "-")}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <span style="display:inline-block;padding:2px 10px;border-radius:12px;background:{bg};color:{fg};font-size:12px;font-weight:600;">{label}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:#444;">{html.escape(r.get("detail") or "")}</td>
        </tr>""")

    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:900px;margin:0 auto;color:#222;">
  <h2 style="margin-bottom:4px;">Zoho Vault Password Rotation Report</h2>
  <div style="color:#777;font-size:13px;margin-bottom:20px;">Run at {html.escape(run_started_at)}</div>

  <table style="border-collapse:separate;border-spacing:12px 0;margin-bottom:24px;">
    <tr>
      <td style="background:#f5f6f8;border-radius:8px;padding:16px 24px;text-align:center;min-width:100px;">
        <div style="font-size:28px;font-weight:700;color:#222;">{total}</div>
        <div style="font-size:11px;letter-spacing:0.05em;color:#888;">TOTAL</div>
      </td>
      <td style="background:#e6f4ea;border-radius:8px;padding:16px 24px;text-align:center;min-width:100px;">
        <div style="font-size:28px;font-weight:700;color:#1a7f37;">{succeeded}</div>
        <div style="font-size:11px;letter-spacing:0.05em;color:#1a7f37;">SUCCEEDED</div>
      </td>
      <td style="background:#fdecea;border-radius:8px;padding:16px 24px;text-align:center;min-width:100px;">
        <div style="font-size:28px;font-weight:700;color:#c0392b;">{failed}</div>
        <div style="font-size:11px;letter-spacing:0.05em;color:#c0392b;">FAILED</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr style="background:#222;color:#fff;text-align:left;">
      <th style="padding:8px 12px;">Folder</th>
      <th style="padding:8px 12px;">Secret</th>
      <th style="padding:8px 12px;">Endpoint</th>
      <th style="padding:8px 12px;">Status</th>
      <th style="padding:8px 12px;">Detail</th>
    </tr>{"".join(row_html)}
  </table>
</div>"""


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

    if not args.apply:
        print("DRY RUN -- no app passwords or Vault secrets will be changed. Pass --apply to run for real.\n")

    all_results = {}
    for folder_id in args.folder_id:
        print(f"Folder {folder_id}:")
        all_results[folder_id] = rotate_folder(dc, token, folder_id, master_key, org_key, args.app_endpoint, args.apply)
        print()

    summary, total, succeeded, failed = build_summary(all_results)
    print(summary)

    if args.apply and not args.no_email:
        html_body = build_html_summary(all_results, run_started_at, total, succeeded, failed)
        send_summary_email(
            args.email_to,
            subject=f"Zoho Vault password rotation report -- {succeeded}/{total} succeeded, {failed} failed",
            text_body=summary,
            html_body=html_body,
        )
        print(f"\nSummary email sent to {args.email_to}")


if __name__ == "__main__":
    main()
