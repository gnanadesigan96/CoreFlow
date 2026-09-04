# VANTA Desk — roadmap

## Core
- [x] Obsidian Ops design system (tokens, fonts, console utilities)
- [x] Ticket/agent/macro data model + seed
- [x] Store with localStorage persistence + live SLA clock
- [x] Shell: command bar, metrics strip, nav rail, ⌘K palette
- [x] Tickets workspace: queue views (All/Unassigned/Overdue/Mine) + search, detail thread, composer (reply / internal note / macros), status-priority-assignee controls, tags, custom fields, new ticket
- [ ] Dashboard (volume, SLA, CSAT)
- [ ] Contacts / accounts
- [ ] Admin settings screen

## Admin (requested 09:30)
- [ ] SLA configuration — per-priority first-response & resolution targets, editable, re-applied to live timers
- [ ] Layout & fields — custom ticket fields (label, type, options, required) rendered on ticket detail
- [ ] Agent management — add/remove agents (name, handle, team)
- [ ] Macros / canned responses management
- [ ] Departments — create departments, enable/disable per agent, assign tickets to a department

## Auth & access model (requested 09:34) — needs Lovable Cloud
- [ ] Enable Lovable Cloud (database + auth)
- [ ] Two login roles: guest (customer) and agent; agent-admin sub-role
- [ ] Guest sees only tickets he created
- [ ] Guest "Shared with me" view: all tickets for a customer/account shared with him
- [ ] Agent-admin can share a customer/account with a guest (grant record)
- [ ] Agents see all ticket details; department enablement gates an agent's visible queues
- [ ] RLS policies enforcing all of the above server-side (roles in a separate user_roles table)

- [x] Fix preview typecheck build errors (queue/settings edits were reverted; reapplied)

- [ ] Remove LIVE status pill from top bar (done)
