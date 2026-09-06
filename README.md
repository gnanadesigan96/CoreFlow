# Zenith Ticketing

A support ticketing desk — SLA tracking, custom ticket fields, a knowledge base, agent/guest/admin/superadmin roles, department sharing, and an AI copilot backed by Claude.

Originally built in [Lovable](https://lovable.dev); this repository is now the source of truth and has no runtime dependency on Lovable (see `deploy/README.md` for the one AI feature that talks to an external provider — Claude, not Lovable).

Repository: https://github.com/gnanadesigan96/CoreFlow

## Development

```sh
git clone https://github.com/gnanadesigan96/CoreFlow.git
cd CoreFlow
git checkout claude/zenith-ticketing-deploy-bz2o23
bun install   # or: npm install
bun run dev   # or: npm run dev
```

Requires a `.env` with the Supabase connection details — see `deploy/README.md` for the full variable list and how secrets are managed via the in-app Vault.

## Deploying

See `deploy/README.md` for the full step-by-step: server requirements, applying the database migrations, the systemd service, and bootstrapping the first Superadmin account.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- Supabase (Postgres, Auth, Vault)
- Claude (AI copilot)
