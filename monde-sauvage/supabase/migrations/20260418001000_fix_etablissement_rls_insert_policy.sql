-- Fix RLS for Etablissement creation and owner management
-- Supports both owner_id and ownerId column naming.

DO $$
DECLARE
    target_table regclass;
    target_table_name text;
    owner_column text;
BEGIN
    -- Resolve actual table name (quoted Etablissement vs lowercase etablissement)
    IF to_regclass('public."Etablissement"') IS NOT NULL THEN
        target_table := to_regclass('public."Etablissement"');
        target_table_name := 'Etablissement';
    ELSIF to_regclass('public.etablissement') IS NOT NULL THEN
        target_table := to_regclass('public.etablissement');
        target_table_name := 'etablissement';
    ELSE
        RAISE NOTICE 'Skipping RLS migration: no Etablissement table found in public schema';
        RETURN;
    END IF;

    -- Detect owner column variant
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = target_table_name
          AND column_name = 'owner_id'
    ) THEN
        owner_column := 'owner_id';
    ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = target_table_name
          AND column_name = 'ownerId'
    ) THEN
        owner_column := 'ownerId';
    ELSE
        RAISE EXCEPTION 'No owner column (owner_id/ownerId) found on %.%', 'public', target_table_name;
    END IF;

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);

    -- Drop and recreate canonical owner policies for deterministic behavior.
    EXECUTE format('DROP POLICY IF EXISTS "Etablissement owners select" ON %s', target_table);
    EXECUTE format('DROP POLICY IF EXISTS "Etablissement owners insert" ON %s', target_table);
    EXECUTE format('DROP POLICY IF EXISTS "Etablissement owners update" ON %s', target_table);
    EXECUTE format('DROP POLICY IF EXISTS "Etablissement owners delete" ON %s', target_table);

    EXECUTE format(
        'CREATE POLICY "Etablissement owners select" ON %s FOR SELECT USING (%I = auth.uid())',
        target_table,
        owner_column
    );

    EXECUTE format(
        'CREATE POLICY "Etablissement owners insert" ON %s FOR INSERT WITH CHECK (%I = auth.uid())',
        target_table,
        owner_column
    );

    EXECUTE format(
        'CREATE POLICY "Etablissement owners update" ON %s FOR UPDATE USING (%I = auth.uid()) WITH CHECK (%I = auth.uid())',
        target_table,
        owner_column,
        owner_column
    );

    EXECUTE format(
        'CREATE POLICY "Etablissement owners delete" ON %s FOR DELETE USING (%I = auth.uid())',
        target_table,
        owner_column
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO authenticated', target_table);
END
$$;
