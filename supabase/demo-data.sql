-- =====================================================================
--  Valgfrit: demo-ophold, så kalenderen ikke er tom, mens I prøver
--  systemet af. Kør EFTER at mindst én person har oprettet sin konto.
--
--  Alle demo-ophold er markeret med source = 'demo'. Fjern dem igen med:
--
--      delete from public.bookings where source = 'demo';
-- =====================================================================

do $$
declare
  d date := (now() at time zone 'Europe/Copenhagen')::date;
  admin_id uuid := (select id from public.profiles where role = 'admin' and active order by created_at limit 1);
  member_id uuid := (select id from public.profiles where role = 'member' and active order by created_at limit 1);
  member_name text := (select full_name from public.profiles where id = member_id);
begin
  if exists (select 1 from public.bookings where source = 'demo') then
    raise notice 'Demo-data findes allerede.';
    return;
  end if;

  insert into public.bookings (property_id, kind, status, start_date, end_date, title, source, created_by, decided_by, decided_at)
  values
    ('mallorca', 'owner',   'approved', d + 20, d + 34, 'Ejernes ferie (demo)', 'demo', admin_id, admin_id, now()),
    ('odde',     'blocked', 'approved', d + 40, d + 44, 'Vinterklargøring (demo)', 'demo', admin_id, admin_id, now());

  insert into public.bookings (property_id, kind, status, start_date, end_date, guests, person_name, guest_email, comment, source, decided_by, decided_at)
  values
    ('odde',     'stay', 'approved', d + 9,  d + 11, 4, 'Lars Jensen (demo)', 'lars@example.com', 'Weekend med familien', 'demo', admin_id, now()),
    ('mallorca', 'stay', 'pending',  d + 50, d + 54, 2, 'Peter Holm (demo)',  'peter@example.com', 'Venner af familien', 'demo', null, null);

  if member_id is not null then
    insert into public.bookings (property_id, kind, status, start_date, end_date, guests, user_id, person_name, comment, source, created_by)
    values ('odde', 'stay', 'pending', d + 16, d + 18, 2, member_id, member_name, 'Hyggeweekend (demo)', 'demo', member_id);
  end if;
end $$;
