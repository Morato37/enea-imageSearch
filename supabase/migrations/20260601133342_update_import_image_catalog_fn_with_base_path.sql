/*
  # Update import_image_catalog to prepend Dropbox base path

  The relative paths from image_catalog.json (e.g. "1_COVER IMAGES/Acer.jpg")
  are stored as full Dropbox paths by prepending the base folder:
  /Test_Enea Group Objects/Test Metadata/General/

  This makes dropbox_path consistent with what the Dropbox API returns,
  so shared-link fetching works without any extra mapping.
*/

CREATE OR REPLACE FUNCTION import_image_catalog(data jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row_count integer;
  base_path text := '/Test_Enea Group Objects/Test Metadata/General/';
BEGIN
  INSERT INTO dropbox_images_index (dropbox_path, tags, status, last_scanned_at)
  SELECT
    base_path || replace(value->>'path', E'\\', '/') AS dropbox_path,
    ARRAY(SELECT lower(trim(t)) FROM jsonb_array_elements_text(value->'keywords') t) AS tags,
    'scanned' AS status,
    now() AS last_scanned_at
  FROM jsonb_array_elements(data)
  ON CONFLICT (dropbox_path) DO UPDATE
    SET tags = EXCLUDED.tags,
        status = EXCLUDED.status,
        last_scanned_at = EXCLUDED.last_scanned_at;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
