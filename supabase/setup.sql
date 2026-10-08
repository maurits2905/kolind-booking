-- =====================================================================
--  Kolind Booking · database setup for Supabase (Free plan)
--
--  Kør hele filen i Supabase → SQL Editor → Run.
--  Filen kan køres igen efter en opdatering: tabeller oprettes kun hvis
--  de mangler, funktioner og policies erstattes, og data bevares.
--
--  Datomodel for ophold:
--    start_date = ankomstdag (check-in), end_date = afrejsedag (check-out).
--    Et ophold dækker nætterne [start_date, end_date). Afrejsedagen er
--    derfor ledig som ankomstdag for det næste ophold (1.-7. juli og
--    7.-14. juli overlapper ikke).
--
--  Sikkerhedsmodel:
--    * RLS er slået til på alle tabeller. Klienter må kun læse deres egne
--      rækker (admins må læse alt). Ingen klient kan skrive direkte.
--    * Alle ændringer sker gennem funktionerne nederst (RPC). De tjekker
--      rolle, ejerskab, datoer og kapacitet.
--    * Databasen afviser overlappende godkendte ophold med en exclusion
--      constraint, så to samtidige godkendelser aldrig kan dobbeltbooke.
--    * Nye konti kan kun oprettes med et gyldigt invitationslink
--      (trigger på auth.users).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
--  Små hjælpefunktioner (skal findes før tabellerne)
-- ---------------------------------------------------------------------

create or replace function private.new_token() returns text
language sql volatile set search_path = '' as $$
  select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
$$;

create or replace function private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Copenhagen')::date
$$;

create or replace function private.clean(p_text text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p_text, '')), p_max), '')
$$;

-- ---------------------------------------------------------------------
--  Tabeller
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 1 and 80),
  email       text not null,
  phone       text check (phone is null or char_length(phone) <= 30),
  role        text not null default 'member' check (role in ('admin', 'member')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique default private.new_token(),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name   text not null check (char_length(full_name) between 1 and 80),
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  used_at     timestamptz,
  used_by     uuid references public.profiles(id) on delete set null
);

create table if not exists public.password_resets (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique default private.new_token(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz
);

create table if not exists public.properties (
  id              text primary key check (id ~ '^[a-z0-9-]+$'),
  name            text not null,
  area            text not null,
  tagline         text,
  description     text,
  address         text,
  country         text,
  latitude        double precision,
  longitude       double precision,
  check_in_time   text not null default '15:00',
  check_out_time  text not null default '11:00',
  max_guests      int not null default 8 check (max_guests between 1 and 50),
  arrival_info    text,
  practical_info  text,
  house_rules     text,
  contact_name    text,
  contact_phone   text,
  sort_order      int not null default 0,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

-- Følsomme oplysninger (Wi-Fi, nøgleboks m.m.). Vises kun for admins og
-- for personer med et godkendt, kommende eller igangværende ophold.
create table if not exists public.property_access (
  property_id    text primary key references public.properties(id) on delete cascade,
  wifi_name      text,
  wifi_password  text,
  access_info    text,
  updated_at     timestamptz not null default now()
);

create table if not exists public.guest_links (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique default private.new_token(),
  label          text not null check (char_length(label) between 1 and 80),
  property_id    text references public.properties(id) on delete cascade,
  created_by     uuid references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '60 days',
  max_requests   int not null default 3 check (max_requests between 1 and 10),
  request_count  int not null default 0,
  revoked_at     timestamptz
);

create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  property_id    text not null references public.properties(id) on delete restrict,
  -- stay = ophold for familie eller gæst, owner = ejernes egen ferie,
  -- blocked = lukket periode (håndværkere, udlejning, ...)
  kind           text not null default 'stay' check (kind in ('stay', 'owner', 'blocked')),
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  start_date     date not null,
  end_date       date not null,
  nights         int generated always as (end_date - start_date) stored,
  stay           daterange generated always as (daterange(start_date, end_date, '[)')) stored,
  guests         int check (guests between 1 and 50),
  user_id        uuid references public.profiles(id) on delete set null,
  person_name    text check (char_length(person_name) <= 80),
  guest_email    text check (char_length(guest_email) <= 120),
  guest_phone    text check (char_length(guest_phone) <= 30),
  guest_link_id  uuid references public.guest_links(id) on delete set null,
  status_token   text unique,
  title          text check (char_length(title) <= 80),
  comment        text check (char_length(comment) <= 1000),
  decision_note  text check (char_length(decision_note) <= 1000),
  source         text not null default 'member' check (source in ('member', 'admin', 'guest', 'demo')),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references public.profiles(id) on delete set null,
  constraint bookings_dates check (end_date > start_date and end_date - start_date <= 120),
  constraint bookings_owner_blocked_status check (kind = 'stay' or status in ('approved', 'cancelled')),
  constraint bookings_stay_has_person check (kind <> 'stay' or person_name is not null),
  -- Kernen i double-booking-beskyttelsen: to godkendte ophold i samme bolig
  -- kan aldrig dele en nat. Håndhæves af Postgres, også ved samtidige kald.
  constraint bookings_no_overlap exclude using gist (property_id with =, stay with &&)
    where (status = 'approved')
);

create index if not exists bookings_property_dates_idx on public.bookings (property_id, start_date);
create index if not exists bookings_user_idx on public.bookings (user_id);
create index if not exists bookings_pending_idx on public.bookings (start_date) where status = 'pending';
create index if not exists bookings_guest_link_idx on public.bookings (guest_link_id);

create table if not exists public.booking_notes (
  booking_id  uuid primary key references public.bookings(id) on delete cascade,
  note        text not null default '' check (char_length(note) <= 2000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

create table if not exists public.booking_events (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  details     jsonb
);

create index if not exists booking_events_booking_idx on public.booking_events (booking_id, at);

-- Indstillinger for hele siden (præcis én række).
create table if not exists public.settings (
  id           boolean primary key default true check (id),
  guest_links  boolean not null default false   -- må familien låne husene ud via gæstelinks?
);
insert into public.settings (id) values (true) on conflict (id) do nothing;

-- Billeder af husene. Selve filerne ligger i Supabase Storage (bucket "photos",
-- privat); tabellen holder rækkefølge og størrelse, så pladsen kan styres.
create table if not exists public.property_photos (
  id           uuid primary key default gen_random_uuid(),
  property_id  text not null references public.properties(id) on delete cascade,
  path         text not null unique check (path ~ '^[a-z0-9_-]+/[0-9a-f-]{36}\.(webp|jpg)$'),
  thumb_path   text not null unique check (thumb_path ~ '^[a-z0-9_-]+/[0-9a-f-]{36}-thumb\.(webp|jpg)$'),
  width        int check (width between 1 and 4000),
  height       int check (height between 1 and 4000),
  bytes        int not null check (bytes between 1 and 6291456),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);
create index if not exists property_photos_property_idx on public.property_photos (property_id, sort_order);

-- ---------------------------------------------------------------------
--  Rolle-hjælpere (bruges af RLS og funktioner)
-- ---------------------------------------------------------------------

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin')
$$;

create or replace function private.require_member() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member() then
    raise exception 'Du skal være logget ind for at gøre dette.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Kun administratorer kan gøre dette.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function private.check_stay(
  p_property_id text, p_start date, p_end date, p_guests int, p_allow_past boolean
) returns public.properties
language plpgsql stable security definer set search_path = '' as $$
declare
  v_prop public.properties;
begin
  select * into v_prop from public.properties where id = p_property_id;
  if not found then
    raise exception 'Boligen findes ikke.';
  end if;
  if p_start is null or p_end is null then
    raise exception 'Vælg både ankomst og afrejse.';
  end if;
  if p_end <= p_start then
    raise exception 'Afrejse skal ligge efter ankomst.';
  end if;
  if p_end - p_start > 60 and not p_allow_past then
    raise exception 'Et ophold kan højst vare 60 nætter.';
  end if;
  if not p_allow_past and p_start < private.today() then
    raise exception 'Ankomstdatoen er allerede passeret.';
  end if;
  if p_start > private.today() + 730 then
    raise exception 'Der kan kun bookes op til to år frem.';
  end if;
  if p_guests is not null and (p_guests < 1 or p_guests > v_prop.max_guests) then
    raise exception 'Antal personer skal være mellem 1 og %.', v_prop.max_guests;
  end if;
  return v_prop;
end $$;

create or replace function private.is_taken(p_property_id text, p_start date, p_end date, p_ignore uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.property_id = p_property_id
      and b.status = 'approved'
      and b.stay && daterange(p_start, p_end, '[)')
      and (p_ignore is null or b.id <> p_ignore)
  )
$$;

-- ---------------------------------------------------------------------
--  Triggers
-- ---------------------------------------------------------------------

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
  for each row execute function private.touch_updated_at();

drop trigger if exists properties_touch on public.properties;
create trigger properties_touch before update on public.properties
  for each row execute function private.touch_updated_at();

-- Historik: hver ændring af et ophold logges, uanset hvor den kommer fra.
create or replace function private.log_booking_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_row public.bookings := coalesce(new, old);
begin
  select p.full_name into v_name from public.profiles p where p.id = v_actor;
  if v_name is null then
    v_name := case
      when v_actor is null and v_row.source = 'guest' then coalesce(v_row.person_name, 'Gæst') || ' (gæst)'
      else 'System'
    end;
  end if;

  if tg_op = 'INSERT' then
    v_action := case when new.status = 'approved' then 'created' else 'requested' end;
    v_details := jsonb_build_object('start_date', new.start_date, 'end_date', new.end_date,
                                    'property_id', new.property_id, 'guests', new.guests);
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      v_action := new.status;
      if new.decision_note is not null then
        v_details := jsonb_build_object('message', new.decision_note);
      end if;
    elsif (new.start_date, new.end_date, new.property_id, new.guests, new.kind, new.person_name)
          is distinct from (old.start_date, old.end_date, old.property_id, old.guests, old.kind, old.person_name) then
      v_action := 'updated';
      v_details := jsonb_build_object(
        'from', jsonb_build_object('start_date', old.start_date, 'end_date', old.end_date,
                                   'property_id', old.property_id, 'guests', old.guests),
        'to',   jsonb_build_object('start_date', new.start_date, 'end_date', new.end_date,
                                   'property_id', new.property_id, 'guests', new.guests));
    else
      return new;
    end if;
  else
    v_action := 'deleted';
    v_details := jsonb_build_object('start_date', old.start_date, 'end_date', old.end_date,
                                    'property_id', old.property_id, 'person_name', old.person_name,
                                    'kind', old.kind, 'status', old.status);
  end if;

  insert into public.booking_events (booking_id, actor_id, actor_name, action, details)
  values (v_row.id, v_actor, v_name, v_action, v_details);
  return coalesce(new, old);
end $$;

drop trigger if exists bookings_log on public.bookings;
create trigger bookings_log after insert or update or delete on public.bookings
  for each row execute function private.log_booking_event();

-- Invitationer: en konto kan kun oprettes med et gyldigt invitationstoken.
-- Tokenet sendes med ved signUp i user metadata ("invite_token").
create or replace function private.auth_user_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_token text := new.raw_user_meta_data ->> 'invite_token';
begin
  if v_token is null or v_token = '' then
    raise exception 'Konti kan kun oprettes via et invitationslink.';
  end if;

  select * into v_inv from public.invitations where token = v_token for update;
  if not found or v_inv.used_at is not null or v_inv.expires_at < now() then
    raise exception 'Invitationen er ugyldig, brugt eller udløbet.';
  end if;
  if lower(v_inv.email) <> lower(new.email) then
    raise exception 'Invitationen gælder en anden email.';
  end if;

  new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite_token')
    || jsonb_build_object('full_name', v_inv.full_name, 'invitation_id', v_inv.id);
  return new;
end $$;

create or replace function private.auth_user_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations
  where id = (new.raw_user_meta_data ->> 'invitation_id')::uuid;

  insert into public.profiles (id, full_name, email, role)
  values (new.id, v_inv.full_name, lower(new.email), v_inv.role)
  on conflict (id) do nothing;

  update public.invitations set used_at = now(), used_by = new.id where id = v_inv.id;
  return new;
end $$;

drop trigger if exists kolind_before_signup on auth.users;
create trigger kolind_before_signup before insert on auth.users
  for each row execute function private.auth_user_before_insert();

drop trigger if exists kolind_after_signup on auth.users;
create trigger kolind_after_signup after insert on auth.users
  for each row execute function private.auth_user_after_insert();

-- ---------------------------------------------------------------------
--  Row Level Security
--  Læsning direkte fra tabellerne er begrænset til egne rækker. Appen
--  bruger funktionerne nedenfor, men RLS er sikkerhedsnettet.
-- ---------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.invitations     enable row level security;
alter table public.password_resets enable row level security;
alter table public.properties      enable row level security;
alter table public.property_access enable row level security;
alter table public.guest_links     enable row level security;
alter table public.bookings        enable row level security;
alter table public.booking_notes   enable row level security;
alter table public.booking_events  enable row level security;
alter table public.settings        enable row level security;
alter table public.property_photos enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists properties_read on public.properties;
create policy properties_read on public.properties for select to authenticated
  using ((select private.is_member()));

drop policy if exists property_access_read on public.property_access;
create policy property_access_read on public.property_access for select to authenticated
  using ((select private.is_admin()));

drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated
  using ((user_id = (select auth.uid()) and (select private.is_member())) or (select private.is_admin()));

drop policy if exists guest_links_read on public.guest_links;
create policy guest_links_read on public.guest_links for select to authenticated
  using ((created_by = (select auth.uid()) and (select private.is_member())) or (select private.is_admin()));

drop policy if exists invitations_read on public.invitations;
create policy invitations_read on public.invitations for select to authenticated
  using ((select private.is_admin()));

drop policy if exists password_resets_read on public.password_resets;
create policy password_resets_read on public.password_resets for select to authenticated
  using ((select private.is_admin()));

drop policy if exists booking_notes_read on public.booking_notes;
create policy booking_notes_read on public.booking_notes for select to authenticated
  using ((select private.is_admin()));

drop policy if exists booking_events_read on public.booking_events;
create policy booking_events_read on public.booking_events for select to authenticated
  using ((select private.is_admin()));

-- Ingen direkte skriveadgang for klienter. Kun SELECT (styret af RLS ovenfor).
revoke all on public.profiles, public.invitations, public.password_resets, public.properties,
              public.property_access, public.guest_links, public.bookings, public.booking_notes,
              public.booking_events
  from anon, authenticated;
grant select on public.profiles, public.invitations, public.password_resets, public.properties,
                public.property_access, public.guest_links, public.bookings, public.booking_notes,
                public.booking_events
  to authenticated;

-- =====================================================================
--  API (RPC-funktioner). Kaldes fra appen med supabase.rpc(...).
-- =====================================================================

-- Holder projektet aktivt (kaldes af GitHub Actions, se README).
create or replace function public.ping() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'at', now(), 'properties', (select count(*) from public.properties))
$$;

-- ---------- Egen profil ----------

create or replace function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
    'role', p.role, 'active', p.active,
    'guest_links', (select guest_links from public.settings),
    'pending_count', case when p.role = 'admin' and p.active then (
      select count(*) from public.bookings b
      where b.status = 'pending' and b.end_date >= private.today()) end)
  from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.update_my_profile(p_full_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
begin
  if private.clean(p_full_name, 80) is null then
    raise exception 'Skriv dit navn.';
  end if;
  update public.profiles
  set full_name = private.clean(p_full_name, 80), phone = private.clean(p_phone, 30)
  where id = v_uid;
  return public.get_me();
end $$;

-- ---------- Boliger ----------

create or replace function public.list_properties() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
  v_admin boolean := private.is_admin();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'has_access', v_admin or exists (
        select 1 from public.bookings b
        where b.property_id = p.id and b.user_id = v_uid and b.status = 'approved'
          and b.end_date >= private.today()))
      order by p.sort_order, p.name)
    from public.properties p), '[]'::jsonb);
end $$;

create or replace function public.get_property_access(p_property_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
begin
  if not (private.is_admin() or exists (
    select 1 from public.bookings b
    where b.property_id = p_property_id and b.user_id = v_uid and b.status = 'approved'
      and b.end_date >= private.today())) then
    return null;
  end if;
  return coalesce((
    select jsonb_build_object('wifi_name', a.wifi_name, 'wifi_password', a.wifi_password,
                              'access_info', a.access_info)
    from public.property_access a where a.property_id = p_property_id), '{}'::jsonb);
end $$;

-- ---------- Kalender ----------
-- Familiemedlemmer ser andres ophold som "optaget"/"forespurgt" uden navne.
-- Egne ophold vises med detaljer. Admins ser alt.

create or replace function public.get_calendar(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
  v_admin boolean := private.is_admin();
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 800 then
    raise exception 'Ugyldigt datointerval.';
  end if;

  return coalesce((
    select jsonb_agg(
      case when v_admin or b.user_id = v_uid then
        jsonb_build_object(
          'id', b.id, 'property_id', b.property_id, 'kind', b.kind, 'status', b.status,
          'start_date', b.start_date, 'end_date', b.end_date, 'guests', b.guests,
          'is_mine', b.user_id = v_uid, 'masked', false,
          'label', case
            when b.kind = 'blocked' then coalesce(b.title, 'Lukket')
            when b.kind = 'owner' then coalesce(b.title, 'Egen ferie')
            else coalesce(b.person_name, 'Ophold') end,
          'is_guest', b.kind = 'stay' and b.user_id is null)
      else
        jsonb_build_object(
          'id', null, 'property_id', b.property_id, 'kind', null, 'status', b.status,
          'start_date', b.start_date, 'end_date', b.end_date, 'guests', null,
          'is_mine', false, 'masked', true, 'label', null, 'is_guest', false)
      end
      order by b.start_date)
    from public.bookings b
    where b.status in ('pending', 'approved')
      and b.stay && daterange(p_from, p_to, '[)')), '[]'::jsonb);
end $$;

-- ---------- Forespørgsler fra familien ----------

create or replace function private.booking_json(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'property_id', b.property_id, 'property_name', p.name, 'kind', b.kind,
    'status', b.status, 'start_date', b.start_date, 'end_date', b.end_date, 'nights', b.nights,
    'guests', b.guests, 'person_name', b.person_name, 'title', b.title, 'comment', b.comment,
    'decision_note', b.decision_note, 'created_at', b.created_at, 'decided_at', b.decided_at,
    'decided_by_name', (select d.full_name from public.profiles d where d.id = b.decided_by),
    'source', b.source)
  from public.properties p where p.id = b.property_id
$$;

create or replace function public.request_booking(
  p_property_id text, p_start_date date, p_end_date date, p_guests int, p_comment text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
  v_admin boolean := private.is_admin();
  v_me public.profiles;
  v_row public.bookings;
begin
  perform private.check_stay(p_property_id, p_start_date, p_end_date, p_guests, false);
  if p_guests is null then
    raise exception 'Skriv hvor mange I er.';
  end if;
  select * into v_me from public.profiles where id = v_uid;

  if not v_admin and (select count(*) from public.bookings
                      where user_id = v_uid and status = 'pending') >= 5 then
    raise exception 'Du har allerede 5 åbne forespørgsler. Vent på svar, før du sender flere.';
  end if;

  -- Lås boligen kort, så to samtidige forespørgsler ser samme billede.
  perform 1 from public.properties where id = p_property_id for update;
  if private.is_taken(p_property_id, p_start_date, p_end_date) then
    raise exception 'Perioden er desværre ikke ledig længere. Vælg andre datoer.';
  end if;

  begin
    insert into public.bookings (property_id, kind, status, start_date, end_date, guests, user_id,
                                 person_name, comment, source, created_by, decided_at, decided_by)
    values (p_property_id, 'stay', case when v_admin then 'approved' else 'pending' end,
            p_start_date, p_end_date, p_guests, v_uid, v_me.full_name,
            private.clean(p_comment, 1000), case when v_admin then 'admin' else 'member' end, v_uid,
            case when v_admin then now() end, case when v_admin then v_uid end)
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Perioden er desværre ikke ledig længere. Vælg andre datoer.';
  end;

  return private.booking_json(v_row);
end $$;

create or replace function public.my_bookings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
begin
  return coalesce((
    select jsonb_agg(private.booking_json(b) order by b.start_date desc)
    from public.bookings b where b.user_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.cancel_booking(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
  v_admin boolean := private.is_admin();
  v_row public.bookings;
begin
  select * into v_row from public.bookings where id = p_id for update;
  if not found or (not v_admin and v_row.user_id is distinct from v_uid) then
    raise exception 'Opholdet findes ikke.';
  end if;
  if v_row.status not in ('pending', 'approved') then
    raise exception 'Opholdet er allerede afsluttet.';
  end if;
  if not v_admin and v_row.end_date <= private.today() then
    raise exception 'Opholdet er afsluttet og kan ikke annulleres.';
  end if;

  update public.bookings
  set status = 'cancelled',
      decision_note = coalesce(private.clean(p_reason, 1000), decision_note),
      decided_at = now(), decided_by = v_uid
  where id = p_id
  returning * into v_row;
  return private.booking_json(v_row);
end $$;

-- Administratorernes navne og emails, så appen kan lave en færdig mail til dem.
create or replace function public.admin_contacts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('full_name', p.full_name, 'email', p.email) order by p.created_at, p.full_name)
    from public.profiles p where p.role = 'admin' and p.active), '[]'::jsonb);
end $$;

-- ---------- Gæstelinks (oprettes af familien) ----------

create or replace function public.create_guest_link(
  p_label text, p_property_id text default null, p_valid_days int default 60
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
  v_row public.guest_links;
begin
  if not (select guest_links from public.settings) then
    raise exception 'Gæstelinks er slået fra.';
  end if;
  if private.clean(p_label, 80) is null then
    raise exception 'Skriv hvem linket er til.';
  end if;
  if p_property_id is not null and not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Boligen findes ikke.';
  end if;
  if (select count(*) from public.guest_links
      where created_by = v_uid and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'Du har allerede 10 aktive gæstelinks. Luk et af dem først.';
  end if;

  insert into public.guest_links (label, property_id, created_by, expires_at)
  values (private.clean(p_label, 80), p_property_id, v_uid,
          now() + make_interval(days => least(greatest(coalesce(p_valid_days, 60), 1), 180)))
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'label', v_row.label,
                            'property_id', v_row.property_id, 'expires_at', v_row.expires_at);
end $$;

create or replace function public.my_guest_links() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'token', l.token, 'label', l.label, 'property_id', l.property_id,
      'created_at', l.created_at, 'expires_at', l.expires_at, 'revoked_at', l.revoked_at,
      'max_requests', l.max_requests, 'request_count', l.request_count,
      'active', l.revoked_at is null and l.expires_at > now() and l.request_count < l.max_requests,
      'requests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'property_id', b.property_id, 'person_name', b.person_name,
          'status', b.status, 'start_date', b.start_date, 'end_date', b.end_date,
          'guests', b.guests) order by b.start_date)
        from public.bookings b where b.guest_link_id = l.id), '[]'::jsonb))
      order by l.created_at desc)
    from public.guest_links l where l.created_by = v_uid), '[]'::jsonb);
end $$;

create or replace function public.revoke_guest_link(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
begin
  update public.guest_links set revoked_at = now()
  where id = p_id and (created_by = v_uid or private.is_admin()) and revoked_at is null;
  if not found then
    raise exception 'Linket findes ikke eller er allerede lukket.';
  end if;
end $$;

-- =====================================================================
--  Administration (kun administratorer)
-- =====================================================================

create or replace function private.admin_booking_json(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.booking_json(b) || jsonb_build_object(
    'user_id', b.user_id,
    'user_email', (select u.email from public.profiles u where u.id = b.user_id),
    'guest_email', b.guest_email, 'guest_phone', b.guest_phone,
    'status_token', b.status_token,
    'is_guest', b.kind = 'stay' and b.user_id is null,
    'sponsor_name', (select s.full_name from public.guest_links l
                     join public.profiles s on s.id = l.created_by where l.id = b.guest_link_id),
    'created_by_name', (select c.full_name from public.profiles c where c.id = b.created_by),
    'note', (select n.note from public.booking_notes n where n.booking_id = b.id),
    'conflict', b.status = 'pending' and private.is_taken(b.property_id, b.start_date, b.end_date, b.id),
    'competing', case when b.status = 'pending' then (
      select count(*) from public.bookings o
      where o.property_id = b.property_id and o.status = 'pending' and o.id <> b.id
        and o.stay && b.stay) else 0 end)
$$;

create or replace function public.admin_bookings(p_scope text default 'upcoming') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_today date := private.today();
begin
  return coalesce((
    select jsonb_agg(private.admin_booking_json(b)
      order by case when p_scope in ('past', 'closed', 'all') then b.start_date end desc,
               b.start_date, b.created_at)
    from public.bookings b
    where case p_scope
      when 'pending'  then b.status = 'pending' and b.end_date >= v_today
      when 'upcoming' then b.status = 'approved' and b.end_date >= v_today
      when 'past'     then b.status = 'approved' and b.end_date < v_today
      when 'closed'   then b.status in ('rejected', 'cancelled')
                           or (b.status = 'pending' and b.end_date < v_today)
      else true end), '[]'::jsonb);
end $$;

create or replace function public.admin_booking_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.bookings;
begin
  select * into v_row from public.bookings where id = p_id;
  if not found then
    raise exception 'Opholdet findes ikke (måske er det slettet).';
  end if;
  return private.admin_booking_json(v_row) || jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.at, 'actor_name', e.actor_name,
                                          'action', e.action, 'details', e.details) order by e.at)
      from public.booking_events e where e.booking_id = p_id), '[]'::jsonb));
end $$;

create or replace function public.admin_decide_booking(p_id uuid, p_approve boolean, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.bookings;
begin
  select * into v_row from public.bookings where id = p_id for update;
  if not found then
    raise exception 'Forespørgslen findes ikke længere.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'Forespørgslen er allerede behandlet (status: %).', v_row.status;
  end if;

  begin
    update public.bookings
    set status = case when p_approve then 'approved' else 'rejected' end,
        decision_note = private.clean(p_message, 1000),
        decided_at = now(), decided_by = v_uid
    where id = p_id
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Kan ikke godkendes: perioden overlapper et andet godkendt ophold.';
  end;

  return private.admin_booking_json(v_row);
end $$;

create or replace function public.admin_save_booking(
  p_id uuid,
  p_property_id text,
  p_kind text,
  p_start_date date,
  p_end_date date,
  p_guests int default null,
  p_user_id uuid default null,
  p_person_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null,
  p_title text default null,
  p_comment text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.bookings;
  v_name text := private.clean(p_person_name, 80);
begin
  if p_kind not in ('stay', 'owner', 'blocked') then
    raise exception 'Ukendt type.';
  end if;
  perform private.check_stay(p_property_id, p_start_date, p_end_date, p_guests, true);
  if p_end_date - p_start_date > 120 then
    raise exception 'En periode kan højst vare 120 nætter.';
  end if;

  if p_user_id is not null then
    select coalesce(v_name, p.full_name) into v_name from public.profiles p where p.id = p_user_id;
    if not found then
      raise exception 'Familiemedlemmet findes ikke.';
    end if;
  end if;
  if p_kind = 'stay' and v_name is null then
    raise exception 'Skriv hvem opholdet er til.';
  end if;

  begin
    if p_id is null then
      insert into public.bookings (property_id, kind, status, start_date, end_date, guests, user_id,
                                   person_name, guest_email, guest_phone, title, comment, source,
                                   created_by, decided_at, decided_by)
      values (p_property_id, p_kind, 'approved', p_start_date, p_end_date,
              case when p_kind = 'blocked' then null else p_guests end,
              case when p_kind = 'stay' then p_user_id end,
              case when p_kind = 'stay' then v_name end,
              case when p_kind = 'stay' then private.clean(p_guest_email, 120) end,
              case when p_kind = 'stay' then private.clean(p_guest_phone, 30) end,
              private.clean(p_title, 80), private.clean(p_comment, 1000), 'admin',
              v_uid, now(), v_uid)
      returning * into v_row;
    else
      update public.bookings
      set property_id = p_property_id,
          kind = p_kind,
          start_date = p_start_date,
          end_date = p_end_date,
          guests = case when p_kind = 'blocked' then null else p_guests end,
          user_id = case when p_kind = 'stay' then p_user_id end,
          person_name = case when p_kind = 'stay' then v_name end,
          guest_email = case when p_kind = 'stay' then private.clean(p_guest_email, 120) end,
          guest_phone = case when p_kind = 'stay' then private.clean(p_guest_phone, 30) end,
          title = private.clean(p_title, 80),
          comment = private.clean(p_comment, 1000),
          status = case when p_kind <> 'stay' and status in ('pending', 'rejected') then 'approved' else status end
      where id = p_id
      returning * into v_row;
      if not found then
        raise exception 'Opholdet findes ikke længere.';
      end if;
    end if;
  exception when exclusion_violation then
    raise exception 'Perioden overlapper et andet godkendt ophold i samme bolig.';
  end;

  return private.admin_booking_json(v_row);
end $$;

create or replace function public.admin_delete_booking(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  delete from public.bookings where id = p_id;
  if not found then
    raise exception 'Opholdet findes ikke længere.';
  end if;
end $$;

create or replace function public.admin_set_booking_note(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  if not exists (select 1 from public.bookings where id = p_id) then
    raise exception 'Opholdet findes ikke længere.';
  end if;
  insert into public.booking_notes (booking_id, note, updated_at, updated_by)
  values (p_id, coalesce(left(btrim(p_note), 2000), ''), now(), v_uid)
  on conflict (booking_id) do update
    set note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end $$;

-- ---------- Familie og adgang ----------

create or replace function public.admin_people() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
        'role', p.role, 'active', p.active, 'created_at', p.created_at, 'is_me', p.id = v_uid,
        'upcoming', (select count(*) from public.bookings b
                     where b.user_id = p.id and b.status in ('pending', 'approved')
                       and b.end_date >= private.today()))
        order by p.active desc, p.role, p.full_name)
      from public.profiles p), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'token', i.token, 'email', i.email, 'full_name', i.full_name, 'role', i.role,
        'created_at', i.created_at, 'expires_at', i.expires_at,
        'expired', i.expires_at < now()) order by i.created_at desc)
      from public.invitations i where i.used_at is null), '[]'::jsonb),
    'guest_links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'token', l.token, 'label', l.label, 'property_id', l.property_id,
        'created_by_name', c.full_name, 'expires_at', l.expires_at,
        'request_count', l.request_count, 'max_requests', l.max_requests) order by l.created_at desc)
      from public.guest_links l left join public.profiles c on c.id = l.created_by
      where l.revoked_at is null and l.expires_at > now()), '[]'::jsonb));
end $$;

create or replace function public.admin_create_invitation(p_email text, p_full_name text, p_role text default 'member')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_email text := lower(private.clean(p_email, 120));
  v_row public.invitations;
begin
  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Skriv en gyldig email.';
  end if;
  if private.clean(p_full_name, 80) is null then
    raise exception 'Skriv personens navn.';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Ukendt rolle.';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Der findes allerede en konto med den email.';
  end if;

  delete from public.invitations where lower(email) = v_email and used_at is null;
  insert into public.invitations (email, full_name, role, created_by)
  values (v_email, private.clean(p_full_name, 80), p_role, v_uid)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'email', v_row.email,
                            'full_name', v_row.full_name, 'role', v_row.role, 'expires_at', v_row.expires_at);
end $$;

create or replace function public.admin_delete_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  delete from public.invitations where id = p_id and used_at is null;
end $$;

create or replace function public.admin_update_member(
  p_user_id uuid, p_full_name text, p_phone text, p_role text, p_active boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  if p_role not in ('admin', 'member') then
    raise exception 'Ukendt rolle.';
  end if;
  if private.clean(p_full_name, 80) is null then
    raise exception 'Navnet må ikke være tomt.';
  end if;
  if p_user_id = v_uid and (p_role <> 'admin' or not p_active) then
    raise exception 'Du kan ikke fjerne din egen administratoradgang.';
  end if;

  update public.profiles
  set full_name = private.clean(p_full_name, 80), phone = private.clean(p_phone, 30),
      role = p_role, active = p_active
  where id = p_user_id;
  if not found then
    raise exception 'Personen findes ikke.';
  end if;

  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'Der skal altid være mindst én administrator.';
  end if;
end $$;

-- Sletter en person helt: kontoen, profilen og personens egne ophold og
-- forespørgsler (med historik). Gæsteophold fra personens gæstelinks bliver
-- liggende. Vil man bevare historikken, deaktiverer man i stedet.
create or replace function public.admin_delete_member(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_email text;
begin
  if p_user_id = v_uid then
    raise exception 'Du kan ikke slette dig selv.';
  end if;
  select email into v_email from public.profiles where id = p_user_id;
  if v_email is null then
    raise exception 'Personen findes ikke.';
  end if;

  delete from public.booking_events
  where booking_id in (select id from public.bookings where user_id = p_user_id);
  delete from public.bookings where user_id = p_user_id;
  delete from public.invitations where lower(email) = lower(v_email);

  -- Kontoen fjernes, så emailen kan inviteres igen. Profil, nulstillingslinks og
  -- gæstelinks følger med (on delete cascade). Skulle Supabase en dag nægte
  -- adgang til auth.users, slettes profilen alene; uden profil er der ingen
  -- adgang til noget.
  begin
    delete from auth.users where id = p_user_id;
  exception when insufficient_privilege then
    null;
  end;
  delete from public.profiles where id = p_user_id;

  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'Der skal altid være mindst én administrator.';
  end if;
end $$;

create or replace function public.admin_set_settings(p_guest_links boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  update public.settings set guest_links = coalesce(p_guest_links, guest_links) where id;
end $$;

-- ---------- Billeder ----------

create or replace function public.list_photos(p_property_id text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'property_id', f.property_id, 'path', f.path, 'thumb_path', f.thumb_path,
      'width', f.width, 'height', f.height, 'bytes', f.bytes) order by f.property_id, f.sort_order, f.created_at)
    from public.property_photos f
    where p_property_id is null or f.property_id = p_property_id), '[]'::jsonb);
end $$;

-- Højst 40 billeder pr. hus og 800 MB i alt (Supabase Free har 1 GB lager).
create or replace function public.admin_add_photo(
  p_property_id text, p_path text, p_thumb_path text, p_width int, p_height int, p_bytes int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.property_photos;
begin
  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Boligen findes ikke.';
  end if;
  if split_part(p_path, '/', 1) <> p_property_id or split_part(p_thumb_path, '/', 1) <> p_property_id then
    raise exception 'Billedet hører ikke til denne bolig.';
  end if;
  if (select count(*) from public.property_photos where property_id = p_property_id) >= 40 then
    raise exception 'Der kan højst være 40 billeder pr. bolig. Slet nogle først.';
  end if;
  if (select coalesce(sum(bytes), 0) from public.property_photos) + coalesce(p_bytes, 0) > 800 * 1024 * 1024 then
    raise exception 'Billedlageret er fuldt (800 MB). Slet nogle billeder først.';
  end if;
  insert into public.property_photos (property_id, path, thumb_path, width, height, bytes, sort_order, created_by)
  values (p_property_id, p_path, p_thumb_path, p_width, p_height, p_bytes,
          (select coalesce(max(sort_order), 0) + 1 from public.property_photos where property_id = p_property_id), v_uid)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id);
end $$;

-- Returnerer filstierne, så appen kan slette selve filerne i Storage bagefter.
create or replace function public.admin_delete_photo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.property_photos;
begin
  delete from public.property_photos where id = p_id returning * into v_row;
  if not found then
    raise exception 'Billedet findes ikke.';
  end if;
  return jsonb_build_object('path', v_row.path, 'thumb_path', v_row.thumb_path);
end $$;

-- p_ids: JSON-liste med billed-id'er i den ønskede rækkefølge.
create or replace function public.admin_order_photos(p_property_id text, p_ids jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  update public.property_photos f set sort_order = x.ord
  from jsonb_array_elements_text(p_ids) with ordinality as x(id, ord)
  where f.id = x.id::uuid and f.property_id = p_property_id;
end $$;

-- Pladsforbrug til admin-skærmen.
create or replace function public.admin_photo_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return (select jsonb_build_object('count', count(*), 'bytes', coalesce(sum(bytes), 0),
                                    'limit_bytes', 800 * 1024 * 1024, 'per_property', 40)
          from public.property_photos);
end $$;

create or replace function public.admin_create_password_reset(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.password_resets;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Personen findes ikke.';
  end if;
  update public.password_resets set used_at = now() where user_id = p_user_id and used_at is null;
  insert into public.password_resets (user_id, created_by) values (p_user_id, v_uid)
  returning * into v_row;
  return jsonb_build_object('token', v_row.token, 'expires_at', v_row.expires_at);
end $$;

-- ---------- Boligernes oplysninger ----------

create or replace function public.admin_update_property(p_id text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.properties;
begin
  update public.properties set
    name           = coalesce(private.clean(p_data ->> 'name', 60), name),
    area           = coalesce(private.clean(p_data ->> 'area', 80), area),
    tagline        = case when p_data ? 'tagline' then private.clean(p_data ->> 'tagline', 160) else tagline end,
    description    = case when p_data ? 'description' then private.clean(p_data ->> 'description', 4000) else description end,
    address        = case when p_data ? 'address' then private.clean(p_data ->> 'address', 300) else address end,
    country        = case when p_data ? 'country' then private.clean(p_data ->> 'country', 60) else country end,
    check_in_time  = coalesce(private.clean(p_data ->> 'check_in_time', 20), check_in_time),
    check_out_time = coalesce(private.clean(p_data ->> 'check_out_time', 20), check_out_time),
    max_guests     = coalesce((p_data ->> 'max_guests')::int, max_guests),
    arrival_info   = case when p_data ? 'arrival_info' then private.clean(p_data ->> 'arrival_info', 4000) else arrival_info end,
    practical_info = case when p_data ? 'practical_info' then private.clean(p_data ->> 'practical_info', 4000) else practical_info end,
    house_rules    = case when p_data ? 'house_rules' then private.clean(p_data ->> 'house_rules', 4000) else house_rules end,
    contact_name   = case when p_data ? 'contact_name' then private.clean(p_data ->> 'contact_name', 80) else contact_name end,
    contact_phone  = case when p_data ? 'contact_phone' then private.clean(p_data ->> 'contact_phone', 30) else contact_phone end,
    latitude       = case when p_data ? 'latitude' then (nullif(p_data ->> 'latitude', ''))::double precision else latitude end,
    longitude      = case when p_data ? 'longitude' then (nullif(p_data ->> 'longitude', ''))::double precision else longitude end,
    updated_by     = v_uid
  where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Boligen findes ikke.';
  end if;
  return to_jsonb(v_row);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Et af felterne har et ugyldigt tal.';
end $$;

create or replace function public.admin_update_property_access(
  p_property_id text, p_wifi_name text, p_wifi_password text, p_access_info text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  insert into public.property_access (property_id, wifi_name, wifi_password, access_info, updated_at)
  values (p_property_id, private.clean(p_wifi_name, 80), private.clean(p_wifi_password, 120),
          private.clean(p_access_info, 2000), now())
  on conflict (property_id) do update
    set wifi_name = excluded.wifi_name, wifi_password = excluded.wifi_password,
        access_info = excluded.access_info, updated_at = excluded.updated_at;
end $$;

-- Backup: alt data som én JSON-fil (knap i admin → Data).
create or replace function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'properties', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.properties t),
    'property_access', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.property_access t),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.profiles t),
    'bookings', (select coalesce(jsonb_agg(to_jsonb(t) - 'stay' - 'status_token'), '[]') from public.bookings t),
    'booking_notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.booking_notes t),
    'booking_events', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.booking_events t),
    'guest_links', (select coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]') from public.guest_links t));
end $$;

-- =====================================================================
--  Offentlige funktioner (kræver et hemmeligt token fra et link)
-- =====================================================================

create or replace function public.invitation_info(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', i.email, 'full_name', i.full_name, 'role', i.role,
                            'valid', i.used_at is null and i.expires_at > now(),
                            'used', i.used_at is not null)
  from public.invitations i where i.token = p_token
$$;

create or replace function public.password_reset_info(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', p.email, 'full_name', p.full_name,
                            'valid', r.used_at is null and r.expires_at > now())
  from public.password_resets r join public.profiles p on p.id = r.user_id
  where r.token = p_token
$$;

create or replace function public.redeem_password_reset(p_token text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_reset public.password_resets;
  v_email text;
begin
  select * into v_reset from public.password_resets where token = p_token for update;
  if not found or v_reset.used_at is not null or v_reset.expires_at < now() then
    raise exception 'Linket er ugyldigt, brugt eller udløbet. Bed en administrator om et nyt.';
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'Adgangskoden skal være mindst 8 tegn.';
  end if;

  begin
    update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
        updated_at = now()
    where id = v_reset.user_id
    returning email into v_email;
  exception when insufficient_privilege then
    raise exception 'Adgangskoden kunne ikke ændres automatisk. Se README under "Glemt adgangskode".';
  end;

  update public.password_resets set used_at = now() where id = v_reset.id;
  return lower(v_email);
end $$;

-- ---------- Gæster ----------

create or replace function private.valid_guest_link(p_token text) returns public.guest_links
language plpgsql stable security definer set search_path = '' as $$
declare
  v_link public.guest_links;
begin
  select * into v_link from public.guest_links where token = p_token;
  if not found or v_link.revoked_at is not null or v_link.expires_at < now()
     or not (select guest_links from public.settings) then
    raise exception 'Linket er ugyldigt eller udløbet. Bed den, der sendte det, om et nyt.';
  end if;
  return v_link;
end $$;

create or replace function public.guest_link_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_link public.guest_links := private.valid_guest_link(p_token);
begin
  return jsonb_build_object(
    'label', v_link.label,
    'inviter_name', (select split_part(p.full_name, ' ', 1) from public.profiles p where p.id = v_link.created_by),
    'expires_at', v_link.expires_at,
    'remaining', greatest(v_link.max_requests - v_link.request_count, 0),
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'area', p.area, 'tagline', p.tagline,
        'max_guests', p.max_guests, 'check_in_time', p.check_in_time,
        'check_out_time', p.check_out_time) order by p.sort_order)
      from public.properties p
      where v_link.property_id is null or p.id = v_link.property_id), '[]'::jsonb));
end $$;

create or replace function public.guest_calendar(p_token text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_link public.guest_links := private.valid_guest_link(p_token);
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 800 then
    raise exception 'Ugyldigt datointerval.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'property_id', b.property_id, 'status', b.status, 'masked', true,
      'start_date', b.start_date, 'end_date', b.end_date) order by b.start_date)
    from public.bookings b
    where b.status in ('pending', 'approved')
      and (v_link.property_id is null or b.property_id = v_link.property_id)
      and b.stay && daterange(p_from, p_to, '[)')), '[]'::jsonb);
end $$;

create or replace function public.guest_request_booking(
  p_token text, p_property_id text, p_start_date date, p_end_date date, p_guests int,
  p_name text, p_email text, p_phone text default null, p_comment text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.guest_links;
  v_row public.bookings;
  v_email text := lower(private.clean(p_email, 120));
begin
  select * into v_link from public.guest_links where token = p_token for update;
  if not found or v_link.revoked_at is not null or v_link.expires_at < now() then
    raise exception 'Linket er ugyldigt eller udløbet. Bed den, der sendte det, om et nyt.';
  end if;
  if v_link.request_count >= v_link.max_requests then
    raise exception 'Dette link er allerede brugt det maksimale antal gange.';
  end if;
  if v_link.property_id is not null and v_link.property_id <> p_property_id then
    raise exception 'Linket gælder ikke denne bolig.';
  end if;
  if private.clean(p_name, 80) is null then
    raise exception 'Skriv dit navn.';
  end if;
  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Skriv en gyldig email, så vi kan svare dig.';
  end if;

  perform private.check_stay(p_property_id, p_start_date, p_end_date, p_guests, false);
  if p_guests is null then
    raise exception 'Skriv hvor mange I er.';
  end if;
  perform 1 from public.properties where id = p_property_id for update;
  if private.is_taken(p_property_id, p_start_date, p_end_date) then
    raise exception 'Perioden er desværre ikke ledig. Vælg andre datoer.';
  end if;

  insert into public.bookings (property_id, kind, status, start_date, end_date, guests,
                               person_name, guest_email, guest_phone, guest_link_id,
                               status_token, comment, source, created_by)
  values (p_property_id, 'stay', 'pending', p_start_date, p_end_date, p_guests,
          private.clean(p_name, 80), v_email, private.clean(p_phone, 30), v_link.id,
          private.new_token(), private.clean(p_comment, 1000), 'guest', null)
  returning * into v_row;

  update public.guest_links set request_count = request_count + 1 where id = v_link.id;
  return jsonb_build_object('status_token', v_row.status_token, 'status', v_row.status);
end $$;

create or replace function public.guest_booking_status(p_status_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.bookings;
  v_prop public.properties;
  v_access public.property_access;
begin
  if p_status_token is null or char_length(p_status_token) < 20 then
    return null;
  end if;
  select * into v_row from public.bookings where status_token = p_status_token;
  if not found then
    return null;
  end if;
  select * into v_prop from public.properties where id = v_row.property_id;
  -- Praktisk info og adgang deles først, når opholdet er godkendt og ikke overstået.
  if v_row.status = 'approved' and v_row.end_date >= private.today() then
    select * into v_access from public.property_access where property_id = v_row.property_id;
  end if;

  return jsonb_build_object(
    'property_id', v_row.property_id, 'property_name', v_prop.name, 'area', v_prop.area,
    'status', v_row.status, 'start_date', v_row.start_date, 'end_date', v_row.end_date,
    'nights', v_row.nights, 'guests', v_row.guests, 'person_name', v_row.person_name,
    'comment', v_row.comment, 'decision_note', v_row.decision_note,
    'check_in_time', v_prop.check_in_time, 'check_out_time', v_prop.check_out_time,
    'details', case when v_row.status = 'approved' and v_row.end_date >= private.today() then
      jsonb_build_object(
        'address', v_prop.address, 'arrival_info', v_prop.arrival_info,
        'practical_info', v_prop.practical_info, 'house_rules', v_prop.house_rules,
        'contact_name', v_prop.contact_name, 'contact_phone', v_prop.contact_phone,
        'wifi_name', v_access.wifi_name, 'wifi_password', v_access.wifi_password,
        'access_info', v_access.access_info)
      end);
end $$;

create or replace function public.guest_cancel_booking(p_status_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = 'cancelled', decided_at = now()
  where status_token = p_status_token and status in ('pending', 'approved')
    and start_date > private.today();
  if not found then
    raise exception 'Forespørgslen kan ikke annulleres (den er allerede afsluttet eller begyndt).';
  end if;
end $$;

-- =====================================================================
--  Rettigheder til funktionerne
--  Postgres giver som standard alle EXECUTE på nye funktioner. Her lukkes
--  alt, og der åbnes kun for det, hver rolle skal bruge. Rettighederne gives
--  eksplicit, så scriptet virker både med Supabases gamle standard og med
--  den strammere standard for nye projekter (fra 30. maj 2026).
-- =====================================================================

do $$
declare
  f record;
  v_anon text[] := array['ping', 'invitation_info', 'password_reset_info', 'redeem_password_reset',
                         'guest_link_info', 'guest_calendar', 'guest_request_booking',
                         'guest_booking_status', 'guest_cancel_booking'];
  v_member text[] := array['get_me', 'update_my_profile', 'list_properties', 'get_property_access', 'admin_contacts',
                           'get_calendar', 'request_booking', 'my_bookings', 'cancel_booking',
                           'create_guest_link', 'my_guest_links', 'revoke_guest_link',
                           'admin_bookings', 'admin_booking_detail', 'admin_decide_booking',
                           'admin_save_booking', 'admin_delete_booking', 'admin_set_booking_note',
                           'admin_people', 'admin_create_invitation', 'admin_delete_invitation',
                           'admin_update_member', 'admin_delete_member', 'admin_create_password_reset', 'admin_set_settings',
                           'list_photos', 'admin_add_photo', 'admin_delete_photo', 'admin_order_photos', 'admin_photo_usage',
                           'admin_update_property', 'admin_update_property_access', 'admin_export'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname = any (v_anon || v_member))
       or n.nspname = 'private'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' and f.proname = any (v_anon) then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    elsif f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- RLS-policies kalder disse to, så den indloggede rolle skal kunne køre dem.
grant execute on function private.is_member(), private.is_admin() to authenticated;

-- =====================================================================
--  Boligerne (indsættes kun første gang; ret dem bagefter i appen)
-- =====================================================================

insert into public.properties (id, name, area, tagline, description, address, country, latitude, longitude,
                               check_in_time, check_out_time, max_guests, arrival_info, practical_info,
                               house_rules, contact_name, contact_phone, sort_order)
values
  ('mallorca', 'Mallorca', 'Mallorca · Spanien',
   'Middelhavssol, appelsinlunde og bjergene lige uden for døren.',
   E'Huset ligger mellem bjergene og citrustræerne på Mallorca. Fra terrassen kan man følge solen hen over bjergene, og der er gåafstand til torvet og caféerne.\n\nHuset er indrettet til lange, dovne dage: morgenkaffe på altanen, frokost i skyggen og aftener med udsigt til bjergene.',
   null, 'Spanien', 39.6, 2.9,
   '16:00', '11:00', 6,
   E'Nøglen udleveres efter aftale med administratorerne.\nFly til Palma (PMI).',
   E'Sengetøj og håndklæder ligger i skabet på første sal.\nAffald sorteres og afleveres i containerne for enden af gaden.\nAircondition slukkes, når huset forlades.',
   E'Luk vinduer og skodder, når I tager ud.\nRygning kun udendørs.\nEfterlad huset, som I selv ønsker at finde det.\nSkriv gerne i gæstebogen.',
   null, null, 1),
  ('odde', 'Sjællands Odde', 'Sjællands Odde · Danmark',
   'Nyt træhus mellem fyrretræer, lyng og Kattegat.',
   E'Sommerhuset ligger mellem høje fyrretræer, få minutters gang fra stranden ved Kattegat. Store vinduesfag og terrasse hele vejen rundt gør, at naturen føles som en del af huset.\n\nHer er plads til ro: lange gåture på stranden, bål om aftenen og brætspil, når vejret skifter.',
   null, 'Danmark', 55.95, 11.45,
   '15:00', '11:00', 8,
   E'Nøglen ligger i nøgleboksen ved døren. Koden står under "Wi-Fi & adgang", når dit ophold er godkendt.\nKør mod Sjællands Odde ad rute 21.',
   E'Medbring selv sengetøj og håndklæder.\nSkraldespanden stilles ud til vejen før tømning.\nBrænde til brændeovnen ligger i skuret.',
   E'Ingen husdyr i sengene.\nRygning kun udendørs.\nSluk brændeovnen helt, før I går i seng.\nHusk at slukke for vandet ved afrejse om vinteren.',
   null, null, 2)
on conflict (id) do nothing;

insert into public.property_access (property_id) values ('mallorca'), ('odde')
on conflict (property_id) do nothing;

-- =====================================================================
--  Billedlager (Supabase Storage)
--
--  Privat bucket: kun indloggede familiemedlemmer kan se billederne, og kun
--  administratorer kan uploade og slette. Appen gør billederne små (WebP eller
--  JPEG, højst 1800 px) før upload; bucketen afviser filer over 3 MB.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/webp', 'image/jpeg'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kolind_photos_read" on storage.objects;
create policy "kolind_photos_read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.is_member());
drop policy if exists "kolind_photos_insert" on storage.objects;
create policy "kolind_photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.is_admin());
drop policy if exists "kolind_photos_delete" on storage.objects;
create policy "kolind_photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and private.is_admin());
