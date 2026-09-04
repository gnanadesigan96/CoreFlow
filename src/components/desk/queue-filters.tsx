import { X } from "lucide-react";
import { CHANNEL_ORDER, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, type Ticket } from "@/lib/desk-data";
import { isOpenStatus, isOverdue, slaRemaining } from "@/lib/desk-store";
import { PROPERTY_GROUPS } from "@/lib/ticket-properties";
import { cn } from "@/lib/utils";

export type SortKey = "sla" | "newest" | "oldest" | "priority" | "updated";

export type QueueFilters = {
  status: string[];
  priority: string[];
  channel: string[];
  department: string[];
  assignee: string[];
  tags: string[];
  customer: string[];
  requestType: string[];
  urgency: string[];
  sla: "any" | "overdue" | "due_soon" | "breached_response";
  created: "any" | "24h" | "7d" | "30d";
  sort: SortKey;
};

export const EMPTY_FILTERS: QueueFilters = {
  status: [],
  priority: [],
  channel: [],
  department: [],
  assignee: [],
  tags: [],
  customer: [],
  requestType: [],
  urgency: [],
  sla: "any",
  created: "any",
  sort: "sla",
};

export function activeFilterCount(f: QueueFilters) {
  return (
    f.status.length +
    f.priority.length +
    f.channel.length +
    f.department.length +
    f.assignee.length +
    f.tags.length +
    f.customer.length +
    f.requestType.length +
    f.urgency.length +
    (f.sla === "any" ? 0 : 1) +
    (f.created === "any" ? 0 : 1)
  );
}

const WINDOW_MS: Record<QueueFilters["created"], number> = {
  any: 0,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export function applyFilters(
  tickets: Ticket[],
  f: QueueFilters,
  ctx: { now: number; props: Record<string, Record<string, string>> },
) {
  const has = (list: string[], value: string | null) => list.length === 0 || (value !== null && list.includes(value));
  return tickets
    .filter((t) => {
      const p = ctx.props[t.id] ?? {};
      if (!has(f.status, t.status)) return false;
      if (!has(f.priority, t.priority)) return false;
      if (!has(f.channel, t.channel)) return false;
      if (!has(f.department, t.departmentId)) return false;
      if (f.assignee.length && !f.assignee.includes(t.assignee ?? "none")) return false;
      if (!has(f.customer, t.customerId)) return false;
      if (!has(f.requestType, p["request_type"] ?? null)) return false;
      if (!has(f.urgency, p["urgency"] ?? null)) return false;
      if (f.tags.length && !f.tags.some((tag) => t.tags.includes(tag))) return false;
      if (f.sla === "overdue" && !isOverdue(t, ctx.now)) return false;
      if (f.sla === "due_soon") {
        const left = slaRemaining(t, ctx.now);
        if (!(left > 0 && left < 2 * 3_600_000)) return false;
      }
      if (f.sla === "breached_response" && (t.firstRespondedAt || new Date(t.firstResponseDueAt).getTime() > ctx.now))
        return false;
      if (f.created !== "any" && ctx.now - new Date(t.createdAt).getTime() > WINDOW_MS[f.created]) return false;
      return true;
    })
    .sort((a, b) => {
      if (f.sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (f.sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (f.sort === "priority") return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (f.sort === "updated") {
        const last = (t: Ticket) => new Date(t.messages.at(-1)?.at ?? t.createdAt).getTime();
        return last(b) - last(a);
      }
      const openDiff = Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status));
      if (openDiff !== 0) return openDiff;
      return slaRemaining(a, ctx.now) - slaRemaining(b, ctx.now);
    });
}

const REQUEST_TYPES = PROPERTY_GROUPS[0]?.fields.find((x) => x.key === "request_type")?.options ?? [];
const URGENCIES = PROPERTY_GROUPS[0]?.fields.find((x) => x.key === "urgency")?.options ?? [];

export function FilterPanel({
  filters,
  setFilters,
  agents,
  departments,
  customers,
  tags,
  isAgent,
}: {
  filters: QueueFilters;
  setFilters: (f: QueueFilters) => void;
  agents: { id: string; handle: string }[];
  departments: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  tags: string[];
  isAgent: boolean;
}) {
  const toggle = (key: keyof QueueFilters, value: string) => {
    const list = filters[key] as string[];
    setFilters({
      ...filters,
      [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    });
  };

  return (
    <div className="space-y-3 border-b border-line bg-panel/60 px-3 py-3">
      <Group label="Status">
        {STATUS_ORDER.map((s) => (
          <Chip key={s} on={filters.status.includes(s)} onClick={() => toggle("status", s)}>
            {STATUS_LABEL[s]}
          </Chip>
        ))}
      </Group>

      <Group label="Priority">
        {PRIORITY_ORDER.map((p) => (
          <Chip key={p} on={filters.priority.includes(p)} onClick={() => toggle("priority", p)}>
            {p}
          </Chip>
        ))}
      </Group>

      <Group label="Channel">
        {CHANNEL_ORDER.map((c) => (
          <Chip key={c} on={filters.channel.includes(c)} onClick={() => toggle("channel", c)}>
            {c}
          </Chip>
        ))}
      </Group>

      <Group label="SLA">
        {(
          [
            ["any", "Any"],
            ["overdue", "Overdue"],
            ["due_soon", "Due < 2h"],
            ["breached_response", "Response breached"],
          ] as [QueueFilters["sla"], string][]
        ).map(([v, l]) => (
          <Chip key={v} on={filters.sla === v} onClick={() => setFilters({ ...filters, sla: v })}>
            {l}
          </Chip>
        ))}
      </Group>

      <Group label="Created">
        {(
          [
            ["any", "Any time"],
            ["24h", "24 hours"],
            ["7d", "7 days"],
            ["30d", "30 days"],
          ] as [QueueFilters["created"], string][]
        ).map(([v, l]) => (
          <Chip key={v} on={filters.created === v} onClick={() => setFilters({ ...filters, created: v })}>
            {l}
          </Chip>
        ))}
      </Group>

      <Group label="Request type">
        {REQUEST_TYPES.map((r) => (
          <Chip key={r} on={filters.requestType.includes(r)} onClick={() => toggle("requestType", r)}>
            {r}
          </Chip>
        ))}
      </Group>

      <Group label="Urgency">
        {URGENCIES.map((u) => (
          <Chip key={u} on={filters.urgency.includes(u)} onClick={() => toggle("urgency", u)}>
            {u}
          </Chip>
        ))}
      </Group>

      {isAgent && (
        <Group label="Assignee">
          <Chip on={filters.assignee.includes("none")} onClick={() => toggle("assignee", "none")}>
            Unassigned
          </Chip>
          {agents.map((a) => (
            <Chip key={a.id} on={filters.assignee.includes(a.id)} onClick={() => toggle("assignee", a.id)}>
              {a.handle}
            </Chip>
          ))}
        </Group>
      )}

      {isAgent && departments.length > 0 && (
        <Group label="Department">
          {departments.map((d) => (
            <Chip key={d.id} on={filters.department.includes(d.id)} onClick={() => toggle("department", d.id)}>
              {d.name}
            </Chip>
          ))}
        </Group>
      )}

      {isAgent && customers.length > 0 && (
        <Group label="Customer">
          {customers.map((c) => (
            <Chip key={c.id} on={filters.customer.includes(c.id)} onClick={() => toggle("customer", c.id)}>
              {c.name}
            </Chip>
          ))}
        </Group>
      )}

      {tags.length > 0 && (
        <Group label="Tags">
          {tags.map((t) => (
            <Chip key={t} on={filters.tags.includes(t)} onClick={() => toggle("tags", t)}>
              {t}
            </Chip>
          ))}
        </Group>
      )}

      <Group label="Sort by">
        {(
          [
            ["sla", "SLA urgency"],
            ["newest", "Newest"],
            ["oldest", "Oldest"],
            ["priority", "Priority"],
            ["updated", "Last activity"],
          ] as [SortKey, string][]
        ).map(([v, l]) => (
          <Chip key={v} on={filters.sort === v} onClick={() => setFilters({ ...filters, sort: v })}>
            {l}
          </Chip>
        ))}
      </Group>

      <button
        onClick={() => setFilters(EMPTY_FILTERS)}
        className="flex items-center gap-1 text-[11px] text-dim transition-colors hover:text-fg"
      >
        <X className="size-3" /> Clear all filters
      </button>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[9px] uppercase tracking-[0.2em] text-faint">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] capitalize transition-colors",
        on ? "border-accent/40 bg-accent/10 font-medium text-accent" : "border-line text-dim hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
