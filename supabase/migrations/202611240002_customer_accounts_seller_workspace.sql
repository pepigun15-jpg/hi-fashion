-- HI FASHION customer accounts and seller workspace
-- Apply after 202611240001_commerce.sql.

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  country_code char(2),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  country_code char(2) not null,
  website text,
  category text not null,
  description text not null default '',
  status text not null default 'pending'
    check (status in ('pending','reviewing','approved','rejected')),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seller_applications_user_idx
  on public.seller_applications(user_id, created_at desc);

alter table public.customer_profiles enable row level security;
alter table public.seller_applications enable row level security;

drop policy if exists "Customers read their own profile" on public.customer_profiles;
create policy "Customers read their own profile"
  on public.customer_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Customers insert their own profile" on public.customer_profiles;
create policy "Customers insert their own profile"
  on public.customer_profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Customers update their own profile" on public.customer_profiles;
create policy "Customers update their own profile"
  on public.customer_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Sellers submit their own application" on public.seller_applications;
create policy "Sellers submit their own application"
  on public.seller_applications for insert to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and admin_notes is null
  );

drop policy if exists "Sellers read their own applications" on public.seller_applications;
create policy "Sellers read their own applications"
  on public.seller_applications for select to authenticated
  using (auth.uid() = user_id);

-- Only approved seller profiles can create and maintain marketplace listings.
drop policy if exists "Approved sellers create products" on public.products;
create policy "Approved sellers create products"
  on public.products for insert to authenticated
  with check (
    auth.uid() = seller_id
    and is_published = false
    and exists (
      select 1 from public.seller_profiles s
      where s.user_id = auth.uid()
        and s.is_approved = true
    )
  );

drop policy if exists "Approved sellers update products" on public.products;
create policy "Approved sellers update products"
  on public.products for update to authenticated
  using (
    auth.uid() = seller_id
    and exists (
      select 1 from public.seller_profiles s
      where s.user_id = auth.uid()
        and s.is_approved = true
    )
  )
  with check (
    auth.uid() = seller_id
    and exists (
      select 1 from public.seller_profiles s
      where s.user_id = auth.uid()
        and s.is_approved = true
    )
  );

drop policy if exists "Approved sellers delete products" on public.products;
create policy "Approved sellers delete products"
  on public.products for delete to authenticated
  using (
    auth.uid() = seller_id
    and exists (
      select 1 from public.seller_profiles s
      where s.user_id = auth.uid()
        and s.is_approved = true
    )
  );

-- No direct browser INSERT/UPDATE/DELETE on orders, order_items, gift cards,
-- payout identifiers or Stripe webhook records. Only Edge Functions use service_role.
