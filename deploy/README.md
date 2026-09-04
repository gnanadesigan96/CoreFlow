# Deploying Zenith Ticketing to a plain server (AWS EC2)

This app was pulled from Lovable, which builds it for Cloudflare Workers by
default (Nitro preset `cloudflare-module`). For a plain Linux server, build
with the `node-server` preset instead — that produces a standalone Node.js
server at `.output/server/index.mjs` that respects `HOST`/`PORT` env vars.
This has been verified to build and serve correctly.

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

## One-time setup

```bash
# as a sudo-capable user
sudo useradd -r -m -d /opt/zenith-ticketing -s /usr/sbin/nologin zenith || true
sudo mkdir -p /opt/zenith-ticketing
sudo chown "$USER" /opt/zenith-ticketing
git clone <this-repo-url> /opt/zenith-ticketing
cd /opt/zenith-ticketing
git checkout claude/zenith-ticketing-deploy-bz2o23

# Create the env file (not committed to git — see below for the variable names)
sudo -u zenith tee /opt/zenith-ticketing/.env > /dev/null <<'EOF'
SUPABASE_PROJECT_ID=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_URL=...
VITE_SUPABASE_PROJECT_ID=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_URL=...
EOF

sudo chown -R zenith:zenith /opt/zenith-ticketing
sudo cp deploy/zenith-ticketing.service /etc/systemd/system/zenith-ticketing.service
sudo systemctl daemon-reload
sudo systemctl enable zenith-ticketing
```

Then run `deploy/deploy.sh` (as a user in the `sudo` group, or adjust the
script if you'd rather run the build as the `zenith` user directly) to build
and start it for the first time, and again on every future update.

The Supabase values are the same ones already in this project's local `.env`
(get them from whoever has the Lovable project, or the Supabase dashboard for
project `oypxpodvjjxwhzkawhnx`) — they are publishable/anon keys, not secret
service-role keys, but are still kept out of git as a matter of hygiene.

## Verifying

```bash
curl -I http://localhost:3000/
```

should return `HTTP/1.1 200 OK`. From outside, `http://<server-ip>:3000/`.

## Later: fronting with Cloudflare / a domain

Once you're ready to move off the bare IP, put Cloudflare (or nginx +
Let's Encrypt) in front of port 3000 on 80/443, and switch the security
group to only allow 3000 from localhost/the reverse proxy. Nothing about the
Node build changes for that step.
