export type Status = "open" | "pending" | "on_hold" | "resolved" | "closed";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type Channel = "email" | "chat" | "api" | "portal" | "phone";
export type MessageKind = "customer" | "agent" | "note" | "event";
export type Role = "admin" | "agent" | "guest";

export type Agent = {
  id: string;
  handle: string;
  name: string;
  team: string;
  initials: string;
  role: Role;
};

export type Message = {
  id: string;
  kind: MessageKind;
  author: string;
  body: string;
  at: string;
};

export type Ticket = {
  id: string;
  code: string;
  subject: string;
  company: string;
  plan: string;
  region: string;
  contactName: string;
  contactEmail: string;
  contactRole: string;
  channel: Channel;
  status: Status;
  priority: Priority;
  assignee: string | null;
  departmentId: string | null;
  customerId: string | null;
  tags: string[];
  createdAt: string;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstRespondedAt: string | null;
  csat: number | null;
  lifetimeValue: string;
  accountCsat: number;
  resolution: string;
  aiSummary: string;
  aiSentiment: string;
  messages: Message[];
};

export type Customer = {
  id: string;
  name: string;
  domain: string;
  tier: string;
  region: string;
  csat: number;
  lifetimeValue: number;
};

export type CustomerShare = {
  id: string;
  customerId: string;
  guestEmail: string;
};

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  pending: "Pending",
  on_hold: "On hold",
  resolved: "Resolved",
  closed: "Closed",
};

export const STATUS_ORDER: Status[] = ["open", "pending", "on_hold", "resolved", "closed"];
export const PRIORITY_ORDER: Priority[] = ["P1", "P2", "P3", "P4"];
export const CHANNEL_ORDER: Channel[] = ["email", "chat", "portal", "api", "phone"];

export function initialsOf(name: string) {
  return name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatMoney(value: number) {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}
