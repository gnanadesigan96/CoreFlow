import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DeskProvider, type Me } from "@/lib/desk-store";
import { DeskShell } from "@/components/desk/desk-shell";
import type { Role } from "@/lib/desk-data";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
  errorComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-ink text-sm text-dim">
      Could not load your desk session. Reload to try again.
    </div>
  ),
});

function AuthenticatedLayout() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return;
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      const role = (roles?.[0]?.role as Role | undefined) ?? "guest";
      if (cancelled) return;
      const email = profile?.email ?? user.email ?? "";
      setMe({
        id: user.id,
        email,
        name: profile?.full_name || email.split("@")[0] || "User",
        handle: profile?.handle || email.split("@")[0] || "user",
        role,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!me) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-ink">
        <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-faint">
          establishing desk session…
        </span>
      </div>
    );
  }

  return (
    <DeskProvider me={me}>
      <DeskShell>
        {/* Required: nested routes render here. */}
        <Outlet />
      </DeskShell>
    </DeskProvider>
  );
}
