-- Fix chalet_images.chalet_id type: the table was originally created with INTEGER
-- but chalets.key is UUID, causing all image inserts to silently fail.
-- Safe to drop/recreate because no rows were ever successfully inserted.

DROP TABLE IF EXISTS public.chalet_images;

CREATE TABLE public.chalet_images (
    id BIGSERIAL PRIMARY KEY,
    chalet_id UUID NOT NULL REFERENCES public.chalets(key) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_chalet_images_chalet_id ON public.chalet_images(chalet_id);
CREATE INDEX IF NOT EXISTS idx_chalet_images_display_order ON public.chalet_images(chalet_id, display_order);

ALTER TABLE public.chalet_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.chalet_images;
CREATE POLICY "Enable read access for all users"
    ON public.chalet_images FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.chalet_images;
CREATE POLICY "Enable insert for authenticated users"
    ON public.chalet_images FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.chalet_images;
CREATE POLICY "Enable update for authenticated users"
    ON public.chalet_images FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.chalet_images;
CREATE POLICY "Enable delete for authenticated users"
    ON public.chalet_images FOR DELETE USING (auth.role() = 'authenticated');

GRANT SELECT ON public.chalet_images TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chalet_images TO authenticated;
