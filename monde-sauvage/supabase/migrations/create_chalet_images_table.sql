-- Create chalet_images table to store multiple images per chalet
CREATE TABLE IF NOT EXISTS chalet_images (
    id BIGSERIAL PRIMARY KEY,
    chalet_id INTEGER NOT NULL REFERENCES chalets(key) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_chalet_images_chalet_id ON chalet_images(chalet_id);
CREATE INDEX IF NOT EXISTS idx_chalet_images_display_order ON chalet_images(chalet_id, display_order);

-- Enable RLS (Row Level Security)
ALTER TABLE chalet_images ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access to everyone
CREATE POLICY "Enable read access for all users" ON chalet_images
    FOR SELECT USING (true);

-- Create policy to allow insert for authenticated users
CREATE POLICY "Enable insert for authenticated users" ON chalet_images
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Create policy to allow update for authenticated users
CREATE POLICY "Enable update for authenticated users" ON chalet_images
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Create policy to allow delete for authenticated users
CREATE POLICY "Enable delete for authenticated users" ON chalet_images
    FOR DELETE USING (auth.role() = 'authenticated');
