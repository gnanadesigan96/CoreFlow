import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PriorityChip } from "@/components/desk/chips";
import type { Priority } from "@/lib/desk-data";
import { deskMetrics, isOpenStatus, isOverdue, useDesk } from "@/lib/desk-store";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Support Dashboard — VANTA Desk" },
      {
        name: "description",
        content: "Live support metrics: open volume, SLA breaches, first-response time, CSAT and load per agent.",
      },
      { property: "og:title", content: "Support Dashboard — VANTA Desk" },
      { property: "og:description", content: "Live queue health, SLA breaches and agent load." },
    ],
  }),
  component: DashboardPage,
});

const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="mb-3 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">{title}</h2>
      {children}
    </section>
  );
}

function DashboardPage() {
  const { isAgent: __isAgent } = useDesk();
  if (!__isAgent) return <AgentsOnly />;

  const { state, now } = useDesk();
  const m = deskMetrics(state.tickets, now);

  const byPriority = PRIORITIES.map((p) => ({
    name: p,
    open: state.tickets.filter((t) => t.priority === p && isOpenStatus(t.status)).length,
  }));

  const byAgent = state.agents.map((a) => ({
    name: a.handle,
    load: state.tickets.filter((t) => t.assignee === a.id && isOpenStatus(t.status)).length,
  }));

  const breaching = state.tickets
    .filter((t) => isOverdue(t, now))
    .concat(state.tickets.filter((t) => isOpenStatus(t.status) && !isOverdue(t, now)).slice(0, 0));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <header className="mb-5">
        <h1 className="text-[15px] font-semibold tracking-tight text-fg">Operations dashboard</h1>
        <p className="mt-1 text-[12px] text-dim">Live snapshot of queue health across every department.</p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Open tickets", value: String(m.open) },
          { label: "SLA breached", value: String(m.overdue), tone: "text-red" },
          { label: "Avg first response", value: `${m.avgFirstResponse}m` },
          { label: "CSAT", value: `${m.csat}%`, tone: "text-accent" },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-line bg-panel p-4">
            <div className="text-[9px] uppercase tracking-[0.2em] text-faint">{card.label}</div>
            <div className={`mt-2 font-mono text-2xl ${card.tone ?? "text-fg"}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Open by priority">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPriority}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--color-faint)" fontSize={10} tickLine={false} />
                <YAxis stroke="var(--color-faint)" fontSize={10} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-raise)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="open" radius={[3, 3, 0, 0]}>
                  {byPriority.map((row) => (
                    <Cell
                      key={row.name}
                      fill={
                        row.name === "P1"
                          ? "var(--color-red)"
                          : row.name === "P2"
                            ? "var(--color-amber)"
                            : "var(--color-accent)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Agent load">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byAgent} layout="vertical">
                <CartesianGrid stroke="var(--color-line)" horizontal={false} />
                <XAxis type="number" stroke="var(--color-faint)" fontSize={10} allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke="var(--color-faint)" fontSize={10} width={60} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-raise)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="load" fill="var(--color-accent)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="SLA breaches">
          {breaching.length === 0 ? (
            <p className="text-[12px] text-faint">No breaches. Queue is inside target.</p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-faint">
                  <th className="pb-2 font-normal">Ticket</th>
                  <th className="pb-2 font-normal">Account</th>
                  <th className="pb-2 font-normal">Priority</th>
                  <th className="pb-2 font-normal">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {breaching.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-[10px] text-faint">#{t.code}</span>{" "}
                      <span className="text-fg">{t.subject}</span>
                    </td>
                    <td className="py-2 pr-3 text-dim">{t.company}</td>
                    <td className="py-2 pr-3">
                      <PriorityChip priority={t.priority} />
                    </td>
                    <td className="py-2 font-mono text-[11px] text-dim">
                      {state.agents.find((a) => a.id === t.assignee)?.handle ?? "unassigned"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
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
