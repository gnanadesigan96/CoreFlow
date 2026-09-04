-- ============ enums ============
create type public.app_role as enum ('admin','agent','guest');
create type public.ticket_status as enum ('open','pending','on_hold','resolved','closed');
create type public.ticket_priority as enum ('P1','P2','P3','P4');
create type public.ticket_channel as enum ('email','chat','portal','phone','api');
create type public.message_kind as enum ('inbound','reply','note');

-- ============ profiles ============
create table public.profiles (
  id uuid primary key,
  email text not null,
  full_name text not null default '',
  handle text not null default '',
  avatar_hue int not null default 180,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('agent','admin'))
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.my_email()
returns text language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email','')) $$;

-- ============ departments ============
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text not null default '',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.departments to authenticated;
grant all on public.departments to service_role;
alter table public.departments enable row level security;

create table public.agent_departments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  department_id uuid not null references public.departments(id) on delete cascade,
  enabled boolean not null default true,
  unique (agent_id, department_id)
);
grant select, insert, update, delete on public.agent_departments to authenticated;
grant all on public.agent_departments to service_role;
alter table public.agent_departments enable row level security;

create or replace function public.agent_department_ids(_agent_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select department_id from public.agent_departments where agent_id = _agent_id and enabled
$$;

-- ============ customers ============
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null default '',
  tier text not null default 'Standard',
  region text not null default '',
  csat int not null default 0,
  lifetime_value int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;
alter table public.customers enable row level security;

create table public.customer_shares (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  guest_email text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (customer_id, guest_email)
);
grant select, insert, update, delete on public.customer_shares to authenticated;
grant all on public.customer_shares to service_role;
alter table public.customer_shares enable row level security;

create or replace function public.shared_customer_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select customer_id from public.customer_shares where lower(guest_email) = public.my_email()
$$;

-- ============ config ============
create table public.sla_policies (
  priority public.ticket_priority primary key,
  first_response_minutes int not null,
  resolution_minutes int not null,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.sla_policies to authenticated;
grant all on public.sla_policies to service_role;
alter table public.sla_policies enable row level security;

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  field_type text not null default 'text',
  required boolean not null default false,
  options text[] not null default '{}',
  position int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.custom_fields to authenticated;
grant all on public.custom_fields to service_role;
alter table public.custom_fields enable row level security;

create table public.macros (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body text not null,
  set_status public.ticket_status,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.macros to authenticated;
grant all on public.macros to service_role;
alter table public.macros enable row level security;

-- ============ tickets ============
create sequence public.ticket_code_seq start 4801;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('T-' || nextval('public.ticket_code_seq')::text),
  subject text not null,
  status public.ticket_status not null default 'open',
  priority public.ticket_priority not null default 'P3',
  channel public.ticket_channel not null default 'portal',
  department_id uuid references public.departments(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  requester_name text not null default '',
  requester_email text not null default '',
  requester_title text not null default '',
  assignee_id uuid,
  tags text[] not null default '{}',
  field_values jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz
);
create index tickets_status_idx on public.tickets(status);
create index tickets_customer_idx on public.tickets(customer_id);
grant select, insert, update, delete on public.tickets to authenticated;
grant all on public.tickets to service_role;
alter table public.tickets enable row level security;

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid,
  author_name text not null default '',
  kind public.message_kind not null default 'reply',
  body text not null,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages(ticket_id);
grant select, insert on public.ticket_messages to authenticated;
grant all on public.ticket_messages to service_role;
alter table public.ticket_messages enable row level security;

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  actor_id uuid,
  actor_name text not null default 'system',
  summary text not null,
  created_at timestamptz not null default now()
);
create index ticket_events_ticket_idx on public.ticket_events(ticket_id);
grant select, insert on public.ticket_events to authenticated;
grant all on public.ticket_events to service_role;
alter table public.ticket_events enable row level security;

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  filters jsonb not null default '{}',
  shared boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.saved_views to authenticated;
grant all on public.saved_views to service_role;
alter table public.saved_views enable row level security;

create or replace function public.can_view_ticket(_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tickets t
    where t.id = _ticket_id
      and (
        (public.is_admin())
        or (public.is_agent() and (t.department_id is null or t.department_id in (select public.agent_department_ids(auth.uid()))))
        or (lower(t.requester_email) = public.my_email())
        or (t.customer_id in (select public.shared_customer_ids()))
      )
  )
$$;

-- ============ policies ============
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

create policy "roles visible to self or agents" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_agent());

create policy "departments readable" on public.departments for select to authenticated using (true);
create policy "departments admin write" on public.departments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "agent departments readable by agents" on public.agent_departments for select to authenticated
  using (public.is_agent());
create policy "agent departments admin write" on public.agent_departments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "customers visible to agents guests" on public.customers for select to authenticated
  using (public.is_agent() or id in (select public.shared_customer_ids())
    or exists (select 1 from public.tickets t where t.customer_id = customers.id and lower(t.requester_email) = public.my_email()));
create policy "customers agent write" on public.customers for all to authenticated
  using (public.is_agent()) with check (public.is_agent());

create policy "shares visible to agents and guest" on public.customer_shares for select to authenticated
  using (public.is_agent() or lower(guest_email) = public.my_email());
create policy "shares admin write" on public.customer_shares for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "sla readable" on public.sla_policies for select to authenticated using (true);
create policy "sla admin write" on public.sla_policies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "fields readable" on public.custom_fields for select to authenticated using (true);
create policy "fields admin write" on public.custom_fields for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "macros readable by agents" on public.macros for select to authenticated using (public.is_agent());
create policy "macros agent write" on public.macros for all to authenticated
  using (public.is_agent()) with check (public.is_agent());

create policy "tickets scoped select" on public.tickets for select to authenticated
  using (
    public.is_admin()
    or (public.is_agent() and (department_id is null or department_id in (select public.agent_department_ids(auth.uid()))))
    or lower(requester_email) = public.my_email()
    or customer_id in (select public.shared_customer_ids())
  );
create policy "tickets insert" on public.tickets for insert to authenticated
  with check (public.is_agent() or lower(requester_email) = public.my_email());
create policy "tickets agent update" on public.tickets for update to authenticated
  using (public.is_agent()) with check (public.is_agent());
create policy "tickets admin delete" on public.tickets for delete to authenticated using (public.is_admin());

create policy "messages scoped select" on public.ticket_messages for select to authenticated
  using (public.can_view_ticket(ticket_id) and (kind <> 'note' or public.is_agent()));
create policy "messages insert" on public.ticket_messages for insert to authenticated
  with check (public.can_view_ticket(ticket_id) and (kind <> 'note' or public.is_agent()));

create policy "events scoped select" on public.ticket_events for select to authenticated
  using (public.can_view_ticket(ticket_id));
create policy "events insert" on public.ticket_events for insert to authenticated
  with check (public.can_view_ticket(ticket_id));

create policy "saved views own" on public.saved_views for all to authenticated
  using (owner_id = auth.uid() or (shared and public.is_agent()))
  with check (owner_id = auth.uid());

-- ============ signup trigger ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted text := coalesce(new.raw_user_meta_data ->> 'role', 'guest');
  assigned public.app_role;
begin
  insert into public.profiles (id, email, full_name, handle)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    lower(split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  if wanted = 'agent' then
    if not exists (select 1 from public.user_roles where role = 'admin') then
      assigned := 'admin';
    else
      assigned := 'agent';
    end if;
  else
    assigned := 'guest';
  end if;

  insert into public.user_roles (user_id, role) values (new.id, assigned)
  on conflict do nothing;

  if assigned in ('agent','admin') then
    insert into public.agent_departments (agent_id, department_id, enabled)
    select new.id, d.id, true from public.departments d
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_ticket()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;
create trigger tickets_touch before update on public.tickets for each row execute function public.touch_ticket();

-- ============ seed ============
insert into public.sla_policies (priority, first_response_minutes, resolution_minutes) values
  ('P1', 15, 240), ('P2', 60, 480), ('P3', 240, 1440), ('P4', 480, 2880);

insert into public.departments (name, slug, description) values
  ('Support', 'support', 'Tier 1 and Tier 2 product support'),
  ('Billing', 'billing', 'Invoices, plans and payment failures'),
  ('Infrastructure', 'infrastructure', 'Platform, uptime and webhooks'),
  ('Customer Success', 'success', 'Onboarding and account health');

insert into public.custom_fields (label, field_type, required, options, position) values
  ('Environment', 'select', true, '{Production,Staging,Sandbox}', 1),
  ('Affected version', 'text', false, '{}', 2),
  ('Impacted users', 'number', false, '{}', 3),
  ('Regression', 'select', false, '{Yes,No,Unknown}', 4);

insert into public.macros (name, body, set_status) values
  ('Ack + investigating', 'Thanks for the report — we have reproduced this and are investigating now. I will update you within the hour.', 'open'),
  ('Need more info', 'Could you share the request ID and the exact timestamp so we can trace it in our logs?', 'pending'),
  ('Resolved + follow up', 'This is now fixed and deployed. I am resolving the ticket — reply here if anything still looks off.', 'resolved');

insert into public.customers (name, domain, tier, region, csat, lifetime_value) values
  ('Meridian Labs', 'meridianlabs.io', 'Enterprise', 'EU-West', 96, 48000),
  ('Polarbyte', 'polarbyte.eu', 'Enterprise', 'EU-North', 94, 57000),
  ('Novafield', 'novafield.com', 'Growth', 'US-East', 91, 21000),
  ('Strata', 'strata.dev', 'Growth', 'US-West', 88, 17000),
  ('Halcyon Co', 'halcyon.co', 'Standard', 'APAC', 90, 9000),
  ('Orbital', 'orbital.sh', 'Standard', 'EU-Central', 85, 7400);

insert into public.tickets (subject, status, priority, channel, department_id, customer_id, requester_name, requester_email, requester_title, tags, field_values, created_at, first_response_at, resolved_at)
select v.subject, v.status::public.ticket_status, v.priority::public.ticket_priority, v.channel::public.ticket_channel,
       d.id, c.id, v.rname, v.remail, v.rtitle, v.tags::text[], v.fields::jsonb,
       now() - (v.age_min || ' minutes')::interval,
       case when v.fr_min is null then null else now() - (v.fr_min || ' minutes')::interval end,
       case when v.res_min is null then null else now() - (v.res_min || ' minutes')::interval end
from (values
  ('SSO login looping after password reset','open','P2','chat','support','Polarbyte','Ivar Holm','ivar@polarbyte.eu','IT Admin','{sso,auth}','{"Environment":"Production","Regression":"Yes"}',96,null,null),
  ('Cannot invite teammate to new project','open','P2','email','support','Novafield','Mia Chen','mia@novafield.com','Product Lead','{invites}','{"Environment":"Production"}',52,40,null),
  ('Question about API rate limit tiers','open','P4','api','support','Strata','Leo Park','leo@strata.dev','Engineer','{api,limits}','{"Environment":"Sandbox"}',110,95,null),
  ('Export to CSV missing custom fields','pending','P3','portal','support','Halcyon Co','Ana Ruiz','ana@halcyon.co','Ops','{export}','{"Environment":"Production"}',180,150,null),
  ('Dashboard widgets not loading on Safari','pending','P3','email','support','Orbital','Tomas Berg','tomas@orbital.sh','Analyst','{ui,browser}','{"Environment":"Production","Regression":"Unknown"}',300,240,null),
  ('Payment webhook returning 502 on retries','open','P1','api','infrastructure','Meridian Labs','Dana Ruiz','dana@meridianlabs.io','Payments Eng','{webhook,payments}','{"Environment":"Production","Regression":"Yes"}',30,null,null),
  ('Invoice PDF renders blank','resolved','P3','email','billing','Meridian Labs','Dana Ruiz','dana@meridianlabs.io','Payments Eng','{billing,pdf}','{"Environment":"Production"}',900,860,120),
  ('Webhook signature mismatch on rotation','closed','P2','api','infrastructure','Meridian Labs','Dana Ruiz','dana@meridianlabs.io','Payments Eng','{webhook,security}','{"Environment":"Production"}',1500,1440,400),
  ('Seat count wrong after downgrade','open','P3','portal','billing','Novafield','Mia Chen','mia@novafield.com','Product Lead','{billing,seats}','{"Environment":"Production"}',420,380,null),
  ('Onboarding checklist stuck at step 3','pending','P4','chat','success','Strata','Leo Park','leo@strata.dev','Engineer','{onboarding}','{}',600,520,null)
) as v(subject,status,priority,channel,dept,cust,rname,remail,rtitle,tags,fields,age_min,fr_min,res_min)
join public.departments d on d.slug = v.dept
join public.customers c on c.name = v.cust;

insert into public.ticket_messages (ticket_id, author_name, kind, body, created_at)
select t.id, t.requester_name, 'inbound', m.body, t.created_at + interval '1 minute'
from public.tickets t
join (values
  ('SSO login looping after password reset','After a password reset, SSO users bounce between our IdP and your login screen indefinitely. Clearing cookies does not help.'),
  ('Cannot invite teammate to new project','Invites to the new project silently fail — the teammate never receives the email and no pending invite appears.'),
  ('Question about API rate limit tiers','What are the per-minute limits on the Growth plan, and do bursts count against the same window?'),
  ('Export to CSV missing custom fields','CSV exports drop every custom field we added last week. The UI shows them fine.'),
  ('Dashboard widgets not loading on Safari','On Safari 17 the dashboard widgets stay as skeletons. Chrome is fine.'),
  ('Payment webhook returning 502 on retries','Our payment webhook receives 502 from your edge on every retry attempt since 04:10 UTC.'),
  ('Invoice PDF renders blank','The August invoice PDF downloads but every page is blank.'),
  ('Webhook signature mismatch on rotation','Signature verification fails for ~30s after we rotate the signing secret.'),
  ('Seat count wrong after downgrade','We downgraded from 40 to 25 seats and the billing page still shows 40.'),
  ('Onboarding checklist stuck at step 3','The onboarding checklist will not advance past "Connect a data source".')
) as m(subject, body) on m.subject = t.subject;
