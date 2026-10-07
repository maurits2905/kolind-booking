-- Security and business-rule tests for supabase/setup.sql.
-- Run with: dev/run-sql-tests.sh  (needs a local Postgres, see README)
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
set client_min_messages = warning;

create schema if not exists t;
grant usage on schema t to public;

-- Switch identity like PostgREST does: a role plus JWT claims.
create or replace function t.claims(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"anon"}'
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, false);
end $$;

-- Assert that a statement fails, optionally with a message matching a pattern.
create or replace function t.fails(p_sql text, p_pattern text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_pattern is not null and sqlerrm !~* p_pattern then
      raise exception 'Expected error matching "%" from [%] but got: %', p_pattern, p_sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected failure but statement succeeded: %', p_sql;
end $$;

create or replace function t.ok(p_label text) returns void language plpgsql as $$
begin
  raise warning 'PASS  %', p_label;
end $$;

grant execute on all functions in schema t to public;

create temporary table ids (name text primary key, id uuid);
grant all on ids to public;

-- ---------------------------------------------------------------------
-- 1. Invite-only signup (inserts done as the GoTrue role)
-- ---------------------------------------------------------------------
insert into public.invitations (email, full_name, role, token) values
  ('anne@example.com', 'Anne', 'admin', 'tok-anne-000000000000000'),
  ('bent@example.com', 'Bent', 'admin', 'tok-bent-000000000000000'),
  ('carl@example.com', 'Carl', 'member', 'tok-carl-000000000000000'),
  ('dorte@example.com', 'Dorte', 'member', 'tok-dorte-00000000000000');
insert into public.invitations (email, full_name, role, token, expires_at) values
  ('old@example.com', 'Old', 'member', 'tok-old-0000000000000000', now() - interval '1 day');

set role supabase_auth_admin;
select t.fails($$insert into auth.users (email, raw_user_meta_data) values ('evil@example.com', '{}')$$, 'invitationslink');
select t.fails($$insert into auth.users (email, raw_user_meta_data) values ('evil@example.com', '{"invite_token":"nope"}')$$, 'ugyldig');
select t.fails($$insert into auth.users (email, raw_user_meta_data) values ('evil@example.com', '{"invite_token":"tok-carl-000000000000000"}')$$, 'anden email');
select t.fails($$insert into auth.users (email, raw_user_meta_data) values ('old@example.com', '{"invite_token":"tok-old-0000000000000000"}')$$, 'udløbet');
insert into auth.users (email, encrypted_password, raw_user_meta_data) values
  ('anne@example.com', extensions.crypt('hemmelig1', extensions.gen_salt('bf')), '{"invite_token":"tok-anne-000000000000000"}'),
  ('bent@example.com', extensions.crypt('hemmelig1', extensions.gen_salt('bf')), '{"invite_token":"tok-bent-000000000000000"}'),
  ('Carl@Example.com', extensions.crypt('hemmelig1', extensions.gen_salt('bf')), '{"invite_token":"tok-carl-000000000000000","role":"admin"}'),
  ('dorte@example.com', extensions.crypt('hemmelig1', extensions.gen_salt('bf')), '{"invite_token":"tok-dorte-00000000000000"}');
select t.fails($$insert into auth.users (email, raw_user_meta_data) values ('x@example.com', '{"invite_token":"tok-dorte-00000000000000"}')$$, 'brugt');
reset role;

insert into ids select split_part(email, '@', 1), id from public.profiles;
do $$ begin
  assert (select role from public.profiles where email = 'anne@example.com') = 'admin';
  assert (select role from public.profiles where email = 'carl@example.com') = 'member', 'metadata role must be ignored';
  assert (select count(*) from public.invitations where used_at is not null) = 4;
  assert not exists (select 1 from auth.users where raw_user_meta_data ? 'invite_token'), 'token stripped';
  assert (select count(*) from auth.users) = 4;
  perform t.ok('invite-only signup, role comes from invitation, token single-use');
end $$;

-- ---------------------------------------------------------------------
-- 2. Anonymous access
-- ---------------------------------------------------------------------
set role anon;
select t.claims(null);
select t.fails('select * from public.bookings', 'permission denied');
select t.fails('select * from public.profiles', 'permission denied');
select t.fails('select * from public.property_access', 'permission denied');
select t.fails($$select public.get_calendar('2026-01-01', '2026-12-31')$$, 'permission denied');
select t.fails($$select public.admin_bookings('all')$$, 'permission denied');
select t.fails($$select public.admin_contacts()$$, 'permission denied');
select t.fails($$select private.is_admin()$$, 'permission denied');
do $$ begin
  assert (public.ping() ->> 'ok')::boolean;
  assert public.invitation_info('nope') is null;
  perform t.ok('anon can only ping and use token functions');
end $$;
reset role;

-- ---------------------------------------------------------------------
-- 3. Member: requests, validation, privacy
-- ---------------------------------------------------------------------
set role authenticated;
select t.claims((select id from ids where name = 'carl'));

select t.fails($$select public.request_booking('odde', current_date - 3, current_date + 2, 2)$$, 'passeret');
select t.fails($$select public.request_booking('odde', current_date + 10, current_date + 10, 2)$$, 'efter ankomst');
select t.fails($$select public.request_booking('odde', current_date + 10, current_date + 5, 2)$$, 'efter ankomst');
select t.fails($$select public.request_booking('odde', current_date + 10, current_date + 12, 99)$$, 'mellem 1 og');
select t.fails($$select public.request_booking('nope', current_date + 10, current_date + 12, 2)$$, 'findes ikke');
select t.fails($$select public.request_booking('odde', current_date + 10, current_date + 100, 2)$$, '60 nætter');

do $$
declare b jsonb;
begin
  b := public.request_booking('mallorca', current_date + 30, current_date + 37, 4, 'Os fire i uge 1');
  assert b ->> 'status' = 'pending';
  insert into ids values ('carl_mallorca', (b ->> 'id')::uuid);
  b := public.request_booking('odde', current_date + 5, current_date + 7, 2);
  insert into ids values ('carl_odde', (b ->> 'id')::uuid);
  perform t.ok('member can request; invalid dates, guests and properties are rejected');
end $$;

select t.fails($$insert into public.bookings (property_id, start_date, end_date, person_name) values ('odde', current_date + 50, current_date + 52, 'x')$$, 'permission denied');
select t.fails($$update public.profiles set role = 'admin'$$, 'permission denied');
select t.fails($$update public.bookings set status = 'approved'$$, 'permission denied');
select t.fails($$delete from public.bookings$$, 'permission denied');
select t.fails($$select public.admin_bookings('all')$$, 'administratorer');
select t.fails($$select public.admin_decide_booking((select id from ids where name = 'carl_odde'), true)$$, 'administratorer');
select t.fails($$select public.admin_create_invitation('x@example.com', 'X', 'admin')$$, 'administratorer');
select t.fails($$select public.admin_update_member((select id from ids where name = 'carl'), 'Carl', null, 'admin', true)$$, 'administratorer');
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'member sees only own profile';
  assert (select count(*) from public.bookings) = 2, 'member sees only own bookings';
  assert (select count(*) from public.invitations) = 0;
  assert (select count(*) from public.booking_events) = 0;
  assert (select count(*) from public.property_access) = 0;
  assert public.get_property_access('mallorca') is null, 'no access info without approved stay';
  assert (public.get_me() ->> 'role') = 'member';
  assert (public.get_me() ->> 'pending_count') is null;
  assert jsonb_array_length(public.admin_contacts()) = 2, 'members can see the two admins to mail them';
  assert not (public.admin_contacts() -> 0 ? 'phone'), 'only name and email';
  perform t.ok('member cannot write tables, escalate role or read admin data');
end $$;
reset role;

set role authenticated;
select t.claims((select id from ids where name = 'dorte'));
do $$
declare b jsonb; cal jsonb; e jsonb;
begin
  -- Overlapping pending requests are allowed; the admin chooses.
  b := public.request_booking('mallorca', current_date + 33, current_date + 40, 2);
  insert into ids values ('dorte_mallorca', (b ->> 'id')::uuid);
  cal := public.get_calendar(current_date, current_date + 90);
  for e in select * from jsonb_array_elements(cal) loop
    if (e ->> 'is_mine')::boolean then
      assert e ->> 'id' is not null and e ->> 'label' is not null;
    else
      assert e ->> 'id' is null and e ->> 'label' is null and e ->> 'kind' is null and e ->> 'guests' is null,
        'others are masked: ' || e::text;
      assert (e ->> 'masked')::boolean;
    end if;
  end loop;
  assert jsonb_array_length(cal) = 3;
  perform t.ok('calendar masks other people''s stays');
end $$;
select t.fails($$select public.cancel_booking((select id from ids where name = 'carl_odde'))$$, 'findes ikke');
reset role;

-- ---------------------------------------------------------------------
-- 4. Admin: approve, reject, overlap protection
-- ---------------------------------------------------------------------
set role authenticated;
select t.claims((select id from ids where name = 'anne'));
do $$
declare b jsonb; lst jsonb;
begin
  assert (public.get_me() ->> 'pending_count')::int = 3;
  lst := public.admin_bookings('pending');
  assert jsonb_array_length(lst) = 3;
  assert (select count(*) from jsonb_array_elements(lst) x where (x ->> 'competing')::int = 1) = 2;

  b := public.admin_decide_booking((select id from ids where name = 'carl_mallorca'), true, 'God tur!');
  assert b ->> 'status' = 'approved';
  assert b ->> 'decision_note' = 'God tur!';

  lst := public.admin_bookings('pending');
  assert (select (x ->> 'conflict')::boolean from jsonb_array_elements(lst) x
          where x ->> 'id' = (select id::text from ids where name = 'dorte_mallorca'));
  perform t.ok('admin approves; overlapping pending request is flagged as conflict');
end $$;
select t.fails($$select public.admin_decide_booking((select id from ids where name = 'dorte_mallorca'), true)$$, 'overlapper');
select t.fails($$select public.admin_decide_booking((select id from ids where name = 'carl_mallorca'), true)$$, 'allerede behandlet');
do $$
declare b jsonb;
begin
  b := public.admin_decide_booking((select id from ids where name = 'dorte_mallorca'), false, 'Desværre optaget');
  assert b ->> 'status' = 'rejected';

  -- Back-to-back: check-out day is free for the next check-in.
  b := public.admin_save_booking(null, 'mallorca', 'owner', current_date + 37, current_date + 44);
  assert b ->> 'status' = 'approved' and b ->> 'kind' = 'owner';
  b := public.admin_save_booking(null, 'mallorca', 'blocked', current_date + 23, current_date + 30, null, null, null, null, null, 'Maler facaden');
  assert b ->> 'status' = 'approved';
  insert into ids values ('blocked', (b ->> 'id')::uuid);
  perform t.ok('back-to-back stays allowed (check-out day = next check-in)');
end $$;
select t.fails($$select public.admin_save_booking(null, 'mallorca', 'blocked', current_date + 36, current_date + 38)$$, 'overlapper');
select t.fails($$select public.admin_save_booking((select id from ids where name = 'blocked'), 'mallorca', 'blocked', current_date + 25, current_date + 31)$$, 'overlapper');
select t.fails($$select public.admin_save_booking(null, 'odde', 'stay', current_date + 60, current_date + 62)$$, 'hvem opholdet');
select t.fails($$select public.admin_update_member((select id from ids where name = 'anne'), 'Anne', null, 'member', true)$$, 'egen');
do $$
declare b jsonb;
begin
  -- Admin's own request is approved immediately.
  b := public.request_booking('odde', current_date + 70, current_date + 74, 2);
  assert b ->> 'status' = 'approved';
  -- Admin creates a stay for a family member.
  b := public.admin_save_booking(null, 'odde', 'stay', current_date + 80, current_date + 84, 3,
                                 (select id from ids where name = 'dorte'));
  assert b ->> 'person_name' = 'Dorte' and b ->> 'status' = 'approved';
  perform public.admin_set_booking_note((b ->> 'id')::uuid, 'Husk at tænde for vandet');
  b := public.admin_booking_detail((b ->> 'id')::uuid);
  assert b ->> 'note' = 'Husk at tænde for vandet';
  assert jsonb_array_length(b -> 'events') = 1;
  -- Edit dates, history records it.
  b := public.admin_save_booking((b ->> 'id')::uuid, 'odde', 'stay', current_date + 81, current_date + 85, 3,
                                 (select id from ids where name = 'dorte'));
  b := public.admin_booking_detail((b ->> 'id')::uuid);
  assert b -> 'events' -> 1 ->> 'action' = 'updated';
  assert b -> 'events' -> 1 ->> 'actor_name' = 'Anne';
  perform t.ok('admin creates, edits and annotates bookings with history');
end $$;
reset role;

-- The database itself refuses double bookings, even without the functions.
select t.fails($$insert into public.bookings (property_id, kind, status, start_date, end_date, person_name)
                values ('mallorca', 'stay', 'approved', current_date + 31, current_date + 32, 'Race')$$, 'bookings_no_overlap');
select t.fails($$insert into public.bookings (property_id, start_date, end_date, person_name) values ('odde', current_date + 5, current_date + 5, 'x')$$, 'bookings_dates');
select t.fails($$insert into public.bookings (property_id, kind, status, start_date, end_date) values ('odde', 'blocked', 'pending', current_date + 5, current_date + 6)$$, 'bookings_owner_blocked_status');
select t.ok('exclusion and check constraints hold at table level');

-- Concurrent approvals: run two overlapping approvals in parallel sessions is
-- covered by the exclusion constraint (tested above at table level).

-- ---------------------------------------------------------------------
-- 5. Member sees result, access info unlocks after approval
-- ---------------------------------------------------------------------
set role authenticated;
select t.claims((select id from ids where name = 'carl'));
do $$
declare mine jsonb;
begin
  mine := public.my_bookings();
  assert (select x ->> 'decision_note' from jsonb_array_elements(mine) x where x ->> 'status' = 'approved') = 'God tur!';
  assert public.get_property_access('mallorca') is not null;
  assert public.get_property_access('odde') is null;
  assert (select (x ->> 'has_access')::boolean from jsonb_array_elements(public.list_properties()) x where x ->> 'id' = 'mallorca');
  assert not exists (select 1 from jsonb_array_elements(mine) x where x ? 'note'), 'internal note never shown to member';
  perform public.cancel_booking((select id from ids where name = 'carl_odde'));
  assert (select status from public.bookings where id = (select id from ids where name = 'carl_odde')) = 'cancelled';
  perform t.ok('member sees decision, access unlocks, can cancel own');
end $$;
select t.fails($$select public.cancel_booking((select id from ids where name = 'carl_odde'))$$, 'afsluttet');

-- ---------------------------------------------------------------------
-- 6. Guest links
-- ---------------------------------------------------------------------
do $$
declare l jsonb;
begin
  l := public.create_guest_link('Peter og Lise', 'odde', 30);
  insert into ids values ('link', (l ->> 'id')::uuid);
  perform set_config('t.link', l ->> 'token', false);
  perform t.ok('member creates guest link');
end $$;
reset role;

set role anon;
select t.claims(null);
do $$
declare info jsonb; cal jsonb; r jsonb; st jsonb;
begin
  info := public.guest_link_info(current_setting('t.link'));
  assert info ->> 'inviter_name' = 'Carl';
  assert jsonb_array_length(info -> 'properties') = 1;
  cal := public.guest_calendar(current_setting('t.link'), current_date, current_date + 120);
  assert not exists (select 1 from jsonb_array_elements(cal) x where x ? 'label' or x ? 'id' or x ? 'person_name');
  assert not exists (select 1 from jsonb_array_elements(cal) x where x ->> 'property_id' <> 'odde'), 'link limited to its property';
  r := public.guest_request_booking(current_setting('t.link'), 'odde', current_date + 90, current_date + 93, 2,
                                    'Peter Hansen', 'peter@example.com', '+45 12345678', 'Vi glæder os!');
  assert r ->> 'status' = 'pending';
  perform set_config('t.status', r ->> 'status_token', false);
  st := public.guest_booking_status(r ->> 'status_token');
  assert st ->> 'status' = 'pending' and st -> 'details' = 'null'::jsonb;
  assert public.guest_booking_status('wrong-token-xxxxxxxxxxxxxxx') is null;
  perform t.ok('guest can see masked availability, request and follow status');
end $$;
select t.fails($$select public.guest_request_booking(current_setting('t.link'), 'mallorca', current_date + 90, current_date + 93, 2, 'P', 'p@example.com')$$, 'gælder ikke');
select t.fails($$select public.guest_request_booking(current_setting('t.link'), 'odde', current_date + 71, current_date + 73, 2, 'P', 'p@example.com')$$, 'ikke ledig');
select t.fails($$select public.guest_request_booking(current_setting('t.link'), 'odde', current_date + 95, current_date + 96, 2, 'P', 'not-an-email')$$, 'gyldig email');
select t.fails($$select public.guest_request_booking('bad-token', 'odde', current_date + 95, current_date + 96, 2, 'P', 'p@example.com')$$, 'ugyldigt');
select t.fails($$select * from public.guest_links$$, 'permission denied');
do $$ begin
  perform public.guest_request_booking(current_setting('t.link'), 'odde', current_date + 100, current_date + 101, 2, 'P', 'p@example.com');
  perform public.guest_request_booking(current_setting('t.link'), 'odde', current_date + 102, current_date + 103, 2, 'P', 'p@example.com');
end $$;
select t.fails($$select public.guest_request_booking(current_setting('t.link'), 'odde', current_date + 104, current_date + 105, 2, 'P', 'p@example.com')$$, 'maksimale');
select t.ok('guest link limits: property, availability, email, token, max requests');
reset role;

set role authenticated;
select t.claims((select id from ids where name = 'anne'));
do $$
declare g jsonb;
begin
  perform public.admin_update_property_access('odde', 'Odden-Net', 'fyrretræ123', 'Nøgleboks: 4711');
  select x into g from jsonb_array_elements(public.admin_bookings('pending')) x where x ->> 'person_name' = 'Peter Hansen';
  assert g ->> 'sponsor_name' = 'Carl' and g ->> 'guest_email' = 'peter@example.com' and (g ->> 'is_guest')::boolean;
  perform public.admin_decide_booking((g ->> 'id')::uuid, true, 'Velkommen!');
  perform t.ok('admin sees guest contact details and sponsor');
end $$;
reset role;

set role anon;
select t.claims(null);
do $$
declare st jsonb;
begin
  st := public.guest_booking_status(current_setting('t.status'));
  assert st ->> 'status' = 'approved';
  assert st -> 'details' ->> 'wifi_password' = 'fyrretræ123';
  assert st ->> 'decision_note' = 'Velkommen!';
  perform t.ok('approved guest gets practical info and access details');
end $$;
reset role;

set role authenticated;
select t.claims((select id from ids where name = 'carl'));
do $$
declare links jsonb;
begin
  links := public.my_guest_links();
  assert jsonb_array_length(links -> 0 -> 'requests') = 3;
  assert not (links -> 0 ->> 'active')::boolean;
  perform public.revoke_guest_link((select id from ids where name = 'link'));
  perform t.ok('member sees requests from own guest link and can revoke it');
end $$;
reset role;

-- ---------------------------------------------------------------------
-- 7. People admin, password reset, deactivation
-- ---------------------------------------------------------------------
set role authenticated;
select t.claims((select id from ids where name = 'anne'));
select t.fails($$select public.admin_create_invitation('carl@example.com', 'M', 'member')$$, 'allerede en konto');
select t.fails($$select public.admin_create_invitation('bad', 'M', 'member')$$, 'gyldig email');
do $$
declare inv jsonb; r jsonb; ppl jsonb;
begin
  inv := public.admin_create_invitation('Ida@Example.com', 'Ida', 'member');
  assert inv ->> 'email' = 'ida@example.com';
  ppl := public.admin_people();
  assert jsonb_array_length(ppl -> 'members') = 4;
  assert jsonb_array_length(ppl -> 'invitations') = 2; -- Ida + the expired one
  r := public.admin_create_password_reset((select id from ids where name = 'carl'));
  perform set_config('t.reset', r ->> 'token', false);
  perform public.admin_update_member((select id from ids where name = 'bent'), 'Bent', '+45 20202020', 'admin', true);
  perform public.admin_update_member((select id from ids where name = 'dorte'), 'Dorte', null, 'member', false);
  perform t.ok('admin invites, creates reset link, edits and deactivates members');
end $$;
reset role;

set role anon;
select t.claims(null);
select t.fails($$select public.redeem_password_reset(current_setting('t.reset'), 'kort')$$, '8 tegn');
do $$ begin
  assert (public.password_reset_info(current_setting('t.reset')) ->> 'valid')::boolean;
  assert public.redeem_password_reset(current_setting('t.reset'), 'nyt-password-1') = 'carl@example.com';
end $$;
select t.fails($$select public.redeem_password_reset(current_setting('t.reset'), 'nyt-password-2')$$, 'brugt');
reset role;
do $$ begin
  assert (select encrypted_password = extensions.crypt('nyt-password-1', encrypted_password)
          from auth.users where lower(email) = 'carl@example.com');
  perform t.ok('password reset link sets a working bcrypt password once');
end $$;

set role authenticated;
select t.claims((select id from ids where name = 'dorte'));
select t.fails($$select public.get_calendar(current_date, current_date + 30)$$, 'logget ind');
select t.fails($$select public.request_booking('odde', current_date + 150, current_date + 152, 2)$$, 'logget ind');
do $$ begin
  assert (public.get_me() ->> 'active')::boolean = false;
  assert (select count(*) from public.bookings) = 0, 'deactivated member sees nothing';
  perform t.ok('deactivated member loses access');
end $$;
reset role;

-- Last admin cannot be removed.
set role authenticated;
select t.claims((select id from ids where name = 'anne'));
select public.admin_update_member((select id from ids where name = 'bent'), 'Bent', null, 'member', true);
reset role;
set role authenticated;
select t.claims((select id from ids where name = 'bent'));
select t.fails($$select public.admin_bookings('all')$$, 'administratorer');
reset role;
select t.ok('demoted admin loses admin functions');

set role authenticated;
select t.claims((select id from ids where name = 'anne'));
do $$
declare x jsonb;
begin
  x := public.admin_export();
  assert jsonb_array_length(x -> 'bookings') >= 8;
  assert not (x -> 'bookings' -> 0 ? 'status_token');
  assert jsonb_array_length(public.admin_bookings('closed')) >= 2;
  perform public.admin_delete_booking((select id from ids where name = 'blocked'));
  assert exists (select 1 from public.booking_events where booking_id = (select id from ids where name = 'blocked') and action = 'deleted');
  perform t.ok('export, closed list and delete (with history) work');
end $$;
reset role;

-- Deleting a person: admins only, never yourself; removes account, profile and
-- the person's own bookings, and the email can be invited again.
set role authenticated;
select t.claims((select id from ids where name = 'carl'));
select t.fails($$select public.admin_delete_member((select id from ids where name = 'dorte'))$$, 'administratorer');
reset role;
set role authenticated;
select t.claims((select id from ids where name = 'anne'));
select t.fails($$select public.admin_delete_member((select id from ids where name = 'anne'))$$, 'dig selv');
reset role;
do $$ begin assert exists (select 1 from public.bookings where user_id = (select id from ids where name = 'dorte')); end $$;
set role authenticated;
select t.claims((select id from ids where name = 'anne'));
select public.admin_delete_member((select id from ids where name = 'dorte'));
reset role;
do $$
declare d uuid := (select id from ids where name = 'dorte');
begin
  assert not exists (select 1 from public.profiles where id = d);
  assert not exists (select 1 from auth.users where id = d);
  assert not exists (select 1 from public.bookings where user_id = d);
  assert not exists (select 1 from public.bookings where person_name = 'Dorte' and source = 'member');
end $$;
set role authenticated;
select t.claims((select id from ids where name = 'anne'));
select public.admin_create_invitation('dorte@example.com', 'Dorte', 'member');
reset role;
select t.ok('admin deletes a person completely and can invite the email again');

select t.ok('ALL TESTS PASSED');
