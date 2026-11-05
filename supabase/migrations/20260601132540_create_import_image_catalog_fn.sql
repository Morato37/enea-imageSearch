/*
  # Create import_image_catalog helper function

  Creates a SECURITY DEFINER function that accepts JSON batches from the
  image_catalog.json and inserts them into dropbox_images_index, bypassing
  RLS for the initial bulk data import.
*/

CREATE OR REPLACE FUNCTION import_image_catalog(data jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row_count integer;
BEGIN
  INSERT INTO dropbox_images_index (dropbox_path, tags, status, last_scanned_at)
  SELECT 
    replace(value->>'path', E'\\', '/') as dropbox_path,
    ARRAY(SELECT lower(trim(t)) FROM jsonb_array_elements_text(value->'keywords') t) as tags,
    'scanned' as status,
    now() as last_scanned_at
  FROM jsonb_array_elements(data)
  ON CONFLICT (dropbox_path) DO UPDATE 
    SET tags = EXCLUDED.tags,
        status = EXCLUDED.status,
        last_scanned_at = EXCLUDED.last_scanned_at;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
