-- Storage buckets.
--   images:  processed WebP variants for logos, covers and item photos.
--            Public read (menus are public); written only by the server.
--   uploads: raw uploads (menu photos and PDFs for AI import, photos before
--            processing). Private. Browsers upload with short-lived signed
--            upload URLs that the server issues after checking permissions.
-- Size and type limits are enforced by Storage itself for every upload.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('images', 'images', true, 5242880, array['image/webp', 'image/jpeg', 'image/png']),
  ('uploads', 'uploads', false, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are created for anon or authenticated: all
-- reads of private files and all writes go through the service role.
