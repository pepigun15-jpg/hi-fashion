-- HI FASHION global multi-retailer catalogue
-- Retailer data must come from approved affiliate programmes or authorised APIs.
-- Do not scrape retailer sites or publish feeds outside the partner's licence.

create extension if not exists pg_trgm;

create table if not exists public.catalogue_sources (
  id uuid primary key default gen_random_uuid(),
  source_code text not null unique check (source_code ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  display_name text not null,
  network text not null default '',
  integration_type text not null default 'product_feed'
    check (integration_type in ('product_feed','partner_api','marketplace_api','seller_feed')),
  market_code char(2),
  is_enabled boolean not null default false,
  last_synced_at timestamptz,
  last_sync_status text not null default 'not_configured'
    check (last_sync_status in ('not_configured','ok','partial','failed')),
  last_sync_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalogue_products (
  id uuid primary key default gen_random_uuid(),
  source_code text not null references public.catalogue_sources(source_code) on delete cascade,
  external_id text not null,
  title text not null,
  brand text not null default '',
  description text not null default '',
  department text not null default '',
  category text not null default '',
  category_path text[] not null default '{}',
  gender text not null default '',
  image_url text,
  product_url text not null,
  affiliate_url text,
  price_minor bigint,
  sale_price_minor bigint,
  currency char(3) not null default 'EUR',
  availability text not null default 'unknown'
    check (availability in ('in_stock','out_of_stock','preorder','unknown')),
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  retailer text not null default '',
  retailer_country char(2) not null default 'ZZ',
  ships_to char(2)[] not null default '{}',
  source_updated_at timestamptz,
  imported_at timestamptz not null default now(),
  is_active boolean not null default true,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(department,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(category,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(category_path,' '),'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description,'')), 'C') ||
    setweight(to_tsvector('simple', coalesce(retailer,'')), 'D')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_code, external_id, retailer_country),
  check (price_minor is null or price_minor >= 0),
  check (sale_price_minor is null or sale_price_minor >= 0)
);

create index if not exists catalogue_products_search_gin
  on public.catalogue_products using gin(search_vector);
create index if not exists catalogue_products_title_trgm
  on public.catalogue_products using gin(title gin_trgm_ops);
create index if not exists catalogue_products_brand_trgm
  on public.catalogue_products using gin(brand gin_trgm_ops);
create index if not exists catalogue_products_department_idx
  on public.catalogue_products(department, category) where is_active = true;
create index if not exists catalogue_products_retailer_market_idx
  on public.catalogue_products(retailer_country, retailer) where is_active = true;
create index if not exists catalogue_products_price_idx
  on public.catalogue_products(currency, sale_price_minor, price_minor) where is_active = true;
create index if not exists catalogue_products_imported_idx
  on public.catalogue_products(imported_at desc) where is_active = true;

create table if not exists public.catalogue_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_code text not null references public.catalogue_sources(source_code) on delete cascade,
  status text not null check (status in ('running','succeeded','partial','failed')),
  received_count integer not null default 0,
  imported_count integer not null default 0,
  failed_count integer not null default 0,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists catalogue_sync_runs_source_idx
  on public.catalogue_sync_runs(source_code, started_at desc);

-- Public metadata only: secrets, feed URLs and partner tokens are never stored here.
insert into public.catalogue_sources(source_code,display_name,network,integration_type)
values
  ('awin','Awin product feeds','Awin','product_feed'),
  ('cj','CJ product catalogues','CJ Affiliate','product_feed'),
  ('ebay_browse','eBay Browse API','eBay Partner Network','marketplace_api')
on conflict(source_code) do nothing;

alter table public.catalogue_sources enable row level security;
alter table public.catalogue_products enable row level security;
alter table public.catalogue_sync_runs enable row level security;

drop policy if exists "Public can see enabled catalogue sources" on public.catalogue_sources;
create policy "Public can see enabled catalogue sources"
  on public.catalogue_sources for select to anon, authenticated
  using (is_enabled = true);

drop policy if exists "Public can see active retailer catalogue items" on public.catalogue_products;
create policy "Public can see active retailer catalogue items"
  on public.catalogue_products for select to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1 from public.catalogue_sources s
      where s.source_code = catalogue_products.source_code
        and s.is_enabled = true
    )
  );

revoke all on public.catalogue_sync_runs from anon, authenticated;
grant select on public.catalogue_sources, public.catalogue_products to anon, authenticated;

create or replace function public.search_catalogue_products(
  p_query text default '',
  p_category text default null,
  p_country char(2) default null,
  p_gender text default null,
  p_brand text default null,
  p_retailer text default null,
  p_currency char(3) default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_in_stock_only boolean default false,
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  brand text,
  description text,
  department text,
  category text,
  gender text,
  image_url text,
  product_url text,
  affiliate_url text,
  price_minor bigint,
  sale_price_minor bigint,
  currency char(3),
  availability text,
  sizes text[],
  colors text[],
  retailer text,
  retailer_country char(2),
  ships_to char(2)[],
  source_code text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      nullif(trim(coalesce(p_query,'')), '') as query_text,
      case when nullif(trim(coalesce(p_query,'')), '') is null then null
           else websearch_to_tsquery('simple', trim(p_query)) end as query_ts
  ),
  matched as (
    select
      cp.*,
      case
        when p.query_text is null then 0::real
        else ts_rank_cd(cp.search_vector, p.query_ts)
      end as relevance
    from public.catalogue_products cp
    join public.catalogue_sources cs on cs.source_code = cp.source_code and cs.is_enabled = true
    cross join params p
    where cp.is_active = true
      and (
        p.query_text is null
        or cp.search_vector @@ p.query_ts
        or cp.title ilike '%' || p.query_text || '%'
        or cp.brand ilike '%' || p.query_text || '%'
        or cp.category ilike '%' || p.query_text || '%'
        or cp.department ilike '%' || p.query_text || '%'
        or cp.retailer ilike '%' || p.query_text || '%'
      )
      and (nullif(trim(coalesce(p_category,'')), '') is null
        or cp.category ilike '%' || trim(p_category) || '%'
        or cp.department ilike '%' || trim(p_category) || '%'
        or array_to_string(cp.category_path,' ') ilike '%' || trim(p_category) || '%')
      and (nullif(trim(coalesce(p_gender,'')), '') is null or cp.gender ilike '%' || trim(p_gender) || '%')
      and (nullif(trim(coalesce(p_brand,'')), '') is null or cp.brand ilike '%' || trim(p_brand) || '%')
      and (nullif(trim(coalesce(p_retailer,'')), '') is null or cp.retailer ilike '%' || trim(p_retailer) || '%')
      and (p_currency is null or cp.currency = p_currency)
      and (p_min_price_minor is null or coalesce(cp.sale_price_minor,cp.price_minor) >= p_min_price_minor)
      and (p_max_price_minor is null or coalesce(cp.sale_price_minor,cp.price_minor) <= p_max_price_minor)
      and (not p_in_stock_only or cp.availability = 'in_stock')
      and (
        p_country is null
        or cp.retailer_country = p_country
        or cardinality(cp.ships_to) = 0
        or p_country = any(cp.ships_to)
      )
  )
  select
    m.id,m.title,m.brand,m.description,m.department,m.category,m.gender,
    m.image_url,m.product_url,m.affiliate_url,m.price_minor,m.sale_price_minor,
    m.currency,m.availability,m.sizes,m.colors,m.retailer,m.retailer_country,
    m.ships_to,m.source_code,count(*) over() as total_count
  from matched m
  order by m.relevance desc, m.imported_at desc
  limit greatest(1,least(coalesce(p_limit,24),100))
  offset greatest(0,least(coalesce(p_offset,0),1000000));
$$;

grant execute on function public.search_catalogue_products(text,text,char,text,text,text,char,bigint,bigint,boolean,integer,integer)
  to anon, authenticated;

comment on table public.catalogue_products is
  'Approved retailer and affiliate feed catalogue. Product links and display rights must follow each source licence.';
comment on function public.search_catalogue_products is
  'Paginated public catalogue search across active, enabled retailer feeds.';

