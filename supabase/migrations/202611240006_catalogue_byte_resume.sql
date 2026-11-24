alter table public.catalogue_feed_cursors
  add column if not exists last_byte_offset bigint not null default 0;
