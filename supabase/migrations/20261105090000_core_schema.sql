-- Menyu core schema.
-- Conventions:
--   * Every tenant table carries restaurant_id; foreign keys between tenant
--     tables are composite (id, restaurant_id) so a row can never point at
--     another restaurant's data.
--   * Money is whole Ugandan shillings in integer columns named *_ugx.
--   * Business tables have created_at, updated_at and deleted_at (soft delete).
--     Append-only logs (events, audit_log, rate_limits) have no soft delete.
--   * Enumerations are text + check constraints so they are easy to evolve.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Utility functions
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Random code from an alphabet without look-alike characters (no 0/O, 1/I/L).
create or replace function private.random_code(p_length integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(p_length);
  v_out text := '';
  i integer;
begin
  for i in 0 .. p_length - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_out;
end;
$$;

create or replace function private.slugify(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
           regexp_replace(lower(extensions.unaccent(coalesce(p_value, ''))), '[^a-z0-9]+', '-', 'g'),
           '-{2,}', '-', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- People and platform
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  phone text,
  email text,
  locale text not null default 'en' check (locale in ('en', 'lg')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.plans (
  code text primary key check (code in ('free', 'standard', 'pro')),
  name text not null,
  price_monthly_ugx integer not null check (price_monthly_ugx >= 0),
  price_yearly_ugx integer check (price_yearly_ugx >= 0),
  price_per_branch boolean not null default false,
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  phone text check (phone ~ '^[0-9]{9,15}$'),
  code text not null unique check (code ~ '^[A-Z0-9]{3,12}$'),
  -- Null means "use the default flat commission from settings".
  commission_ugx integer check (commission_ugx >= 0),
  is_active boolean not null default true,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Restaurants, menus and branches
-- ---------------------------------------------------------------------------

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  description_lg text check (char_length(description_lg) <= 500),
  -- Processed image descriptors: {path, w, h, widths[], color, v}
  logo jsonb check (logo is null or jsonb_typeof(logo) = 'object'),
  cover jsonb check (cover is null or jsonb_typeof(cover) = 'object'),
  brand_color text not null default '#1E5B3A' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  cuisines text[] not null default '{}',
  price_range smallint check (price_range between 1 and 4),
  agent_id uuid references public.agents (id) on delete set null,
  referral_code text not null unique default private.random_code(6) check (referral_code ~ '^[A-Z0-9]{4,12}$'),
  referred_by uuid references public.restaurants (id) on delete set null,
  directory_status text not null default 'hidden'
    check (directory_status in ('hidden', 'pending', 'approved', 'rejected')),
  is_featured boolean not null default false,
  is_suspended boolean not null default false,
  -- Bumped whenever anything on the public menu changes (cache busting).
  content_version bigint not null default 1,
  menu_updated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (cardinality(cuisines) <= 8)
);

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null default 'Main menu' check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, restaurant_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_id uuid not null,
  name text check (char_length(name) <= 80),
  -- Slugs are never reused, even after deletion, so an old printed QR code
  -- can never open a different restaurant's menu.
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  area text check (char_length(area) <= 80),
  address text check (char_length(address) <= 200),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  phone text check (phone ~ '^[0-9]{9,15}$'),
  whatsapp text check (whatsapp ~ '^[0-9]{9,15}$'),
  momo_mtn_code text check (char_length(momo_mtn_code) <= 20),
  momo_mtn_name text check (char_length(momo_mtn_name) <= 80),
  momo_airtel_code text check (char_length(momo_airtel_code) <= 20),
  momo_airtel_name text check (char_length(momo_airtel_name) <= 80),
  -- {"mon": [["07:00","22:00"]], ..., "sun": []}; a close earlier than the
  -- open time means the range runs past midnight.
  opening_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(opening_hours) = 'object'),
  accepts_dine_in boolean not null default true,
  accepts_takeaway boolean not null default true,
  accepts_delivery boolean not null default false,
  delivery_note text check (char_length(delivery_note) <= 200),
  is_main boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, restaurant_id),
  foreign key (menu_id, restaurant_id) references public.menus (id, restaurant_id)
);

create unique index branches_one_main_per_restaurant
  on public.branches (restaurant_id) where is_main and deleted_at is null;
create index branches_restaurant on public.branches (restaurant_id);
create index branches_area on public.branches (lower(area)) where deleted_at is null;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  -- Staff can be limited to one branch; null means every branch.
  branch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id)
);

create unique index memberships_user_restaurant
  on public.memberships (user_id, restaurant_id) where deleted_at is null;
create index memberships_restaurant on public.memberships (restaurant_id) where deleted_at is null;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  branch_id uuid,
  phone text check (phone ~ '^[0-9]{9,15}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  -- Only a SHA-256 hash of the token is stored.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (phone is not null or email is not null),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id)
);

create index invitations_phone on public.invitations (phone) where accepted_at is null and deleted_at is null;
create index invitations_email on public.invitations (lower(email)) where accepted_at is null and deleted_at is null;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  name_lg text check (char_length(name_lg) <= 80),
  sort_order integer not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, restaurant_id),
  unique (id, menu_id),
  foreign key (menu_id, restaurant_id) references public.menus (id, restaurant_id) on delete cascade
);

create index categories_menu on public.categories (menu_id, sort_order) where deleted_at is null;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_id uuid not null,
  category_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  name_lg text check (char_length(name_lg) <= 120),
  description text check (char_length(description) <= 300),
  description_lg text check (char_length(description_lg) <= 300),
  -- Null when the item is priced only through its sizes.
  price_ugx integer check (price_ugx between 0 and 100000000),
  photo jsonb check (photo is null or jsonb_typeof(photo) = 'object'),
  tags text[] not null default '{}'
    check (tags <@ array['popular', 'spicy', 'vegetarian', 'new']::text[]),
  is_hidden boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, restaurant_id),
  foreign key (menu_id, restaurant_id) references public.menus (id, restaurant_id) on delete cascade,
  -- The item's category must belong to the same menu.
  foreign key (category_id, menu_id) references public.categories (id, menu_id) on delete cascade
);

create index items_category on public.items (category_id, sort_order) where deleted_at is null;
create index items_menu on public.items (menu_id) where deleted_at is null;
create index items_name_trgm on public.items using gin (name extensions.gin_trgm_ops) where deleted_at is null;

create table public.item_options (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id uuid not null,
  -- size: the full price of that size. addon: the extra price on top.
  kind text not null check (kind in ('size', 'addon')),
  name text not null check (char_length(name) between 1 and 60),
  name_lg text check (char_length(name_lg) <= 60),
  price_ugx integer not null check (price_ugx between 0 and 100000000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade
);

create index item_options_item on public.item_options (item_id, kind, sort_order) where deleted_at is null;

-- Sold-out is per branch, so branches sharing a menu can run out separately.
create table public.sold_out (
  branch_id uuid not null,
  item_id uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (branch_id, item_id),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade,
  foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade
);

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  label text not null check (char_length(label) between 1 and 40),
  -- Stable code used in the QR link (?t=code). Never changes after creation.
  code text not null check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(code) <= 24),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);

create unique index tables_branch_code on public.tables (branch_id, code) where deleted_at is null;

create table public.specials (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- Null means every branch.
  branch_id uuid,
  title text not null check (char_length(title) between 1 and 80),
  title_lg text check (char_length(title_lg) <= 80),
  description text check (char_length(description) <= 300),
  description_lg text check (char_length(description_lg) <= 300),
  price_ugx integer check (price_ugx between 0 and 100000000),
  -- ISO weekdays: 1 = Monday ... 7 = Sunday.
  days smallint[] not null default '{1,2,3,4,5,6,7}'
    check (cardinality(days) > 0 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- Africa/Kampala wall-clock times. start = end means all day; end < start
  -- runs past midnight.
  start_time time not null default '00:00',
  end_time time not null default '00:00',
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, restaurant_id),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade,
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.special_items (
  special_id uuid not null,
  item_id uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  quantity smallint not null default 1 check (quantity between 1 and 20),
  primary key (special_id, item_id),
  foreign key (special_id, restaurant_id) references public.specials (id, restaurant_id) on delete cascade,
  foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Operations: imports, feedback, analytics, setup requests
-- ---------------------------------------------------------------------------

create table public.menu_imports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_id uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  -- [{path, mime, size, name}]
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'needs_review', 'published', 'failed', 'discarded')),
  model text,
  ai_result jsonb,
  draft jsonb,
  error_code text,
  error_message text,
  usage jsonb,
  attempts integer not null default 0,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (menu_id, restaurant_id) references public.menus (id, restaurant_id) on delete cascade
);

create index menu_imports_restaurant on public.menu_imports (restaurant_id, created_at desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  table_code text check (char_length(table_code) <= 24),
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);

create index feedback_restaurant on public.feedback (restaurant_id, created_at desc) where deleted_at is null;

-- Anonymous diner analytics. No personal data: session_id is a random id
-- generated per visit in the browser.
create table public.events (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  type text not null check (type in (
    'menu_view', 'item_view', 'whatsapp_order', 'order_copy',
    'waiter_call', 'bill_request', 'momo_view'
  )),
  table_code text check (char_length(table_code) <= 24),
  item_id uuid,
  session_id text check (char_length(session_id) <= 40),
  occurred_at timestamptz not null default now(),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);

create index events_restaurant_time on public.events (restaurant_id, occurred_at desc);
create index events_branch_type_time on public.events (branch_id, type, occurred_at desc);
create index events_time on public.events (occurred_at desc);

create table public.setup_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  -- setup: "Send it to us" during onboarding. change: Free plan edit request.
  kind text not null default 'setup' check (kind in ('setup', 'change')),
  requested_by uuid references auth.users (id) on delete set null default auth.uid(),
  contact_name text check (char_length(contact_name) <= 120),
  contact_phone text check (contact_phone ~ '^[0-9]{9,15}$'),
  notes text check (char_length(notes) <= 2000),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  status text not null default 'new' check (status in ('new', 'in_progress', 'done', 'cancelled')),
  assigned_to uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index setup_requests_status on public.setup_requests (status, created_at) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------

-- One row per restaurant holding its current billing state. History lives in
-- payments and audit_log.
create table public.subscriptions (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  -- The plan the restaurant pays for (or trials). When status is 'free' the
  -- effective plan is Free, but this keeps what they had so nothing is lost.
  plan text not null default 'standard' references public.plans (code),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  status text not null default 'trial' check (status in ('trial', 'active', 'overdue', 'free')),
  trial_ends_at timestamptz,
  paid_until timestamptz,
  grace_days integer not null default 7 check (grace_days between 0 and 90),
  setup_fee_ugx integer check (setup_fee_ugx >= 0),
  status_changed_at timestamptz not null default now(),
  last_reminder_at timestamptz,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind text not null default 'subscription' check (kind in ('subscription', 'setup_fee', 'other')),
  amount_ugx integer not null check (amount_ugx > 0),
  method text not null check (method in ('mtn_momo', 'airtel_money', 'cash', 'bank', 'card', 'other')),
  provider text not null default 'manual' check (provider in ('manual', 'flutterwave', 'pesapal')),
  transaction_id text check (char_length(transaction_id) <= 80),
  provider_ref text check (char_length(provider_ref) <= 120),
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  plan text references public.plans (code),
  billing_interval text check (billing_interval in ('month', 'year')),
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id) on delete set null,
  notes text check (char_length(notes) <= 500),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- The same MoMo transaction can never be recorded twice.
create unique index payments_transaction_unique
  on public.payments (method, transaction_id) where transaction_id is not null and deleted_at is null;
create unique index payments_provider_ref_unique
  on public.payments (provider, provider_ref) where provider_ref is not null and deleted_at is null;
create index payments_restaurant on public.payments (restaurant_id, paid_at desc);

-- One flat commission per restaurant, earned on its first payment.
create table public.agent_commissions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  restaurant_id uuid not null unique references public.restaurants (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  amount_ugx integer not null check (amount_ugx >= 0),
  earned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.agent_payouts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  amount_ugx integer not null check (amount_ugx > 0),
  method text check (method in ('mtn_momo', 'airtel_money', 'cash', 'bank', 'other')),
  transaction_id text check (char_length(transaction_id) <= 80),
  paid_at timestamptz not null default now(),
  notes text check (char_length(notes) <= 500),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.restaurants (id) on delete cascade,
  referred_id uuid not null unique references public.restaurants (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'void')),
  qualifying_payment_id uuid references public.payments (id) on delete set null,
  reward_months integer not null default 1 check (reward_months between 0 and 12),
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referrer_id <> referred_id)
);

-- ---------------------------------------------------------------------------
-- Infrastructure
-- ---------------------------------------------------------------------------

-- Fixed-window counters used by rate limits on public endpoints and AI import.
create table public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_restaurant on public.audit_log (restaurant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'settings', 'plans', 'agents', 'restaurants', 'menus', 'branches',
    'memberships', 'invitations', 'categories', 'items', 'item_options', 'tables',
    'specials', 'menu_imports', 'feedback', 'setup_requests', 'subscriptions',
    'payments', 'agent_commissions', 'agent_payouts', 'referrals'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- Any change that affects a public menu bumps the restaurant's content
-- version (used by the diner page cache) and, for menu content, the
-- "last menu update" time the admin sees.
create or replace function private.on_content_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid;
begin
  if tg_op = 'DELETE' then
    v_restaurant_id := old.restaurant_id;
  else
    v_restaurant_id := new.restaurant_id;
  end if;

  update public.restaurants
     set content_version = content_version + 1,
         menu_updated_at = case
           when tg_table_name in ('categories', 'items', 'item_options') then now()
           else menu_updated_at
         end
   where id = v_restaurant_id;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'branches', 'categories', 'items', 'item_options', 'sold_out', 'tables', 'specials', 'special_items'
  ] loop
    execute format(
      'create trigger content_changed after insert or update or delete on public.%I for each row execute function private.on_content_change()',
      t
    );
  end loop;
end;
$$;

-- Profile edits (name, logo, colours...) also change the public page.
create or replace function private.bump_restaurant_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content_version = old.content_version then
    new.content_version := old.content_version + 1;
  end if;
  return new;
end;
$$;

create trigger bump_version before update on public.restaurants
  for each row execute function private.bump_restaurant_version();

-- Keep a profile row for every auth user.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone, email, full_name)
  values (new.id, new.phone, new.email, nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_contact_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set phone = new.phone,
         email = new.email
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_contact_changed
  after update of phone, email on auth.users
  for each row execute function private.handle_user_contact_change();
