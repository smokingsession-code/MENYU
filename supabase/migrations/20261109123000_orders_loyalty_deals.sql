-- How diners order (show a waiter, WhatsApp or the kitchen screen), pay
-- with cash, loyalty stamps, "Sell it today" deals, sales in insights, and
-- deals and rankings in the directory.

-- ---------------------------------------------------------------------------
-- Ordering settings per branch.
--   waiter:   the diner shows the order on their phone to a waiter
--   whatsapp: the order is sent to the branch's WhatsApp
--   kitchen:  the order goes to the kitchen screen (plans with "kitchen")
-- ---------------------------------------------------------------------------
alter table public.branches
  add column order_mode text not null default 'whatsapp' check (order_mode in ('waiter', 'whatsapp', 'kitchen')),
  add column accepts_cash boolean not null default true;

grant update (order_mode, accepts_cash) on public.branches to authenticated;

-- Loyalty stamps, for the whole restaurant (every branch fills the same card).
alter table public.restaurants
  add column loyalty_enabled boolean not null default false,
  add column loyalty_visits smallint not null default 5 check (loyalty_visits between 2 and 20),
  add column loyalty_reward text check (char_length(loyalty_reward) <= 80),
  add column loyalty_reward_lg text check (char_length(loyalty_reward_lg) <= 80),
  -- Orders below this total earn no stamp.
  add column loyalty_min_ugx integer not null default 0 check (loyalty_min_ugx between 0 and 10000000),
  add constraint restaurants_loyalty_reward check (not loyalty_enabled or nullif(btrim(loyalty_reward), '') is not null);

grant update (loyalty_enabled, loyalty_visits, loyalty_reward, loyalty_reward_lg, loyalty_min_ugx)
  on public.restaurants to authenticated;

-- ---------------------------------------------------------------------------
-- "Sell it today": a discount on one dish at one branch until a time today.
-- ---------------------------------------------------------------------------
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  item_id uuid not null,
  percent_off smallint not null check (percent_off between 5 and 90),
  note text check (char_length(note) <= 120),
  note_lg text check (char_length(note_lg) <= 120),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at >= starts_at and ends_at <= starts_at + interval '24 hours'),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade,
  foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade
);

create index deals_branch_live on public.deals (branch_id, ends_at desc) where deleted_at is null;
create index deals_restaurant on public.deals (restaurant_id, created_at desc);

create trigger content_changed after insert or update or delete on public.deals
  for each row execute function private.on_content_change();

-- ---------------------------------------------------------------------------
-- Orders placed from the menu. Prices are always worked out here from the
-- menu, never taken from the phone.
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  -- Made by the diner's phone: sending the same order again updates it
  -- instead of adding another, and lets the phone follow a kitchen order.
  client_ref text not null check (client_ref ~ '^[A-Za-z0-9_-]{12,40}$'),
  -- Kitchen orders only: 1, 2, 3... each Kampala day, per branch.
  number integer check (number > 0),
  local_date date not null,
  mode text not null check (mode in ('waiter', 'whatsapp', 'kitchen')),
  order_type text not null check (order_type in ('dine_in', 'takeaway', 'delivery')),
  table_code text check (char_length(table_code) <= 24),
  table_label text check (char_length(table_label) <= 40),
  customer_name text check (char_length(customer_name) <= 80),
  address text check (char_length(address) <= 300),
  payment text check (payment in ('momo', 'cash')),
  -- [{item_id?, special_id?, name, size?, addons[], qty, unit, total, note?, percent_off?}]
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  item_count integer not null check (item_count between 1 and 200),
  total_ugx integer not null check (total_ugx between 0 and 100000000),
  -- sent: shown to a waiter or sent on WhatsApp (a record only).
  -- Kitchen orders: new -> cooking -> ready -> done, or cancelled.
  status text not null check (status in ('sent', 'new', 'cooking', 'ready', 'done', 'cancelled')),
  status_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, client_ref),
  unique (branch_id, local_date, number),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);

create index orders_restaurant_time on public.orders (restaurant_id, created_at desc);
create index orders_branch_day on public.orders (branch_id, local_date);
create index orders_kitchen on public.orders (branch_id, created_at)
  where mode = 'kitchen' and status in ('new', 'cooking', 'ready');

create trigger set_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create or replace function private.on_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_at := now();
  end if;
  return new;
end;
$$;

create trigger order_status before update on public.orders
  for each row execute function private.on_order_status();

-- ---------------------------------------------------------------------------
-- Loyalty cards. A diner's phone keeps a random id; only its SHA-256 is
-- stored here. At most one stamp a day per card.
-- ---------------------------------------------------------------------------
create table public.loyalty_cards (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  stamps smallint not null default 0 check (stamps between 0 and 20),
  last_stamp_on date,
  rewards_used integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, device_hash)
);

create trigger set_updated_at before update on public.loyalty_cards
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security and privileges for the new tables.
-- ---------------------------------------------------------------------------
alter table public.deals enable row level security;
alter table public.orders enable row level security;
alter table public.loyalty_cards enable row level security;

grant select on public.deals, public.orders, public.loyalty_cards to authenticated;
grant insert (restaurant_id, branch_id, item_id, percent_off, note, note_lg, ends_at) on public.deals to authenticated;
grant update (ends_at, deleted_at) on public.deals to authenticated;
grant update (status) on public.orders to authenticated;

-- Owners, and staff for their branch, work with orders (the kitchen screen).
create or replace function private.can_work_branch(p_restaurant_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or exists (
        select 1
          from public.memberships m
         where m.user_id = (select auth.uid())
           and m.restaurant_id = p_restaurant_id
           and m.deleted_at is null
           and (
             m.role = 'owner'
             or (m.role = 'staff'
                 and private.plan_allows(p_restaurant_id, 'staff')
                 and (m.branch_id is null or m.branch_id = p_branch_id))
           )
      );
$$;

create policy deals_select on public.deals for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy deals_insert on public.deals for insert to authenticated
  with check (private.can_edit_menu(restaurant_id) and private.plan_allows(restaurant_id, 'specials'));
create policy deals_update on public.deals for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id));

create policy orders_select on public.orders for select to authenticated
  using (private.can_work_branch(restaurant_id, branch_id));
create policy orders_update on public.orders for update to authenticated
  using (mode = 'kitchen' and private.can_work_branch(restaurant_id, branch_id) and private.plan_allows(restaurant_id, 'kitchen'))
  with check (mode = 'kitchen' and status in ('new', 'cooking', 'ready', 'done', 'cancelled'));

create policy loyalty_cards_select on public.loyalty_cards for select to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The way a branch takes orders right now. Kitchen needs a plan with the
-- kitchen screen and WhatsApp needs a number; otherwise WhatsApp (if there
-- is a number) or showing a waiter.
create or replace function private.order_mode(p_mode text, p_whatsapp text, p_restaurant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_mode = 'kitchen' and private.plan_allows(p_restaurant_id, 'kitchen') then 'kitchen'
    when p_mode in ('whatsapp', 'kitchen') and p_whatsapp is not null then 'whatsapp'
    else 'waiter'
  end;
$$;

-- A deal price: the discount, rounded to the nearest UGX 100. Must match
-- dealPrice() in src/lib/deals.ts.
create or replace function private.deal_price(p_price integer, p_percent integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (round(p_price::numeric * (100 - p_percent) / 10000) * 100)::integer;
$$;

-- Whether a special is on at a moment, in Kampala time. Must match
-- specialOnAt() in src/lib/specials.ts.
create or replace function private.special_on_at(
  p_days smallint[], p_start time, p_end time, p_starts_on date, p_ends_on date, p_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  with k as (
    select (p_at at time zone 'Africa/Kampala') as local
  ), c as (
    select local::date as d,
           extract(isodow from local)::smallint as dow,
           local::time as t,
           (local - interval '1 day')::date as yd,
           extract(isodow from local - interval '1 day')::smallint as ydow
      from k
  )
  select case
    when p_start = p_end then
      c.dow = any (p_days) and (p_starts_on is null or c.d >= p_starts_on) and (p_ends_on is null or c.d <= p_ends_on)
    when p_start < p_end then
      c.dow = any (p_days) and c.t >= p_start and c.t < p_end
        and (p_starts_on is null or c.d >= p_starts_on) and (p_ends_on is null or c.d <= p_ends_on)
    when c.t >= p_start then
      c.dow = any (p_days) and (p_starts_on is null or c.d >= p_starts_on) and (p_ends_on is null or c.d <= p_ends_on)
    when c.t < p_end then
      c.ydow = any (p_days) and (p_starts_on is null or c.yd >= p_starts_on) and (p_ends_on is null or c.yd <= p_ends_on)
    else false
  end
  from c;
$$;

create or replace function private.order_json(o public.orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ref', o.client_ref, 'number', o.number, 'mode', o.mode, 'status', o.status, 'status_at', o.status_at,
    'total', o.total_ugx, 'item_count', o.item_count, 'lines', o.lines, 'created_at', o.created_at
  );
$$;

create or replace function private.loyalty_json(p_card public.loyalty_cards, p_visits integer, p_earned boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'stamps', least(coalesce(p_card.stamps, 0), p_visits),
    'visits', p_visits,
    'ready', coalesce(p_card.stamps, 0) >= p_visits,
    'earned', p_earned,
    'stamped_today', coalesce(p_card.last_stamp_on = (now() at time zone 'Africa/Kampala')::date, false),
    'last_used_at', p_card.last_used_at
  );
$$;

-- Adds today's stamp to a card (at most one a day, none while a reward waits).
create or replace function private.stamp_loyalty(p_restaurant_id uuid, p_visits integer, p_device_hash text, p_eligible boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_card public.loyalty_cards%rowtype;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
  v_earned boolean := false;
begin
  insert into public.loyalty_cards (restaurant_id, device_hash) values (p_restaurant_id, p_device_hash)
  on conflict do nothing;
  select * into v_card from public.loyalty_cards
   where restaurant_id = p_restaurant_id and device_hash = p_device_hash
   for update;
  if p_eligible and (v_card.last_stamp_on is null or v_card.last_stamp_on < v_today) and v_card.stamps < p_visits then
    update public.loyalty_cards
       set stamps = stamps + 1, last_stamp_on = v_today
     where restaurant_id = p_restaurant_id and device_hash = p_device_hash
    returning * into v_card;
    v_earned := true;
  end if;
  return private.loyalty_json(v_card, p_visits, v_earned);
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order: called by the rate-limited /api/orders route (service role).
-- p: slug, ref, mode (waiter | whatsapp | kitchen), type, table (QR code),
-- table_label (typed), name, address, payment (momo | cash) and lines
-- [{i: item id or "special:<id>", s: size option id, a: [add-on ids], q, n}].
-- Returns {result, ...}: ok (with order and loyalty), sold_out (with items),
-- changed (the menu changed: reload), mode_changed, invalid, too_many,
-- not_found or not_available.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(p jsonb, p_rate_key text default null, p_device_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_branch public.branches%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_mode text := p ->> 'mode';
  v_ref text := p ->> 'ref';
  v_type text := coalesce(p ->> 'type', 'dine_in');
  v_payment text := p ->> 'payment';
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Africa/Kampala')::date;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_sold_out text[] := '{}';
  v_count integer := 0;
  v_total bigint := 0;
  v_qty integer;
  v_id text;
  v_item public.items%rowtype;
  v_size public.item_options%rowtype;
  v_special public.specials%rowtype;
  v_addon_input jsonb;
  v_addon_ids uuid[];
  v_addons jsonb;
  v_addon_sum integer;
  v_addon_count integer;
  v_base integer;
  v_unit integer;
  v_percent smallint;
  v_name text;
  v_note text;
  v_table_code text;
  v_table_label text;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_number integer;
  v_status text;
  v_loyalty jsonb;
begin
  select b.* into v_branch from public.branches b where b.slug = lower(btrim(p ->> 'slug')) and b.deleted_at is null;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_branch.restaurant_id and r.deleted_at is null and not r.is_suspended;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if v_restaurant.is_demo or not private.plan_allows(v_restaurant.id, 'whatsapp_ordering') then
    return jsonb_build_object('result', 'not_available');
  end if;

  if v_ref is null or v_ref !~ '^[A-Za-z0-9_-]{12,40}$' or v_type not in ('dine_in', 'takeaway', 'delivery')
     or jsonb_typeof(p -> 'lines') is distinct from 'array'
     or jsonb_array_length(p -> 'lines') not between 1 and 50 then
    return jsonb_build_object('result', 'invalid');
  end if;
  if v_payment is not null and v_payment not in ('momo', 'cash') then
    v_payment := null;
  end if;

  -- The branch may have changed how it takes orders since the page loaded.
  if not (
       (v_mode = 'kitchen' and v_type <> 'delivery'
          and private.order_mode(v_branch.order_mode, v_branch.whatsapp, v_restaurant.id) = 'kitchen')
    or (v_mode = 'waiter' and v_type <> 'delivery'
          and private.order_mode(v_branch.order_mode, v_branch.whatsapp, v_restaurant.id) = 'waiter')
    or (v_mode = 'whatsapp' and v_branch.whatsapp is not null)
  ) then
    return jsonb_build_object('result', 'mode_changed');
  end if;

  -- Generous per phone and per network (a busy restaurant's Wi-Fi is one
  -- address); kitchen orders have their own limits below.
  if p_rate_key is not null and not public.rate_limit_hit('ord:' || p_rate_key || ':' || v_branch.id, 60, 600) then
    return jsonb_build_object('result', 'too_many');
  end if;
  if p_device_hash is not null and not public.rate_limit_hit('ordd:' || left(p_device_hash, 16) || ':' || v_branch.id, 30, 600) then
    return jsonb_build_object('result', 'too_many');
  end if;

  for v_line in select value from jsonb_array_elements(p -> 'lines') loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      return jsonb_build_object('result', 'invalid');
    end if;
    v_id := v_line ->> 'i';
    v_qty := case when (v_line ->> 'q') ~ '^[0-9]{1,2}$' then (v_line ->> 'q')::integer else 0 end;
    if v_id is null or v_qty < 1 or v_qty > 99 then
      return jsonb_build_object('result', 'invalid');
    end if;
    v_note := nullif(left(regexp_replace(btrim(coalesce(v_line ->> 'n', '')), '\s+', ' ', 'g'), 120), '');

    if v_id like 'special:%' then
      if substr(v_id, 9) !~ c_uuid then
        return jsonb_build_object('result', 'invalid');
      end if;
      select sp.* into v_special
        from public.specials sp
       where sp.id = substr(v_id, 9)::uuid and sp.restaurant_id = v_restaurant.id
         and (sp.branch_id is null or sp.branch_id = v_branch.id)
         and sp.is_active and sp.deleted_at is null and sp.price_ugx is not null;
      -- A little grace: the diner may have added it just before it ended.
      if not found or not private.plan_allows(v_restaurant.id, 'specials')
         or not (private.special_on_at(v_special.days, v_special.start_time, v_special.end_time, v_special.starts_on, v_special.ends_on, v_now)
                 or private.special_on_at(v_special.days, v_special.start_time, v_special.end_time, v_special.starts_on, v_special.ends_on, v_now - interval '15 minutes')) then
        return jsonb_build_object('result', 'changed');
      end if;
      select v_special.title || coalesce(' (' || string_agg(i.name, ', ' order by i.sort_order, i.name) || ')', '')
        into v_name
        from public.special_items si
        join public.items i on i.id = si.item_id and i.deleted_at is null
       where si.special_id = v_special.id;
      v_unit := v_special.price_ugx;
      v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'special_id', v_special.id, 'name', coalesce(v_name, v_special.title), 'addons', '[]'::jsonb,
        'qty', v_qty, 'unit', v_unit, 'total', v_unit * v_qty, 'note', v_note
      )));
    else
      if v_id !~ c_uuid then
        return jsonb_build_object('result', 'invalid');
      end if;
      select i.* into v_item
        from public.items i
        join public.categories c on c.id = i.category_id
       where i.id = v_id::uuid and i.menu_id = v_branch.menu_id
         and i.deleted_at is null and not i.is_hidden
         and c.deleted_at is null and not c.is_hidden;
      if not found then
        return jsonb_build_object('result', 'changed');
      end if;
      if exists (select 1 from public.sold_out so where so.branch_id = v_branch.id and so.item_id = v_item.id) then
        v_sold_out := v_sold_out || v_item.name;
        continue;
      end if;

      -- A size replaces the base price; add-ons go on top.
      if exists (select 1 from public.item_options o where o.item_id = v_item.id and o.kind = 'size' and o.deleted_at is null) then
        if coalesce(v_line ->> 's', '') !~ c_uuid then
          return jsonb_build_object('result', 'changed');
        end if;
        select o.* into v_size
          from public.item_options o
         where o.id = (v_line ->> 's')::uuid and o.item_id = v_item.id and o.kind = 'size' and o.deleted_at is null;
        if not found then
          return jsonb_build_object('result', 'changed');
        end if;
        v_base := v_size.price_ugx;
      else
        if v_line ->> 's' is not null or v_item.price_ugx is null then
          return jsonb_build_object('result', 'changed');
        end if;
        v_size := null;
        v_base := v_item.price_ugx;
      end if;

      v_addon_input := case when jsonb_typeof(v_line -> 'a') = 'array' then v_line -> 'a' else '[]'::jsonb end;
      if jsonb_array_length(v_addon_input) > 20 then
        return jsonb_build_object('result', 'invalid');
      end if;
      v_addon_ids := array(
        select distinct x::uuid from jsonb_array_elements_text(v_addon_input) x where x ~ c_uuid
      );
      select count(*), coalesce(sum(o.price_ugx), 0), coalesce(jsonb_agg(o.name order by o.sort_order, o.created_at), '[]'::jsonb)
        into v_addon_count, v_addon_sum, v_addons
        from public.item_options o
       where o.id = any (v_addon_ids) and o.item_id = v_item.id and o.kind = 'addon' and o.deleted_at is null;
      if v_addon_count <> cardinality(v_addon_ids) or cardinality(v_addon_ids) <> jsonb_array_length(v_addon_input) then
        return jsonb_build_object('result', 'changed');
      end if;

      -- A live "Sell it today" deal (with the same grace as specials).
      v_percent := null;
      if private.plan_allows(v_restaurant.id, 'specials') then
        select d.percent_off into v_percent
          from public.deals d
         where d.branch_id = v_branch.id and d.item_id = v_item.id and d.deleted_at is null
           and d.starts_at <= v_now and d.ends_at > v_now - interval '15 minutes'
         order by d.percent_off desc
         limit 1;
      end if;
      if v_percent is not null then
        v_base := private.deal_price(v_base, v_percent);
      end if;

      v_unit := v_base + v_addon_sum;
      v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'item_id', v_item.id, 'name', v_item.name, 'size', v_size.name, 'addons', v_addons,
        'qty', v_qty, 'unit', v_unit, 'total', v_unit * v_qty, 'note', v_note, 'percent_off', v_percent
      )));
    end if;
    v_count := v_count + v_qty;
    v_total := v_total + v_unit::bigint * v_qty;
  end loop;

  if cardinality(v_sold_out) > 0 then
    return jsonb_build_object('result', 'sold_out', 'items', to_jsonb(v_sold_out));
  end if;
  if v_count > 200 or v_total > 100000000 then
    return jsonb_build_object('result', 'invalid');
  end if;

  -- The table: the QR code's table if it is real, or what the diner typed.
  if v_type = 'dine_in' then
    v_table_code := case when (p ->> 'table') ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(p ->> 'table') <= 24 then p ->> 'table' end;
    if v_table_code is not null then
      select t.label into v_table_label from public.tables t
       where t.branch_id = v_branch.id and t.code = v_table_code and t.deleted_at is null;
      if not found then
        v_table_code := null;
      end if;
    end if;
    v_table_label := coalesce(nullif(left(regexp_replace(btrim(coalesce(p ->> 'table_label', '')), '\s+', ' ', 'g'), 40), ''), v_table_label);
  end if;

  select o.* into v_existing from public.orders o where o.branch_id = v_branch.id and o.client_ref = v_ref;
  if found and v_existing.mode = 'kitchen' then
    -- Kitchen orders are final once sent: sending again is a retry.
    v_order := v_existing;
  else
    v_status := 'sent';
    v_number := v_existing.number;
    if v_mode = 'kitchen' then
      v_status := 'new';
      if p_rate_key is not null and not public.rate_limit_hit('ordk:' || p_rate_key || ':' || v_branch.id, 20, 600) then
        return jsonb_build_object('result', 'too_many');
      end if;
      if not public.rate_limit_hit('ordk:b:' || v_branch.id, 400, 3600) then
        return jsonb_build_object('result', 'too_many');
      end if;
      -- One number at a time per branch.
      perform pg_advisory_xact_lock(hashtextextended('orders:' || v_branch.id::text, 0));
      select coalesce(max(o.number), 0) + 1 into v_number
        from public.orders o
       where o.branch_id = v_branch.id and o.local_date = v_today and o.number is not null;
    end if;

    if v_existing.id is not null then
      update public.orders
         set mode = v_mode, order_type = v_type, number = v_number, status = v_status,
             table_code = v_table_code, table_label = v_table_label,
             customer_name = nullif(left(btrim(coalesce(p ->> 'name', '')), 80), ''),
             address = case when v_type = 'delivery' then nullif(left(btrim(coalesce(p ->> 'address', '')), 300), '') end,
             payment = v_payment, lines = v_lines, item_count = v_count, total_ugx = v_total
       where id = v_existing.id
      returning * into v_order;
    else
      insert into public.orders (
        restaurant_id, branch_id, client_ref, number, local_date, mode, order_type, table_code, table_label,
        customer_name, address, payment, lines, item_count, total_ugx, status
      )
      values (
        v_restaurant.id, v_branch.id, v_ref, v_number, v_today, v_mode, v_type, v_table_code, v_table_label,
        nullif(left(btrim(coalesce(p ->> 'name', '')), 80), ''),
        case when v_type = 'delivery' then nullif(left(btrim(coalesce(p ->> 'address', '')), 300), '') end,
        v_payment, v_lines, v_count, v_total, v_status
      )
      on conflict (branch_id, client_ref) do nothing
      returning * into v_order;
      if v_order.id is null then
        -- Sent twice at the same moment: the first one counts.
        select o.* into v_order from public.orders o where o.branch_id = v_branch.id and o.client_ref = v_ref;
      end if;
    end if;
  end if;

  if p_device_hash ~ '^[0-9a-f]{64}$' and v_restaurant.loyalty_enabled and private.plan_allows(v_restaurant.id, 'loyalty') then
    v_loyalty := private.stamp_loyalty(v_restaurant.id, v_restaurant.loyalty_visits, p_device_hash, v_order.total_ugx >= v_restaurant.loyalty_min_ugx);
  end if;

  return jsonb_build_object('result', 'ok', 'order', private.order_json(v_order), 'loyalty', v_loyalty);
end;
$$;

-- The diner's phone following its kitchen order.
create or replace function public.order_status(p_slug text, p_ref text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.order_json(o)
    from public.orders o
    join public.branches b on b.id = o.branch_id
   where b.slug = lower(btrim(p_slug)) and o.client_ref = p_ref;
$$;

-- The diner's loyalty card (null when the restaurant has no loyalty stamps).
create or replace function public.loyalty_status(p_slug text, p_device_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_card public.loyalty_cards%rowtype;
begin
  select r.* into v_restaurant
    from public.restaurants r
    join public.branches b on b.restaurant_id = r.id and b.deleted_at is null
   where b.slug = lower(btrim(p_slug)) and r.deleted_at is null;
  if not found or not v_restaurant.loyalty_enabled or not private.plan_allows(v_restaurant.id, 'loyalty') then
    return null;
  end if;
  select * into v_card from public.loyalty_cards c where c.restaurant_id = v_restaurant.id and c.device_hash = p_device_hash;
  return private.loyalty_json(v_card, v_restaurant.loyalty_visits, false);
end;
$$;

-- The diner uses a waiting reward, in front of the waiter.
create or replace function public.redeem_loyalty(p_slug text, p_device_hash text, p_rate_key text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_card public.loyalty_cards%rowtype;
begin
  select r.* into v_restaurant
    from public.restaurants r
    join public.branches b on b.restaurant_id = r.id and b.deleted_at is null
   where b.slug = lower(btrim(p_slug)) and r.deleted_at is null and not r.is_suspended;
  if not found or not v_restaurant.loyalty_enabled or not private.plan_allows(v_restaurant.id, 'loyalty') then
    return jsonb_build_object('result', 'not_available');
  end if;
  if p_rate_key is not null and not public.rate_limit_hit('loy:' || p_rate_key, 20, 3600) then
    return jsonb_build_object('result', 'too_many');
  end if;
  update public.loyalty_cards c
     set stamps = 0, rewards_used = c.rewards_used + 1, last_used_at = now()
   where c.restaurant_id = v_restaurant.id and c.device_hash = p_device_hash and c.stamps >= v_restaurant.loyalty_visits
  returning * into v_card;
  if not found then
    return jsonb_build_object('result', 'not_ready');
  end if;
  return jsonb_build_object('result', 'ok', 'loyalty', private.loyalty_json(v_card, v_restaurant.loyalty_visits, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- start_deal: "Sell it today". Runs as the owner, so row-level security
-- checks the restaurant and the plan. A new deal on a dish replaces the old.
-- ---------------------------------------------------------------------------
create or replace function public.start_deal(
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_item_id uuid,
  p_percent integer,
  p_ends_at timestamptz,
  p_note text default null,
  p_note_lg text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_ends_at is null or p_ends_at < now() + interval '5 minutes' or p_ends_at > now() + interval '24 hours' then
    raise exception 'ends_at' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.items i
      join public.branches b on b.menu_id = i.menu_id
     where i.id = p_item_id and b.id = p_branch_id and b.restaurant_id = p_restaurant_id
       and i.deleted_at is null and b.deleted_at is null
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.deals
     set ends_at = now()
   where branch_id = p_branch_id and item_id = p_item_id and deleted_at is null and ends_at > now();
  insert into public.deals (restaurant_id, branch_id, item_id, percent_off, note, note_lg, ends_at)
  values (
    p_restaurant_id, p_branch_id, p_item_id, p_percent,
    nullif(left(btrim(coalesce(p_note, '')), 120), ''),
    nullif(left(btrim(coalesce(p_note_lg, '')), 120), ''),
    p_ends_at
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_public_menu: adds how the branch takes orders, cash, loyalty and
-- today's deals.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_menu(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_plan text;
  v_features jsonb;
  v_limits jsonb;
  v_item_limit integer;
  v_photo_limit integer;
  v_categories jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_specials jsonb := '[]'::jsonb;
  v_deals jsonb := '[]'::jsonb;
  v_has_lg boolean;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_branch from public.branches b where b.slug = lower(btrim(p_slug)) and b.deleted_at is null;
  if not found then
    return null;
  end if;
  select * into v_restaurant
    from public.restaurants r
   where r.id = v_branch.restaurant_id and r.deleted_at is null and not r.is_suspended;
  if not found then
    return null;
  end if;

  v_plan := private.effective_plan(v_restaurant.id);
  select p.features, p.limits into v_features, v_limits from public.plans p where p.code = v_plan;
  v_item_limit := (v_limits ->> 'items')::integer;
  v_photo_limit := (v_limits ->> 'itemPhotos')::integer;

  with visible as (
    select i.*,
           row_number() over (order by c.sort_order, c.created_at, i.sort_order, i.created_at) as position
      from public.items i
      join public.categories c on c.id = i.category_id
     where i.menu_id = v_branch.menu_id
       and i.deleted_at is null and not i.is_hidden
       and c.deleted_at is null and not c.is_hidden
  ),
  shown as (
    select v.*,
           case when v.photo is null then null
                else row_number() over (partition by v.photo is not null order by v.position) end as photo_rank
      from visible v
     where v_item_limit is null or v.position <= v_item_limit
  ),
  item_json as (
    select s.category_id, s.position, jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'name_lg', s.name_lg,
      'description', s.description,
      'description_lg', s.description_lg,
      'price', s.price_ugx,
      'photo', case when v_photo_limit is null or s.photo_rank <= v_photo_limit then s.photo end,
      'tags', to_jsonb(s.tags),
      'sold_out', exists (select 1 from public.sold_out so where so.branch_id = v_branch.id and so.item_id = s.id),
      'options', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', o.id, 'kind', o.kind, 'name', o.name, 'name_lg', o.name_lg, 'price', o.price_ugx
               ) order by o.kind desc, o.sort_order, o.created_at)
          from public.item_options o
         where o.item_id = s.id and o.deleted_at is null
      ), '[]'::jsonb)
    ) as item
      from shown s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'name_lg', c.name_lg,
           'items', (select jsonb_agg(ij.item order by ij.position) from item_json ij where ij.category_id = c.id)
         ) order by c.sort_order, c.created_at), '[]'::jsonb)
    into v_categories
    from public.categories c
   where c.menu_id = v_branch.menu_id and c.deleted_at is null and not c.is_hidden
     and exists (select 1 from item_json ij where ij.category_id = c.id);

  if coalesce((v_features ->> 'table_qr')::boolean, false) then
    select coalesce(jsonb_object_agg(t.code, t.label), '{}'::jsonb) into v_tables
      from public.tables t
     where t.branch_id = v_branch.id and t.deleted_at is null;
  end if;

  if coalesce((v_features ->> 'specials')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sp.id, 'title', sp.title, 'title_lg', sp.title_lg,
             'description', sp.description, 'description_lg', sp.description_lg,
             'price', sp.price_ugx, 'days', to_jsonb(sp.days),
             'start', to_char(sp.start_time, 'HH24:MI'), 'end', to_char(sp.end_time, 'HH24:MI'),
             'starts_on', sp.starts_on, 'ends_on', sp.ends_on,
             'items', coalesce((
               select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'name_lg', i.name_lg, 'quantity', si.quantity))
                 from public.special_items si join public.items i on i.id = si.item_id
                where si.special_id = sp.id and i.deleted_at is null
             ), '[]'::jsonb)
           ) order by sp.sort_order, sp.created_at), '[]'::jsonb)
      into v_specials
      from public.specials sp
     where sp.restaurant_id = v_restaurant.id
       and (sp.branch_id is null or sp.branch_id = v_branch.id)
       and sp.is_active and sp.deleted_at is null
       and (sp.ends_on is null or sp.ends_on >= v_today);

    -- "Sell it today" deals that are on now, biggest discount first. The
    -- page hides each one at its end time by the phone's clock.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id, 'item_id', d.item_id, 'percent', d.percent_off,
             'note', d.note, 'note_lg', d.note_lg, 'ends_at', d.ends_at
           ) order by d.percent_off desc, d.ends_at), '[]'::jsonb)
      into v_deals
      from public.deals d
      join public.items i on i.id = d.item_id
      join public.categories c on c.id = i.category_id
     where d.branch_id = v_branch.id and d.deleted_at is null
       and d.starts_at <= now() and d.ends_at > now()
       and i.menu_id = v_branch.menu_id and i.deleted_at is null and not i.is_hidden
       and c.deleted_at is null and not c.is_hidden;
  end if;

  select coalesce(nullif(btrim(v_restaurant.description_lg), ''), null) is not null
      or exists (select 1 from public.categories c where c.menu_id = v_branch.menu_id and c.deleted_at is null and nullif(btrim(c.name_lg), '') is not null)
      or exists (select 1 from public.items i where i.menu_id = v_branch.menu_id and i.deleted_at is null
                   and (nullif(btrim(i.name_lg), '') is not null or nullif(btrim(i.description_lg), '') is not null))
    into v_has_lg;

  return jsonb_build_object(
    'version', v_restaurant.content_version,
    'plan', v_plan,
    'features', jsonb_build_object(
      'whatsapp_ordering', coalesce((v_features ->> 'whatsapp_ordering')::boolean, false),
      'momo_pay', coalesce((v_features ->> 'momo_pay')::boolean, false),
      'hide_footer', coalesce((v_features ->> 'hide_footer')::boolean, false),
      'specials', coalesce((v_features ->> 'specials')::boolean, false),
      'waiter_call', coalesce((v_features ->> 'waiter_call')::boolean, false),
      'feedback', coalesce((v_features ->> 'feedback')::boolean, false),
      'table_qr', coalesce((v_features ->> 'table_qr')::boolean, false),
      'loyalty', coalesce((v_features ->> 'loyalty')::boolean, false),
      'kitchen', coalesce((v_features ->> 'kitchen')::boolean, false)
    ),
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'description', v_restaurant.description,
      'description_lg', v_restaurant.description_lg,
      'logo', v_restaurant.logo,
      'cover', v_restaurant.cover,
      'brand_color', v_restaurant.brand_color,
      'cuisines', to_jsonb(v_restaurant.cuisines),
      'price_range', v_restaurant.price_range,
      'is_demo', v_restaurant.is_demo,
      'listed', v_restaurant.directory_status = 'approved'
                and coalesce((v_features ->> 'directory_listing')::boolean, false)
    ),
    'branch', jsonb_build_object(
      'id', v_branch.id,
      'slug', v_branch.slug,
      'name', v_branch.name,
      'area', v_branch.area,
      'address', v_branch.address,
      'lat', v_branch.lat,
      'lng', v_branch.lng,
      'phone', v_branch.phone,
      'whatsapp', v_branch.whatsapp,
      'opening_hours', v_branch.opening_hours,
      'accepts_dine_in', v_branch.accepts_dine_in,
      'accepts_takeaway', v_branch.accepts_takeaway,
      'accepts_delivery', v_branch.accepts_delivery,
      'delivery_note', v_branch.delivery_note,
      'order_mode', private.order_mode(v_branch.order_mode, v_branch.whatsapp, v_restaurant.id),
      'accepts_cash', v_branch.accepts_cash,
      'momo', case when coalesce((v_features ->> 'momo_pay')::boolean, false)
                    and (v_branch.momo_mtn_code is not null or v_branch.momo_airtel_code is not null)
              then jsonb_build_object(
                'mtn_code', v_branch.momo_mtn_code, 'mtn_name', v_branch.momo_mtn_name,
                'airtel_code', v_branch.momo_airtel_code, 'airtel_name', v_branch.momo_airtel_name)
              end
    ),
    'categories', v_categories,
    'tables', v_tables,
    'specials', v_specials,
    'deals', v_deals,
    'loyalty', case when coalesce((v_features ->> 'loyalty')::boolean, false)
                     and coalesce((v_features ->> 'whatsapp_ordering')::boolean, false)
                     and v_restaurant.loyalty_enabled
               then jsonb_build_object(
                 'visits', v_restaurant.loyalty_visits,
                 'reward', v_restaurant.loyalty_reward,
                 'reward_lg', v_restaurant.loyalty_reward_lg,
                 'min', v_restaurant.loyalty_min_ugx)
               end,
    'has_luganda', v_has_lg
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- restaurant_insights: adds orders and sales from orders placed on the menu.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_insights(p_restaurant_id uuid, p_days integer default 7)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_today timestamp := date_trunc('day', now() at time zone 'Africa/Kampala');
  v_first timestamp;
  v_from timestamptz;
  v_result jsonb;
  v_sales jsonb;
begin
  if not ((select private.is_admin())
          or (p_restaurant_id in (select private.owner_restaurant_ids())
              and private.plan_allows(p_restaurant_id, 'insights'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_first := v_today - make_interval(days => v_days - 1);
  v_from := v_first at time zone 'Africa/Kampala';

  with e as (
    select ev.type, ev.table_code, ev.item_id, ev.session_id, ev.occurred_at at time zone 'Africa/Kampala' as local
      from public.events ev
     where ev.restaurant_id = p_restaurant_id and ev.occurred_at >= v_from
  )
  select jsonb_build_object(
    'days', v_days,
    'from', to_char(v_first, 'YYYY-MM-DD'),
    'totals', (
      select jsonb_build_object(
        'menu_views', count(*) filter (where type = 'menu_view'),
        'visitors', count(distinct session_id) filter (where type = 'menu_view'),
        'item_views', count(*) filter (where type = 'item_view'),
        'whatsapp_orders', count(*) filter (where type in ('whatsapp_order', 'order_copy')),
        'waiter_calls', count(*) filter (where type = 'waiter_call'),
        'bill_requests', count(*) filter (where type = 'bill_request'),
        'momo_views', count(*) filter (where type = 'momo_view')
      ) from e
    ),
    'per_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(d, 'YYYY-MM-DD'), 'views', coalesce(v.views, 0), 'orders', coalesce(v.orders, 0)
             ) order by d), '[]'::jsonb)
        from generate_series(v_first, v_today, interval '1 day') d
        left join (
          select date_trunc('day', local) as day,
                 count(*) filter (where type = 'menu_view') as views,
                 count(*) filter (where type in ('whatsapp_order', 'order_copy')) as orders
            from e group by 1
        ) v on v.day = d
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'views', coalesce(v.views, 0)) order by h), '[]'::jsonb)
        from generate_series(0, 23) h
        left join (
          select extract(hour from local)::integer as hour, count(*) as views from e where type = 'menu_view' group by 1
        ) v on v.hour = h
    ),
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.item_id, 'name', i.name, 'views', x.views) order by x.views desc, i.name), '[]'::jsonb)
        from (
          select item_id, count(*) as views from e
           where type = 'item_view' and item_id is not null
           group by 1 order by 2 desc limit 10
        ) x
        join public.items i on i.id = x.item_id
    ),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object('code', x.table_code, 'views', x.views) order by x.views desc, x.table_code), '[]'::jsonb)
        from (
          select table_code, count(*) as views from e
           where type = 'menu_view' and table_code is not null
           group by 1 order by 2 desc limit 10
        ) x
    )
  ) into v_result;

  -- Orders sent, shown to a waiter or sent to the kitchen from the menu
  -- (not cancelled ones). Payment is not checked, so these are orders, not
  -- money received.
  with o as (
    select od.total_ugx, od.lines, od.created_at at time zone 'Africa/Kampala' as local
      from public.orders od
     where od.restaurant_id = p_restaurant_id and od.created_at >= v_from and od.status <> 'cancelled'
  )
  select jsonb_build_object(
    'orders', (select count(*) from o),
    'value', (select coalesce(sum(o.total_ugx), 0) from o),
    'per_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(d, 'YYYY-MM-DD'), 'orders', coalesce(x.orders, 0), 'value', coalesce(x.value, 0)
             ) order by d), '[]'::jsonb)
        from generate_series(v_first, v_today, interval '1 day') d
        left join (
          select date_trunc('day', local) as day, count(*) as orders, sum(total_ugx) as value from o group by 1
        ) x on x.day = d
    ),
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'qty', t.qty, 'value', t.value) order by t.qty desc, t.name), '[]'::jsonb)
        from (
          select l ->> 'name' as name, sum((l ->> 'qty')::integer) as qty, sum((l ->> 'total')::bigint) as value
            from o, jsonb_array_elements(o.lines) l
           group by 1
           order by 2 desc, 1
           limit 8
        ) t
    )
  ) into v_sales;

  return v_result || jsonb_build_object('sales', v_sales);
end;
$$;

-- ---------------------------------------------------------------------------
-- directory_search: adds each listing's best "Sell it today" deal.
-- ---------------------------------------------------------------------------
create or replace function public.directory_search(
  p_query text default null,
  p_area text default null,
  p_cuisine text default null,
  p_price smallint default null,
  p_limit integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := coalesce((select (s.value #>> '{}')::boolean from public.settings s where s.key = 'directory_enabled'), false);
  v_q text := nullif(left(btrim(coalesce(p_query, '')), 60), '');
  v_pattern text;
  v_results jsonb;
  v_areas jsonb;
begin
  if not v_enabled and not private.is_admin() then
    return jsonb_build_object('enabled', false, 'results', '[]'::jsonb, 'areas', '[]'::jsonb);
  end if;
  -- Treat the search as plain text, not a LIKE pattern.
  v_pattern := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with listed as (
    select r.id, r.name, r.cuisines, r.price_range, r.logo, b.id as branch_id, b.slug, b.area, b.opening_hours, b.menu_id,
           (r.is_featured and private.plan_allows(r.id, 'featured_listing')) as featured
      from public.restaurants r
      join public.branches b on b.restaurant_id = r.id and b.deleted_at is null
     where r.deleted_at is null and r.directory_status = 'approved' and not r.is_suspended and not r.is_demo
       and private.plan_allows(r.id, 'directory_listing')
  ),
  matched as (
    select l.*,
           case when v_q is null then '[]'::jsonb else coalesce((
             select jsonb_agg(d.name) from (
               select i.name from public.items i
                where i.menu_id = l.menu_id and i.deleted_at is null and not i.is_hidden and i.name ilike v_pattern
                order by i.sort_order limit 3
             ) d
           ), '[]'::jsonb) end as dishes
      from listed l
     where (p_area is null or lower(l.area) = lower(btrim(p_area)))
       and (p_cuisine is null or lower(btrim(p_cuisine)) = any (select lower(c) from unnest(l.cuisines) c))
       and (p_price is null or l.price_range = p_price)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', m.name, 'slug', m.slug, 'area', m.area, 'cuisines', to_jsonb(m.cuisines), 'price_range', m.price_range,
           'logo', m.logo, 'opening_hours', m.opening_hours, 'featured', m.featured, 'dishes', m.dishes,
           'deal', (
             select jsonb_build_object(
                      'item', i.name, 'percent', d.percent_off, 'ends_at', d.ends_at, 'was', i.price_ugx,
                      'price', case when i.price_ugx is not null then private.deal_price(i.price_ugx, d.percent_off) end)
               from public.deals d
               join public.items i on i.id = d.item_id
              where d.branch_id = m.branch_id and d.deleted_at is null and d.starts_at <= now() and d.ends_at > now()
                and i.menu_id = m.menu_id and i.deleted_at is null and not i.is_hidden
                and private.plan_allows(m.id, 'specials')
              order by d.percent_off desc, d.ends_at
              limit 1
           )
         ) order by m.featured desc, m.name), '[]'::jsonb)
    into v_results
    from (
      select * from matched m
       where v_q is null or m.name ilike v_pattern or jsonb_array_length(m.dishes) > 0
       order by m.featured desc, m.name
       limit least(greatest(coalesce(p_limit, 60), 1), 200)
    ) m;

  -- Areas with listings, for the area filter.
  select coalesce(jsonb_agg(jsonb_build_object('area', a.area, 'count', a.n) order by a.n desc, a.area), '[]'::jsonb)
    into v_areas
    from (
      select b.area, count(*) as n
        from public.restaurants r
        join public.branches b on b.restaurant_id = r.id and b.deleted_at is null
       where r.deleted_at is null and r.directory_status = 'approved' and not r.is_suspended and not r.is_demo
         and private.plan_allows(r.id, 'directory_listing') and b.area is not null
       group by b.area
    ) a;

  return jsonb_build_object('enabled', v_enabled, 'results', v_results, 'areas', v_areas);
end;
$$;

-- ---------------------------------------------------------------------------
-- directory_top: "Top in {area} this week", ranked by menu visitors plus
-- orders placed on the menu in the last 7 days (an order counts as three
-- visitors). Private ratings are never used. Only the order is returned,
-- never the numbers.
-- ---------------------------------------------------------------------------
create or replace function public.directory_top(p_area text default null, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := coalesce((select (s.value #>> '{}')::boolean from public.settings s where s.key = 'directory_enabled'), false);
  v_since timestamptz := now() - interval '7 days';
  v_result jsonb;
begin
  if not v_enabled and not private.is_admin() then
    return '[]'::jsonb;
  end if;

  with listed as (
    select r.id, r.name, b.id as branch_id, b.slug, b.area
      from public.restaurants r
      join public.branches b on b.restaurant_id = r.id and b.deleted_at is null
     where r.deleted_at is null and r.directory_status = 'approved' and not r.is_suspended and not r.is_demo
       and private.plan_allows(r.id, 'directory_listing')
       and (p_area is null or lower(b.area) = lower(btrim(p_area)))
  ),
  visits as (
    select e.branch_id, count(distinct coalesce(e.session_id, e.id::text)) as n
      from public.events e
     where e.type = 'menu_view' and e.occurred_at >= v_since
       and e.branch_id in (select l.branch_id from listed l)
     group by 1
  ),
  placed as (
    select o.branch_id, count(*) as n
      from public.orders o
     where o.created_at >= v_since and o.status <> 'cancelled'
       and o.branch_id in (select l.branch_id from listed l)
     group by 1
  ),
  scored as (
    select l.name, l.slug, l.area, coalesce(v.n, 0) + 3 * coalesce(o.n, 0) as score
      from listed l
      left join visits v on v.branch_id = l.branch_id
      left join placed o on o.branch_id = l.branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'area', s.area) order by s.score desc, s.name), '[]'::jsonb)
    into v_result
    from (
      select * from scored where score > 0 order by score desc, name
       limit least(greatest(coalesce(p_limit, 5), 1), 10)
    ) s;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function private.can_work_branch(uuid, uuid) from public;
revoke all on function private.order_mode(text, text, uuid) from public;
revoke all on function private.deal_price(integer, integer) from public;
revoke all on function private.special_on_at(smallint[], time, time, date, date, timestamptz) from public;
revoke all on function private.order_json(public.orders) from public;
revoke all on function private.loyalty_json(public.loyalty_cards, integer, boolean) from public;
revoke all on function private.stamp_loyalty(uuid, integer, text, boolean) from public;
revoke all on function private.on_order_status() from public;
grant execute on function private.can_work_branch(uuid, uuid) to authenticated, service_role;
grant execute on function private.order_mode(text, text, uuid) to authenticated, service_role;
grant execute on function private.deal_price(integer, integer) to authenticated, service_role;
grant execute on function private.special_on_at(smallint[], time, time, date, date, timestamptz) to authenticated, service_role;
grant execute on function private.order_json(public.orders) to service_role;
grant execute on function private.loyalty_json(public.loyalty_cards, integer, boolean) to service_role;
grant execute on function private.stamp_loyalty(uuid, integer, text, boolean) to service_role;

revoke execute on function public.place_order(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.order_status(text, text) from public, anon, authenticated;
revoke execute on function public.loyalty_status(text, text) from public, anon, authenticated;
revoke execute on function public.redeem_loyalty(text, text, text) from public, anon, authenticated;
revoke execute on function public.start_deal(uuid, uuid, uuid, integer, timestamptz, text, text) from public, anon;
revoke execute on function public.directory_top(text, integer) from public;
grant execute on function public.place_order(jsonb, text, text) to service_role;
grant execute on function public.order_status(text, text) to service_role;
grant execute on function public.loyalty_status(text, text) to service_role;
grant execute on function public.redeem_loyalty(text, text, text) to service_role;
grant execute on function public.start_deal(uuid, uuid, uuid, integer, timestamptz, text, text) to authenticated;
grant execute on function public.directory_top(text, integer) to anon, authenticated;
