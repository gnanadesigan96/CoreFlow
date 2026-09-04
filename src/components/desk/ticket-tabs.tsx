import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Markdown } from "@/components/desk/markdown";
import { askCopilot } from "@/lib/copilot.functions";
import { useDesk } from "@/lib/desk-store";
import type { Ticket } from "@/lib/desk-data";
import { cn } from "@/lib/utils";

export const TICKET_TABS = [
  "Conversation",
  "Resolution",
  "Time",
  "Approvals",
  "Articles",
  "History",
] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

const inputCls =
  "h-8 w-full rounded-md border border-line bg-raise px-2.5 text-[12px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none";
const btnCls =
  "h-8 rounded-md bg-accent px-3 text-[12px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50";
const ghostCls =
  "h-8 rounded-md border border-line px-3 text-[12px] text-dim transition-colors hover:text-fg disabled:opacity-50";

export function transcriptOf(ticket: Ticket) {
  return ticket.messages
    .filter((m) => m.kind !== "note")
    .slice(-12)
    .map((m) => `${m.kind === "customer" ? "Customer" : "Agent"} (${m.author}): ${m.body}`)
    .join("\n\n");
}

export function TicketTabBar({
  tab,
  setTab,
  ticket,
  isAgent,
}: {
  tab: TicketTab;
  setTab: (t: TicketTab) => void;
  ticket: Ticket;
  isAgent: boolean;
}) {
  const { state } = useDesk();
  const counts: Partial<Record<TicketTab, number>> = {
    Conversation: ticket.messages.length,
    Time: state.timeEntries.filter((e) => e.ticketId === ticket.id).length,
    Approvals: state.approvals.filter((a) => a.ticketId === ticket.id).length,
    Articles: (state.ticketArticles[ticket.id] ?? []).length,
  };
  const tabs = isAgent ? TICKET_TABS : (["Conversation", "Resolution", "Articles"] as const);
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-panel/60 px-3">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors",
            tab === t ? "bg-accent/10 font-medium text-accent" : "text-faint hover:text-dim",
          )}
        >
          {t}
          {counts[t] ? (
            <span className="font-mono text-[9px] text-faint">{counts[t]}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Resolution ---------------- */

export function ResolutionPanel({ ticket, isAgent }: { ticket: Ticket; isAgent: boolean }) {
  const { saveResolution, saveArticle } = useDesk();
  const copilot = useServerFn(askCopilot);
  const [body, setBody] = useState(ticket.resolution);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);

  if (!isAgent) {
    return (
      <Panel title="Resolution">
        {ticket.resolution ? (
          <div className="rounded-md border border-line bg-raise p-4">
            <Markdown source={ticket.resolution} />
          </div>
        ) : (
          <Empty text="The support team has not published a resolution yet." />
        )}
      </Panel>
    );
  }

  const promote = async () => {
    setDrafting(true);
    try {
      const res = await copilot({
        data: {
          mode: "article",
          subject: ticket.subject,
          priority: ticket.priority,
          customer: ticket.company,
          transcript: `${transcriptOf(ticket)}\n\nResolution notes: ${body}`,
          knowledge: "",
          instruction: "",
        },
      });
      const text = res.text;
      const grab = (key: string) => {
        const m = new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z]{4,}:|$)`).exec(text);
        return (m?.[1] ?? "").trim();
      };
      const id = await saveArticle({
        title: grab("TITLE") || ticket.subject,
        summary: grab("SUMMARY"),
        tags: grab("TAGS")
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
        body: grab("BODY") || body,
        status: "draft",
      });
      toast.success(id ? "Draft article created in the knowledge base" : "Could not create the article");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copilot failed");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Panel
      title="Resolution"
      hint="What actually fixed it. Publishing a resolution is what turns a closed ticket into reusable knowledge."
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={"## Cause\n\n## Fix\n1. \n\n## Prevention"}
        className="min-h-[220px] w-full resize-none rounded-md border border-line bg-raise px-3 py-2.5 font-mono text-[12px] leading-relaxed text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={busy}
          className={btnCls}
          onClick={async () => {
            setBusy(true);
            try {
              await saveResolution(ticket.id, body);
              toast.success("Resolution saved");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save resolution
        </button>
        <button disabled={drafting || !body.trim()} className={ghostCls} onClick={() => void promote()}>
          {drafting ? "Drafting…" : "Turn into KB article"}
        </button>
        {ticket.resolution && (
          <span className="ml-auto font-mono text-[10px] text-faint">
            {ticket.resolution.length} chars published
          </span>
        )}
      </div>
      {body.trim() && (
        <div className="mt-4 rounded-md border border-line bg-panel p-4">
          <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-faint">Preview</div>
          <Markdown source={body} />
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Time entries ---------------- */

export function TimePanel({ ticket }: { ticket: Ticket }) {
  const { state, addTimeEntry, removeTimeEntry, me } = useDesk();
  const entries = state.timeEntries.filter((e) => e.ticketId === ticket.id);
  const [minutes, setMinutes] = useState("15");
  const [note, setNote] = useState("");
  const [billable, setBillable] = useState(true);

  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const billableTotal = entries.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0);

  return (
    <Panel title="Time entry" hint="Logged effort rolls up per agent and drives billable reporting.">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
        <Cell label="Total" value={`${Math.floor(total / 60)}h ${total % 60}m`} />
        <Cell label="Billable" value={`${Math.floor(billableTotal / 60)}h ${billableTotal % 60}m`} tone="accent" />
        <Cell label="Entries" value={String(entries.length)} />
      </div>

      <div className="mt-4 grid gap-2 rounded-md border border-line bg-raise p-3 sm:grid-cols-[90px_1fr_auto_auto]">
        <input
          value={minutes}
          onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="mins"
          className={inputCls}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you work on?"
          className={inputCls}
        />
        <button
          onClick={() => setBillable((b) => !b)}
          className={cn(
            "h-8 rounded-md border px-3 text-[11px] transition-colors",
            billable ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-faint",
          )}
        >
          {billable ? "Billable" : "Non-billable"}
        </button>
        <button
          className={btnCls}
          onClick={() => {
            const m = Number(minutes);
            if (!m) {
              toast.error("Enter the minutes spent");
              return;
            }
            void addTimeEntry(ticket.id, { minutes: m, billable, note });
            setNote("");
            toast.success(`${m}m logged`);
          }}
        >
          Log
        </button>
      </div>

      <div className="mt-4 space-y-1.5">
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center gap-3 rounded-md border border-line bg-raise px-3 py-2"
          >
            <span className="font-mono text-[12px] text-accent">{e.minutes}m</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-dim">{e.note || "—"}</span>
            {!e.billable && (
              <span className="rounded border border-line px-1 font-mono text-[9px] uppercase text-faint">
                non-billable
              </span>
            )}
            <span className="font-mono text-[10px] text-faint">{e.agentName}</span>
            <span className="font-mono text-[10px] text-faint">
              {new Date(e.at).toLocaleDateString()}
            </span>
            {(e.agentId === me.id || me.role === "admin") && (
              <button
                onClick={() => void removeTimeEntry(e.id)}
                className="text-[11px] text-faint transition-colors hover:text-red"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {entries.length === 0 && <Empty text="No time logged on this ticket yet." />}
      </div>
    </Panel>
  );
}

/* ---------------- Approvals ---------------- */

export function ApprovalsPanel({ ticket }: { ticket: Ticket }) {
  const { state, requestApproval, decideApproval, me } = useDesk();
  const rows = state.approvals.filter((a) => a.ticketId === ticket.id);
  const [form, setForm] = useState({ approverEmail: "", subject: "", reason: "" });

  return (
    <Panel
      title="Approvals"
      hint="Ask an owner to sign off before a refund, credit or production change. Decisions are timestamped on the ticket."
    >
      <div className="grid gap-2 rounded-md border border-line bg-raise p-3">
        <input
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          placeholder="What needs approval? (e.g. 2-month credit)"
          className={inputCls}
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={form.approverEmail}
            onChange={(e) => setForm({ ...form, approverEmail: e.target.value })}
            placeholder="approver@company.com"
            className={inputCls}
          />
          <button
            className={btnCls}
            onClick={() => {
              if (!form.subject.trim() || !form.approverEmail.trim()) {
                toast.error("Subject and approver email are required");
                return;
              }
              void requestApproval(ticket.id, form);
              setForm({ approverEmail: "", subject: "", reason: "" });
              toast.success("Approval requested");
            }}
          >
            Request
          </button>
        </div>
        <textarea
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          placeholder="Context for the approver…"
          className="min-h-[60px] w-full resize-none rounded-md border border-line bg-panel px-2.5 py-2 text-[12px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
        />
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((a) => (
          <div key={a.id} className="rounded-md border border-line bg-raise px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-fg">{a.subject}</span>
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider",
                  a.status === "approved"
                    ? "border-accent/40 text-accent"
                    : a.status === "rejected"
                      ? "border-red/40 text-red"
                      : "border-amber/40 text-amber",
                )}
              >
                {a.status}
              </span>
              <span className="ml-auto font-mono text-[10px] text-faint">{a.approverEmail}</span>
            </div>
            {a.reason && <p className="mt-1 text-[12px] text-dim">{a.reason}</p>}
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-[10px] text-faint">
                asked by {a.requestedByName} · {new Date(a.at).toLocaleString()}
              </span>
              {a.status === "pending" && (
                <div className="ml-auto flex gap-1.5">
                  <button
                    className="h-7 rounded-md border border-accent/40 bg-accent/10 px-2.5 text-[11px] text-accent"
                    onClick={() => {
                      void decideApproval(a.id, "approved");
                      toast.success("Approved");
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="h-7 rounded-md border border-line px-2.5 text-[11px] text-faint transition-colors hover:border-red/40 hover:text-red"
                    onClick={() => {
                      void decideApproval(a.id, "rejected");
                      toast("Rejected");
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
              {a.status !== "pending" && a.decidedAt && (
                <span className="ml-auto font-mono text-[10px] text-faint">
                  decided {new Date(a.decidedAt).toLocaleString()}
                </span>
              )}
            </div>
            {a.approverEmail === me.email && a.status === "pending" && (
              <p className="mt-1 text-[10px] text-accent">You are the approver on this request.</p>
            )}
          </div>
        ))}
        {rows.length === 0 && <Empty text="No approvals requested." />}
      </div>
    </Panel>
  );
}

/* ---------------- Linked / suggested articles ---------------- */

export function ArticlesPanel({
  ticket,
  isAgent,
  onInsert,
}: {
  ticket: Ticket;
  isAgent: boolean;
  onInsert: (text: string) => void;
}) {
  const { state, linkArticle, unlinkArticle } = useDesk();
  const linkedIds = state.ticketArticles[ticket.id] ?? [];
  const linked = state.articles.filter((a) => linkedIds.includes(a.id));

  const suggestions = useMemo(() => {
    const haystack = `${ticket.subject} ${ticket.tags.join(" ")} ${ticket.messages
      .map((m) => m.body)
      .join(" ")}`.toLowerCase();
    const words = new Set(haystack.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    return state.articles
      .filter((a) => a.status === "published" && !linkedIds.includes(a.id))
      .map((a) => {
        const terms = `${a.title} ${a.summary} ${a.tags.join(" ")}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 3);
        const score = terms.reduce((acc, w) => acc + (words.has(w) ? 1 : 0), 0);
        return { article: a, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [state.articles, ticket, linkedIds]);

  return (
    <Panel
      title="Knowledge"
      hint="Attach the article that solves this ticket, or drop its link straight into your reply."
    >
      <div className="space-y-2">
        {linked.map((a) => (
          <div key={a.id} className="rounded-md border border-accent/30 bg-accent/[0.05] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Link
                to="/kb"
                search={{ a: a.id }}
                className="text-[12px] font-medium text-fg transition-colors hover:text-accent"
              >
                {a.title}
              </Link>
              <span className="ml-auto font-mono text-[10px] text-faint">{a.views} views</span>
            </div>
            <p className="mt-1 text-[11px] text-dim">{a.summary}</p>
            <div className="mt-2 flex gap-1.5">
              <button
                className={ghostCls}
                onClick={() => {
                  onInsert(`Here is the article that covers this: ${a.title}\n\n${a.summary}`);
                  toast.success("Added to your reply");
                }}
              >
                Insert into reply
              </button>
              {isAgent && (
                <button
                  className="h-8 rounded-md border border-line px-3 text-[12px] text-faint transition-colors hover:border-red/40 hover:text-red"
                  onClick={() => void unlinkArticle(ticket.id, a.id)}
                >
                  Detach
                </button>
              )}
            </div>
          </div>
        ))}
        {linked.length === 0 && <Empty text="No article attached yet." />}
      </div>

      {isAgent && (
        <>
          <div className="mt-5 text-[9px] uppercase tracking-[0.2em] text-faint">Suggested</div>
          <div className="mt-2 space-y-2">
            {suggestions.map(({ article, score }) => (
              <div
                key={article.id}
                className="flex items-center gap-3 rounded-md border border-line bg-raise px-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    to="/kb"
                    search={{ a: article.id }}
                    className="block truncate text-[12px] text-fg transition-colors hover:text-accent"
                  >
                    {article.title}
                  </Link>
                  <span className="font-mono text-[10px] text-faint">match score {score}</span>
                </div>
                <button
                  className={cn(ghostCls, "ml-auto")}
                  onClick={() => {
                    void linkArticle(ticket.id, article.id);
                    toast.success("Article attached");
                  }}
                >
                  Attach
                </button>
              </div>
            ))}
            {suggestions.length === 0 && <Empty text="No close matches in the knowledge base." />}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------------- History ---------------- */

export function HistoryPanel({ ticket }: { ticket: Ticket }) {
  const { state } = useDesk();
  const assignee = state.agents.find((a) => a.id === ticket.assignee);
  const events: { at: string; label: string; detail: string }[] = [
    { at: ticket.createdAt, label: "Ticket created", detail: `${ticket.channel} · ${ticket.contactEmail}` },
    ...ticket.messages.map((m) => ({
      at: m.at,
      label:
        m.kind === "customer" ? "Customer message" : m.kind === "note" ? "Internal note" : "Agent reply",
      detail: m.body.slice(0, 90),
    })),
    ...(ticket.firstRespondedAt
      ? [{ at: ticket.firstRespondedAt, label: "First response sent", detail: "SLA clock met" }]
      : []),
    ...state.timeEntries
      .filter((e) => e.ticketId === ticket.id)
      .map((e) => ({ at: e.at, label: `${e.minutes}m logged`, detail: e.agentName })),
    ...state.approvals
      .filter((a) => a.ticketId === ticket.id)
      .map((a) => ({ at: a.at, label: `Approval ${a.status}`, detail: a.subject })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Panel title="History" hint={`Assigned to ${assignee?.name ?? "nobody"}.`}>
      <ol className="relative ml-2 border-l border-line pl-4">
        {events.map((e, i) => (
          <li key={i} className="relative pb-4 last:pb-0">
            <span className="absolute -left-[21px] top-1.5 size-1.5 rounded-full bg-accent" />
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] text-fg">{e.label}</span>
              <span className="font-mono text-[10px] text-faint">
                {new Date(e.at).toLocaleString()}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-dim">{e.detail}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/* ---------------- Copilot card (right rail) ---------------- */

export function CopilotCard({
  ticket,
  onDraft,
}: {
  ticket: Ticket;
  onDraft: (text: string) => void;
}) {
  const { state, saveInsight } = useDesk();
  const copilot = useServerFn(askCopilot);
  const [busy, setBusy] = useState<"insight" | "reply" | null>(null);
  const [insight, setInsight] = useState<{ risk: string; next: string[] } | null>(null);

  const knowledge = state.articles
    .filter((a) => a.status === "published")
    .slice(0, 4)
    .map((a) => `${a.title}: ${a.summary}`)
    .join("\n");

  const run = async (mode: "insight" | "reply") => {
    setBusy(mode);
    try {
      const res = await copilot({
        data: {
          mode,
          subject: ticket.subject,
          priority: ticket.priority,
          customer: `${ticket.company} (${ticket.plan})`,
          transcript: transcriptOf(ticket),
          knowledge,
          instruction: "",
        },
      });
      if (mode === "reply") {
        onDraft(res.text);
        toast.success("Draft reply added to the composer");
        return;
      }
      const grab = (key: string) => {
        const m = new RegExp(`${key}:\\s*(.*)`).exec(res.text);
        return (m?.[1] ?? "").trim();
      };
      const summary = grab("SUMMARY");
      const sentiment = grab("SENTIMENT").toLowerCase();
      setInsight({
        risk: grab("RISK"),
        next: grab("NEXT")
          .split("|")
          .map((s) => s.replace(/^\d+[.)]?\s*/, "").trim())
          .filter(Boolean),
      });
      await saveInsight(ticket.id, summary, sentiment);
      toast.success("Copilot updated the ticket brief");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copilot failed");
    } finally {
      setBusy(null);
    }
  };

  const sentimentTone =
    ticket.aiSentiment === "angry" || ticket.aiSentiment === "frustrated"
      ? "text-red"
      : ticket.aiSentiment === "calm"
        ? "text-accent"
        : "text-dim";

  return (
    <div className="rounded-md border border-accent/25 bg-accent/[0.04] p-3">
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-accent">Copilot</span>
        {ticket.aiSentiment && (
          <span className={cn("ml-auto font-mono text-[10px] capitalize", sentimentTone)}>
            {ticket.aiSentiment}
          </span>
        )}
      </div>
      {ticket.aiSummary ? (
        <p className="mt-2 text-[11px] leading-snug text-dim">{ticket.aiSummary}</p>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-faint">
          Summarise the thread, read customer sentiment and get the next three actions.
        </p>
      )}
      {insight?.risk && <p className="mt-2 text-[11px] text-amber">{insight.risk}</p>}
      {insight && insight.next.length > 0 && (
        <ol className="mt-2 space-y-1">
          {insight.next.map((n, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-dim">
              <span className="font-mono text-faint">{i + 1}</span>
              {n}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex gap-1.5">
        <button
          disabled={busy !== null}
          onClick={() => void run("insight")}
          className="h-7 flex-1 rounded-md border border-accent/40 bg-accent/10 text-[11px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {busy === "insight" ? "Reading…" : "Brief me"}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => void run("reply")}
          className="h-7 flex-1 rounded-md border border-line text-[11px] text-dim transition-colors hover:text-fg disabled:opacity-50"
        >
          {busy === "reply" ? "Writing…" : "Draft reply"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- primitives ---------------- */

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div className="max-w-[80ch]">
        <h3 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h3>
        {hint && <p className="mt-1 mb-3 text-[11px] leading-snug text-faint">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-line px-3 py-4 text-[11px] text-faint">{text}</p>;
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <div className="bg-panel p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-faint">{label}</div>
      <div className={cn("mt-1 font-mono text-[14px]", tone === "accent" ? "text-accent" : "text-fg")}>
        {value}
      </div>
    </div>
  );
}
