alter table public.catalogue_products
  add column if not exists last_seen_sync_run_id uuid references public.catalogue_sync_runs(id);

alter table public.catalogue_feed_cursors
  add column if not exists last_row_number bigint not null default 0,
  add column if not exists current_sync_run_id uuid references public.catalogue_sync_runs(id);

create index if not exists catalogue_products_sync_run_idx
  on public.catalogue_products(source_code,last_seen_sync_run_id);

-- Fix scalar aliases for size and colour matching and preserve the richer filter API.
drop function if exists public.search_catalogue_products(text,text,char,text,text,text,char,bigint,bigint,boolean,integer,integer);
drop function if exists public.search_catalogue_products(text,text,char,text,text,text,char,bigint,bigint,boolean,text,text,text,integer,integer);

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
  p_size text default null,
  p_color text default null,
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,title text,brand text,description text,department text,category text,gender text,
  image_url text,product_url text,affiliate_url text,price_minor bigint,sale_price_minor bigint,
  currency char(3),availability text,sizes text[],colors text[],retailer text,
  retailer_country char(2),ships_to char(2)[],source_code text,total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select nullif(trim(coalesce(p_query,'')), '') as query_text,
      case when nullif(trim(coalesce(p_query,'')), '') is null then null
      else websearch_to_tsquery('simple', trim(p_query)) end as query_ts
  ),
  matched as (
    select cp.*,
      case when p.query_text is null then 0::real else ts_rank_cd(cp.search_vector,p.query_ts) end as relevance
    from public.catalogue_products cp
    join public.catalogue_sources cs on cs.source_code=cp.source_code and cs.is_enabled=true
    cross join params p
    where cp.is_active=true
      and (p.query_text is null or cp.search_vector @@ p.query_ts
        or cp.title ilike '%'||p.query_text||'%' or cp.brand ilike '%'||p.query_text||'%'
        or cp.category ilike '%'||p.query_text||'%' or cp.department ilike '%'||p.query_text||'%'
        or cp.retailer ilike '%'||p.query_text||'%')
      and (nullif(trim(coalesce(p_category,'')),'') is null
        or cp.category ilike '%'||trim(p_category)||'%'
        or cp.department ilike '%'||trim(p_category)||'%'
        or array_to_string(cp.category_path,' ') ilike '%'||trim(p_category)||'%')
      and (nullif(trim(coalesce(p_gender,'')),'') is null or cp.gender ilike '%'||trim(p_gender)||'%')
      and (nullif(trim(coalesce(p_brand,'')),'') is null or cp.brand ilike '%'||trim(p_brand)||'%')
      and (nullif(trim(coalesce(p_retailer,'')),'') is null or cp.retailer ilike '%'||trim(p_retailer)||'%')
      and (p_currency is null or cp.currency=p_currency)
      and (p_min_price_minor is null or coalesce(cp.sale_price_minor,cp.price_minor)>=p_min_price_minor)
      and (p_max_price_minor is null or coalesce(cp.sale_price_minor,cp.price_minor)<=p_max_price_minor)
      and (not p_in_stock_only or cp.availability='in_stock')
      and (nullif(trim(coalesce(p_size,'')),'') is null or exists (
        select 1 from unnest(cp.sizes) as size_values(value) where size_values.value ilike trim(p_size)))
      and (nullif(trim(coalesce(p_color,'')),'') is null or exists (
        select 1 from unnest(cp.colors) as color_values(value) where color_values.value ilike '%'||trim(p_color)||'%'))
      and (p_country is null or cp.retailer_country=p_country
        or cardinality(cp.ships_to)=0 or p_country=any(cp.ships_to))
  )
  select m.id,m.title,m.brand,m.description,m.department,m.category,m.gender,
    m.image_url,m.product_url,m.affiliate_url,m.price_minor,m.sale_price_minor,m.currency,
    m.availability,m.sizes,m.colors,m.retailer,m.retailer_country,m.ships_to,m.source_code,
    count(*) over() as total_count
  from matched m
  order by
    case when coalesce(p_sort,'relevance')='price_asc' then coalesce(m.sale_price_minor,m.price_minor) end asc nulls last,
    case when coalesce(p_sort,'relevance')='price_desc' then coalesce(m.sale_price_minor,m.price_minor) end desc nulls last,
    case when coalesce(p_sort,'relevance')='newest' then extract(epoch from m.imported_at)::bigint end desc nulls last,
    case when coalesce(p_sort,'relevance')='relevance' then m.relevance end desc nulls last,
    m.imported_at desc
  limit greatest(1,least(coalesce(p_limit,24),100))
  offset greatest(0,least(coalesce(p_offset,0),1000000));
$$;
grant execute on function public.search_catalogue_products(text,text,char,text,text,text,char,bigint,bigint,boolean,text,text,text,integer,integer) to anon, authenticated;
