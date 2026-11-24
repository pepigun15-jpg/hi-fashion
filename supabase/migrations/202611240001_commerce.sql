-- HI FASHION commerce foundation
-- Apply with Supabase CLI: supabase db push
-- Prices are integer minor units (EUR cents). Never accept client-supplied prices.

create extension if not exists pgcrypto;

create table if not exists public.seller_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null,
  country_code char(2) not null,
  stripe_account_id text unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles(user_id),
  slug text not null unique,
  name text not null,
  description text not null default '',
  category text not null,
  image_url text,
  currency char(3) not null default 'EUR',
  price_minor integer not null check (price_minor > 0),
  stock integer not null default 0 check (stock >= 0),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_public_catalog_idx
  on public.products(category, created_at desc)
  where is_published = true;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  seller_id uuid references public.seller_profiles(user_id),
  customer_email text not null,
  customer_name text not null,
  currency char(3) not null default 'EUR',
  subtotal_minor integer not null check (subtotal_minor >= 0),
  shipping_minor integer not null default 0 check (shipping_minor >= 0),
  tax_minor integer not null default 0 check (tax_minor >= 0),
  total_minor integer not null check (total_minor >= 0),
  status text not null default 'pending'
    check (status in ('pending','paid','processing','shipped','delivered','cancelled','refunded','payment_failed')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_account_id text,
  shipping_address jsonb not null default '{}'::jsonb,
  inventory_reserved boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists orders_buyer_idx on public.orders(user_id, created_at desc);
create index if not exists orders_seller_idx on public.orders(seller_id, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  line_type text not null check (line_type in ('product','gift_card')),
  name_snapshot text not null,
  quantity integer not null check (quantity between 1 and 20),
  unit_amount_minor integer not null check (unit_amount_minor > 0),
  currency char(3) not null default 'EUR',
  recipient_name text,
  recipient_email text,
  gift_message text,
  created_at timestamptz not null default now(),
  check (
    (line_type = 'product' and product_id is not null and recipient_email is null)
    or
    (line_type = 'gift_card' and product_id is null and recipient_email is not null)
  )
);

create index if not exists order_items_order_idx on public.order_items(order_id);

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  order_item_id uuid not null unique references public.order_items(id),
  code_hash text not null unique,
  encrypted_code text,
  currency char(3) not null default 'EUR',
  initial_balance_minor integer not null check (initial_balance_minor > 0),
  balance_minor integer not null check (balance_minor >= 0),
  status text not null default 'active' check (status in ('active','exhausted','disabled')),
  recipient_name text not null,
  recipient_email text not null,
  gift_message text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id),
  order_id uuid references public.orders(id),
  transaction_type text not null check (transaction_type in ('issued','redeemed','refund','adjustment')),
  amount_minor integer not null check (amount_minor <> 0),
  currency char(3) not null default 'EUR',
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create table if not exists public.wishlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, product_id)
);

-- Stock is reserved atomically before a Stripe Checkout Session is created.
-- On session expiry/cancellation, release_order_inventory() restores stock once.
create or replace function public.reserve_order_inventory(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  perform 1 from public.orders where id = p_order_id for update;
  if not found then return false; end if;

  if (select inventory_reserved from public.orders where id = p_order_id) then
    return true;
  end if;

  for v_item in
    select product_id, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and line_type = 'product'
    group by product_id
    order by product_id
  loop
    perform 1 from public.products
      where id = v_item.product_id and is_published = true
      and stock >= v_item.quantity
      for update;
    if not found then
      raise exception 'INSUFFICIENT_STOCK';
    end if;
  end loop;

  for v_item in
    select product_id, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and line_type = 'product'
    group by product_id
  loop
    update public.products
    set stock = stock - v_item.quantity, updated_at = now()
    where id = v_item.product_id;
  end loop;

  update public.orders set inventory_reserved = true, updated_at = now()
  where id = p_order_id;
  return true;
end;
$$;

create or replace function public.release_order_inventory(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  perform 1 from public.orders where id = p_order_id for update;
  if not found then return false; end if;

  if not (select inventory_reserved from public.orders where id = p_order_id) then
    return true;
  end if;

  for v_item in
    select product_id, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and line_type = 'product'
    group by product_id
  loop
    update public.products
    set stock = stock + v_item.quantity, updated_at = now()
    where id = v_item.product_id;
  end loop;

  update public.orders set inventory_reserved = false, updated_at = now()
  where id = p_order_id;
  return true;
end;
$$;

revoke all on function public.reserve_order_inventory(uuid) from public, anon, authenticated;
revoke all on function public.release_order_inventory(uuid) from public, anon, authenticated;
grant execute on function public.reserve_order_inventory(uuid) to service_role;
grant execute on function public.release_order_inventory(uuid) to service_role;

alter table public.seller_profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.gift_cards enable row level security;
alter table public.gift_card_transactions enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.wishlists enable row level security;

drop policy if exists "Public can view published products" on public.products;
create policy "Public can view published products"
  on public.products for select to anon, authenticated
  using (is_published = true);

drop policy if exists "Sellers can view their own profile" on public.seller_profiles;
create policy "Sellers can view their own profile"
  on public.seller_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Sellers can view their own products" on public.products;
create policy "Sellers can view their own products"
  on public.products for select to authenticated
  using (auth.uid() = seller_id);

drop policy if exists "Sellers can view their own orders" on public.orders;
create policy "Sellers can view their own orders"
  on public.orders for select to authenticated
  using (auth.uid() = seller_id);

drop policy if exists "Buyers can view their own orders" on public.orders;
create policy "Buyers can view their own orders"
  on public.orders for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Order participants can view order items" on public.order_items;
create policy "Order participants can view order items"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.user_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

drop policy if exists "Users manage their own wishlist" on public.wishlists;
create policy "Users manage their own wishlist"
  on public.wishlists for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No client role can read gift-card hashes/balances, mutate orders, or touch webhook events.
-- Service-role Edge Functions perform those operations after verifying Stripe events.
