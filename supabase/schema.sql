-- Run this once in Supabase Dashboard > SQL Editor before deploying.
-- Application access uses a server-only database connection. Do not expose
-- database credentials or the Supabase service-role key in browser code.

create table if not exists public.users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null,
  image text not null,
  price numeric(12,2) not null check (price > 0),
  promo_price numeric(12,2) check (promo_price is null or (promo_price > 0 and promo_price < price)),
  badge text not null default '',
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id integer primary key check (id = 1),
  currency text not null default 'NGN',
  bank_name text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  payment_instructions text not null default '',
  shipping_fee numeric(12,2) not null default 3500 check (shipping_fee >= 0),
  free_shipping_threshold numeric(12,2) not null default 100000 check (free_shipping_threshold >= 0),
  store_name text not null default 'Forma'
);

create table if not exists public.orders (
  id uuid primary key,
  reference text not null unique,
  user_id uuid not null references public.users(id),
  customer_name text not null,
  customer_email text not null,
  phone text not null,
  address text not null,
  subtotal numeric(12,2) not null,
  shipping numeric(12,2) not null,
  total numeric(12,2) not null,
  currency text not null,
  status text not null default 'Awaiting payment',
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null
);

create table if not exists public.cart_items (
  user_id uuid not null references public.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 20),
  primary key (user_id, product_id)
);

create table if not exists public.subscribers (
  email text primary key,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_created_at_idx on public.orders(user_id, created_at desc);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.cart_items enable row level security;
alter table public.subscribers enable row level security;

insert into public.settings (id) values (1) on conflict (id) do nothing;
