/*
  # Create Dropbox Images Index Table

  ## Purpose
  Stores metadata about images scanned from Dropbox for search and linking purposes.

  ## New Table: dropbox_images_index
  - `id` (uuid, primary key)
  - `dropbox_path` (text, unique) - full path of the file inside Dropbox
  - `dropbox_shared_link` (text, nullable) - public shared link for the file
  - `tags` (text[]) - searchable tags associated with the image
  - `last_scanned_at` (timestamptz) - when the entry was last updated by the scanner
  - `status` (text) - e.g. 'scanned', 'linked', 'missing'

  ## Security
  - RLS enabled; table is locked down by default
  - Authenticated users: SELECT only
  - Admins (role = 'admin' in user_profiles): INSERT, UPDATE, DELETE
*/

CREATE TABLE IF NOT EXISTS public.dropbox_images_index (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dropbox_path TEXT NOT NULL UNIQUE,
    dropbox_shared_link TEXT,
    tags TEXT[] DEFAULT '{}',
    last_scanned_at TIMESTAMPTZ DEFAULT now(),
    status TEXT DEFAULT 'scanned'
);

ALTER TABLE public.dropbox_images_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view dropbox index"
    ON public.dropbox_images_index
    FOR SELECT
    TO authenticated
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert dropbox index entries"
    ON public.dropbox_images_index
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    );

CREATE POLICY "Admins can update dropbox index entries"
    ON public.dropbox_images_index
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    );

CREATE POLICY "Admins can delete dropbox index entries"
    ON public.dropbox_images_index
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    );

CREATE INDEX IF NOT EXISTS idx_dropbox_images_tags ON public.dropbox_images_index USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_dropbox_images_path ON public.dropbox_images_index (dropbox_path);
CREATE INDEX IF NOT EXISTS idx_dropbox_images_status ON public.dropbox_images_index (status);
