-- Specials, diner feedback and owner insights (Pro features).

-- ---------------------------------------------------------------------------
-- submit_feedback: called by the rate-limited /api/feedback route (service
-- role). Only menus whose plan includes feedback accept it. Returns 'ok',
-- 'invalid', 'not_found', 'not_available' or 'too_many'.
-- ---------------------------------------------------------------------------
create or replace function public.submit_feedback(
  p_slug text,
  p_rating integer,
  p_comment text default null,
  p_table text default null,
  -- Hashed client IP.
  p_rate_key text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return 'invalid';
  end if;
  select b.* into v_branch
    from public.branches b
    join public.restaurants r on r.id = b.restaurant_id
   where b.slug = lower(btrim(p_slug)) and b.deleted_at is null and r.deleted_at is null;
  if not found then
    return 'not_found';
  end if;
  if not private.plan_allows(v_branch.restaurant_id, 'feedback') then
    return 'not_available';
  end if;
  -- A few per phone per restaurant an hour, and a daily ceiling per branch.
  if p_rate_key is not null and not public.rate_limit_hit('fb:' || p_rate_key || ':' || v_branch.id, 3, 3600) then
    return 'too_many';
  end if;
  if not public.rate_limit_hit('fb:b:' || v_branch.id, 300, 86400) then
    return 'too_many';
  end if;

  insert into public.feedback (restaurant_id, branch_id, table_code, rating, comment)
  values (
    v_branch.restaurant_id, v_branch.id,
    case when p_table ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(p_table) <= 24 then p_table end,
    p_rating,
    nullif(left(btrim(coalesce(p_comment, '')), 1000), '')
  );
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- restaurant_insights: views, orders and busy hours over whole Kampala days
-- (today and the days before). Owners on a plan with insights, and admins.
-- Runs as the caller, so row-level security keeps it to their own events.
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
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_special: creates or updates a special and its dishes in one go. Runs
-- as the caller, so row-level security checks the owner and the plan.
-- p: id (optional), restaurant_id, title, description, price_ugx, days,
-- start_time, end_time, starts_on, ends_on, is_active, item_ids.
-- ---------------------------------------------------------------------------
create or replace function public.save_special(p jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_restaurant uuid := (p ->> 'restaurant_id')::uuid;
  v_days smallint[] := array(select distinct jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb))::smallint order by 1);
  v_items uuid[] := array(select distinct jsonb_array_elements_text(coalesce(p -> 'item_ids', '[]'::jsonb))::uuid);
begin
  if v_id is null then
    insert into public.specials (
      restaurant_id, title, description, price_ugx, days, start_time, end_time, starts_on, ends_on, is_active, sort_order
    )
    values (
      v_restaurant, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''),
      (p ->> 'price_ugx')::integer, v_days, (p ->> 'start_time')::time, (p ->> 'end_time')::time,
      (p ->> 'starts_on')::date, (p ->> 'ends_on')::date, coalesce((p ->> 'is_active')::boolean, true),
      coalesce((select max(s.sort_order) + 1 from public.specials s where s.restaurant_id = v_restaurant and s.deleted_at is null), 0)
    )
    returning id into v_id;
  else
    update public.specials
       set title = btrim(p ->> 'title'),
           description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
           price_ugx = (p ->> 'price_ugx')::integer,
           days = v_days,
           start_time = (p ->> 'start_time')::time,
           end_time = (p ->> 'end_time')::time,
           starts_on = (p ->> 'starts_on')::date,
           ends_on = (p ->> 'ends_on')::date,
           is_active = coalesce((p ->> 'is_active')::boolean, true)
     where id = v_id and restaurant_id = v_restaurant and deleted_at is null;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.special_items si where si.special_id = v_id and not (si.item_id = any (v_items));
  insert into public.special_items (special_id, item_id, restaurant_id, quantity)
  select v_id, x, v_restaurant, 1
    from unnest(v_items) x
   where exists (select 1 from public.items i where i.id = x and i.restaurant_id = v_restaurant and i.deleted_at is null)
  on conflict (special_id, item_id) do nothing;
  return v_id;
end;
$$;

revoke execute on function public.submit_feedback(text, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.restaurant_insights(uuid, integer) from public, anon;
revoke execute on function public.save_special(jsonb) from public, anon;
grant execute on function public.submit_feedback(text, integer, text, text, text) to service_role;
grant execute on function public.restaurant_insights(uuid, integer) to authenticated;
grant execute on function public.save_special(jsonb) to authenticated;
