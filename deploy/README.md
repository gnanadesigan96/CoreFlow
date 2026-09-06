# Deploying Zenith Ticketing to a plain server (AWS EC2)

This app was pulled from Lovable, which builds it for Cloudflare Workers by
default (Nitro preset `cloudflare-module`). For a plain Linux server, build
with the `node-server` preset instead — that produces a standalone Node.js
server at `.output/server/index.mjs` that respects `HOST`/`PORT` env vars.
This has been verified to build and serve correctly.

## Useful links (project ref `oypxpodvjjxwhzkawhnx`)

| What | URL |
|---|---|
| This repo | https://github.com/gnanadesigan96/CoreFlow |
| Supabase SQL Editor (run migrations here — easiest, no DB password needed) | https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/sql/new |
| Supabase API keys (publishable + service role) | https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/settings/api |
| Supabase Auth users (find a user id to bootstrap superadmin) | https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/auth/users |
| Supabase Database extensions (enable Vault if needed) | https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/database/extensions |
| Supabase DB connection string (only if you prefer `psql` over the SQL Editor) | https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/settings/database |
| Anthropic API keys (for the AI Copilot) | https://console.anthropic.com/settings/keys |

`$SUPABASE_DB_URL` (only needed for the `psql` route below) has the shape
`postgresql://postgres:[YOUR-PASSWORD]@db.oypxpodvjjxwhzkawhnx.supabase.co:5432/postgres`
— `[YOUR-PASSWORD]` is the database password, which nobody but you has; copy
the ready-made string (with a "reset password" option if you don't have it)
from the Database settings link above. **The SQL Editor avoids needing this
at all** — that's why it's the recommended path below.

## Server requirements

- **OS**: Ubuntu 22.04/24.04 LTS (or any recent Debian/RHEL-family distro)
- **Size**: 2 vCPU / 2–4 GB RAM is comfortable for build + run; the build step
  is the heaviest part (bundles ~600 packages)
- **Software**: Node.js 22.x, `git`. Optional: `bun` (faster installs; the
  repo's lockfile is `bun.lock`) or plain `npm`.
- **Security group / firewall (inbound)**:
  - 22/tcp — SSH (restrict to your IP)
  - 3000/tcp — the app itself, for the "just use the IP" phase (or 80/tcp if
    you front it with a reverse proxy — see below)
- **Outbound**: must reach the public internet (npm registry, Supabase)

## 1. Apply the database migrations (once, before first deploy)

Open the [SQL Editor](https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/sql/new),
paste the contents of each file below **in order**, and click Run:

1. `drizzle/migrations/0000_vanta_desk_core.sql`
2. `drizzle/migrations/0001_role_admin_writes_and_seed_replies.sql`
3. `drizzle/migrations/0002_kb_and_ticket_workspace.sql`
4. `drizzle/migrations/0003_vault_and_superadmin.sql`

If the first three were already applied by Lovable, you likely only need to
run `0003`. If it errors on `create extension if not exists supabase_vault`,
enable "Vault" first under
[Database → Extensions](https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/database/extensions),
then re-run just that file.

(Prefer the command line instead? `psql "$SUPABASE_DB_URL" -f drizzle/migrations/0003_vault_and_superadmin.sql` — see the DB URL note above.)

## 2. Set up the server

```bash
# as a sudo-capable user, on the new server
sudo useradd -r -m -d /opt/zenith-ticketing -s /usr/sbin/nologin zenith || true
sudo mkdir -p /opt/zenith-ticketing
sudo chown "$USER" /opt/zenith-ticketing
git clone https://github.com/gnanadesigan96/CoreFlow.git /opt/zenith-ticketing
cd /opt/zenith-ticketing
git checkout claude/zenith-ticketing-deploy-bz2o23

# Create the env file (never committed to git)
sudo -u zenith tee /opt/zenith-ticketing/.env > /dev/null <<'EOF'
SUPABASE_PROJECT_ID=oypxpodvjjxwhzkawhnx
SUPABASE_URL=https://oypxpodvjjxwhzkawhnx.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
VITE_SUPABASE_PROJECT_ID=oypxpodvjjxwhzkawhnx
VITE_SUPABASE_URL=https://oypxpodvjjxwhzkawhnx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
EOF

sudo chown -R zenith:zenith /opt/zenith-ticketing
sudo cp deploy/zenith-ticketing.service /etc/systemd/system/zenith-ticketing.service
sudo systemctl daemon-reload
sudo systemctl enable zenith-ticketing
```

Get `SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_PUBLISHABLE_KEY` (same value,
not secret) and `SUPABASE_SERVICE_ROLE_KEY` (**a real secret** — never
commit it) from
[Project Settings → API](https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/settings/api).
The service role key is required for any server-side code that bypasses
RLS, including reading secrets from the Vault.

## 3. Build and start

```bash
cd /opt/zenith-ticketing && bash deploy/deploy.sh
```

Verify: `curl -I http://localhost:3000/` → `HTTP/1.1 200 OK`. From outside:
`http://<your-server-ip>:3000/`.

## 4. Bootstrap the first Superadmin

The app has four roles, each a superset of the one before: **Guest** <
**Agent** < **Admin** < **Superadmin** — only a Superadmin can manage the
**Vault** (encrypted secrets) or grant/revoke Superadmin itself. Nobody gets
it automatically, by design.

Sign up in the running app first (as guest or agent). Then find your user
id in [Auth → Users](https://supabase.com/dashboard/project/oypxpodvjjxwhzkawhnx/auth/users)
(or the SQL Editor: `select id from auth.users where email = '...'`), and
run in the SQL Editor:

```sql
insert into public.user_roles (user_id, role) values ('<your-auth-uid>', 'superadmin');
```

From there, log back in and a Superadmin can promote others from
Settings → People & roles, and manage secrets from Settings → Vault — values
are write-only in the UI (masked as `••••••••`, never shown again once
saved).

## 5. Set up the AI Copilot key

Get a key from [console.anthropic.com](https://console.anthropic.com/settings/keys),
then either:
- add `ANTHROPIC_API_KEY=...` to the server's `.env` (checked first), or
- log in as Superadmin → Settings → Vault → add `ANTHROPIC_API_KEY` there
  (checked as a fallback, cached 30s).

Without it set either way, the rest of the app works fine — only the
Copilot feature returns a "not configured" error.

## Later: fronting with Cloudflare / a domain

Once you're ready to move off the bare IP, put Cloudflare (or nginx +
Let's Encrypt) in front of port 3000 on 80/443, and switch the security
group to only allow 3000 from localhost/the reverse proxy. Nothing about the
Node build changes for that step.
