-- Allow anyone (authenticated or anonymous) to read chalets.
-- The get_chalets_nearby RPC already bypasses RLS via SECURITY DEFINER,
-- but direct REST queries (e.g. chalet detail page) need this policy.

ALTER TABLE public.chalets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chalets: public select" ON public.chalets;

CREATE POLICY "chalets: public select"
ON public.chalets
FOR SELECT
USING (true);

NOTIFY pgrst, 'reload schema';
