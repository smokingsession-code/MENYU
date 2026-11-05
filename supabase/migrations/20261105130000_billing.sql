-- Billing: recording payments and changing plans.
--
-- The rules (which period a payment buys, due dates, grace) live in
-- src/lib/billing/status.ts and are unit tested. These functions apply the
-- result atomically and refuse to work from stale data: the caller passes
-- the subscription's updated_at as it read it, and gets 'stale' (40001) if
-- anything changed since, so it can read again and recompute.
--
-- Only server code calls them (service role): admin actions after checking
-- the caller is an admin, the daily billing job, and later the payment
-- provider webhooks (Flutterwave or Pesapal), which share record_payment.

-- A provider's reference is unique (webhooks may arrive twice), and one
-- MoMo transaction can only be recorded once.
create unique index if not exists payments_provider_ref on public.payments (provider, provider_ref) where provider_ref is not null;
create unique index if not exists payments_transaction on public.payments (method, transaction_id)
  where transaction_id is not null and deleted_at is null;
create index if not exists payments_restaurant on public.payments (restaurant_id, paid_at desc) where deleted_at is null;
create index if not exists subscriptions_status on public.subscriptions (status, paid_until);

-- p: restaurant_id, kind, amount_ugx, method, provider, transaction_id,
-- provider_ref, status ('succeeded' | 'pending'), paid_at, notes, raw,
-- actor_id; for kind 'subscription' also plan, billing_interval,
-- period_start, period_end, new_status and expected_updated_at.
create or replace function public.record_payment(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_restaurant uuid := (p ->> 'restaurant_id')::uuid;
  v_kind text := coalesce(p ->> 'kind', 'subscription');
  v_provider text := coalesce(p ->> 'provider', 'manual');
  v_status text := coalesce(p ->> 'status', 'succeeded');
  v_sub public.subscriptions%rowtype;
  v_existing public.payments%rowtype;
  v_payment_id uuid;
begin
  if v_status not in ('succeeded', 'pending') then
    raise exception 'invalid_payment' using errcode = '22023';
  end if;

  -- The same provider payment delivered twice is recorded once. A pending
  -- one (a mobile money prompt the owner has not approved yet) is completed.
  if p ->> 'provider_ref' is not null then
    select * into v_existing from public.payments
     where provider = v_provider and provider_ref = p ->> 'provider_ref' for update;
    if found and (v_existing.status <> 'pending' or v_status = 'pending') then
      return jsonb_build_object('payment_id', v_existing.id, 'duplicate', true);
    end if;
  end if;

  select * into v_sub from public.subscriptions s where s.restaurant_id = v_restaurant for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_kind = 'subscription' and v_status = 'succeeded' then
    if v_sub.updated_at is distinct from (p ->> 'expected_updated_at')::timestamptz then
      raise exception 'stale' using errcode = '40001';
    end if;
    if (p ->> 'plan') not in ('standard', 'pro')
       or (p ->> 'billing_interval') not in ('month', 'year')
       or (p ->> 'new_status') not in ('active', 'overdue', 'free')
       or (p ->> 'period_end')::timestamptz <= (p ->> 'period_start')::timestamptz then
      raise exception 'invalid_payment' using errcode = '22023';
    end if;
  end if;

  if v_existing.id is not null then
    update public.payments
       set status = 'succeeded', amount_ugx = (p ->> 'amount_ugx')::integer, method = p ->> 'method',
           transaction_id = coalesce(p ->> 'transaction_id', transaction_id),
           paid_at = coalesce((p ->> 'paid_at')::timestamptz, now()), raw = coalesce(p -> 'raw', raw),
           plan = p ->> 'plan', billing_interval = p ->> 'billing_interval',
           period_start = (p ->> 'period_start')::timestamptz, period_end = (p ->> 'period_end')::timestamptz
     where id = v_existing.id
    returning id into v_payment_id;
  else
    insert into public.payments (
      restaurant_id, kind, amount_ugx, method, provider, transaction_id, provider_ref, status,
      plan, billing_interval, period_start, period_end, paid_at, recorded_by, notes, raw
    )
    values (
      v_restaurant, v_kind, (p ->> 'amount_ugx')::integer, p ->> 'method', v_provider,
      nullif(btrim(p ->> 'transaction_id'), ''), p ->> 'provider_ref', v_status,
      case when v_kind = 'subscription' then p ->> 'plan' end,
      case when v_kind = 'subscription' then p ->> 'billing_interval' end,
      case when v_kind = 'subscription' then (p ->> 'period_start')::timestamptz end,
      case when v_kind = 'subscription' then (p ->> 'period_end')::timestamptz end,
      coalesce((p ->> 'paid_at')::timestamptz, now()),
      (p ->> 'actor_id')::uuid,
      nullif(left(btrim(coalesce(p ->> 'notes', '')), 500), ''),
      p -> 'raw'
    )
    returning id into v_payment_id;
  end if;

  if v_status = 'succeeded' then
    if v_kind = 'subscription' then
      update public.subscriptions
         set plan = p ->> 'plan',
             billing_interval = p ->> 'billing_interval',
             paid_until = (p ->> 'period_end')::timestamptz,
             status = p ->> 'new_status',
             status_changed_at = case when status <> p ->> 'new_status' then now() else status_changed_at end
       where restaurant_id = v_restaurant;
    elsif v_kind = 'setup_fee' then
      update public.subscriptions set setup_fee_ugx = (p ->> 'amount_ugx')::integer where restaurant_id = v_restaurant;
    end if;

    insert into public.audit_log (actor_id, restaurant_id, action, details)
    values ((p ->> 'actor_id')::uuid, v_restaurant, 'payment.recorded', jsonb_build_object(
      'payment_id', v_payment_id, 'kind', v_kind, 'amount_ugx', (p ->> 'amount_ugx')::integer,
      'method', p ->> 'method', 'provider', v_provider, 'period_end', p ->> 'period_end',
      'status_before', v_sub.status, 'paid_until_before', v_sub.paid_until,
      'status_after', coalesce(p ->> 'new_status', v_sub.status)
    ));
  end if;

  return jsonb_build_object('payment_id', v_payment_id, 'duplicate', false);
end;
$$;

-- p: restaurant_id, plan, billing_interval, status, trial_ends_at,
-- paid_until, grace_days, actor_id, expected_updated_at.
create or replace function public.set_subscription(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_restaurant uuid := (p ->> 'restaurant_id')::uuid;
  v_sub public.subscriptions%rowtype;
begin
  select * into v_sub from public.subscriptions s where s.restaurant_id = v_restaurant for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_sub.updated_at is distinct from (p ->> 'expected_updated_at')::timestamptz then
    raise exception 'stale' using errcode = '40001';
  end if;

  update public.subscriptions
     set plan = p ->> 'plan',
         billing_interval = p ->> 'billing_interval',
         status = p ->> 'status',
         trial_ends_at = (p ->> 'trial_ends_at')::timestamptz,
         paid_until = (p ->> 'paid_until')::timestamptz,
         grace_days = (p ->> 'grace_days')::integer,
         status_changed_at = case when status <> p ->> 'status' then now() else status_changed_at end
   where restaurant_id = v_restaurant;

  insert into public.audit_log (actor_id, restaurant_id, action, details)
  values ((p ->> 'actor_id')::uuid, v_restaurant, 'subscription.changed', jsonb_build_object(
    'before', jsonb_build_object('plan', v_sub.plan, 'status', v_sub.status, 'trial_ends_at', v_sub.trial_ends_at,
                                 'paid_until', v_sub.paid_until, 'billing_interval', v_sub.billing_interval, 'grace_days', v_sub.grace_days),
    'after', p - 'actor_id' - 'expected_updated_at' - 'restaurant_id'
  ));
end;
$$;

-- Used by the daily billing job: moves one restaurant from one status to the
-- next, only if it is still in the status the job saw.
create or replace function public.apply_billing_status(p_restaurant_id uuid, p_from text, p_to text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.subscriptions
     set status = p_to, status_changed_at = now()
   where restaurant_id = p_restaurant_id and status = p_from;
  if not found then
    return false;
  end if;
  insert into public.audit_log (actor_id, restaurant_id, action, details)
  values (null, p_restaurant_id, 'subscription.status_changed', jsonb_build_object('from', p_from, 'to', p_to, 'by', 'schedule'));
  return true;
end;
$$;

-- Removes a payment recorded by mistake (kept, soft-deleted). When it was
-- the latest plan payment, the caller passes `revert` to move the paid-until
-- date back: {paid_until, status, expected_updated_at}.
create or replace function public.remove_payment(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
begin
  select * into v_payment from public.payments where id = (p ->> 'payment_id')::uuid and deleted_at is null for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.payments set deleted_at = now() where id = v_payment.id;

  if p ? 'revert' then
    select * into v_sub from public.subscriptions s where s.restaurant_id = v_payment.restaurant_id for update;
    if v_sub.updated_at is distinct from (p -> 'revert' ->> 'expected_updated_at')::timestamptz then
      raise exception 'stale' using errcode = '40001';
    end if;
    update public.subscriptions
       set paid_until = (p -> 'revert' ->> 'paid_until')::timestamptz,
           status = p -> 'revert' ->> 'status',
           status_changed_at = case when status <> p -> 'revert' ->> 'status' then now() else status_changed_at end
     where restaurant_id = v_payment.restaurant_id;
  end if;

  insert into public.audit_log (actor_id, restaurant_id, action, details)
  values ((p ->> 'actor_id')::uuid, v_payment.restaurant_id, 'payment.removed', jsonb_build_object(
    'payment_id', v_payment.id, 'amount_ugx', v_payment.amount_ugx, 'reverted', p ? 'revert'
  ));
end;
$$;

revoke execute on function public.record_payment(jsonb) from public, anon, authenticated;
revoke execute on function public.set_subscription(jsonb) from public, anon, authenticated;
revoke execute on function public.apply_billing_status(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.remove_payment(jsonb) from public, anon, authenticated;
grant execute on function public.record_payment(jsonb) to service_role;
grant execute on function public.set_subscription(jsonb) to service_role;
grant execute on function public.apply_billing_status(uuid, text, text) to service_role;
grant execute on function public.remove_payment(jsonb) to service_role;
