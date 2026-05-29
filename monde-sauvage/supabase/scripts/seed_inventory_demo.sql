-- =============================================================================
-- Demo seed: equipment_kind + inventory_unit
-- Establishment: Falls Gully (4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7)
-- Chalets:
--   Refuge 1  → 85b640b1-4067-4eb4-a808-64bf40e7ea49
--   Chalet 2  → 16792746-7f71-49f8-adc2-2e221f6cab32
-- =============================================================================
-- Run in Supabase SQL editor (service role) after all migrations are applied.
-- Safe to re-run: INSERT … ON CONFLICT DO UPDATE / DO NOTHING.
-- =============================================================================

BEGIN;

-- ─── 1. Equipment kinds ───────────────────────────────────────────────────────
INSERT INTO public.equipment_kind (establishment_id, slug, label, metadata, is_active)
VALUES
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    'chaloupe',
    'Chaloupe aluminium 14''',
    jsonb_build_object('addon_price_per_stay', 75.00, 'capacity_persons', 3),
    true
  ),
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    'moteur_hors_bord',
    'Moteur hors-bord 9.9 HP',
    jsonb_build_object('addon_price_per_stay', 55.00, 'fuel_included', false),
    true
  ),
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    'batterie_12v',
    'Batterie 12V démarrage',
    jsonb_build_object('addon_price_per_stay', 20.00),
    true
  ),
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    'canot',
    'Canot',
    jsonb_build_object('addon_price_per_stay', 40.00, 'capacity_persons', 2),
    true
  )
ON CONFLICT (establishment_id, slug) DO UPDATE
  SET label      = EXCLUDED.label,
      metadata   = EXCLUDED.metadata,
      is_active  = true,
      updated_at = now();

-- ─── 2. Inventory units ───────────────────────────────────────────────────────
-- Pattern: chaloupes split between the two chalets + pool;
--          motors and batteries in shared pool;
--          canots in pool.
-- notes field used for maintenance / cleaning status (quick demo option).

WITH kinds AS (
  SELECT id, slug
  FROM public.equipment_kind
  WHERE establishment_id = '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7'
)
INSERT INTO public.inventory_unit (
  establishment_id,
  equipment_kind_id,
  chalet_id,
  unit_code,
  display_name,
  sort_order,
  is_active,
  deleted_at,
  notes
)
VALUES
  -- Chaloupes ---
  -- BOAT-01 incluse avec Refuge 1
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'chaloupe'),
    '85b640b1-4067-4eb4-a808-64bf40e7ea49',
    'BOAT-01', 'Chaloupe #1 (Refuge 1)', 1, true, NULL,
    'Inspection: 2026-05-15 — OK. Prochain entretien prévu 2026-07-01.'
  ),
  -- BOAT-02 incluse avec Chalet 2
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'chaloupe'),
    '16792746-7f71-49f8-adc2-2e221f6cab32',
    'BOAT-02', 'Chaloupe #2 (Chalet 2)', 2, true, NULL,
    'Nettoyage post-séjour: 2026-05-20. Fond légèrement oxydé — surveiller.'
  ),
  -- BOAT-03 réserve globale
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'chaloupe'),
    NULL,
    'BOAT-03', 'Chaloupe #3 (réserve)', 3, true, NULL,
    NULL
  ),

  -- Moteurs hors-bord (pool partagé) ---
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'moteur_hors_bord'),
    NULL,
    'ENG-01', 'Moteur 9.9 HP #1', 1, true, NULL,
    'Vidange huile: 2026-04-30. Prochain entretien 2026-10-01.'
  ),
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'moteur_hors_bord'),
    NULL,
    'ENG-02', 'Moteur 9.9 HP #2', 2, true, NULL,
    NULL
  ),

  -- Batteries (pool partagé) ---
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'batterie_12v'),
    NULL,
    'BAT-01', 'Batterie 12V #1', 1, true, NULL,
    'Chargée 2026-05-22. Capacité 100 %.'
  ),
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'batterie_12v'),
    NULL,
    'BAT-02', 'Batterie 12V #2', 2, true, NULL,
    NULL
  ),
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'batterie_12v'),
    NULL,
    'BAT-03', 'Batterie 12V #3', 3, true, NULL,
    'Capacité diminuée — prévoir remplacement avant saison 2027.'
  ),

  -- Canots (pool partagé) ---
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'canot'),
    NULL,
    'CANOT-01', 'Canot #1', 1, true, NULL,
    NULL
  ),
  (
    '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7',
    (SELECT id FROM kinds WHERE slug = 'canot'),
    NULL,
    'CANOT-02', 'Canot #2', 2, true, NULL,
    'Rainure latérale réparée 2026-05-10 — étanche vérifiée.'
  )
ON CONFLICT (establishment_id, unit_code) DO UPDATE
  SET equipment_kind_id = EXCLUDED.equipment_kind_id,
      chalet_id         = EXCLUDED.chalet_id,
      display_name      = EXCLUDED.display_name,
      sort_order        = EXCLUDED.sort_order,
      is_active         = true,
      deleted_at        = NULL,
      notes             = COALESCE(EXCLUDED.notes, public.inventory_unit.notes),
      updated_at        = now();

-- Also re-activate the stale BATT_1 unit from previous manual test
UPDATE public.inventory_unit
SET    is_active  = false,
       deleted_at = now(),
       updated_at = now()
WHERE  establishment_id = '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7'
  AND  unit_code = 'BATT_1'
  AND  is_active = true;

COMMIT;

-- ─── Verification ─────────────────────────────────────────────────────────────
SELECT ek.slug, ek.label, ek.metadata,
       count(iu.id) FILTER (WHERE iu.is_active AND iu.deleted_at IS NULL) AS active_units
FROM public.equipment_kind ek
LEFT JOIN public.inventory_unit iu ON iu.equipment_kind_id = ek.id
WHERE ek.establishment_id = '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7'
  AND ek.is_active = true
GROUP BY ek.id, ek.slug, ek.label, ek.metadata
ORDER BY ek.slug;

SELECT iu.unit_code, iu.display_name, iu.is_active,
       ek.slug AS kind,
       ch."Name" AS assigned_chalet,
       iu.notes
FROM public.inventory_unit iu
JOIN public.equipment_kind ek ON ek.id = iu.equipment_kind_id
LEFT JOIN public.chalets ch ON ch.key = iu.chalet_id
WHERE iu.establishment_id = '4f671fc7-4782-4b5d-bcf4-a4727b6ec1d7'
  AND iu.is_active = true
  AND iu.deleted_at IS NULL
ORDER BY ek.slug, iu.sort_order, iu.unit_code;
