-- Agents' commissions and referral rewards, both earned when a restaurant
-- makes its first plan payment. Called by server code (service role) right
-- after recording a payment; safe to call more than once.

-- Menu views across all restaurants, for the admin overview.
create index if not exists events_menu_views on public.events (occurred_at) where type = 'menu_view';
create index if not exists agent_commissions_agent on public.agent_commissions (agent_id) where deleted_at is null;
create index if not exists agent_payouts_agent on public.agent_payouts (agent_id) where deleted_at is null;

-- Returns {commission: boolean, referral: {id, referrer_id, months} | null}.
-- The referral is claimed here (pending -> rewarded); the caller then gives
-- the referrer their free months, and calls unclaim_referral if that fails.
create or replace function public.payment_rewards(p_restaurant_id uuid, p_payment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents%rowtype;
  v_commission boolean := false;
  v_referral public.referrals%rowtype;
begin
  select a.* into v_agent
    from public.restaurants r
    join public.agents a on a.id = r.agent_id
   where r.id = p_restaurant_id and a.deleted_at is null;
  if found then
    -- A flat fee per restaurant that pays, once. One removed with its
    -- payment can be earned again.
    insert into public.agent_commissions (agent_id, restaurant_id, payment_id, amount_ugx)
    values (v_agent.id, p_restaurant_id, p_payment_id,
            coalesce(v_agent.commission_ugx, private.setting_int('agent_commission_ugx', 20000)))
    on conflict (restaurant_id) do update
      set agent_id = excluded.agent_id, payment_id = excluded.payment_id, amount_ugx = excluded.amount_ugx,
          earned_at = now(), deleted_at = null
      where public.agent_commissions.deleted_at is not null;
    v_commission := found;
    if v_commission then
      insert into public.audit_log (restaurant_id, action, details)
      values (p_restaurant_id, 'agent.commission_earned', jsonb_build_object('agent_id', v_agent.id, 'payment_id', p_payment_id));
    end if;
  end if;

  update public.referrals
     set status = 'rewarded', qualifying_payment_id = p_payment_id, rewarded_at = now()
   where referred_id = p_restaurant_id and status = 'pending'
  returning * into v_referral;

  return jsonb_build_object(
    'commission', v_commission,
    'referral', case when v_referral.id is null then null
                     else jsonb_build_object('id', v_referral.id, 'referrer_id', v_referral.referrer_id, 'months', v_referral.reward_months) end
  );
end;
$$;

create or replace function public.unclaim_referral(p_referral_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.referrals
     set status = 'pending', qualifying_payment_id = null, rewarded_at = null
   where id = p_referral_id and status = 'rewarded';
$$;

-- A payment removed as a mistake takes its agent commission with it.
create or replace function public.void_payment_rewards(p_payment_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.agent_commissions set deleted_at = now()
   where payment_id = p_payment_id and deleted_at is null;
$$;

revoke execute on function public.payment_rewards(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.unclaim_referral(uuid) from public, anon, authenticated;
revoke execute on function public.void_payment_rewards(uuid) from public, anon, authenticated;
grant execute on function public.payment_rewards(uuid, uuid) to service_role;
grant execute on function public.unclaim_referral(uuid) to service_role;
grant execute on function public.void_payment_rewards(uuid) to service_role;
