-- Store parser metadata required to resume authorised CSV/TSV catalogue imports.
alter table public.catalogue_feed_cursors
  add column if not exists header_columns text[] not null default '{}',
  add column if not exists delimiter text not null default ',',
  add column if not exists total_bytes bigint;

comment on column public.catalogue_feed_cursors.header_columns is
  'Parsed CSV/TSV header names for the current resumable feed import.';
comment on column public.catalogue_feed_cursors.delimiter is
  'Detected CSV/TSV field delimiter for the current resumable feed import.';
comment on column public.catalogue_feed_cursors.total_bytes is
  'Total feed size in bytes when the partner server provides it.';
