-- ============ tickets: resolution + AI columns ============
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS resolution text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resolution_by uuid,
  ADD COLUMN IF NOT EXISTS ai_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_sentiment text NOT NULL DEFAULT '';

-- ============ time entries ============
CREATE TABLE IF NOT EXISTS public.ticket_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  agent_id uuid,
  agent_name text NOT NULL DEFAULT '',
  minutes integer NOT NULL DEFAULT 0,
  billable boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_time_entries TO authenticated;
GRANT ALL ON public.ticket_time_entries TO service_role;
ALTER TABLE public.ticket_time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "time entries agent select" ON public.ticket_time_entries
  FOR SELECT TO authenticated USING (public.is_agent());
CREATE POLICY "time entries agent insert" ON public.ticket_time_entries
  FOR INSERT TO authenticated WITH CHECK (public.is_agent());
CREATE POLICY "time entries own delete" ON public.ticket_time_entries
  FOR DELETE TO authenticated USING (public.is_agent() AND (agent_id = auth.uid() OR public.is_admin()));

-- ============ approvals ============
CREATE TABLE IF NOT EXISTS public.ticket_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  requested_by uuid,
  requested_by_name text NOT NULL DEFAULT '',
  approver_email text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_approvals TO authenticated;
GRANT ALL ON public.ticket_approvals TO service_role;
ALTER TABLE public.ticket_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approvals select" ON public.ticket_approvals
  FOR SELECT TO authenticated USING (public.is_agent() OR lower(approver_email) = public.my_email());
CREATE POLICY "approvals insert" ON public.ticket_approvals
  FOR INSERT TO authenticated WITH CHECK (public.is_agent());
CREATE POLICY "approvals decide" ON public.ticket_approvals
  FOR UPDATE TO authenticated USING (public.is_agent() OR lower(approver_email) = public.my_email())
  WITH CHECK (public.is_agent() OR lower(approver_email) = public.my_email());
CREATE POLICY "approvals admin delete" ON public.ticket_approvals
  FOR DELETE TO authenticated USING (public.is_admin());

-- ============ knowledge base ============
CREATE TABLE IF NOT EXISTS public.kb_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_categories TO authenticated;
GRANT ALL ON public.kb_categories TO service_role;
ALTER TABLE public.kb_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb categories readable" ON public.kb_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "kb categories agent write" ON public.kb_categories
  FOR ALL TO authenticated USING (public.is_agent()) WITH CHECK (public.is_agent());

CREATE TABLE IF NOT EXISTS public.kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  category_id uuid REFERENCES public.kb_categories(id) ON DELETE SET NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  author_id uuid,
  author_name text NOT NULL DEFAULT '',
  views integer NOT NULL DEFAULT 0,
  helpful integer NOT NULL DEFAULT 0,
  not_helpful integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_articles TO authenticated;
GRANT ALL ON public.kb_articles TO service_role;
ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb published readable" ON public.kb_articles
  FOR SELECT TO authenticated USING (status = 'published' OR public.is_agent());
CREATE POLICY "kb agent write" ON public.kb_articles
  FOR ALL TO authenticated USING (public.is_agent()) WITH CHECK (public.is_agent());

CREATE TABLE IF NOT EXISTS public.kb_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.kb_articles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  helpful boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_feedback TO authenticated;
GRANT ALL ON public.kb_feedback TO service_role;
ALTER TABLE public.kb_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb feedback own" ON public.kb_feedback
  FOR ALL TO authenticated USING (user_id = auth.uid() OR public.is_agent())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.ticket_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES public.kb_articles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, article_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_articles TO authenticated;
GRANT ALL ON public.ticket_articles TO service_role;
ALTER TABLE public.ticket_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket articles scoped select" ON public.ticket_articles
  FOR SELECT TO authenticated USING (public.can_view_ticket(ticket_id));
CREATE POLICY "ticket articles agent write" ON public.ticket_articles
  FOR ALL TO authenticated USING (public.is_agent()) WITH CHECK (public.is_agent());

-- vote helper keeps counters in sync without granting broad update rights
CREATE OR REPLACE FUNCTION public.kb_vote(_article_id uuid, _helpful boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.kb_feedback (article_id, user_id, helpful)
  values (_article_id, auth.uid(), _helpful)
  on conflict (article_id, user_id) do update set helpful = excluded.helpful;

  update public.kb_articles a
     set helpful = (select count(*) from public.kb_feedback f where f.article_id = a.id and f.helpful),
         not_helpful = (select count(*) from public.kb_feedback f where f.article_id = a.id and not f.helpful)
   where a.id = _article_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.kb_view(_article_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  update public.kb_articles set views = views + 1 where id = _article_id
$$;

-- ============ seed knowledge base ============
INSERT INTO public.kb_categories (name, slug, description, position) VALUES
  ('Getting started', 'getting-started', 'Onboarding, access and first-run setup', 1),
  ('Billing & invoices', 'billing', 'Charges, invoices, plan changes and refunds', 2),
  ('Integrations', 'integrations', 'Cloud accounts, connectors and API keys', 3),
  ('Troubleshooting', 'troubleshooting', 'Known errors and their resolutions', 4)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.kb_articles (title, slug, category_id, summary, body, tags, status, author_name, views, helpful, not_helpful)
VALUES
  ('Onboarding a new cloud account',
   'onboarding-a-new-cloud-account',
   (SELECT id FROM public.kb_categories WHERE slug = 'getting-started'),
   'Connect a cloud account end to end, including the read-only role and validation checks.',
   E'## Before you start\nYou need admin rights in the target cloud account and the Owner role on the workspace.\n\n## Steps\n1. Open **Settings → Accounts → Add account**.\n2. Choose the provider and paste the account identifier.\n3. Deploy the read-only role template we generate for you.\n4. Run **Validate** and wait for all five checks to pass.\n\n## If validation fails\nMissing access policies are the most common cause. Re-deploy the template and re-run validation; permissions can take up to 10 minutes to propagate.',
   ARRAY['onboarding','accounts','validation'], 'published', 'Desk team', 412, 38, 2),
  ('Why does my invoice differ from the dashboard total?',
   'invoice-vs-dashboard-total',
   (SELECT id FROM public.kb_categories WHERE slug = 'billing'),
   'Dashboard totals are near real-time and unblended; invoices are finalised with credits and reservations applied.',
   E'## Short answer\nThe dashboard shows unblended, near real-time spend. The invoice shows finalised spend after credits, savings plans and reserved instance amortisation.\n\n## What to check\n- Compare the same billing window (invoices close at UTC month end).\n- Look for **credits** and **support charges** lines on the invoice.\n- Amortised vs unblended cost toggles change the dashboard figure.\n\n## Still mismatched?\nRaise a ticket with the invoice ID and the dashboard screenshot; we reconcile line by line within one business day.',
   ARRAY['billing','invoice','cost'], 'published', 'Desk team', 268, 24, 3),
  ('Fixing "Unable to select the account name" in templates',
   'unable-to-select-account-name',
   (SELECT id FROM public.kb_categories WHERE slug = 'troubleshooting'),
   'The account picker only lists accounts whose monitoring status is Active.',
   E'## Cause\nA template can only target accounts in the **Active** monitoring state. Accounts stuck in *Monitoring — In Progress* are hidden from the picker.\n\n## Resolution\n1. Open the account detail page and check the monitoring status.\n2. Re-run the permission validation; fix any missing policies it lists.\n3. Once the status flips to Active, reload the template page — the account appears in the picker.\n\n## Prevention\nAdd the read-only policy set to your account bootstrap so new accounts land Active on day one.',
   ARRAY['templates','monitoring','permissions'], 'published', 'Desk team', 511, 45, 1),
  ('Rotating API keys without downtime',
   'rotating-api-keys',
   (SELECT id FROM public.kb_categories WHERE slug = 'integrations'),
   'Create the replacement key, migrate callers, then revoke the old key after traffic drains.',
   E'## Zero-downtime rotation\n1. Create a second key with the same scopes.\n2. Deploy the new key to callers.\n3. Watch the **Last used** timestamp of the old key for 24 hours.\n4. Revoke the old key once it stops being used.\n\n## Notes\nKeys are scoped per workspace. Never share a key across environments — rotation then forces a coordinated deploy.',
   ARRAY['api','security','keys'], 'published', 'Desk team', 190, 19, 0),
  ('SLA escalation matrix',
   'sla-escalation-matrix',
   (SELECT id FROM public.kb_categories WHERE slug = 'getting-started'),
   'First response and resolution targets per priority, and who gets paged when they breach.',
   E'| Priority | First response | Resolution | Escalates to |\n| --- | --- | --- | --- |\n| P1 | 15 min | 4 h | Duty manager |\n| P2 | 1 h | 8 h | Team lead |\n| P3 | 4 h | 24 h | Queue owner |\n| P4 | 8 h | 72 h | Queue owner |\n\nBreaches page the listed owner automatically and mark the ticket red in the queue.',
   ARRAY['sla','process'], 'published', 'Desk team', 143, 12, 1)
ON CONFLICT (slug) DO NOTHING;
