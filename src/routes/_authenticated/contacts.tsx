import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { isOpenStatus, useDesk } from "@/lib/desk-store";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts & Accounts — VANTA Desk" },
      {
        name: "description",
        content: "Every account and contact in the desk with plan, region, open ticket count and lifetime value.",
      },
      { property: "og:title", content: "Contacts & Accounts — VANTA Desk" },
      { property: "og:description", content: "Account and contact directory with open ticket counts." },
    ],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  const { isAgent: __isAgent } = useDesk();
  if (!__isAgent) return <AgentsOnly />;

  const { state } = useDesk();
  const [query, setQuery] = useState("");

  const accounts = useMemo(() => {
    const map = new Map<
      string,
      {
        company: string;
        plan: string;
        region: string;
        lifetimeValue: string;
        contacts: Map<string, { name: string; email: string; role: string }>;
        open: number;
        total: number;
        lastTicketId: string;
      }
    >();
    for (const t of state.tickets) {
      const row =
        map.get(t.company) ??
        {
          company: t.company,
          plan: t.plan,
          region: t.region,
          lifetimeValue: t.lifetimeValue,
          contacts: new Map(),
          open: 0,
          total: 0,
          lastTicketId: t.id,
        };
      row.contacts.set(t.contactEmail, {
        name: t.contactName,
        email: t.contactEmail,
        role: t.contactRole,
      });
      row.total += 1;
      if (isOpenStatus(t.status)) row.open += 1;
      map.set(t.company, row);
    }
    const q = query.trim().toLowerCase();
    return [...map.values()].filter(
      (a) =>
        !q ||
        a.company.toLowerCase().includes(q) ||
        [...a.contacts.values()].some((c) => `${c.name} ${c.email}`.toLowerCase().includes(q)),
    );
  }, [state.tickets, query]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-fg">Accounts & contacts</h1>
          <p className="mt-1 text-[12px] text-dim">{accounts.length} accounts in this workspace.</p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts or people…"
          className="h-8 w-64 rounded-md border border-line bg-raise px-2.5 font-mono text-[11px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
        />
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <article key={a.company} className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-md border border-line bg-raise font-mono text-[11px] text-accent">
                {a.company.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[13px] font-semibold text-fg">{a.company}</h2>
                <p className="text-[11px] text-faint">
                  {a.plan} · {a.region}
                </p>
              </div>
              <Link
                to="/"
                search={{ t: a.lastTicketId }}
                className="ml-auto font-mono text-[10px] text-accent hover:underline"
              >
                open →
              </Link>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
              {[
                { label: "Open", value: String(a.open) },
                { label: "Total", value: String(a.total) },
                { label: "Lifetime", value: a.lifetimeValue },
              ].map((s) => (
                <div key={s.label} className="bg-panel p-2">
                  <div className="text-[9px] uppercase tracking-wider text-faint">{s.label}</div>
                  <div className="mt-1 font-mono text-[12px] text-fg">{s.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5">
              {[...a.contacts.values()].map((c) => (
                <div key={c.email} className="text-[11px]">
                  <span className="text-fg">{c.name}</span>{" "}
                  <span className="text-faint">· {c.role}</span>
                  <div className="font-mono text-[10px] text-faint">{c.email}</div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AgentsOnly() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-8">
      <div className="max-w-sm rounded-lg border border-line bg-panel p-5 text-center">
        <h2 className="text-[13px] font-semibold text-fg">Agents only</h2>
        <p className="mt-1 text-[12px] text-dim">
          This area is part of the agent console. Your account can view and raise tickets from
          &ldquo;My tickets&rdquo;.
        </p>
      </div>
    </div>
  );
}
