-- ============================================================
-- 015 - Public PWD ID verification without exposing whole tables
--
-- Anonymous visitors can verify one exact ID number through this function.
-- RLS remains enabled on profiles and pwd_applications. Full printed-card
-- details are returned only when the caller presents the QR/NFC token.
-- A manual ID-only check returns the minimum identity and validity result.
--
-- Do not apply migration 014: it makes all profile and application rows
-- readable to the public and allows direct anonymous audit inserts.
-- ============================================================

drop policy if exists "profiles_select_anon" on public.profiles;
drop policy if exists "verification_transactions_insert_anon"
  on public.verification_transactions;
drop policy if exists "pwd_applications_select_anon" on public.pwd_applications;

create or replace function public.verify_public_pwd_id(
  p_pwd_id text,
  p_method text default 'Manual',
  p_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lookup text := btrim(coalesce(p_pwd_id, ''));
  v_method text := upper(btrim(coalesce(p_method, 'MANUAL')));
  v_method_for_log text;
  v_profile public.profiles%rowtype;
  v_card public.pwd_applications%rowtype;
  v_expected_token text;
  v_supplied_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_token_verified boolean := false;
  v_stale_token boolean := false;
  v_expired boolean := false;
  v_method_disabled boolean := false;
  v_approved boolean := false;
  v_failure_reason text;
  v_card_json jsonb := null;
  v_legacy_birthdate text;
begin
  if v_lookup = '' then
    return jsonb_build_object(
      'ok', false,
      'message', 'PWD ID is required for verification.'
    );
  end if;

  if v_method not in ('QR', 'NFC', 'RFID', 'MANUAL') then
    v_method := 'MANUAL';
  end if;
  v_method_for_log := case
    when v_method = 'MANUAL' then 'Manual'
    else v_method
  end;

  select p.*
    into v_profile
    from public.profiles as p
   where p.id_number = v_lookup
      or p.id::text = v_lookup
   limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'PWD ID not found, is not valid, or has not been approved yet.'
    );
  end if;

  v_expected_token := nullif(btrim(v_profile.qr_token), '');
  v_token_verified := v_expected_token is not null
    and v_supplied_token = v_expected_token;

  -- QR/NFC links must prove possession of the card's current secret. A manual
  -- ID-only lookup can confirm validity, but cannot reveal the printed details.
  v_stale_token := v_expected_token is not null
    and (v_method in ('QR', 'NFC') or v_supplied_token is not null)
    and v_supplied_token is distinct from v_expected_token;

  v_expired := v_profile.valid_until is not null
    and v_profile.valid_until::date < current_date;
  v_method_disabled := (v_method = 'QR' and not v_profile.qr_enabled)
    or (v_method = 'NFC' and not v_profile.nfc_enabled);
  v_approved := v_profile.application_status = 'Approved'
    and v_profile.role = 'pwd'
    and not v_expired
    and not v_method_disabled
    and not v_stale_token;

  v_failure_reason := case
    when v_approved then null
    when v_profile.role <> 'pwd' then 'Not a PWD account'
    when v_profile.application_status <> 'Approved'
      then 'Application status: ' || coalesce(v_profile.application_status, 'unknown')
    when v_expired then 'ID expired'
    when v_method_disabled then v_method_for_log || ' verification is disabled'
    when v_stale_token then 'Code is out of date'
    else 'ID is not valid'
  end;

  insert into public.verification_transactions
    (pwd_id, verifier_id, method, result, failure_reason)
  values
    (v_profile.id,
     case
       when auth.uid() is not null
         and exists (select 1 from public.profiles where id = auth.uid())
         then auth.uid()
       else null
     end,
     v_method_for_log,
     case when v_approved then 'Success' else 'Failed' end,
     v_failure_reason);

  if not v_approved then
    return jsonb_build_object(
      'ok', false,
      'message', case
        when v_stale_token then
          'This code is no longer valid. Ask the holder for their latest card.'
        when v_method_disabled then
          v_method_for_log || ' verification is disabled by the cardholder.'
        when v_expired then 'This PWD ID has expired.'
        else 'PWD ID not found, is not valid, or has not been approved yet.'
      end
    );
  end if;

  if v_token_verified then
    select a.*
      into v_card
      from public.pwd_applications as a
     where a.user_id = v_profile.id
     order by a.submitted_at desc nulls last, a.created_at desc
     limit 1;

    if found then
      v_legacy_birthdate := case
        when coalesce(v_card.disability_type, '')
          ~ '^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{2,4}$'
          then v_card.disability_type
        else ''
      end;

      v_card_json := jsonb_build_object(
        'photoUrl', coalesce(v_card.photo_url, ''),
        'signatureUrl', coalesce(v_card.signature_url, ''),
        'bgFront', lower(coalesce(v_card.bg_front, '')),
        'birthdate', coalesce(nullif(btrim(v_card.birthdate), ''), v_legacy_birthdate),
        'sex', coalesce(v_card.sex, ''),
        'bloodType', coalesce(v_card.blood_type, ''),
        'disabilityType', case
          when v_legacy_birthdate <> '' then ''
          else coalesce(v_card.disability_type, '')
        end,
        'emergencyName', coalesce(v_card.emergency_name, ''),
        'emergencyContact', coalesce(v_card.emergency_contact, ''),
        'address', coalesce(v_card.address, ''),
        'dateIssued', coalesce(v_card.reviewed_at, v_card.submitted_at)
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', 'PWD ID is valid.',
    'method', v_method_for_log,
    'account', jsonb_build_object(
      'id', v_profile.id,
      'idNumber', v_profile.id_number,
      'firstName', coalesce(v_profile.first_name, '—'),
      'lastName', coalesce(v_profile.last_name, '—'),
      'validUntil', case
        when v_profile.valid_until is null then null
        else to_char(v_profile.valid_until, 'Mon DD, YYYY')
      end,
      'approvedAt', case
        when v_profile.approved_at is null then null
        else to_char(v_profile.approved_at, 'Mon DD, YYYY')
      end
    ),
    'card', v_card_json,
    'cardDetailsAvailable', v_token_verified
  );
end;
$$;

revoke all on function public.verify_public_pwd_id(text, text, text) from public;
grant execute on function public.verify_public_pwd_id(text, text, text)
  to anon, authenticated;
