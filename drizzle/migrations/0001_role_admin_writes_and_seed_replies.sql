grant insert, update, delete on public.user_roles to authenticated;

create policy "roles admin write" on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- a couple of agent replies so threads read as conversations
insert into public.ticket_messages (ticket_id, author_name, kind, body, created_at)
select t.id, 'desk.agent', 'reply', m.body, t.created_at + interval '20 minutes'
from public.tickets t
join (values
  ('Cannot invite teammate to new project','Thanks for the report — reproduced on new projects only. Engineering has a fix in review; I will update this thread today.'),
  ('Invoice PDF renders blank','A font asset was missing from the render worker. Redeployed and backfilled the affected invoices — resolving this now.'),
  ('Webhook signature mismatch on rotation','Expected during rotation: both secrets are accepted for a 24h overlap window. Documented on the webhooks page.'),
  ('Dashboard widgets not loading on Safari','Reproduced on Safari 17.2 — tracked as a bundling issue. I will follow up when the patch ships.')
) as m(subject, body) on m.subject = t.subject;

insert into public.ticket_events (ticket_id, actor_name, summary, created_at)
select t.id, 'system', 'Ticket created via ' || t.channel::text, t.created_at from public.tickets t;
