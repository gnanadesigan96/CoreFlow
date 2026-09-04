import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  formatMoney,
  initialsOf,
  type Agent,
  type Customer,
  type CustomerShare,
  type Message,
  type Priority,
  type Role,
  type Status,
  type Ticket,
} from "./desk-data";

export type CustomField = {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox";
  options: string[];
  required: boolean;
  section: "ticket" | "contact";
};

export type SlaRule = { priority: Priority; firstResponse: number; resolution: number };
export type Macro = { id: string; label: string; body: string; setStatus: Status | null };
export type Department = { id: string; name: string; slug: string; description: string };

export type TimeEntry = {
  id: string;
  ticketId: string;
  agentId: string | null;
  agentName: string;
  minutes: number;
  billable: boolean;
  note: string;
  at: string;
};

export type Approval = {
  id: string;
  ticketId: string;
  requestedByName: string;
  approverEmail: string;
  subject: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  at: string;
  decidedAt: string | null;
};

export type KbCategory = { id: string; name: string; slug: string; description: string };

export type KbArticle = {
  id: string;
  title: string;
  slug: string;
  categoryId: string | null;
  summary: string;
  body: string;
  tags: string[];
  status: "draft" | "published";
  authorName: string;
  views: number;
  helpful: number;
  notHelpful: number;
  updatedAt: string;
};

export type Me = {
  id: string;
  email: string;
  name: string;
  handle: string;
  role: Role;
};

export type DeskState = {
  tickets: Ticket[];
  agents: Agent[];
  macros: Macro[];
  sla: SlaRule[];
  fields: CustomField[];
  fieldValues: Record<string, Record<string, string>>;
  /** raw tickets.field_values map per ticket (built-in ticket properties) */
  props: Record<string, Record<string, string>>;
  departments: Department[];
  /** department ids each agent is enabled for */
  agentDepartments: Record<string, string[]>;
  customers: Customer[];
  shares: CustomerShare[];
  guests: Me[];
  timeEntries: TimeEntry[];
  approvals: Approval[];
  articles: KbArticle[];
  kbCategories: KbCategory[];
  /** article ids linked to each ticket */
  ticketArticles: Record<string, string[]>;
};

const EMPTY_STATE: DeskState = {
  tickets: [],
  agents: [],
  macros: [],
  sla: [],
  fields: [],
  fieldValues: {},
  props: {},
  departments: [],
  agentDepartments: {},
  customers: [],
  shares: [],
  guests: [],
  timeEntries: [],
  approvals: [],
  articles: [],
  kbCategories: [],
  ticketArticles: {},
};

type DeskContextValue = {
  state: DeskState;
  me: Me;
  isAgent: boolean;
  isAdmin: boolean;
  isSuperadmin: boolean;
  loading: boolean;
  now: number;
  refresh: () => Promise<void>;
  updateTicket: (id: string, patch: Partial<Ticket>) => Promise<void>;
  addMessage: (id: string, kind: "agent" | "note", body: string) => Promise<void>;
  createTicket: (input: {
    subject: string;
    customerId: string | null;
    departmentId: string | null;
    contactName: string;
    contactEmail: string;
    priority: Priority;
    body: string;
    assignee: string | null;
  }) => Promise<string | null>;
  toggleTag: (id: string, tag: string) => Promise<void>;
  setFieldValue: (ticketId: string, fieldId: string, value: string) => Promise<void>;
  setProperty: (ticketId: string, key: string, value: string) => Promise<void>;
  saveSla: (rules: SlaRule[]) => Promise<void>;
  addField: (field: Omit<CustomField, "id">) => Promise<void>;
  removeField: (fieldId: string) => Promise<void>;
  setUserRole: (userId: string, role: Role) => Promise<void>;
  addMacro: (macro: Omit<Macro, "id">) => Promise<void>;
  removeMacro: (macroId: string) => Promise<void>;
  addDepartment: (dept: Omit<Department, "id" | "slug">) => Promise<void>;
  removeDepartment: (deptId: string) => Promise<void>;
  toggleAgentDepartment: (agentId: string, deptId: string) => Promise<void>;
  shareCustomer: (customerId: string, guestEmail: string) => Promise<void>;
  unshareCustomer: (shareId: string) => Promise<void>;
  saveResolution: (ticketId: string, body: string) => Promise<void>;
  addTimeEntry: (
    ticketId: string,
    entry: { minutes: number; billable: boolean; note: string },
  ) => Promise<void>;
  removeTimeEntry: (entryId: string) => Promise<void>;
  requestApproval: (
    ticketId: string,
    input: { approverEmail: string; subject: string; reason: string },
  ) => Promise<void>;
  decideApproval: (approvalId: string, status: "approved" | "rejected") => Promise<void>;
  saveArticle: (article: Partial<KbArticle> & { title: string }) => Promise<string | null>;
  deleteArticle: (articleId: string) => Promise<void>;
  voteArticle: (articleId: string, helpful: boolean) => Promise<void>;
  registerArticleView: (articleId: string) => Promise<void>;
  linkArticle: (ticketId: string, articleId: string) => Promise<void>;
  unlinkArticle: (ticketId: string, articleId: string) => Promise<void>;
  saveInsight: (ticketId: string, summary: string, sentiment: string) => Promise<void>;
};

const DeskContext = createContext<DeskContextValue | null>(null);

const MSG_KIND: Record<string, Message["kind"]> = {
  inbound: "customer",
  reply: "agent",
  note: "note",
};

function fieldTypeOf(dbType: string): CustomField["type"] {
  if (dbType === "number" || dbType === "select" || dbType === "checkbox") return dbType;
  return "text";
}

export function DeskProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [state, setState] = useState<DeskState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const isAgent = me.role === "agent" || me.role === "admin" || me.role === "superadmin";
  const isAdmin = me.role === "admin" || me.role === "superadmin";
  const isSuperadmin = me.role === "superadmin";

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [
        ticketsRes,
        messagesRes,
        customersRes,
        departmentsRes,
        agentDeptRes,
        slaRes,
        fieldsRes,
        macrosRes,
        profilesRes,
        rolesRes,
        sharesRes,
        timeRes,
        approvalsRes,
        articlesRes,
        kbCategoriesRes,
        ticketArticlesRes,
      ] = await Promise.all([
        supabase.from("tickets").select("*").order("created_at", { ascending: false }),
        supabase.from("ticket_messages").select("*").order("created_at", { ascending: true }),
        supabase.from("customers").select("*").order("name"),
        supabase.from("departments").select("*").order("name"),
        supabase.from("agent_departments").select("*"),
        supabase.from("sla_policies").select("*"),
        supabase.from("custom_fields").select("*").order("position"),
        supabase.from("macros").select("*").order("created_at"),
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("user_roles").select("*"),
        supabase.from("customer_shares").select("*"),
        supabase.from("ticket_time_entries").select("*").order("created_at", { ascending: false }),
        supabase.from("ticket_approvals").select("*").order("created_at", { ascending: false }),
        supabase.from("kb_articles").select("*").order("updated_at", { ascending: false }),
        supabase.from("kb_categories").select("*").order("position"),
        supabase.from("ticket_articles").select("*"),
      ]);

      const sla: SlaRule[] = (slaRes.data ?? [])
        .map((r) => ({
          priority: r.priority as Priority,
          firstResponse: r.first_response_minutes,
          resolution: r.resolution_minutes,
        }))
        .sort((a, b) => a.priority.localeCompare(b.priority));

      const fields: CustomField[] = (fieldsRes.data ?? []).map((f) => ({
        id: f.id,
        label: f.label,
        type: fieldTypeOf(f.field_type),
        options: f.options ?? [],
        required: f.required,
        section: "ticket",
      }));

      const customers: Customer[] = (customersRes.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        tier: c.tier,
        region: c.region,
        csat: c.csat,
        lifetimeValue: c.lifetime_value,
      }));
      const customerById = new Map(customers.map((c) => [c.id, c]));

      const roleByUser = new Map<string, Role>();
      for (const r of rolesRes.data ?? []) roleByUser.set(r.user_id, r.role as Role);

      const agents: Agent[] = [];
      const guests: Me[] = [];
      for (const p of profilesRes.data ?? []) {
        const role = roleByUser.get(p.id) ?? "guest";
        if (role === "guest") {
          guests.push({ id: p.id, email: p.email, name: p.full_name || p.email, handle: p.handle, role });
        } else {
          agents.push({
            id: p.id,
            handle: p.handle || p.email,
            name: p.full_name || p.email,
            team: role === "superadmin" ? "Superadmin" : role === "admin" ? "Desk admin" : "Agent",
            initials: initialsOf(p.full_name || p.email),
            role,
          });
        }
      }

      const messagesByTicket = new Map<string, Message[]>();
      for (const m of messagesRes.data ?? []) {
        const list = messagesByTicket.get(m.ticket_id) ?? [];
        list.push({
          id: m.id,
          kind: MSG_KIND[m.kind] ?? "agent",
          author: m.author_name,
          body: m.body,
          at: m.created_at,
        });
        messagesByTicket.set(m.ticket_id, list);
      }

      const slaFor = (p: Priority) => sla.find((r) => r.priority === p) ?? { firstResponse: 60, resolution: 480 };
      const fieldValues: Record<string, Record<string, string>> = {};
      const props: Record<string, Record<string, string>> = {};

      const tickets: Ticket[] = (ticketsRes.data ?? []).map((t) => {
        const customer = t.customer_id ? customerById.get(t.customer_id) : undefined;
        const rule = slaFor(t.priority as Priority);
        const created = new Date(t.created_at).getTime();
        const raw = (t.field_values ?? {}) as Record<string, string>;
        const perTicket: Record<string, string> = {};
        for (const f of fields) if (raw[f.label] !== undefined) perTicket[f.id] = String(raw[f.label]);
        fieldValues[t.id] = perTicket;
        props[t.id] = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]));
        return {
          id: t.id,
          code: t.code,
          subject: t.subject,
          company: customer?.name ?? "—",
          plan: customer?.tier ?? "—",
          region: customer?.region ?? "—",
          contactName: t.requester_name,
          contactEmail: t.requester_email,
          contactRole: t.requester_title,
          channel: t.channel as Ticket["channel"],
          status: t.status as Status,
          priority: t.priority as Priority,
          assignee: t.assignee_id,
          departmentId: t.department_id,
          customerId: t.customer_id,
          tags: t.tags ?? [],
          createdAt: t.created_at,
          firstResponseDueAt: new Date(created + rule.firstResponse * 60_000).toISOString(),
          resolutionDueAt: new Date(created + rule.resolution * 60_000).toISOString(),
          firstRespondedAt: t.first_response_at,
          csat: null,
          lifetimeValue: customer ? formatMoney(customer.lifetimeValue) : "—",
          accountCsat: customer?.csat ?? 0,
          resolution: t.resolution ?? "",
          aiSummary: t.ai_summary ?? "",
          aiSentiment: t.ai_sentiment ?? "",
          messages: messagesByTicket.get(t.id) ?? [],
        };
      });

      const agentDepartments: Record<string, string[]> = {};
      for (const row of agentDeptRes.data ?? []) {
        if (!row.enabled) continue;
        const list = agentDepartments[row.agent_id] ?? [];
        list.push(row.department_id);
        agentDepartments[row.agent_id] = list;
      }

      setState({
        tickets,
        agents,
        guests,
        macros: (macrosRes.data ?? []).map((m) => ({
          id: m.id,
          label: m.name,
          body: m.body,
          setStatus: (m.set_status as Status | null) ?? null,
        })),
        sla,
        fields,
        fieldValues,
        props,
        departments: (departmentsRes.data ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
          description: d.description,
        })),
        agentDepartments,
        customers,
        shares: (sharesRes.data ?? []).map((s) => ({
          id: s.id,
          customerId: s.customer_id,
          guestEmail: s.guest_email,
        })),
        timeEntries: (timeRes.data ?? []).map((e) => ({
          id: e.id,
          ticketId: e.ticket_id,
          agentId: e.agent_id,
          agentName: e.agent_name,
          minutes: e.minutes,
          billable: e.billable,
          note: e.note,
          at: e.created_at,
        })),
        approvals: (approvalsRes.data ?? []).map((a) => ({
          id: a.id,
          ticketId: a.ticket_id,
          requestedByName: a.requested_by_name,
          approverEmail: a.approver_email,
          subject: a.subject,
          reason: a.reason,
          status: (a.status as Approval["status"]) ?? "pending",
          at: a.created_at,
          decidedAt: a.decided_at,
        })),
        articles: (articlesRes.data ?? []).map((a) => ({
          id: a.id,
          title: a.title,
          slug: a.slug,
          categoryId: a.category_id,
          summary: a.summary,
          body: a.body,
          tags: a.tags ?? [],
          status: (a.status as KbArticle["status"]) ?? "draft",
          authorName: a.author_name,
          views: a.views,
          helpful: a.helpful,
          notHelpful: a.not_helpful,
          updatedAt: a.updated_at,
        })),
        kbCategories: (kbCategoriesRes.data ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
        })),
        ticketArticles: (ticketArticlesRes.data ?? []).reduce<Record<string, string[]>>((acc, row) => {
          acc[row.ticket_id] = [...(acc[row.ticket_id] ?? []), row.article_id];
          return acc;
        }, {}),
      });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The very first fetch can race a freshly minted session (right after sign-up),
  // so re-check shortly after mount and whenever the auth token changes.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 1200);
    const { data } = supabase.auth.onAuthStateChange(() => void refresh());
    return () => {
      clearTimeout(t);
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const updateTicket = useCallback(
    async (id: string, patch: Partial<Ticket>) => {
      const row: Record<string, unknown> = {};
      if (patch.status !== undefined) row["status"] = patch.status;
      if (patch.priority !== undefined) row["priority"] = patch.priority;
      if (patch.assignee !== undefined) row["assignee_id"] = patch.assignee;
      if (patch.departmentId !== undefined) row["department_id"] = patch.departmentId;
      if (patch.customerId !== undefined) row["customer_id"] = patch.customerId;
      if (patch.subject !== undefined) row["subject"] = patch.subject;
      if (patch.tags !== undefined) row["tags"] = patch.tags;
      if (Object.keys(row).length === 0) return;
      await supabase.from("tickets").update(row as never).eq("id", id);
      await refresh();
    },
    [refresh],
  );

  const addMessage = useCallback(
    async (id: string, kind: "agent" | "note", body: string) => {
      await supabase.from("ticket_messages").insert({
        ticket_id: id,
        author_id: me.id,
        author_name: me.handle || me.email,
        kind: kind === "note" ? "note" : isAgent ? "reply" : "inbound",
        body,
      });
      if (isAgent && kind === "agent") {
        const ticket = state.tickets.find((t) => t.id === id);
        if (ticket && !ticket.firstRespondedAt) {
          await supabase.from("tickets").update({ first_response_at: new Date().toISOString() }).eq("id", id);
        }
      }
      await refresh();
    },
    [isAgent, me.email, me.handle, me.id, refresh, state.tickets],
  );

  const createTicket = useCallback<DeskContextValue["createTicket"]>(
    async (input) => {
      const { data, error } = await supabase
        .from("tickets")
        .insert({
          subject: input.subject,
          priority: input.priority,
          customer_id: input.customerId,
          department_id: input.departmentId,
          requester_name: input.contactName || me.name,
          requester_email: (input.contactEmail || me.email).toLowerCase(),
          requester_title: isAgent ? "Contact" : "Requester",
          assignee_id: input.assignee,
          channel: "portal",
        })
        .select("id")
        .single();
      if (error || !data) return null;
      if (input.body.trim()) {
        await supabase.from("ticket_messages").insert({
          ticket_id: data.id,
          author_id: me.id,
          author_name: input.contactName || me.name,
          kind: "inbound",
          body: input.body,
        });
      }
      await refresh();
      return data.id;
    },
    [isAgent, me.email, me.id, me.name, refresh],
  );

  const toggleTag = useCallback(
    async (id: string, tag: string) => {
      const ticket = state.tickets.find((t) => t.id === id);
      if (!ticket) return;
      const tags = ticket.tags.includes(tag) ? ticket.tags.filter((x) => x !== tag) : [...ticket.tags, tag];
      await supabase.from("tickets").update({ tags }).eq("id", id);
      await refresh();
    },
    [refresh, state.tickets],
  );

  const setFieldValue = useCallback(
    async (ticketId: string, fieldId: string, value: string) => {
      const field = state.fields.find((f) => f.id === fieldId);
      const ticket = state.tickets.find((t) => t.id === ticketId);
      if (!field || !ticket) return;
      const current = state.fieldValues[ticketId] ?? {};
      const labels = new Set(state.fields.map((f) => f.label));
      const next: Record<string, string> = Object.fromEntries(
        Object.entries(state.props[ticketId] ?? {}).filter(([k]) => !labels.has(k)),
      );
      for (const f of state.fields) {
        const v = f.id === fieldId ? value : current[f.id];
        if (v !== undefined && v !== "") next[f.label] = v;
      }
      await supabase.from("tickets").update({ field_values: next }).eq("id", ticketId);
      await refresh();
    },
    [refresh, state.fieldValues, state.props, state.fields, state.tickets],
  );

  const setProperty = useCallback(
    async (ticketId: string, key: string, value: string) => {
      const current = { ...(state.props[ticketId] ?? {}) };
      if (value === "") delete current[key];
      else current[key] = value;
      await supabase.from("tickets").update({ field_values: current }).eq("id", ticketId);
      await refresh();
    },
    [refresh, state.props],
  );

  const saveSla = useCallback(
    async (rules: SlaRule[]) => {
      await Promise.all(
        rules.map((r) =>
          supabase
            .from("sla_policies")
            .update({ first_response_minutes: r.firstResponse, resolution_minutes: r.resolution })
            .eq("priority", r.priority),
        ),
      );
      await refresh();
    },
    [refresh],
  );

  const addField = useCallback(
    async (field: Omit<CustomField, "id">) => {
      await supabase.from("custom_fields").insert({
        label: field.label,
        field_type: field.type,
        required: field.required,
        options: field.options,
        position: state.fields.length + 1,
      });
      await refresh();
    },
    [refresh, state.fields.length],
  );

  const removeField = useCallback(
    async (fieldId: string) => {
      await supabase.from("custom_fields").delete().eq("id", fieldId);
      await refresh();
    },
    [refresh],
  );

  const setUserRole = useCallback(
    async (userId: string, role: Role) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      await supabase.from("user_roles").insert({ user_id: userId, role });
      if (role !== "guest") {
        const rows = state.departments.map((d) => ({ agent_id: userId, department_id: d.id, enabled: true }));
        if (rows.length) await supabase.from("agent_departments").upsert(rows, { onConflict: "agent_id,department_id" });
      }
      await refresh();
    },
    [refresh, state.departments],
  );

  const addMacro = useCallback(
    async (macro: Omit<Macro, "id">) => {
      await supabase
        .from("macros")
        .insert({ name: macro.label, body: macro.body, set_status: macro.setStatus });
      await refresh();
    },
    [refresh],
  );

  const removeMacro = useCallback(
    async (macroId: string) => {
      await supabase.from("macros").delete().eq("id", macroId);
      await refresh();
    },
    [refresh],
  );

  const addDepartment = useCallback(
    async (dept: Omit<Department, "id" | "slug">) => {
      const slug = dept.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await supabase.from("departments").insert({ name: dept.name, slug, description: dept.description });
      await refresh();
    },
    [refresh],
  );

  const removeDepartment = useCallback(
    async (deptId: string) => {
      await supabase.from("departments").delete().eq("id", deptId);
      await refresh();
    },
    [refresh],
  );

  const toggleAgentDepartment = useCallback(
    async (agentId: string, deptId: string) => {
      const enabled = (state.agentDepartments[agentId] ?? []).includes(deptId);
      await supabase
        .from("agent_departments")
        .upsert({ agent_id: agentId, department_id: deptId, enabled: !enabled }, { onConflict: "agent_id,department_id" });
      await refresh();
    },
    [refresh, state.agentDepartments],
  );

  const shareCustomer = useCallback(
    async (customerId: string, guestEmail: string) => {
      await supabase
        .from("customer_shares")
        .insert({ customer_id: customerId, guest_email: guestEmail.trim().toLowerCase(), created_by: me.id });
      await refresh();
    },
    [me.id, refresh],
  );

  const unshareCustomer = useCallback(
    async (shareId: string) => {
      await supabase.from("customer_shares").delete().eq("id", shareId);
      await refresh();
    },
    [refresh],
  );

  const saveResolution = useCallback(
    async (ticketId: string, body: string) => {
      await supabase
        .from("tickets")
        .update({ resolution: body, resolution_by: me.id })
        .eq("id", ticketId);
      await refresh();
    },
    [me.id, refresh],
  );

  const addTimeEntry = useCallback<DeskContextValue["addTimeEntry"]>(
    async (ticketId, entry) => {
      await supabase.from("ticket_time_entries").insert({
        ticket_id: ticketId,
        agent_id: me.id,
        agent_name: me.name || me.email,
        minutes: entry.minutes,
        billable: entry.billable,
        note: entry.note,
      });
      await refresh();
    },
    [me.email, me.id, me.name, refresh],
  );

  const removeTimeEntry = useCallback(
    async (entryId: string) => {
      await supabase.from("ticket_time_entries").delete().eq("id", entryId);
      await refresh();
    },
    [refresh],
  );

  const requestApproval = useCallback<DeskContextValue["requestApproval"]>(
    async (ticketId, input) => {
      await supabase.from("ticket_approvals").insert({
        ticket_id: ticketId,
        requested_by: me.id,
        requested_by_name: me.name || me.email,
        approver_email: input.approverEmail.trim().toLowerCase(),
        subject: input.subject,
        reason: input.reason,
      });
      await refresh();
    },
    [me.email, me.id, me.name, refresh],
  );

  const decideApproval = useCallback<DeskContextValue["decideApproval"]>(
    async (approvalId, status) => {
      await supabase
        .from("ticket_approvals")
        .update({ status, decided_at: new Date().toISOString() })
        .eq("id", approvalId);
      await refresh();
    },
    [refresh],
  );

  const saveArticle = useCallback<DeskContextValue["saveArticle"]>(
    async (article) => {
      const slug =
        article.slug ||
        article.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60);
      const row = {
        title: article.title,
        slug,
        category_id: article.categoryId ?? null,
        summary: article.summary ?? "",
        body: article.body ?? "",
        tags: article.tags ?? [],
        status: article.status ?? "draft",
        author_id: me.id,
        author_name: me.name || me.email,
        updated_at: new Date().toISOString(),
      };
      if (article.id) {
        await supabase.from("kb_articles").update(row).eq("id", article.id);
        await refresh();
        return article.id;
      }
      const { data, error } = await supabase.from("kb_articles").insert(row).select("id").single();
      await refresh();
      if (error || !data) return null;
      return data.id;
    },
    [me.email, me.id, me.name, refresh],
  );

  const deleteArticle = useCallback(
    async (articleId: string) => {
      await supabase.from("kb_articles").delete().eq("id", articleId);
      await refresh();
    },
    [refresh],
  );

  const voteArticle = useCallback(
    async (articleId: string, helpful: boolean) => {
      await supabase.rpc("kb_vote", { _article_id: articleId, _helpful: helpful });
      await refresh();
    },
    [refresh],
  );

  const registerArticleView = useCallback(async (articleId: string) => {
    await supabase.rpc("kb_view", { _article_id: articleId });
  }, []);

  const linkArticle = useCallback(
    async (ticketId: string, articleId: string) => {
      await supabase.from("ticket_articles").insert({ ticket_id: ticketId, article_id: articleId });
      await refresh();
    },
    [refresh],
  );

  const unlinkArticle = useCallback(
    async (ticketId: string, articleId: string) => {
      await supabase
        .from("ticket_articles")
        .delete()
        .eq("ticket_id", ticketId)
        .eq("article_id", articleId);
      await refresh();
    },
    [refresh],
  );

  const saveInsight = useCallback(
    async (ticketId: string, summary: string, sentiment: string) => {
      await supabase
        .from("tickets")
        .update({ ai_summary: summary, ai_sentiment: sentiment })
        .eq("id", ticketId);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<DeskContextValue>(
    () => ({
      state,
      me,
      isAgent,
      isAdmin,
      isSuperadmin,
      loading,
      now,
      refresh,
      updateTicket,
      addMessage,
      createTicket,
      toggleTag,
      setFieldValue,
      setProperty,
      saveSla,
      addField,
      removeField,
      setUserRole,
      addMacro,
      removeMacro,
      addDepartment,
      removeDepartment,
      toggleAgentDepartment,
      shareCustomer,
      unshareCustomer,
      saveResolution,
      addTimeEntry,
      removeTimeEntry,
      requestApproval,
      decideApproval,
      saveArticle,
      deleteArticle,
      voteArticle,
      registerArticleView,
      linkArticle,
      unlinkArticle,
      saveInsight,
    }),
    [
      state,
      me,
      isAgent,
      isAdmin,
      isSuperadmin,
      loading,
      now,
      refresh,
      updateTicket,
      addMessage,
      createTicket,
      toggleTag,
      setFieldValue,
      setProperty,
      saveSla,
      addField,
      removeField,
      setUserRole,
      addMacro,
      removeMacro,
      addDepartment,
      removeDepartment,
      toggleAgentDepartment,
      shareCustomer,
      unshareCustomer,
      saveResolution,
      addTimeEntry,
      removeTimeEntry,
      requestApproval,
      decideApproval,
      saveArticle,
      deleteArticle,
      voteArticle,
      registerArticleView,
      linkArticle,
      unlinkArticle,
      saveInsight,
    ],
  );

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk() {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk must be used inside DeskProvider");
  return ctx;
}

/* ---------- derived helpers ---------- */

export function isOpenStatus(status: Status) {
  return status === "open" || status === "pending" || status === "on_hold";
}

export function slaRemaining(ticket: Ticket, now: number) {
  const target = ticket.firstRespondedAt ? ticket.resolutionDueAt : ticket.firstResponseDueAt;
  return new Date(target).getTime() - now;
}

export function isOverdue(ticket: Ticket, now: number) {
  return isOpenStatus(ticket.status) && slaRemaining(ticket, now) <= 0;
}

export function formatCountdown(ms: number) {
  const over = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${over ? "-" : ""}${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function slaTone(ticket: Ticket, now: number): "red" | "amber" | "accent" | "dim" {
  if (!isOpenStatus(ticket.status)) return "dim";
  const ms = slaRemaining(ticket, now);
  if (ms <= 0) return "red";
  if (ms < 20 * 60_000) return "amber";
  return "accent";
}

export function deskMetrics(tickets: Ticket[], now: number) {
  const open = tickets.filter((t) => isOpenStatus(t.status));
  const overdue = open.filter((t) => isOverdue(t, now));
  const responded = tickets.filter((t) => t.firstRespondedAt);
  const avgFirstResponse =
    responded.length === 0
      ? 0
      : Math.round(
          responded.reduce(
            (acc, t) =>
              acc + (new Date(t.firstRespondedAt!).getTime() - new Date(t.createdAt).getTime()) / 60_000,
            0,
          ) / responded.length,
        );
  const resolvedCount = tickets.filter((t) => t.status === "resolved" || t.status === "closed").length;
  const csat = tickets.length === 0 ? 0 : Math.round(
    tickets.reduce((a, t) => a + t.accountCsat, 0) / tickets.length,
  );
  return {
    open: open.length,
    overdue: overdue.length,
    avgFirstResponse,
    csat,
    resolved: resolvedCount,
    total: tickets.length,
  };
}
