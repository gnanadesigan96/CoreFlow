// Server-only. Load inside server handlers:
// const { getSecret } = await import("@/lib/vault.server");
// Top-level import is unsafe from *.functions.ts / route files, which ship to
// the client bundle — see src/integrations/supabase/client.server.ts.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CacheEntry = { value: string | undefined; expiresAt: number };
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

// Resolves a secret for server-side use: an env var takes priority (keeps
// bootstrap/local-dev overrides working), then falls back to the superadmin
// Vault. Never call this for SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY etc. —
// those must stay real env vars, since they're what's used to reach the
// database the Vault itself lives in.
export async function getSecret(key: string): Promise<string | undefined> {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await supabaseAdmin.rpc("vault_read_secret", { _key: key });
  const value = error ? undefined : (data ?? undefined);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
