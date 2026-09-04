import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { Priority } from "@/lib/desk-data";
import { useDesk, type CustomField, type SlaRule } from "@/lib/desk-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Admin Settings — VANTA Desk" },
      {
        name: "description",
        content:
          "Configure SLA targets per priority, ticket layout and custom fields, agents, departments and canned macros.",
      },
      { property: "og:title", content: "Admin Settings — VANTA Desk" },
      {
        property: "og:description",
        content: "SLA policies, custom fields, agents, departments and macros in one console.",
      },
    ],
  }),
  component: SettingsPage,
});

const TABS = ["SLA", "Layout & fields", "People & roles", "Departments", "Macros", "Sharing"] as const;
type Tab = (typeof TABS)[number];

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
      <p className="mt-1 mb-4 text-[11px] text-dim">{hint}</p>
      {children}
    </section>
  );
}

const inputCls =
  "h-8 w-full rounded-md border border-line bg-raise px-2.5 font-mono text-[11px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none";
const btnCls =
  "h-8 rounded-md bg-accent px-3 text-[11px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90";
const ghostBtnCls =
  "h-8 rounded-md border border-line px-2.5 text-[11px] text-dim transition-colors hover:border-red/40 hover:text-red";

function SettingsPage() {
  const { isAgent: __isAgent } = useDesk();
  if (!__isAgent) return <AgentsOnly />;

  const [tab, setTab] = useState<Tab>("SLA");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <header className="mb-4">
        <h1 className="text-[15px] font-semibold tracking-tight text-fg">Admin settings</h1>
        <p className="mt-1 text-[12px] text-dim">
          Everything that shapes the desk: SLA policy, ticket layout, people and departments.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] transition-colors",
              tab === t
                ? "border-accent/30 bg-accent/10 font-medium text-accent"
                : "border-line text-dim hover:text-fg",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="max-w-3xl">
        {tab === "SLA" && <SlaSettings />}
        {tab === "Layout & fields" && <FieldSettings />}
        {tab === "People & roles" && <AgentSettings />}
        {tab === "Departments" && <DepartmentSettings />}
        {tab === "Macros" && <MacroSettings />}
        {tab === "Sharing" && <SharingSettings />}
      </div>
    </div>
  );
}

function SlaSettings() {
  const { state, saveSla } = useDesk();
  const [rules, setRules] = useState<SlaRule[]>(state.sla);

  const update = (priority: Priority, key: "firstResponse" | "resolution", value: number) =>
    setRules((rs) => rs.map((r) => (r.priority === priority ? { ...r, [key]: value } : r)));

  return (
    <Section
      title="SLA configuration"
      hint="Targets are in minutes from ticket creation. Saving recalculates every live countdown in the queue."
    >
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-faint">
            <th className="pb-2 font-normal">Priority</th>
            <th className="pb-2 font-normal">First response (min)</th>
            <th className="pb-2 font-normal">Resolution (min)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {rules.map((r) => (
            <tr key={r.priority}>
              <td className="py-2 pr-3 font-mono text-fg">{r.priority}</td>
              <td className="py-2 pr-3">
                <input
                  type="number"
                  min={1}
                  value={r.firstResponse}
                  onChange={(e) => update(r.priority, "firstResponse", Number(e.target.value))}
                  className={inputCls}
                />
              </td>
              <td className="py-2">
                <input
                  type="number"
                  min={1}
                  value={r.resolution}
                  onChange={(e) => update(r.priority, "resolution", Number(e.target.value))}
                  className={inputCls}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className={cn(btnCls, "mt-4")}
        onClick={() => {
          saveSla(rules);
          toast.success("SLA policy saved — timers recalculated");
        }}
      >
        Save SLA policy
      </button>
    </Section>
  );
}

function FieldSettings() {
  const { state, addField, removeField } = useDesk();
  const [draft, setDraft] = useState<Omit<CustomField, "id">>({
    label: "",
    type: "text",
    options: [],
    required: false,
    section: "ticket",
  });
  const [optionText, setOptionText] = useState("");

  return (
    <Section
      title="Layout & fields"
      hint="Custom fields render in the ticket detail sidebar in this order. Select fields need comma-separated options."
    >
      <div className="space-y-2">
        {state.fields.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-3 rounded-md border border-line bg-raise px-3 py-2 text-[12px]"
          >
            <span className="text-fg">{f.label}</span>
            <span className="rounded border border-line px-1 font-mono text-[9px] uppercase tracking-wider text-dim">
              {f.type}
            </span>
            {f.required && (
              <span className="rounded border border-red/30 px-1 font-mono text-[9px] uppercase tracking-wider text-red/90">
                required
              </span>
            )}
            {f.options.length > 0 && (
              <span className="truncate font-mono text-[10px] text-faint">{f.options.join(" · ")}</span>
            )}
            <button onClick={() => removeField(f.id)} className={cn(ghostBtnCls, "ml-auto h-7")}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 rounded-md border border-line bg-raise p-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-faint">Label</span>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Root cause"
            className={cn(inputCls, "mt-1")}
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-faint">Type</span>
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomField["type"] })}
            className={cn(inputCls, "mt-1")}
          >
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="select">select</option>
            <option value="checkbox">checkbox</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[10px] uppercase tracking-wider text-faint">
            Options (comma separated, select only)
          </span>
          <input
            value={optionText}
            onChange={(e) => setOptionText(e.target.value)}
            placeholder="Config, Code defect, Data"
            className={cn(inputCls, "mt-1")}
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-dim">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
            className="accent-[var(--color-accent)]"
          />
          Required on ticket
        </label>
        <button
          className={cn(btnCls, "sm:justify-self-end")}
          onClick={() => {
            if (!draft.label.trim()) {
              toast.error("Field label is required");
              return;
            }
            addField({
              ...draft,
              label: draft.label.trim(),
              options: optionText
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean),
            });
            setDraft({ label: "", type: "text", options: [], required: false, section: "ticket" });
            setOptionText("");
            toast.success("Field added to the ticket layout");
          }}
        >
          Add field
        </button>
      </div>
    </Section>
  );
}

function AgentSettings() {
  const { state, me, isAdmin, setUserRole, toggleAgentDepartment } = useDesk();
  const people = [
    ...state.agents,
    ...state.guests.map((g) => ({
      ...g,
      initials: (g.handle || g.email).slice(0, 2).toUpperCase(),
      team: "Guest",
    })),
  ];

  return (
    <Section
      title="People & roles"
      hint="Everyone who signs up appears here. Admins promote guests to agents, grant admin, and enable the departments each agent can work in."
    >
      {!isAdmin && (
        <p className="mb-3 rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-[11px] text-amber">
          Only desk admins can change roles. You can view the roster.
        </p>
      )}
      <div className="space-y-2">
        {people.map((person) => {
          const role = person.role;
          const isAgentRow = state.agents.some((a) => a.id === person.id);
          return (
            <div key={person.id} className="rounded-md border border-line bg-raise px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-md border border-line bg-panel font-mono text-[10px] text-accent">
                  {person.initials}
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] text-fg">
                    {person.name}
                    {person.id === me.id && <span className="ml-2 text-[10px] text-faint">you</span>}
                  </div>
                  <div className="font-mono text-[10px] text-faint">{person.handle}</div>
                </div>
                <div className="ml-auto flex gap-1">
                  {(["guest", "agent", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      disabled={!isAdmin}
                      onClick={() => {
                        void setUserRole(person.id, r);
                        toast.success(`${person.name} is now ${r}`);
                      }}
                      className={cn(
                        "rounded border px-2 py-0.5 font-mono text-[10px] capitalize transition-colors disabled:opacity-40",
                        role === r
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line text-faint hover:text-dim",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {isAgentRow && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {state.departments.map((d) => {
                    const on = (state.agentDepartments[person.id] ?? []).includes(d.id);
                    return (
                      <button
                        key={d.id}
                        disabled={!isAdmin}
                        onClick={() => void toggleAgentDepartment(person.id, d.id)}
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors disabled:opacity-40",
                          on
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-line text-faint hover:text-dim",
                        )}
                      >
                        {on ? "● " : "○ "}
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {people.length === 0 && <p className="text-[11px] text-faint">No accounts yet.</p>}
      </div>
    </Section>
  );
}

function SharingSettings() {
  const { state, isAdmin, shareCustomer, unshareCustomer } = useDesk();
  const [customerId, setCustomerId] = useState("");
  const [email, setEmail] = useState("");

  return (
    <Section
      title="Customer sharing"
      hint="Give a guest read access to every ticket on an account — useful for account managers and partners who need visibility beyond their own tickets."
    >
      <div className="space-y-2">
        {state.shares.map((share) => {
          const customer = state.customers.find((c) => c.id === share.customerId);
          return (
            <div
              key={share.id}
              className="flex items-center gap-3 rounded-md border border-line bg-raise px-3 py-2"
            >
              <span className="text-[12px] text-fg">{customer?.name ?? "Unknown account"}</span>
              <span className="font-mono text-[10px] text-faint">{share.guestEmail}</span>
              <button
                disabled={!isAdmin}
                onClick={() => void unshareCustomer(share.id)}
                className={cn(ghostBtnCls, "ml-auto h-7 disabled:opacity-40")}
              >
                Revoke
              </button>
            </div>
          );
        })}
        {state.shares.length === 0 && (
          <p className="text-[11px] text-faint">No accounts shared with guests yet.</p>
        )}
      </div>

      <div className="mt-4 grid gap-2 rounded-md border border-line bg-raise p-3 sm:grid-cols-[1fr_1fr_auto]">
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="h-8 w-full rounded-md border border-line bg-panel px-2 text-[11px] text-fg focus:border-accent/40 focus:outline-none"
        >
          <option value="">Select account…</option>
          {state.customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="guest@company.com"
          className={inputCls}
        />
        <button
          disabled={!isAdmin}
          className={cn(btnCls, "disabled:opacity-40")}
          onClick={() => {
            if (!customerId || !email.trim()) {
              toast.error("Pick an account and enter a guest email");
              return;
            }
            void shareCustomer(customerId, email.trim().toLowerCase());
            setEmail("");
            toast.success("Account shared");
          }}
        >
          Share
        </button>
      </div>
    </Section>
  );
}

function DepartmentSettings() {
  const { state, addDepartment, removeDepartment } = useDesk();
  const [draft, setDraft] = useState({ name: "", description: "" });

  return (
    <Section
      title="Departments"
      hint="Departments group queues (Technical Support, Billing, Onboarding…). Enable them per agent on the Agents tab."
    >
      <div className="space-y-2">
        {state.departments.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 rounded-md border border-line bg-raise px-3 py-2 text-[12px]"
          >
            <div className="min-w-0">
              <div className="text-fg">{d.name}</div>
              <div className="text-[11px] text-faint">{d.description}</div>
            </div>
            <span className="ml-auto font-mono text-[10px] text-faint">
              {
                Object.values(state.agentDepartments).filter((ids) => ids.includes(d.id)).length
              }{" "}
              agents
            </span>
            <button onClick={() => removeDepartment(d.id)} className={cn(ghostBtnCls, "h-7")}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 rounded-md border border-line bg-raise p-3 sm:grid-cols-2">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Department name"
          className={inputCls}
        />
        <input
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="What it handles"
          className={inputCls}
        />
        <button
          className={cn(btnCls, "sm:col-span-2 sm:justify-self-start")}
          onClick={() => {
            if (!draft.name.trim()) {
              toast.error("Department name is required");
              return;
            }
            addDepartment({ name: draft.name.trim(), description: draft.description.trim() });
            setDraft({ name: "", description: "" });
            toast.success("Department created");
          }}
        >
          Add department
        </button>
      </div>
    </Section>
  );
}

function MacroSettings() {
  const { state, addMacro, removeMacro } = useDesk();
  const [draft, setDraft] = useState({ label: "", body: "" });

  return (
    <Section title="Macros" hint="Canned responses available from the reply composer.">
      <div className="space-y-2">
        {state.macros.map((m) => (
          <div key={m.id} className="rounded-md border border-line bg-raise px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-fg">{m.label}</span>
              <button onClick={() => removeMacro(m.id)} className={cn(ghostBtnCls, "ml-auto h-7")}>
                Remove
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">{m.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 rounded-md border border-line bg-raise p-3">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="Macro name"
          className={inputCls}
        />
        <textarea
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder="Response text…"
          className="min-h-[72px] w-full resize-none rounded-md border border-line bg-panel px-2.5 py-2 text-[12px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
        />
        <button
          className={btnCls}
          onClick={() => {
            if (!draft.label.trim() || !draft.body.trim()) {
              toast.error("Macro name and text are required");
              return;
            }
            addMacro({ label: draft.label.trim(), body: draft.body.trim(), setStatus: null });
            setDraft({ label: "", body: "" });
            toast.success("Macro saved");
          }}
        >
          Add macro
        </button>
      </div>
    </Section>
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
