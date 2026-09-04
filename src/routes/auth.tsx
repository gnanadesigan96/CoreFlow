import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — VANTA Desk Support Console" },
      {
        name: "description",
        content:
          "Sign in to VANTA Desk as a support agent or as a customer guest to raise and track support tickets with live SLA timers.",
      },
      { property: "og:title", content: "Sign in — VANTA Desk" },
      {
        property: "og:description",
        content: "Agent console and customer portal access for the VANTA Desk ticketing system.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [role, setRole] = useState<"guest" | "agent">("guest");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate({ to: "/", replace: true });
    })();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { role, full_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success(role === "agent" ? "Agent account created" : "Guest account created");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate({ to: "/", replace: true });
      else toast.info("Check your inbox to confirm your address, then sign in.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-ink px-4 py-10">
      <div className="hairline-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2">
          <span className="font-mono text-[15px] font-semibold tracking-[0.18em] text-fg">VANTA</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-faint">// desk</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">
          {mode === "signin" ? "Sign in to the desk" : "Create your desk access"}
        </h1>
        <p className="mt-1 text-[13px] text-dim">
          Agents triage every queue. Guests see their own tickets plus anything shared with them.
        </p>

        <div className="mt-6 rounded-lg border border-line bg-panel p-5">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-line bg-raise p-1">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-3 py-1.5 text-[12px] font-medium transition-colors",
                  mode === m ? "bg-accent text-accent-foreground" : "text-dim hover:text-fg",
                )}
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-raise p-1">
                  {(["guest", "agent"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={cn(
                        "rounded px-3 py-1.5 text-[12px] font-medium capitalize transition-colors",
                        role === r ? "bg-raise text-accent ring-1 ring-accent/40" : "text-dim hover:text-fg",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <Field label="Full name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="desk-input"
                    placeholder="Dana Ruiz"
                  />
                </Field>
              </>
            )}
            <Field label="Work email">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="desk-input"
                placeholder="you@company.com"
              />
            </Field>
            <Field label="Password">
              <input
                required
                type="password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="desk-input"
                placeholder="••••••••"
              />
            </Field>
            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-md bg-accent px-3 py-2 text-[13px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          {mode === "signup" && (
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              The first agent account becomes the desk admin: it manages departments, SLA policy, ticket
              layout, roles and customer sharing.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-faint">{label}</span>
      {children}
    </label>
  );
}
