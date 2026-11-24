-- HI FASHION destination-aware fulfilment ranking.
-- Customer coordinates are supplied per request and are never persisted by this function.
-- Only verified stock locations with a fresh inventory check, confirmed delivery coverage,
-- and a valid HTTPS affiliate deep link can appear in nearest-fulfilment results.

create table if not exists public.catalogue_fulfilment_locations (
  id uuid primary key default gen_random_uuid(),
  catalogue_product_id uuid not null references public.catalogue_products(id) on delete cascade,
  source_code text not null references public.catalogue_sources(source_code) on delete cascade,
  feed_id text not null default 'default',
  external_location_id text not null,
  location_type text not null default 'warehouse'
    check (location_type in ('warehouse','retail_store','seller_dispatch','marketplace_fulfilment','pickup_point')),
  display_city text not null default '',
  display_region text not null default '',
  country_code char(2) not null,
  postal_code text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  ships_to char(2)[] not null default '{}',
  shipping_min_days integer check (shipping_min_days is null or shipping_min_days >= 0),
  shipping_max_days integer check (shipping_max_days is null or shipping_max_days >= 0),
  last_stock_checked_at timestamptz,
  last_location_checked_at timestamptz,
  is_verified boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(catalogue_product_id, external_location_id),
  check (shipping_min_days is null or shipping_max_days is null or shipping_max_days >= shipping_min_days)
);

create index if not exists catalogue_fulfilment_product_active_idx
  on public.catalogue_fulfilment_locations(catalogue_product_id, is_active, is_verified);
create index if not exists catalogue_fulfilment_country_stock_idx
  on public.catalogue_fulfilment_locations(country_code, stock_quantity, last_stock_checked_at)
  where is_active = true and is_verified = true;
create index if not exists catalogue_fulfilment_source_feed_idx
  on public.catalogue_fulfilment_locations(source_code, feed_id, external_location_id);

alter table public.catalogue_fulfilment_locations enable row level security;
revoke all on public.catalogue_fulfilment_locations from anon, authenticated;
grant all on public.catalogue_fulfilment_locations to service_role;

create or replace function public.search_catalogue_products_nearby(
  p_query text default '',
  p_category text default null,
  p_country char(2) default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_brand text default null,
  p_currency char(3) default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_in_stock_only boolean default true,
  p_size text default null,
  p_color text default null,
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
  dispatch_city text,
  dispatch_region text,
  dispatch_country char(2),
  distance_km double precision,
  estimated_delivery_days integer,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(trim(coalesce(p_query,'')), '') as query_text,
      case when nullif(trim(coalesce(p_query,'')), '') is null then null
           else websearch_to_tsquery('simple', trim(p_query)) end as query_ts
  ),
  candidates as (
    select
      cp.id, cp.title, cp.brand, cp.description, cp.department, cp.category, cp.gender,
      cp.image_url, cp.product_url, cp.affiliate_url, cp.price_minor, cp.sale_price_minor,
      cp.currency, cp.availability, cp.sizes, cp.colors, cp.retailer, cp.retailer_country,
      cp.ships_to, cp.source_code,
      fl.display_city as dispatch_city,
      fl.display_region as dispatch_region,
      fl.country_code as dispatch_country,
      round((
        6371.0 * 2.0 * asin(sqrt(least(1.0, greatest(0.0,
          power(sin(radians(fl.latitude - p_lat) / 2.0), 2.0)
          + cos(radians(p_lat)) * cos(radians(fl.latitude))
          * power(sin(radians(fl.longitude - p_lon) / 2.0), 2.0)
        ))))
      )::numeric, 1)::double precision as distance_km,
      coalesce(fl.shipping_max_days, fl.shipping_min_days) as estimated_delivery_days,
      row_number() over (
        partition by cp.id
        order by
          6371.0 * 2.0 * asin(sqrt(least(1.0, greatest(0.0,
            power(sin(radians(fl.latitude - p_lat) / 2.0), 2.0)
            + cos(radians(p_lat)) * cos(radians(fl.latitude))
            * power(sin(radians(fl.longitude - p_lon) / 2.0), 2.0)
          )))),
          coalesce(fl.shipping_max_days, 999),
          fl.last_stock_checked_at desc
      ) as location_rank
    from public.catalogue_products cp
    join public.catalogue_sources cs
      on cs.source_code = cp.source_code and cs.is_enabled = true
    join public.catalogue_fulfilment_locations fl
      on fl.catalogue_product_id = cp.id
    cross join params p
    where p_country is not null
      and p_lat between -90 and 90
      and p_lon between -180 and 180
      and cp.is_active = true
      and cp.availability = 'in_stock'
      and coalesce(cp.affiliate_url,'') ~* '^https://'
      and fl.is_active = true
      and fl.is_verified = true
      and fl.stock_quantity > 0
      and fl.last_stock_checked_at >= now() - interval '72 hours'
      and fl.last_location_checked_at >= now() - interval '365 days'
      and p_country = any(fl.ships_to)
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
      and (nullif(trim(coalesce(p_brand,'')), '') is null or cp.brand ilike '%' || trim(p_brand) || '%')
      and (p_currency is null or cp.currency = p_currency)
      and (p_min_price_minor is null or coalesce(cp.sale_price_minor,cp.price_minor) >= p_min_price_minor)
      and (p_max_price_minor is null or coalesce(cp.sale_price_minor,cp.price_minor) <= p_max_price_minor)
      and (not p_in_stock_only or fl.stock_quantity > 0)
      and (nullif(trim(coalesce(p_size,'')), '') is null or exists (
        select 1 from unnest(cp.sizes) as size_values(value)
        where size_values.value ilike trim(p_size)
      ))
      and (nullif(trim(coalesce(p_color,'')), '') is null or exists (
        select 1 from unnest(cp.colors) as color_values(value)
        where color_values.value ilike '%' || trim(p_color) || '%'
      ))
  ),
  nearest as (
    select * from candidates where location_rank = 1
  )
  select
    n.id,n.title,n.brand,n.description,n.department,n.category,n.gender,
    n.image_url,n.product_url,n.affiliate_url,n.price_minor,n.sale_price_minor,
    n.currency,n.availability,n.sizes,n.colors,n.retailer,n.retailer_country,
    n.ships_to,n.source_code,n.dispatch_city,n.dispatch_region,n.dispatch_country,
    n.distance_km,n.estimated_delivery_days,count(*) over() as total_count
  from nearest n
  order by n.distance_km asc, n.estimated_delivery_days asc nulls last
  limit greatest(1,least(coalesce(p_limit,24),100))
  offset greatest(0,least(coalesce(p_offset,0),1000000));
$$;

revoke all on function public.search_catalogue_products_nearby(
  text,text,char,double precision,double precision,text,char,bigint,bigint,boolean,text,text,integer,integer
) from public;
grant execute on function public.search_catalogue_products_nearby(
  text,text,char,double precision,double precision,text,char,bigint,bigint,boolean,text,text,integer,integer
) to anon, authenticated;

comment on table public.catalogue_fulfilment_locations is
  'Verified stock/dispatch locations supplied by authorised retailers or sellers. Buyer coordinates are not stored here.';
comment on function public.search_catalogue_products_nearby is
  'Returns only in-stock affiliate offers with verified, recently checked dispatch locations that explicitly ship to the buyer country, ranked by distance.';
