import { supabase } from "@/integrations/supabase/client";

export type VaultSecretMeta = {
  key: string;
  description: string;
  updatedAt: string;
  updatedBy: string | null;
};

// Metadata only (key, description, last-updated) — Postgres RLS restricts
// the underlying table to superadmins, and it has no value column anyway.
export async function listVaultSecrets(): Promise<VaultSecretMeta[]> {
  const { data, error } = await supabase
    .from("app_secrets")
    .select("key, description, updated_at, updated_by")
    .order("key");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    key: row.key,
    description: row.description,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

// Creates or replaces a secret's value. Postgres re-checks superadmin on the
// server side regardless of who calls this. The value is write-only — it is
// never returned to the browser again after this call.
export async function upsertVaultSecret(key: string, value: string, description?: string): Promise<void> {
  const { error } = await supabase.rpc("vault_upsert_secret", {
    _key: key,
    _value: value,
    _description: description ?? null,
  });
  if (error) throw error;
}

export async function deleteVaultSecret(key: string): Promise<void> {
  const { error } = await supabase.rpc("vault_delete_secret", { _key: key });
  if (error) throw error;
}
