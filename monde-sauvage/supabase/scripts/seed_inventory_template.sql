-- =============================================================================
-- Seed template: equipment_kind + inventory_unit
-- =============================================================================
-- Usage:
-- 1) Replace __ESTABLISHMENT_ID__ with a real UUID from "Etablissement".key
-- 2) Run in Supabase SQL editor (or psql) AFTER migrations are applied
-- 3) Optionally adjust prices in metadata
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Types d'équipements (families)
-- -----------------------------------------------------------------------------
WITH upsert_kinds AS (
  INSERT INTO public.equipment_kind (
    establishment_id,
    slug,
    label,
    metadata,
    is_active
  )
  VALUES
    (
      '__ESTABLISHMENT_ID__'::uuid,
      'chaloupe',
      'Chaloupe aluminium',
      jsonb_build_object('addon_price_per_stay', 65.00),
      true
    ),
    (
      '__ESTABLISHMENT_ID__'::uuid,
      'moteur_hors_bord',
      'Moteur hors-bord',
      jsonb_build_object('addon_price_per_night', 22.00),
      true
    ),
    (
      '__ESTABLISHMENT_ID__'::uuid,
      'batterie_12v',
      'Batterie 12V',
      jsonb_build_object('addon_price_per_stay', 15.00),
      true
    )
  ON CONFLICT (establishment_id, slug) DO UPDATE
    SET
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      is_active = EXCLUDED.is_active,
      updated_at = now()
  RETURNING id, slug
)
SELECT * FROM upsert_kinds;

-- -----------------------------------------------------------------------------
-- Unités physiques (1 ligne = 1 unité réelle, agenda individuel ultérieurement)
-- -----------------------------------------------------------------------------
WITH kinds AS (
  SELECT id, slug
  FROM public.equipment_kind
  WHERE establishment_id = '__ESTABLISHMENT_ID__'::uuid
)
INSERT INTO public.inventory_unit (
  establishment_id,
  equipment_kind_id,
  chalet_id,
  unit_code,
  display_name,
  sort_order,
  is_active
)
VALUES
  -- Chaloupes (pool établissement: chalet_id NULL)
  ('__ESTABLISHMENT_ID__'::uuid, (SELECT id FROM kinds WHERE slug = 'chaloupe'), NULL, 'BOAT-01', 'Chaloupe #1', 1, true),
  ('__ESTABLISHMENT_ID__'::uuid, (SELECT id FROM kinds WHERE slug = 'chaloupe'), NULL, 'BOAT-02', 'Chaloupe #2', 2, true),
  ('__ESTABLISHMENT_ID__'::uuid, (SELECT id FROM kinds WHERE slug = 'chaloupe'), NULL, 'BOAT-03', 'Chaloupe #3', 3, true),

  -- Moteurs
  ('__ESTABLISHMENT_ID__'::uuid, (SELECT id FROM kinds WHERE slug = 'moteur_hors_bord'), NULL, 'ENG-01', 'Moteur #1', 1, true),
  ('__ESTABLISHMENT_ID__'::uuid, (SELECT id FROM kinds WHERE slug = 'moteur_hors_bord'), NULL, 'ENG-02', 'Moteur #2', 2, true),

  -- Batteries
  ('__ESTABLISHMENT_ID__'::uuid, (SELECT id FROM kinds WHERE slug = 'batterie_12v'), NULL, 'BAT-01', 'Batterie #1', 1, true),
  ('__ESTABLISHMENT_ID__'::uuid, (SELECT id FROM kinds WHERE slug = 'batterie_12v'), NULL, 'BAT-02', 'Batterie #2', 2, true)
ON CONFLICT (establishment_id, unit_code) DO UPDATE
  SET
    equipment_kind_id = EXCLUDED.equipment_kind_id,
    display_name = EXCLUDED.display_name,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

COMMIT;

-- Verification
SELECT ek.slug, ek.label, ek.metadata
FROM public.equipment_kind ek
WHERE ek.establishment_id = '__ESTABLISHMENT_ID__'::uuid
ORDER BY ek.slug;

SELECT iu.unit_code, iu.display_name, iu.google_calendar_id, ek.slug AS kind_slug
FROM public.inventory_unit iu
JOIN public.equipment_kind ek ON ek.id = iu.equipment_kind_id
WHERE iu.establishment_id = '__ESTABLISHMENT_ID__'::uuid
ORDER BY ek.slug, iu.sort_order, iu.unit_code;
