-- Demo users and bookings for the LOCAL emulator only (dev/local-supabase.mjs).
-- All demo users have the password: ferie2026
-- Dates are relative to today, so the calendar always looks alive.
-- Ida has an invitation but no account yet (shows the invite flow).

insert into public.invitations (email, full_name, role, token) values
  ('anne@familien.dk',   'Anne',   'admin', 'local-invite-anne-0000000'),
  ('bent@familien.dk',   'Bent',   'admin', 'local-invite-bent-0000000'),
  ('carl@familien.dk',   'Carl',   'member', 'local-invite-carl-0000000'),
  ('dorte@familien.dk',  'Dorte',  'member', 'local-invite-dorte-000000'),
  ('eva@familien.dk',    'Eva',    'member', 'local-invite-eva-00000000'),
  ('frank@familien.dk',  'Frank',  'member', 'local-invite-frank-000000'),
  ('gitte@familien.dk',  'Gitte',  'member', 'local-invite-gitte-000000'),
  ('hans@familien.dk',   'Hans',   'member', 'local-invite-hans-0000000'),
  ('ida@familien.dk',    'Ida',    'member', 'local-invite-ida-00000000')
on conflict do nothing;

insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
select i.email, extensions.crypt('ferie2026', extensions.gen_salt('bf', 8)), now(),
       jsonb_build_object('invite_token', i.token)
from public.invitations i
where i.email <> 'ida@familien.dk'
  and not exists (select 1 from auth.users u where u.email = i.email)
order by i.created_at;

do $$
declare
  d date := (now() at time zone 'Europe/Copenhagen')::date;
  anne uuid := (select id from public.profiles where email = 'anne@familien.dk');
  bent uuid := (select id from public.profiles where email = 'bent@familien.dk');
  carl uuid := (select id from public.profiles where email = 'carl@familien.dk');
  dorte uuid := (select id from public.profiles where email = 'dorte@familien.dk');
  eva uuid := (select id from public.profiles where email = 'eva@familien.dk');
  frank uuid := (select id from public.profiles where email = 'frank@familien.dk');
  gitte uuid := (select id from public.profiles where email = 'gitte@familien.dk');
  hans uuid := (select id from public.profiles where email = 'hans@familien.dk');
  link uuid;
  b uuid;
begin
  if exists (select 1 from public.bookings) then
    return;
  end if;

  update public.profiles set phone = '+45 20 11 22 33' where id = carl;

  insert into public.guest_links (label, property_id, created_by, token)
  values ('Peter og Lise', null, frank, 'local-guest-link-peter-000')
  returning id into link;

  -- Mallorca
  insert into public.bookings (property_id, kind, status, start_date, end_date, guests, user_id, person_name, comment, source, created_by, decided_by, decided_at, decision_note)
  values
    ('mallorca', 'stay', 'approved', d - 58, d - 51, 2, carl,   'Carl',   'Sommerferie', 'member', carl, anne, now() - interval '90 days', null),
    ('mallorca', 'stay', 'approved', d + 11, d + 18, 4, carl,   'Carl',   'Os fire, efterårsferie', 'member', carl, anne, now() - interval '5 days', 'Nøglen ligger hos naboen. God tur!'),
    ('mallorca', 'stay', 'rejected', d + 13, d + 16, 2, dorte,     'Dorte',     null, 'member', dorte, bent, now() - interval '4 days', 'Desværre, Carl har huset den uge. Hvad med i november?'),
    ('mallorca', 'stay', 'pending',  d + 45, d + 48, 3, eva,    'Eva',    'Forlænget weekend med veninderne', 'member', eva, null, null, null),
    ('mallorca', 'stay', 'approved', d + 70, d + 77, 2, gitte, 'Gitte', 'Vandretur i bjergene', 'member', gitte, anne, now() - interval '12 days', null),
    ('mallorca', 'stay', 'cancelled', d + 80, d + 84, 2, gitte, 'Gitte', null, 'member', gitte, gitte, now() - interval '2 days', 'Planerne er ændret');
  insert into public.bookings (property_id, kind, status, start_date, end_date, title, source, created_by, decided_by, decided_at)
  values
    ('mallorca', 'owner',   'approved', d + 25, d + 39, 'Ejernes ferie', 'admin', anne, anne, now()),
    ('mallorca', 'blocked', 'approved', d + 63, d + 67, 'Maler skodder', 'admin', bent, bent, now());
  insert into public.bookings (property_id, kind, status, start_date, end_date, guests, person_name, guest_email, guest_phone, guest_link_id, status_token, comment, source)
  values ('mallorca', 'stay', 'pending', d + 52, d + 56, 2, 'Peter Holm', 'peter@example.com', '+45 22 33 44 55', link,
          'local-status-token-peter-0001', 'Vi er venner af Frank og vil meget gerne låne huset et par dage.', 'guest');

  -- Sjællands Odde
  insert into public.bookings (property_id, kind, status, start_date, end_date, guests, user_id, person_name, comment, source, created_by, decided_by, decided_at)
  values
    ('odde', 'stay', 'approved', d - 79, d - 72, 5, frank,    'Frank',    null, 'member', frank, bent, now() - interval '120 days'),
    ('odde', 'stay', 'approved', d + 4,  d + 6,  3, dorte,   'Dorte',   'Weekend med veninderne', 'member', dorte, anne, now() - interval '10 days'),
    ('odde', 'stay', 'pending',  d + 18, d + 20, 2, carl, 'Carl', 'Hyggeweekend', 'member', carl, null, null),
    ('odde', 'stay', 'approved', d + 25, d + 27, 4, hans,  'Hans',  'Fisketur med drengene', 'member', hans, bent, now() - interval '3 days'),
    ('odde', 'stay', 'pending',  d + 44, d + 47, 6, frank,    'Frank',    'Fødselsdagsweekend', 'member', frank, null, null);
  insert into public.bookings (property_id, kind, status, start_date, end_date, title, source, created_by, decided_by, decided_at)
  values
    ('odde', 'owner',   'approved', d - 3,  d + 2,  'Ejernes ferie', 'admin', bent, bent, now() - interval '20 days'),
    ('odde', 'blocked', 'approved', d + 35, d + 39, 'Vinterklargøring', 'admin', bent, bent, now()),
    ('odde', 'owner',   'approved', (date_trunc('year', d) + interval '11 months 22 days')::date,
                                    (date_trunc('year', d) + interval '11 months 27 days')::date, 'Jul på Odden', 'admin', anne, anne, now());

  select id into b from public.bookings where person_name = 'Peter Holm';
  insert into public.booking_notes (booking_id, note, updated_by) values (b, 'Frank siger god for dem.', anne);

  update public.property_access set wifi_name = 'Casa-Net', wifi_password = 'naranjas2026',
    access_info = 'Nøglen hos naboen. Ring på +34 600 000 000.' where property_id = 'mallorca';
  update public.property_access set wifi_name = 'Odden-Net', wifi_password = 'fyrretrae',
    access_info = 'Nøgleboks til venstre for hoveddøren. Kode: 0000.' where property_id = 'odde';
  update public.properties set contact_phone = '+45 20 00 00 01' where id = 'mallorca';
  update public.properties set contact_phone = '+45 20 00 00 02' where id = 'odde';
end $$;
