-- Preserve unfinished CSV records between HTTP Range batches.
alter table public.catalogue_feed_cursors
  add column if not exists pending_tail_base64 text;
