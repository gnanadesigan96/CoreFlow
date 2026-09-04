import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PriorityChip, SlaText, StatusChip } from "@/components/desk/chips";
import {
  ApprovalsPanel,
  ArticlesPanel,
  CopilotCard,
  HistoryPanel,
  ResolutionPanel,
  TicketTabBar,
  TimePanel,
  type TicketTab,
} from "@/components/desk/ticket-tabs";
import {
  EMPTY_FILTERS,
  FilterPanel,
  activeFilterCount,
  applyFilters,
  type QueueFilters,
} from "@/components/desk/queue-filters";
import { TicketProperties } from "@/components/desk/ticket-properties";
import { STATUS_LABEL, type Priority, type Status, type Ticket } from "@/lib/desk-data";
import {
  formatCountdown,
  isOpenStatus,
  isOverdue,
  slaRemaining,
  slaTone,
  useDesk,
} from "@/lib/desk-store";
import { cn } from "@/lib/utils";

type View = "all" | "unassigned" | "overdue" | "mine";

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: (search: Record<string, unknown>): { t?: string } =>
    typeof search["t"] === "string" ? { t: search["t"] } : {},
  head: () => ({
    meta: [
      { title: "Ticket Queue — VANTA Desk" },
      {
        name: "description",
        content:
          "Triage support tickets with live SLA countdowns, saved views, threaded replies, internal notes and macros.",
      },
      { property: "og:title", content: "Ticket Queue — VANTA Desk" },
      {
        property: "og:description",
        content: "A futuristic support console: queue triage, SLA timers, macros and custom fields.",
      },
    ],
  }),
  component: Workspace,
});

const STATUSES: Status[] = ["open", "pending", "resolved", "closed"];
const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];

function Workspace() {
  const { t: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const { state, me, isAgent, now, updateTicket, addMessage, toggleTag, setFieldValue, createTicket } =
    useDesk();
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<QueueFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const filterCount = activeFilterCount(filters);
  const allTags = useMemo(
    () => Array.from(new Set(state.tickets.flatMap((t) => t.tags))).sort(),
    [state.tickets],
  );

  const tickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = state.tickets
      .filter((t) => {
        if (view === "unassigned") return !t.assignee && isOpenStatus(t.status);
        if (view === "overdue") return isOverdue(t, now);
        if (view === "mine") return isAgent ? t.assignee === me.id : t.contactEmail === me.email;
        return true;
      })
      .filter(
        (t) =>
          !q ||
          `${t.code} ${t.subject} ${t.company} ${t.contactName} ${t.tags.join(" ")}`
            .toLowerCase()
            .includes(q),
      );
    return applyFilters(base, filters, { now, props: state.props });
  }, [state.tickets, state.props, view, query, filters, now, isAgent, me.id, me.email]);

  const active = state.tickets.find((t) => t.id === selectedId) ?? tickets[0] ?? null;

  const select = (id: string) => navigate({ search: { t: id } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key !== "j" && e.key !== "k") return;
      const idx = tickets.findIndex((t) => t.id === active?.id);
      const next = e.key === "j" ? idx + 1 : idx - 1;
      if (tickets[next]) select(tickets[next].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <section className="flex min-h-0 w-[330px] shrink-0 flex-col border-r border-line bg-ink">
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold tracking-tight">{isAgent ? "Queue" : "My tickets"}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters((v) => !v)}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
                  showFilters || filterCount
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-line text-dim hover:text-fg",
                )}
              >
                Filters{filterCount ? ` · ${filterCount}` : ""}
              </button>
              <span className="font-mono text-[10px] text-faint">{tickets.length}</span>
              <NewTicketDialog
                onCreate={createTicket}
                onCreated={select}
                isAgent={isAgent}
                customers={state.customers}
                departments={state.departments}
                me={me}
              />
            </div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter queue…"
            className="mt-2.5 h-7 w-full rounded-md border border-line bg-raise px-2.5 font-mono text-[11px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
          />
          <div className="mt-2 flex gap-1">
            {((isAgent ? ["all", "unassigned", "overdue", "mine"] : ["all", "mine"]) as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] capitalize transition-colors",
                  view === v
                    ? "border-accent/30 bg-accent/10 font-medium text-accent"
                    : v === "overdue"
                      ? "border-red/30 text-red/80 hover:text-red"
                      : "border-line text-dim hover:text-fg",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {showFilters && (
          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            agents={state.agents}
            departments={state.departments}
            customers={state.customers}
            tags={allTags}
            isAgent={isAgent}
          />
        )}

        <div className="flex items-center gap-3 border-y border-line/60 bg-panel/40 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-faint">
          <span>SLA</span>
          <span className="flex-1">Subject</span>
          <span>Pri</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tickets.map((ticket) => (
            <QueueRow
              key={ticket.id}
              ticket={ticket}
              now={now}
              active={ticket.id === active?.id}
              assigneeLabel={
                state.agents.find((a) => a.id === ticket.assignee)?.handle ?? "unassigned"
              }
              onSelect={() => select(ticket.id)}
            />
          ))}
          {tickets.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-faint">Nothing in this view.</p>
          )}
        </div>
      </section>

      <main className="flex min-h-0 min-w-0 flex-1 bg-ink">
        {active ? (
          <TicketDetail
            key={active.id}
            ticket={active}
            isAgent={isAgent}
            now={now}
            agents={state.agents}
            macros={state.macros}
            fields={state.fields.filter((f) => f.section === "ticket")}
            fieldValues={state.fieldValues[active.id] ?? {}}
            relatedTickets={state.tickets.filter((t) => t.company === active.company && t.id !== active.id)}
            onUpdate={(patch) => updateTicket(active.id, patch)}
            onMessage={(kind, body) => addMessage(active.id, kind, body)}
            onToggleTag={(tag) => toggleTag(active.id, tag)}
            onFieldValue={(fieldId, value) => setFieldValue(active.id, fieldId, value)}
            onSelectTicket={select}
          />
        ) : (
          <div className="grid flex-1 place-items-center text-[12px] text-faint">Select a ticket</div>
        )}
      </main>
    </>
  );
}

function QueueRow({
  ticket,
  now,
  active,
  assigneeLabel,
  onSelect,
}: {
  ticket: Ticket;
  now: number;
  active: boolean;
  assigneeLabel: string;
  onSelect: () => void;
}) {
  const tone = slaTone(ticket, now);
  return (
    <div
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-line/60 px-3 py-2.5 transition-colors",
        active ? "border-l-2 border-l-accent bg-accent/[0.06]" : "hover:bg-raise",
        !isOpenStatus(ticket.status) && !active && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <SlaText text={formatCountdown(slaRemaining(ticket, now))} tone={tone} />
        <span className="ml-auto flex items-center gap-1">
          <PriorityChip priority={ticket.priority} />
          {isOverdue(ticket, now) ? (
            <span className="rounded border border-amber/30 px-1 font-mono text-[9px] uppercase tracking-wider text-amber/90">
              overdue
            </span>
          ) : (
            <StatusChip status={ticket.status} />
          )}
        </span>
      </div>
      <div className="mt-1.5 text-[13px] font-medium leading-snug text-fg">{ticket.subject}</div>
      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-faint">
        <span>#{ticket.code}</span>
        <span>·</span>
        <span className="truncate">{ticket.company}</span>
        <span className="ml-auto text-dim">{assigneeLabel}</span>
      </div>
    </div>
  );
}

function ToolbarButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-raise px-2.5 text-[11px] text-dim transition-colors hover:text-fg">
      {children}
    </button>
  );
}

function SlaBar({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: "red" | "accent" }) {
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-faint">{label}</span>
        <span className={cn("font-mono text-[11px]", tone === "red" ? "text-red" : "text-dim")}>{value}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <div
          className={cn("h-full rounded-full", tone === "red" ? "bg-red" : "bg-accent")}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </>
  );
}

function TicketDetail({
  ticket,
  isAgent,
  now,
  agents,
  macros,
  fields,
  fieldValues,
  relatedTickets,
  onUpdate,
  onMessage,
  onToggleTag,
  onFieldValue,
  onSelectTicket,
}: {
  ticket: Ticket;
  isAgent: boolean;
  now: number;
  agents: { id: string; handle: string; name: string }[];
  macros: { id: string; label: string; body: string }[];
  fields: { id: string; label: string; type: string; options: string[]; required: boolean }[];
  fieldValues: Record<string, string>;
  relatedTickets: Ticket[];
  onUpdate: (patch: Partial<Ticket>) => void;
  onMessage: (kind: "agent" | "note", body: string) => void;
  onToggleTag: (tag: string) => void;
  onFieldValue: (fieldId: string, value: string) => void;
  onSelectTicket: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"agent" | "note">("agent");
  const [tab, setTab] = useState<TicketTab>("Conversation");
  const [tagDraft, setTagDraft] = useState("");
  const insertDraft = (text: string) => {
    setTab("Conversation");
    setMode("agent");
    setDraft((d) => (d ? `${d}\n\n${text}` : text));
  };
  const assignee = agents.find((a) => a.id === ticket.assignee);
  const remaining = slaRemaining(ticket, now);
  const tone = slaTone(ticket, now);

  const firstResponsePct =
    ((new Date(ticket.firstResponseDueAt).getTime() - now) /
      (new Date(ticket.firstResponseDueAt).getTime() - new Date(ticket.createdAt).getTime())) *
    100;
  const resolutionPct =
    ((new Date(ticket.resolutionDueAt).getTime() - now) /
      (new Date(ticket.resolutionDueAt).getTime() - new Date(ticket.createdAt).getTime())) *
    100;

  const send = () => {
    if (!draft.trim()) return;
    onMessage(mode, draft.trim());
    setDraft("");
    toast.success(mode === "agent" ? "Reply sent" : "Internal note added");
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-line bg-panel px-4">
          <span className="shrink-0 font-mono text-[12px] text-fg">#{ticket.code}</span>
          <span className="shrink-0 text-faint">/</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{ticket.subject}</span>
          <div className={cn("flex shrink-0 items-center gap-1.5", !isAgent && "hidden")}>
            <span
              className={cn(
                "size-1.5 rounded-full",
                tone === "red" ? "bg-red sla-over" : tone === "amber" ? "bg-amber" : "bg-accent",
              )}
              title="SLA state"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ToolbarButton>
                  {STATUS_LABEL[ticket.status]} <span className="text-faint">▾</span>
                </ToolbarButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-line bg-panel">
                {STATUSES.map((s) => (
                  <DropdownMenuItem key={s} className="text-[12px]" onSelect={() => onUpdate({ status: s })}>
                    {STATUS_LABEL[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ToolbarButton>
                  <span className="text-amber">{ticket.priority}</span> <span className="text-faint">▾</span>
                </ToolbarButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-line bg-panel">
                {PRIORITIES.map((p) => (
                  <DropdownMenuItem
                    key={p}
                    className="text-[12px]"
                    onSelect={() => onUpdate({ priority: p })}
                  >
                    {p}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ToolbarButton>
                  {assignee?.handle ?? "Unassigned"} <span className="text-faint">▾</span>
                </ToolbarButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-line bg-panel">
                <DropdownMenuItem className="text-[12px]" onSelect={() => onUpdate({ assignee: null })}>
                  Unassigned
                </DropdownMenuItem>
                {agents.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    className="text-[12px]"
                    onSelect={() => onUpdate({ assignee: a.id })}
                  >
                    {a.name} <span className="ml-2 font-mono text-[10px] text-faint">{a.handle}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() =>
                onUpdate({ status: ticket.status === "resolved" ? "open" : "resolved" })
              }
              className="h-7 rounded-md bg-accent px-2.5 text-[11px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
            >
              {ticket.status === "resolved" ? "Reopen" : "Resolve"}
            </button>
          </div>
        </div>

        <TicketTabBar tab={tab} setTab={setTab} ticket={ticket} isAgent={isAgent} />

        {tab !== "Conversation" ? (
          tab === "Resolution" ? (
            <ResolutionPanel ticket={ticket} isAgent={isAgent} />
          ) : tab === "Time" ? (
            <TimePanel ticket={ticket} />
          ) : tab === "Approvals" ? (
            <ApprovalsPanel ticket={ticket} />
          ) : tab === "Articles" ? (
            <ArticlesPanel ticket={ticket} isAgent={isAgent} onInsert={insertDraft} />
          ) : (
            <HistoryPanel ticket={ticket} />
          )
        ) : (
        <>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {ticket.messages.filter((m) => isAgent || m.kind !== "note").map((m) => (
            <div
              key={m.id}
              className="flex gap-3"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-raise font-mono text-[10px] text-dim">
                {(m.kind === "customer" ? m.author : m.author).slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-fg">{m.author}</span>
                  {m.kind === "note" && (
                    <span className="rounded border border-accent/30 px-1 font-mono text-[9px] uppercase tracking-wider text-accent">
                      internal note
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-faint">
                    {new Date(m.at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className={cn(
                    "mt-1.5 max-w-[62ch] rounded-lg rounded-tl-none border px-3.5 py-2.5 text-[13px] leading-relaxed text-dim",
                    m.kind === "note" ? "border-accent/20 bg-accent/[0.05]" : "border-line bg-raise",
                  )}
                >
                  {m.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-line bg-panel/60 p-3">
          <div className="rounded-lg border border-line bg-raise transition-colors focus-within:border-accent/40">
            <div className={cn("flex gap-1 border-b border-line/60 px-2.5 pt-2", !isAgent && "hidden")}>
              {(["agent", "note"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-t-md px-2 py-1 text-[11px] transition-colors",
                    mode === m ? "bg-accent/10 text-accent" : "text-faint hover:text-dim",
                  )}
                >
                  {m === "agent" ? "Reply" : "Internal note"}
                </button>
              ))}
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              placeholder={
                mode === "agent"
                  ? isAgent
                    ? `Reply to ${ticket.contactName}…  (⌘↵ to send)`
                    : "Add a reply for the support team…  (⌘↵ to send)"
                  : "Note visible only to agents…"
              }
              className="min-h-[64px] w-full resize-none bg-transparent px-3.5 py-2.5 text-[13px] text-fg placeholder:text-faint focus:outline-none"
            />
            <div className="flex items-center gap-1.5 border-t border-line/60 px-2.5 py-2">
              <DropdownMenu>
                <DropdownMenuTrigger className={cn("h-6 rounded-md border border-line px-2 font-mono text-[10px] text-dim transition-colors hover:border-accent/40 hover:text-fg", !isAgent && "hidden")}>
                  + Macro
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-sm border-line bg-panel">
                  {macros.map((macro) => (
                    <DropdownMenuItem
                      key={macro.id}
                      className="text-[12px]"
                      onSelect={() => setDraft((d) => (d ? `${d}\n\n${macro.body}` : macro.body))}
                    >
                      {macro.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => onUpdate({ status: "pending" })}
                className={cn("h-6 rounded-md border border-line px-2 font-mono text-[10px] text-dim transition-colors hover:text-fg", !isAgent && "hidden")}
              >
                Set pending
              </button>
              <div className="ml-auto flex items-center gap-2">
                <span className="font-mono text-[9px] text-faint">
                  SLA <SlaText text={formatCountdown(remaining)} tone={tone} />
                </span>
                <button
                  onClick={send}
                  className="h-6 rounded-md bg-accent px-3 text-[11px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      <aside className="w-[264px] shrink-0 overflow-y-auto border-l border-line bg-panel px-4 py-4">
        <AccountCard ticket={ticket} isAgent={isAgent} onUpdate={onUpdate} />

        {isAgent && (
          <div className="mt-4">
            <CopilotCard ticket={ticket} onDraft={insertDraft} />
          </div>
        )}



        <div className="mt-4">
          <TicketProperties ticketId={ticket.id} readOnly={!isAgent} />
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-faint">Contact</div>
          <div className="text-[12px] text-fg">{ticket.contactName}</div>
          <div className="font-mono text-[10px] text-faint">{ticket.contactEmail}</div>
          <div className="mt-1 text-[11px] text-dim">
            {ticket.contactRole} · via {ticket.channel}
          </div>
        </div>

        <div className={cn("mt-4", !isAgent && "hidden")}>
          <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-faint">Tags</div>
          <div className="flex flex-wrap gap-1.5">
            {ticket.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => onToggleTag(tag)}
                title="Remove tag"
                className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-dim transition-colors hover:border-red/40 hover:text-red"
              >
                {tag}
              </button>
            ))}
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagDraft.trim()) {
                  onToggleTag(tagDraft.trim().toLowerCase());
                  setTagDraft("");
                }
              }}
              placeholder="+ add"
              className="w-16 rounded border border-line bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-faint">SLA</div>
          <div className="rounded-md border border-line bg-raise p-3">
            <SlaBar
              label="First response"
              value={
                ticket.firstRespondedAt
                  ? "met"
                  : `${formatCountdown(new Date(ticket.firstResponseDueAt).getTime() - now)} left`
              }
              pct={ticket.firstRespondedAt ? 100 : firstResponsePct}
              tone={ticket.firstRespondedAt ? "accent" : firstResponsePct < 30 ? "red" : "accent"}
            />
            <div className="mt-3" />
            <SlaBar
              label="Resolution"
              value={`${formatCountdown(new Date(ticket.resolutionDueAt).getTime() - now)} left`}
              pct={resolutionPct}
              tone={resolutionPct < 20 ? "red" : "accent"}
            />
          </div>
        </div>

        {fields.length > 0 && isAgent && (
          <div className="mt-4">
            <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-faint">Fields</div>
            <div className="space-y-2">
              {fields.map((f) => (
                <label key={f.id} className="block">
                  <span className="text-[10px] text-faint">
                    {f.label}
                    {f.required && <span className="text-red"> *</span>}
                  </span>
                  {f.type === "select" ? (
                    <select
                      value={fieldValues[f.id] ?? ""}
                      onChange={(e) => onFieldValue(f.id, e.target.value)}
                      className="mt-1 h-7 w-full rounded-md border border-line bg-raise px-2 text-[11px] text-fg focus:border-accent/40 focus:outline-none"
                    >
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "checkbox" ? (
                    <button
                      onClick={() => onFieldValue(f.id, fieldValues[f.id] === "true" ? "false" : "true")}
                      className={cn(
                        "mt-1 h-7 w-full rounded-md border px-2 text-left text-[11px] transition-colors",
                        fieldValues[f.id] === "true"
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line bg-raise text-dim",
                      )}
                    >
                      {fieldValues[f.id] === "true" ? "Yes" : "No"}
                    </button>
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : "text"}
                      value={fieldValues[f.id] ?? ""}
                      onChange={(e) => onFieldValue(f.id, e.target.value)}
                      className="mt-1 h-7 w-full rounded-md border border-line bg-raise px-2 font-mono text-[11px] text-fg focus:border-accent/40 focus:outline-none"
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className={cn("mt-4 border-t border-line pt-3", !isAgent && "hidden")}>
          <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-faint">
            Recent from {ticket.company}
          </div>
          <div className="space-y-2">
            {relatedTickets.slice(0, 4).map((r) => (
              <button
                key={r.id}
                onClick={() => onSelectTicket(r.id)}
                className="block w-full text-left text-[11px] text-dim transition-colors hover:text-fg"
              >
                {r.subject} <span className="font-mono text-faint">#{r.code}</span>
              </button>
            ))}
            {relatedTickets.length === 0 && <p className="text-[11px] text-faint">No other tickets.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}

function AccountCard({
  ticket,
  isAgent,
  onUpdate,
}: {
  ticket: Ticket;
  isAgent: boolean;
  onUpdate: (patch: Partial<Ticket>) => void;
}) {
  const { state } = useDesk();
  const linked = Boolean(ticket.customerId);
  const title = linked ? ticket.company : ticket.contactName || ticket.contactEmail || "Unknown requester";
  const subtitle = linked
    ? [ticket.plan, ticket.region].filter((x) => x && x !== "—").join(" · ")
    : ticket.contactEmail;

  return (
    <>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-10 place-items-center rounded-md border font-mono text-[11px]",
            linked ? "border-line bg-raise text-accent" : "border-dashed border-line bg-raise text-faint",
          )}
        >
          {title.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-fg">{title}</div>
          <div className="truncate text-[11px] text-faint">
            {subtitle || (linked ? "No plan on file" : "No account linked")}
          </div>
        </div>
      </div>

      {linked ? (
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
          <div className="bg-panel p-2.5">
            <div className="text-[9px] uppercase tracking-wider text-faint">CSAT</div>
            <div className="mt-1 font-mono text-[14px] text-accent">
              {ticket.accountCsat ? `${ticket.accountCsat}%` : "Not rated"}
            </div>
          </div>
          <div className="bg-panel p-2.5">
            <div className="text-[9px] uppercase tracking-wider text-faint">Lifetime</div>
            <div className="mt-1 font-mono text-[14px] text-fg">{ticket.lifetimeValue}</div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-line bg-raise p-2.5">
          <p className="text-[11px] leading-relaxed text-dim">
            This ticket came in from a person who is not attached to a company yet, so account health and
            lifetime value have nothing to show.
          </p>
          {isAgent && (
            <select
              value=""
              onChange={(e) => e.target.value && onUpdate({ customerId: e.target.value })}
              className="mt-2 h-7 w-full rounded-md border border-line bg-panel px-2 text-[11px] text-fg focus:border-accent/40 focus:outline-none"
            >
              <option value="">Link to a company…</option>
              {state.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </>
  );
}

function NewTicketDialog({
  onCreate,
  onCreated,
  isAgent,
  customers,
  departments,
  me,
}: {
  onCreate: ReturnType<typeof useDesk>["createTicket"];
  onCreated: (id: string) => void;
  isAgent: boolean;
  customers: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  me: { name: string; email: string };
}) {
  const [open, setOpen] = useState(false);
  const empty = {
    subject: "",
    customerId: "",
    departmentId: "",
    contactName: isAgent ? "" : me.name,
    contactEmail: isAgent ? "" : me.email,
    priority: "P3" as Priority,
    body: "",
  };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const field = (key: keyof typeof form, label: string, placeholder = "") => (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <input
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 h-8 w-full rounded-md border border-line bg-raise px-2.5 text-[12px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
      />
    </label>
  );

  const submit = async () => {
    if (!form.subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    setBusy(true);
    try {
      const id = await onCreate({
        subject: form.subject.trim(),
        customerId: form.customerId || null,
        departmentId: form.departmentId || null,
        contactName: form.contactName.trim(),
        contactEmail: form.contactEmail.trim(),
        priority: form.priority,
        body: form.body.trim(),
        assignee: null,
      });
      setOpen(false);
      setForm(empty);
      if (id) onCreated(id);
      toast.success("Ticket created — SLA clock started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the ticket");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="h-6 rounded-md bg-accent px-2 text-[10px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90">
        + New
      </DialogTrigger>
      <DialogContent className="border-line bg-panel">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {isAgent ? "New ticket" : "Raise a support ticket"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {field("subject", "Subject", "Short summary of the issue")}
          {isAgent && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-faint">Account</span>
                <select
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  className="mt-1 h-8 w-full rounded-md border border-line bg-raise px-2 text-[12px] text-fg focus:border-accent/40 focus:outline-none"
                >
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-faint">Department</span>
                <select
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  className="mt-1 h-8 w-full rounded-md border border-line bg-raise px-2 text-[12px] text-fg focus:border-accent/40 focus:outline-none"
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {isAgent && (
            <div className="grid grid-cols-2 gap-3">
              {field("contactName", "Contact")}
              {field("contactEmail", "Email", "name@company.com")}
            </div>
          )}
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-faint">Priority</span>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
              className="mt-1 h-8 w-full rounded-md border border-line bg-raise px-2 text-[12px] text-fg focus:border-accent/40 focus:outline-none"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-faint">First message</span>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="mt-1 min-h-[72px] w-full resize-none rounded-md border border-line bg-raise px-2.5 py-2 text-[12px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
              placeholder={isAgent ? "What did the customer report?" : "Describe what is happening…"}
            />
          </label>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="h-8 w-full rounded-md bg-accent text-[12px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
