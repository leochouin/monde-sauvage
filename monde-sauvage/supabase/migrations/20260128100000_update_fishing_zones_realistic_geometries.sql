-- Migration: Update fishing zones with realistic polygon geometries
-- Replaces bounding boxes with natural-looking river/lake/coastal shapes

-- Set search path to include extensions schema where PostGIS functions live
SET search_path TO public, extensions;

-- Update Rivière Cascapédia - follows the river valley shape
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -66.05 48.42,
  -66.02 48.44,
  -65.98 48.45,
  -65.94 48.44,
  -65.91 48.42,
  -65.89 48.39,
  -65.88 48.36,
  -65.90 48.33,
  -65.93 48.31,
  -65.97 48.30,
  -66.01 48.32,
  -66.04 48.35,
  -66.06 48.38,
  -66.05 48.42
))', 4326)
WHERE name = 'Rivière Cascapédia';

-- Update Rivière Matapédia - elongated river valley shape
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -67.18 48.08,
  -67.14 48.10,
  -67.08 48.09,
  -67.04 48.06,
  -67.01 48.02,
  -67.00 47.97,
  -67.02 47.93,
  -67.06 47.91,
  -67.11 47.92,
  -67.15 47.95,
  -67.18 47.99,
  -67.19 48.04,
  -67.18 48.08
))', 4326)
WHERE name = 'Rivière Matapédia';

-- Update Rivière Bonaventure - winding river corridor
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -65.48 48.38,
  -65.44 48.40,
  -65.39 48.39,
  -65.35 48.36,
  -65.32 48.32,
  -65.31 48.27,
  -65.33 48.23,
  -65.37 48.21,
  -65.42 48.22,
  -65.46 48.25,
  -65.49 48.29,
  -65.50 48.34,
  -65.48 48.38
))', 4326)
WHERE name = 'Rivière Bonaventure';

-- Update Lac des Américains - natural lake shape (rounded)
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -65.94 48.97,
  -65.90 48.98,
  -65.86 48.97,
  -65.83 48.94,
  -65.82 48.90,
  -65.84 48.86,
  -65.88 48.83,
  -65.93 48.82,
  -65.97 48.84,
  -66.00 48.88,
  -66.00 48.92,
  -65.98 48.96,
  -65.94 48.97
))', 4326)
WHERE name = 'Lac des Américains';

-- Update Réserve faunique des Chic-Chocs - mountain reserve area (irregular)
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -66.45 49.08,
  -66.38 49.10,
  -66.30 49.09,
  -66.24 49.06,
  -66.22 49.00,
  -66.24 48.94,
  -66.30 48.91,
  -66.38 48.90,
  -66.45 48.93,
  -66.48 48.98,
  -66.49 49.03,
  -66.45 49.08
))', 4326)
WHERE name = 'Réserve faunique des Chic-Chocs';

-- Update Rivière Sainte-Anne - river corridor with bends
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -66.38 49.18,
  -66.33 49.20,
  -66.27 49.19,
  -66.23 49.15,
  -66.21 49.10,
  -66.22 49.05,
  -66.26 49.02,
  -66.32 49.01,
  -66.37 49.04,
  -66.40 49.09,
  -66.41 49.14,
  -66.38 49.18
))', 4326)
WHERE name = 'Rivière Sainte-Anne';

-- Update Mont Albert Sector - alpine lake region (mountain contours)
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -66.27 48.88,
  -66.22 48.90,
  -66.16 48.89,
  -66.12 48.85,
  -66.11 48.80,
  -66.13 48.75,
  -66.18 48.72,
  -66.24 48.71,
  -66.29 48.74,
  -66.31 48.79,
  -66.30 48.84,
  -66.27 48.88
))', 4326)
WHERE name = 'Mont Albert Sector';

-- Update Baie des Chaleurs - coastal bay shape (curved coastline)
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -66.45 48.18,
  -66.30 48.20,
  -66.10 48.19,
  -65.90 48.16,
  -65.70 48.12,
  -65.55 48.06,
  -65.52 47.98,
  -65.55 47.90,
  -65.65 47.85,
  -65.85 47.82,
  -66.10 47.83,
  -66.35 47.87,
  -66.50 47.94,
  -66.52 48.02,
  -66.50 48.10,
  -66.45 48.18
))', 4326)
WHERE name = 'Baie des Chaleurs';

-- Update Percé Coastal - coastal area following shoreline
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -64.38 48.58,
  -64.33 48.60,
  -64.27 48.59,
  -64.22 48.55,
  -64.20 48.50,
  -64.22 48.45,
  -64.27 48.42,
  -64.33 48.41,
  -64.38 48.44,
  -64.41 48.49,
  -64.42 48.54,
  -64.38 48.58
))', 4326)
WHERE name = 'Percé Coastal';

-- Update Gaspé Bay - bay shape following natural coastline
UPDATE fishing_zones 
SET geometry = ST_GeomFromText('POLYGON((
  -64.55 48.88,
  -64.48 48.90,
  -64.42 48.89,
  -64.38 48.85,
  -64.36 48.80,
  -64.38 48.75,
  -64.43 48.72,
  -64.50 48.71,
  -64.56 48.74,
  -64.59 48.79,
  -64.59 48.84,
  -64.55 48.88
))', 4326)
WHERE name = 'Gaspé Bay';
