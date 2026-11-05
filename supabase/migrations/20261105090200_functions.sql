-- Server-side operations that must be atomic or need elevated rights.
-- Every security-definer function checks the caller itself.

-- ---------------------------------------------------------------------------
-- Default settings (admin-editable)
-- ---------------------------------------------------------------------------

insert into public.settings (key, value) values
  ('trial_days', '30'::jsonb),
  ('grace_days', '7'::jsonb),
  ('directory_enabled', 'false'::jsonb),
  ('agent_commission_ugx', '20000'::jsonb),
  ('referral_reward_months', '1'::jsonb),
  ('business_momo', '{"mtn_code": "", "mtn_name": "", "airtel_code": "", "airtel_name": ""}'::jsonb),
  ('support_whatsapp', '""'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function private.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::integer from public.settings s where s.key = p_key), p_default);
$$;

create or replace function private.unique_branch_slug(p_base text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base text := trim(both '-' from left(private.slugify(p_base), 60));
  v_candidate text;
  i integer := 1;
begin
  if char_length(v_base) < 3 then
    v_base := 'menu-' || lower(private.random_code(5));
  end if;
  v_candidate := v_base;
  while exists (select 1 from public.branches b where b.slug = v_candidate) loop
    i := i + 1;
    if i > 30 then
      v_candidate := v_base || '-' || lower(private.random_code(4));
    else
      v_candidate := v_base || '-' || i;
    end if;
  end loop;
  return v_candidate;
end;
$$;

create or replace function private.audit(p_action text, p_restaurant_id uuid, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, restaurant_id, action, details)
  values ((select auth.uid()), p_restaurant_id, p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- Creates an invitation and returns the raw token (only its hash is stored).
create or replace function private.new_invitation(
  p_restaurant_id uuid,
  p_role text,
  p_branch_id uuid,
  p_phone text,
  p_email text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_id uuid;
  v_email text := nullif(lower(btrim(p_email)), '');
  v_phone text := nullif(btrim(p_phone), '');
begin
  if v_phone is null and v_email is null then
    raise exception 'invitation_needs_contact' using errcode = '22023';
  end if;

  -- Replace any pending invitation for the same person.
  update public.invitations i
     set deleted_at = now()
   where i.restaurant_id = p_restaurant_id
     and i.accepted_at is null
     and i.deleted_at is null
     and ((v_phone is not null and i.phone = v_phone) or (v_email is not null and lower(i.email) = v_email));

  insert into public.invitations (restaurant_id, role, branch_id, phone, email, token_hash, invited_by)
  values (
    p_restaurant_id, p_role, p_branch_id, v_phone, v_email,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    (select auth.uid())
  )
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'token', v_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_restaurant
--   Admin: creates a restaurant for an owner and returns an invitation token.
--   Signed-in user (self-serve onboarding): creates it with them as owner.
-- ---------------------------------------------------------------------------

create or replace function public.create_restaurant(
  p_name text,
  p_area text default null,
  p_whatsapp text default null,
  p_owner_phone text default null,
  p_owner_email text default null,
  p_trial_days integer default null,
  p_agent_code text default null,
  p_referral_code text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := private.is_admin();
  v_name text := btrim(coalesce(p_name, ''));
  v_area text := nullif(btrim(coalesce(p_area, '')), '');
  v_whatsapp text := nullif(btrim(coalesce(p_whatsapp, '')), '');
  v_restaurant_id uuid;
  v_menu_id uuid;
  v_branch_id uuid;
  v_slug text;
  v_trial_days integer;
  v_agent_id uuid;
  v_referrer_id uuid;
  v_invitation jsonb;
  v_owned integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_area is not null and char_length(v_area) > 80 then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  if v_whatsapp is not null and v_whatsapp !~ '^[0-9]{9,15}$' then
    raise exception 'invalid_whatsapp' using errcode = '22023';
  end if;

  if v_is_admin then
    v_trial_days := coalesce(p_trial_days, private.setting_int('trial_days', 30));
  else
    select count(*) into v_owned
      from public.memberships m
     where m.user_id = v_uid and m.role = 'owner' and m.deleted_at is null;
    if v_owned >= 5 then
      raise exception 'too_many_restaurants' using errcode = '22023';
    end if;
    -- Only the admin chooses trial length or invites an owner.
    v_trial_days := private.setting_int('trial_days', 30);
    p_owner_phone := null;
    p_owner_email := null;
  end if;

  if v_trial_days < 0 or v_trial_days > 365 then
    raise exception 'invalid_trial_days' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_agent_code, '')), '') is not null then
    select a.id into v_agent_id
      from public.agents a
     where a.code = upper(btrim(p_agent_code)) and a.is_active and a.deleted_at is null;
    if v_agent_id is null then
      raise exception 'unknown_agent_code' using errcode = '22023';
    end if;
  end if;

  if nullif(btrim(coalesce(p_referral_code, '')), '') is not null then
    select r.id into v_referrer_id
      from public.restaurants r
     where r.referral_code = upper(btrim(p_referral_code)) and r.deleted_at is null;
    -- An unknown referral code is ignored rather than blocking signup.
  end if;

  insert into public.restaurants (name, agent_id, referred_by, created_by)
  values (v_name, v_agent_id, v_referrer_id, v_uid)
  returning id into v_restaurant_id;

  insert into public.menus (restaurant_id) values (v_restaurant_id) returning id into v_menu_id;

  v_slug := private.unique_branch_slug(v_name || coalesce(' ' || v_area, ''));

  insert into public.branches (restaurant_id, menu_id, slug, area, whatsapp, phone, is_main)
  values (v_restaurant_id, v_menu_id, v_slug, v_area, v_whatsapp, v_whatsapp, true)
  returning id into v_branch_id;

  if v_trial_days = 0 then
    insert into public.subscriptions (restaurant_id, plan, status, grace_days)
    values (v_restaurant_id, 'free', 'free', private.setting_int('grace_days', 7));
  else
    insert into public.subscriptions (restaurant_id, plan, status, trial_ends_at, grace_days)
    values (
      v_restaurant_id, 'standard', 'trial',
      now() + make_interval(days => v_trial_days),
      private.setting_int('grace_days', 7)
    );
  end if;

  if v_referrer_id is not null then
    insert into public.referrals (referrer_id, referred_id, reward_months)
    values (v_referrer_id, v_restaurant_id, private.setting_int('referral_reward_months', 1));
  end if;

  if v_is_admin then
    if p_owner_phone is not null or p_owner_email is not null then
      v_invitation := private.new_invitation(v_restaurant_id, 'owner', null, p_owner_phone, p_owner_email);
    end if;
  else
    insert into public.memberships (user_id, restaurant_id, role)
    values (v_uid, v_restaurant_id, 'owner');
  end if;

  perform private.audit('restaurant.created', v_restaurant_id, jsonb_build_object(
    'by_admin', v_is_admin, 'trial_days', v_trial_days, 'agent_id', v_agent_id, 'referred_by', v_referrer_id
  ));

  return jsonb_build_object(
    'restaurant_id', v_restaurant_id,
    'branch_id', v_branch_id,
    'menu_id', v_menu_id,
    'slug', v_slug,
    'invitation_token', v_invitation ->> 'token'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

-- Admin: invite an owner or staff to any restaurant.
-- Owner: invite staff to their own restaurant when the plan includes staff.
create or replace function public.create_invitation(
  p_restaurant_id uuid,
  p_role text,
  p_phone text default null,
  p_email text default null,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_role not in ('owner', 'staff') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id and r.deleted_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not private.is_admin() then
    if p_restaurant_id not in (select private.owner_restaurant_ids()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if p_role <> 'staff' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not private.plan_allows(p_restaurant_id, 'staff') then
      raise exception 'plan_required' using errcode = '42501';
    end if;
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches b
     where b.id = p_branch_id and b.restaurant_id = p_restaurant_id and b.deleted_at is null
  ) then
    raise exception 'invalid_branch' using errcode = '22023';
  end if;

  v_result := private.new_invitation(p_restaurant_id, p_role, p_branch_id, p_phone, p_email);
  perform private.audit('invitation.created', p_restaurant_id, jsonb_build_object(
    'role', p_role, 'invitation_id', v_result ->> 'invitation_id'
  ));
  return v_result;
end;
$$;

-- Turns every pending invitation that matches the caller's verified phone
-- or email into a membership. Called after each sign-in.
create or replace function public.claim_invitations()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_phone text;
  v_email text;
  v_phone_ok boolean;
  v_email_ok boolean;
  v_count integer := 0;
  r record;
begin
  if v_uid is null then
    return 0;
  end if;

  select u.phone, lower(u.email), u.phone_confirmed_at is not null, u.email_confirmed_at is not null
    into v_phone, v_email, v_phone_ok, v_email_ok
    from auth.users u
   where u.id = v_uid;

  for r in
    select i.*
      from public.invitations i
     where i.deleted_at is null
       and i.accepted_at is null
       and i.expires_at > now()
       and (
         (v_phone_ok and i.phone is not null and i.phone = v_phone)
         or (v_email_ok and i.email is not null and lower(i.email) = v_email)
       )
     for update
  loop
    insert into public.memberships (user_id, restaurant_id, role, branch_id)
    values (v_uid, r.restaurant_id, r.role, r.branch_id)
    on conflict (user_id, restaurant_id) where deleted_at is null
    do update set
      role = case when excluded.role = 'owner' then 'owner' else public.memberships.role end,
      branch_id = case when excluded.role = 'owner' then null else public.memberships.branch_id end;

    update public.invitations
       set accepted_at = now(), accepted_by = v_uid
     where id = r.id;

    perform private.audit('invitation.accepted', r.restaurant_id, jsonb_build_object('invitation_id', r.id, 'role', r.role));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- What the invite landing page shows before sign-in. Reveals only the
-- restaurant name and a hint of the invited number.
create or replace function public.invitation_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'restaurant_name', r.name,
    'role', i.role,
    'phone_hint', case when i.phone is not null then right(i.phone, 3) end,
    'email_hint', case when i.email is not null then left(i.email, 2) || '…@' || split_part(i.email, '@', 2) end,
    'status', case
      when i.deleted_at is not null then 'revoked'
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'pending'
    end
  )
  from public.invitations i
  join public.restaurants r on r.id = i.restaurant_id
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (service role only)
-- Returns true when the call is allowed.
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = rl.count + 1
  returning rl.count into v_count;
  return v_count <= p_limit;
end;
$$;

create or replace function public.prune_rate_limits()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with d as (delete from public.rate_limits where window_start < now() - interval '2 days' returning 1)
  select count(*)::integer from d;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.create_restaurant(text, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.create_invitation(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.claim_invitations() to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.prune_rate_limits() to service_role;
