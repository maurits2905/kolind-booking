-- =====================================================================
--  De første invitationer (kør EFTER setup.sql)
--
--  1. Ret navne og emails nedenfor.
--  2. Ret adressen i select'en, hvis siden ligger på en anden adresse.
--  3. Kør filen i Supabase → SQL Editor.
--  4. Resultatet viser et link pr. person. Send linket til personen
--     (SMS, mail, Messenger). De vælger selv en adgangskode.
--
--  Resten af familien inviteres bagefter inde i appen:
--  Administration → Familie → Inviter.
-- =====================================================================

insert into public.invitations (email, full_name, role) values
  ('admin1@example.com',  'Admin Et',  'admin'),
  ('admin2@example.com',  'Admin To',  'admin'),
  ('familie@example.com', 'Familie',   'member');

select full_name, role, email,
       'https://kolindbooking.dk/#/invitation/' || token as link,
       expires_at
from public.invitations
where used_at is null
order by created_at;
