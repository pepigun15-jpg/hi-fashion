-- Support multiple approved advertiser feeds within each affiliate network.
alter table public.catalogue_products
  add column if not exists feed_id text not null default 'default';

alter table public.catalogue_sync_runs
  add column if not exists feed_id text not null default 'default';

alter table public.catalogue_feed_cursors
  add column if not exists feed_id text not null default 'default';

alter table public.catalogue_feed_cursors
  drop constraint if exists catalogue_feed_cursors_pkey;

alter table public.catalogue_feed_cursors
  add constraint catalogue_feed_cursors_pkey primary key(source_code, feed_id);

alter table public.catalogue_products
  drop constraint if exists catalogue_products_source_external_retailer_country_key;

alter table public.catalogue_products
  add constraint catalogue_products_source_feed_external_retailer_country_key
  unique(source_code, feed_id, external_id, retailer, retailer_country);

create index if not exists catalogue_products_feed_idx
  on public.catalogue_products(source_code, feed_id, is_active);

create index if not exists catalogue_sync_runs_feed_idx
  on public.catalogue_sync_runs(source_code, feed_id, started_at desc);
