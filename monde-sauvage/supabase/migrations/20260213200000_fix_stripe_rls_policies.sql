-- Fix-up: apply RLS policies that failed in the previous migration
-- (PostgreSQL doesn't support CREATE POLICY IF NOT EXISTS)

ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- pricing_rules: vendors can manage their own chalet pricing
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can view their pricing rules') THEN
        CREATE POLICY "Vendors can view their pricing rules"
            ON pricing_rules FOR SELECT
            USING (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can insert pricing rules') THEN
        CREATE POLICY "Vendors can insert pricing rules"
            ON pricing_rules FOR INSERT
            WITH CHECK (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can update pricing rules') THEN
        CREATE POLICY "Vendors can update pricing rules"
            ON pricing_rules FOR UPDATE
            USING (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can delete pricing rules') THEN
        CREATE POLICY "Vendors can delete pricing rules"
            ON pricing_rules FOR DELETE
            USING (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view active pricing rules') THEN
        CREATE POLICY "Anyone can view active pricing rules"
            ON pricing_rules FOR SELECT
            USING (is_active = TRUE);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages webhook events') THEN
        CREATE POLICY "Service role manages webhook events"
            ON stripe_webhook_events FOR ALL
            USING (FALSE);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own bookings') THEN
        CREATE POLICY "Users can view their own bookings"
            ON bookings FOR SELECT
            USING (user_id = auth.uid());
    END IF;
END $$;

GRANT SELECT ON pricing_rules TO anon;
GRANT SELECT ON pricing_rules TO authenticated;
GRANT ALL ON pricing_rules TO service_role;
GRANT ALL ON stripe_webhook_events TO service_role;
