-- All records were imported without the base folder prefix.
-- Update every path that doesn't already start with '/' to prepend the correct Dropbox base path.
UPDATE dropbox_images_index
SET dropbox_path = '/Test_Enea Group Objects/Test Metadata/General/' || dropbox_path
WHERE dropbox_path NOT LIKE '/%';
