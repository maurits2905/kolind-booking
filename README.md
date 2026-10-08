# Kolind Booking

Privat booking-side for familiens to feriehuse på **Mallorca** og **Sjællands Odde**.

Familien ser ledige perioder og sender forespørgsler. Administratorerne godkender eller afviser med ét tryk. Venner kan låne husene via personlige gæstelinks. Siden virker på mobil og computer og kan lægges på hjemmeskærmen som en app.

> **Estimated recurring cost: 0 DKK/month**
>
> Siden ligger på GitHub Pages (gratis for offentlige repos), og data og login ligger i Supabase Free (intet betalingskort). Ingen server, ingen betalte API'er og ingen mailservice. Eneste udgift: domænet kolindbooking.dk, som betales årligt.

---

## Indhold

1. [Kom i gang fra nul](#kom-i-gang-fra-nul)
2. [Arkitektur](#arkitektur)
3. [Pris og gratisgrænser](#pris-0-kr-om-måneden)
4. [Mails](#mails)
5. [Administratorer](#administratorer)
6. [Familie, gæster og adgangskoder](#familie-gæster-og-adgangskoder)
7. [Billeder og tekster](#billeder-og-tekster)
8. [Eget domæne (kolindbooking.dk)](#eget-domæne)
9. [Backup](#backup)
10. [Når Supabase sætter projektet på pause](#pause-supabase-free)
11. [Lokal udvikling og tests](#lokal-udvikling-og-tests)
12. [Sikkerhed og privatliv](#sikkerhed-og-privatliv)
13. [Datamodel og datoer](#datamodel-og-datoer)
14. [Vedligehold og fejlfinding](#vedligehold)

---

## Kom i gang fra nul

Det tager omkring 20 minutter. Du skal bruge en GitHub-konto. Menunavnene i Supabase og GitHub passer pr. september 2026; de skifter en gang imellem.

### Del A: GitHub-repo og hosting

**A1. Repo**

Koden skal ligge i roden af et **Public** repo (GitHub Pages er kun gratis for offentlige repos), fx `kolind-booking`. Repoet indeholder kun kode: navne, emails og adresser lægges i databasen, ikke her.

**A2. Ingen hemmeligheder i git**

Commit aldrig adresser, emails, adgangskoder eller nøgler, der starter med `sb_secret_`. Den publishable key i `config.js` er den eneste nøgle, der må ligge i repoet.

**A3. Slå GitHub Pages til**

1. I repoet: **Settings → Pages**.
2. Under **Build and deployment → Source**: vælg **Deploy from a branch**.
3. Branch: **main**, mappe: **/ (root)**, tryk **Save**.
4. Efter 1-2 minutter står der øverst: *Your site is live at …*. Med eget domæne er det `https://kolindbooking.dk/` (se [Eget domæne](#eget-domæne)).

Siden viser nu "Forbind siden til Supabase". Det er meningen; det klares i del B og C.

### Del B: Supabase (database og login)

**B1. Opret konto og projekt**

1. Gå til [supabase.com](https://supabase.com) → **Start your project** → log ind med GitHub.
2. Bliver du bedt om at oprette en organisation: navn `Kolind`, type *Personal*, plan **Free**.
3. **New project**:
   - Name: `kolind-booking`
   - Database password: tryk **Generate a password**, og gem den i din password manager (skal kun bruges til fuld backup).
   - Region: **Central EU (Frankfurt)** eller **North EU (Stockholm)**.
   - Lad **Data API** være slået til (standard). Om nye tabeller eksponeres automatisk, er ligegyldigt: `setup.sql` giver selv de rettigheder, der skal til.
4. Tryk **Create new project**, og vent et par minutter.

**B2. Byg databasen**

1. Venstremenuen: **SQL Editor** → **New query**.
2. Åbn [`supabase/setup.sql`](supabase/setup.sql) i repoet, kopiér **hele** filen, og sæt den ind.
3. Tryk **Run**. Advarer Supabase om "destructive operations" (scriptet indeholder `drop trigger if exists` for at kunne køres igen), så vælg **Run this query**.
4. Resultatet skal være *Success. No rows returned*.

**B3. Indstil login**

Venstremenuen: **Authentication → Sign In / Providers**.

| Indstilling | Værdi | Hvorfor |
|---|---|---|
| **Allow new users to sign up** | Slået **til** | Nødvendigt for invitationer. Databasen afviser alle uden et gyldigt invitationslink. |
| **Email** (provider) | Slået **til** | Login med email og adgangskode |
| **Confirm email** (inde i Email) | Slået **fra** | Supabases indbyggede mail sender kun til projektets egne teammedlemmer. Invitationslinket er beviset. |
| Minimum password length (inde i Email, valgfri) | 8 | Samme krav som appen |

Tryk **Save**. Sociale logins (Google, Apple …) og anonyme logins skal forblive slået fra (standard).

**B4. Find URL og nøgle**

Tryk **Connect** øverst i projektet (eller **Project Settings → API Keys**) og find:

- **Project URL**, fx `https://abcdefghijkl.supabase.co`
- **Publishable key**, som starter med `sb_publishable_`

Brug **aldrig** nøglen, der starter med `sb_secret_` (eller den gamle `service_role`).

### Del C: Forbind siden

1. På GitHub: åbn `config.js` i repoet → blyant-ikonet (**Edit this file**).
2. Udfyld:

   ```js
   supabaseUrl: 'https://abcdefghijkl.supabase.co',
   supabaseKey: 'sb_publishable_…',
   ```

3. Tryk **Commit changes**. Efter et minut viser siden forsiden i stedet for opsætningsbeskeden.

Den publishable key må gerne være offentlig: den giver kun de rettigheder, databasens RLS og funktioner tillader.

### Del D: De første konti

1. Supabase → **SQL Editor** → **New query**.
2. Indsæt indholdet af [`supabase/first-admins.sql`](supabase/first-admins.sql), og ret emails, navne og adressen til de rigtige i SQL Editor (ikke i repoet). Administratorerne skal have rollen `admin`.
3. Tryk **Run**. Resultatet viser ét link pr. person.
4. Send hvert link til personen (mail eller SMS). De åbner linket, vælger en adgangskode og er logget ind.

Emails står bevidst ikke i repoet: det er offentligt, og adresser i offentlige repos bliver høstet til spam.

Husenes adresser, kontaktpersoner og præcise koordinater står heller ikke i repoet. Udfyld dem i appen under **Administration → Boliger** (eller med et SQL-script, du kun kører i SQL Editor).

Resten af familien inviteres inde i appen: **Administration → Familie → Inviter**.

### Del E: Prøv det af

1. Log ind som administrator, og tjek **Administration → Boliger**: udfyld adresse, kontaktperson, Wi-Fi og nøgleinfo.
2. Vil du se kalenderen med indhold, så kør [`supabase/demo-data.sql`](supabase/demo-data.sql). Fjern demo-data igen med `delete from public.bookings where source = 'demo';`.
3. Keepalive: gå til **Actions → Hold databasen vågen → Run workflow** for at teste pingen (se [Pause](#pause-supabase-free)).

---

## Arkitektur

```
 Mobil / computer
 ┌────────────────────────────────────────────┐
 │  Statisk app: HTML + CSS + vanilla JS      │  ← GitHub Pages
 │  Ingen build, ingen npm i produktion       │
 │  supabase-js 2.117.2 ligger i vendor/      │
 └──────────────┬─────────────────────────────┘
                │ HTTPS (publishable key + brugerens login-token)
 ┌──────────────▼─────────────────────────────┐
 │  Supabase Free                             │
 │   • Auth: email + adgangskode              │
 │     (kun via invitationslink)              │
 │   • Postgres: tabeller, RLS, constraints   │
 │   • Alle regler i SQL-funktioner (RPC)     │  ← supabase/setup.sql
 └────────────────────────────────────────────┘
   Valgfrit:  Open-Meteo (vejr, ingen nøgle) · GitHub Actions (ping hver 3. dag)
```

- **Ingen egen backend.** Al forretningslogik (hvem må hvad, datovalidering, overlap) ligger i Postgres-funktioner, så den kan ikke omgås fra browseren.
- **Ingen framework og ingen build-pipeline.** ES-moduler direkte i browseren.
- **Hash-routing** (`#/kalender`) virker på GitHub Pages uden serveropsætning, og tokens i links sendes aldrig til en server.

## Pris: 0 kr. om måneden

| Tjeneste | Bruges til | Gratisgrænse | Familiens forbrug |
|---|---|---|---|
| GitHub Pages | Hosting af siden | Gratis for offentlige repos, 100 GB trafik/md | Få MB/md |
| Supabase Free | Database, login, sikkerhed | 500 MB database, 50.000 aktive brugere/md, 5 GB trafik/md, 2 gratis projekter | Under 1 MB data, ~10 brugere |
| GitHub Actions | Valgfri keepalive-ping | Gratis for offentlige repos | ~10 sekunder hver 3. dag |
| Open-Meteo | Vejrudsigt | Gratis til ikke-kommerciel brug, ingen nøgle | Få kald pr. besøg (caches 30 min) |

Der er intet betalingskort tilknyttet, så intet kan begynde at koste penge af sig selv. Rammes en gratisgrænse mod forventning, holder tjenesten op med at svare; den sender ikke en regning. Den eneste udgift er domænet kolindbooking.dk, som betales én gang om året hos GoDaddy.

## Mails

Systemet sender **ikke** mails selv. I stedet laver det en **færdig mail**, der popper op og kan sendes med ét tryk fra ens egen mail-app:

| Hvornår | Mail til | Indhold |
|---|---|---|
| Et familiemedlem sender en forespørgsel | Administratorerne | Hus, datoer, antal, besked og link til godkendelse |
| En administrator godkender | Personen (eller gæsten) | Datoer, tider, beskeden fra admin og link til praktisk info |
| En administrator afviser | Personen (eller gæsten) | Svaret og link til kalenderen |
| Nogen annullerer | Administratorerne | At perioden er ledig igen |
| Invitation og ny adgangskode | Personen | Det personlige link |

Mailen kan rettes før afsendelse, kopieres (fx til Gmail på en computer uden mail-app) eller sendes som SMS/besked på mobilen.

**Hvorfor ikke automatiske mails?** Supabases indbyggede mail kan ikke bruges til det. Den sender kun login-mails (bekræftelse, nulstilling), kun til medlemmer af Supabase-projektets team, og når grænsen på 2 mails i timen er nået, afvises mailen; den lægges **ikke** i kø. Automatiske mails ville kræve en separat mailkonto (fx Gmail med app-adgangskode) og en Supabase Edge Function. Det kan tilføjes gratis senere, men er en ekstra ting, der kan gå i stykker. De færdige mails virker altid og kan ikke gå tabt.

## Administratorer

En administrator kan alt: se alle detaljer, godkende og afvise, oprette, rette, annullere og slette ophold, blokere perioder, skrive interne noter, invitere familie og rette oplysningerne om husene.

- **Via invitation (anbefalet):** rollen `admin` i `first-admins.sql`, eller i appen: **Administration → Familie → Inviter → Administrator**.
- **Gør en eksisterende konto til admin:** i appen under **Administration → Familie → personen → Rolle**, eller i SQL Editor:

  ```sql
  update public.profiles set role = 'admin' where email = 'person@example.com';
  ```

Der skal altid være mindst én aktiv administrator. Databasen forhindrer, at den sidste fjernes, og at en admin fjerner sin egen adgang.

**Kort guide til administratorerne:**

- Tallet på **Admin** viser, hvor mange forespørgsler der venter. Tryk **Godkend** eller **Afslå**, og skriv evt. en besked.
- Bagefter popper en færdig mail op til personen. Tryk **Åbn i mail**, og send den.
- **Opret ophold**, **Egen ferie** og **Bloker periode** ligger øverst i Administration. Det, I selv opretter, er godkendt med det samme.
- I kalenderen kan I trykke på et ophold for at se detaljer, historik og interne noter.

## Familie, gæster og adgangskoder

**Nyt familiemedlem:** Administration → Familie → **Inviter**. Skriv navn og email, og send linket med **Send som mail** eller SMS. Linket virker i 30 dage og kan bruges én gang. Ingen kan oprette en konto uden et link.

**Venner og gæster** (slået fra som standard; slås til under Administration → Familie → Gæstelinks til venner): Et familiemedlem laver et gæstelink under **Mine ophold → Gæstelinks** (fx "Peter og Lise"). Gæsten åbner linket uden at logge ind, ser ledige datoer (kun "Optaget"/"Forespurgt", aldrig navne) og sender en forespørgsel med navn og email. Gæsten får et statuslink, hvor svaret, adressen, praktisk info og Wi-Fi vises, når opholdet er godkendt. Et gæstelink kan bruges til 3 forespørgsler og udløber efter valgfri periode.

**Glemt adgangskode:** Administration → Familie → personen → **Lav nulstillingslink**, og send det som mail. Man kan også selv skifte adgangskode under **Profil**.

Virker nulstillingslinket en dag ikke (fordi Supabase ændrer rettighederne på `auth.users`), kan du sætte en ny adgangskode i SQL Editor:

```sql
update auth.users
set encrypted_password = extensions.crypt('ny-midlertidig-kode', extensions.gen_salt('bf'))
where email = 'person@example.com';
```

**Fjern adgang:** Administration → Familie → personen → slå **Aktiv** fra. Historikken bevares.

**Slet en person helt:** Administration → Familie → personen → **Slet person**. Kontoen og personens egne ophold og forespørgsler slettes; gæsteophold fra personens gæstelinks bliver liggende. Emailen kan inviteres igen bagefter.

## Billeder og tekster

**Tekster** (beskrivelse, adresse, check-in/-ud, husregler, kontakt, Wi-Fi og adgang) rettes i appen under **Administration → Boliger**. Wi-Fi og adgangsoplysninger vises kun for personer med et godkendt, kommende eller igangværende ophold.

**Galleri:** Administration → Boliger → **Billeder** → **Tilføj billeder**. Vælg flere på én gang. Browseren gør dem små før upload (WebP, højst 1800 px, cirka 250 KB pr. billede plus en miniature), så pladsen rækker til tusindvis af billeder. Billederne ligger i en privat bucket i Supabase Storage og kan kun ses af indloggede familiemedlemmer. Rækkefølgen ændres med pilene, og der er en papirkurv på hvert billede.

Grænser, der håndhæves af databasen: højst 40 billeder pr. hus, højst 3 MB pr. fil og 800 MB i alt (Supabase Free har 1 GB lager). Forbruget står over billederne.

**Hovedbillederne** (forsiden og toppen af husets side) ligger i repoet:

| Fil | Bruges til |
|---|---|
| `assets/photos/*-original.jpg` | Originalerne |
| `assets/img/<id>.webp`, `<id>-sm.webp` | Brede billeder og thumbnails |
| `assets/img/<id>-portrait.webp` | Kortene på forsiden |
| `assets/img/og.jpg` | Forhåndsvisning, når linket deles |

Sådan skifter du et billede:

1. Læg det nye foto i `assets/photos/` med samme navn (fx `odde-original.jpg`). Jo højere opløsning, jo skarpere; 2000 px bredde eller mere er ideelt.
2. Ret evt. beskæringen i `dev/make-images.py`.
3. Kør `pip install pillow && python3 dev/make-images.py`, og commit.

App-ikonerne laves med `python3 dev/make-icons.py`. Farver og billedvalg pr. hus ligger i `js/properties.js` og `css/base.css` (`--mallorca`, `--odde`). Sidens navn står i `config.js` (`siteName`).

## Eget domæne

Siden ligger på **kolindbooking.dk** (købt hos GoDaddy). Filen `CNAME` i repoet fortæller GitHub Pages, hvilket domæne siden hører til. Alle links bygges ud fra den adresse, siden åbnes på, så koden skal ikke ændres, hvis domænet skifter.

**DNS hos GoDaddy** (Domæner → kolindbooking.dk → DNS):

| Type | Navn | Værdi |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA (valgfri) | `@` | `2606:50c0:8000::153`, `…8001::153`, `…8002::153`, `…8003::153` |
| CNAME | `www` | `maurits2905.github.io` |

GoDaddys egen A-record for `@` ("Parked" eller deres hjemmeside) skal slettes, og videresendelse skal være slået fra.

**GitHub:** Settings → Pages → Custom domain viser `kolindbooking.dk`. Når DNS-tjekket er grønt, så sæt flueben ved **Enforce HTTPS**. Certifikatet er gratis og fornyes automatisk.

Den gamle adresse (`…github.io/kolind-booking/`) sender videre til det nye domæne. Login gemmes pr. adresse, så alle skal logge ind én gang efter skiftet.

## Backup

- **I appen:** Administration → Boliger → **Download backup (JSON)**. Filen indeholder alle ophold, noter, historik, familie og boligernes oplysninger. Tag en backup et par gange om året, og gem den sikkert (den indeholder Wi-Fi-koder).
- **Fuld databasebackup:** Tryk **Connect** i Supabase, og kopiér forbindelsesstrengen under *Session pooler*. Kør `pg_dump "postgresql://…" --schema=public --schema=auth > backup.sql`.

Stol ikke på Supabases egne backups på gratisplanen; download selv.

## Pause (Supabase Free)

Supabase sætter gratisprojekter på pause efter **7 dage uden databaseaktivitet**.

**Hvad familien oplever:** Siden åbner fint (den ligger på GitHub), men data kan ikke hentes. Appen viser "Ingen forbindelse … databasen kan være sat på pause". Intet data går tabt.

**Sådan vækkes den:** Log ind på supabase.com, åbn projektet, og tryk **Restore project**. Det tager et par minutter. Supabase sender en mail til projektets ejer, før og når projektet pauses. Et projekt, der har været på pause længe, kan ikke nødvendigvis gendannes med ét klik, så lad det ikke ligge i måneder.

**Sådan undgås det:** [`keepalive.yml`](.github/workflows/keepalive.yml) pinger databasen hver 3. dag via GitHub Actions. Den læser URL og nøgle fra `config.js`, så der skal ikke opsættes noget. GitHub slår planlagte workflows fra efter 60 dage uden commits i et offentligt repo; workflowet forsøger at nulstille det selv. Får du en mail om, at det er slået fra, så gå til **Actions → Hold databasen vågen → Enable workflow**.

## Lokal udvikling og tests

**Frontend mod det rigtige projekt:** Siden er statiske filer: `python3 -m http.server 8080` og åbn `http://localhost:8080`. Det rammer de rigtige data.

**Helt lokalt med en emulator** (valgfrit, kræver Postgres 15+ og Node 20+). `dev/local-supabase.mjs` er en lille stand-in for Supabase (email-login og RPC), som kører den rigtige `setup.sql` mod en lokal Postgres:

```bash
export PGHOST=localhost PGUSER=postgres       # din lokale Postgres
cd dev && npm install
./reset-local-db.sh                            # opretter kolind_dev med demo-data
node local-supabase.mjs                        # http://localhost:8787
```

Demo-logins med opdigtede navne (kode `ferie2026`): `anne@familien.dk` og `bent@familien.dk` (admins), `carl@`, `dorte@`, `eva@`, `frank@`, `gitte@`, `hans@familien.dk` (familie). Ida har en invitation: `http://localhost:8787/#/invitation/local-invite-ida-00000000`. Gæstelink: `http://localhost:8787/#/gaest/local-guest-link-peter-000`.

**Tests:**

- `./dev/run-sql-tests.sh` kører `setup.sql` mod en tom database og prøver derefter at bryde reglerne som anonym, familiemedlem, gæst og admin. Den kører to gange: med Supabases klassiske standardrettigheder og med de strammere standarder for nye projekter (fra 30. maj 2026).
- `node dev/e2e.mjs` (kræver Playwright) klikker hele flowet igennem i en browser mod emulatoren: forespørgsel, færdig mail, godkendelse, blokering, gæsteforespørgsel og invitation.

## Sikkerhed og privatliv

Sikkerheden ligger i databasen, ikke i browseren.

- **Row Level Security** er slået til på alle tabeller. Klienter kan kun læse egne rækker (admins alt), og ingen klient har skriverettigheder på tabellerne.
- **Alle ændringer går gennem SQL-funktioner**, der tjekker rolle, ejerskab, datoer, kapacitet og status. Alle rettigheder gives eksplicit.
- **Ingen kan gøre sig selv til admin.** Rollen sættes kun ud fra invitationen eller af en admin.
- **Invite-only:** en trigger på `auth.users` afviser enhver ny konto uden et gyldigt, ubrugt invitationslink til præcis den email.
- **Dobbeltbooking er umulig** i databasen: en `EXCLUDE USING gist`-constraint forbyder to godkendte ophold i samme hus samme nat, også ved samtidige godkendelser.
- **Privatliv:** familiemedlemmer ser andres ophold som "Optaget" eller "Forespurgt" uden navne. Gæster ser kun det samme for det hus, deres link gælder. Interne noter, gæsters kontaktinfo og historik er kun for admins. Wi-Fi og adgangskoder vises kun med et godkendt ophold. Indloggede familiemedlemmer kan se administratorernes navn og email (til de færdige mails).
- **Tokens** i links er 144-bit tilfældige, står efter `#` i URL'en og udløber.
- **Ingen hemmeligheder i repoet.** Kun den publishable key ligger i `config.js`. Siden har `noindex`, så søgemaskiner ikke viser den.
- **Offentligt repo:** kun koden er synlig. Adresser, navne, emails, telefonnumre, kalender og Wi-Fi ligger kun i databasen og vises kun efter login. Den offentlige forside viser kun husenes navn, region og fotos.

Supabases **Security Advisor** kan advare om, at `security definer`-funktioner kan kaldes via API'et. Det er med vilje: de er appens API og tjekker selv rettigheder.

## Datamodel og datoer

| Tabel | Indhold |
|---|---|
| `profiles` | Én række pr. konto: navn, email, telefon, rolle (`admin`/`member`), aktiv |
| `invitations` | Invitationslinks |
| `password_resets` | Nulstillingslinks |
| `properties` | Husene: tekster, adresse, tider, husregler, kontakt, koordinater |
| `property_access` | Wi-Fi og adgangsinfo (følsomt, separat tabel) |
| `guest_links` | Gæstelinks lavet af familien |
| `bookings` | Alle ophold og forespørgsler |
| `booking_notes` | Interne noter (kun admin) |
| `booking_events` | Historik: hvem gjorde hvad hvornår |

**Ophold:** `kind` er `stay` (familie eller gæst), `owner` (ejernes egen ferie) eller `blocked` (lukket periode). `status` er `pending`, `approved`, `rejected` eller `cancelled`.

**Datoer:** `start_date` er ankomstdagen, `end_date` er afrejsedagen. Et ophold dækker nætterne `[start_date, end_date)`, så afrejsedagen kan være næste gæsts ankomstdag: 1.–7. juli og 7.–14. juli overlapper ikke. Kalenderen tegner ophold fra midten af ankomstdagen til midten af afrejsedagen. "I dag" beregnes i dansk tid.

Regler i databasen: afrejse efter ankomst, højst 60 nætter pr. forespørgsel (120 for admins), ingen ankomst i fortiden for familie og gæster, højst to år frem, antal personer mellem 1 og husets max, højst 5 åbne forespørgsler pr. person.

## Vedligehold

Der er ingen servere, certifikater eller processer at holde kørende.

- `vendor/supabase.js` er en fastlåst kopi (2.117.2). Den behøver ikke opdateres.
- Skrifterne (Newsreader og Hanken Grotesk, SIL Open Font License) ligger lokalt i `assets/fonts/`.
- Ændringer i `supabase/setup.sql` køres ved at køre hele filen igen i SQL Editor.

### Fejlfinding

| Problem | Løsning |
|---|---|
| Siden siger "Forbind siden til Supabase" | `config.js` mangler URL eller nøgle (del C) |
| "Databasen er ikke sat op endnu" | Kør `supabase/setup.sql` (B2) |
| "Ingen forbindelse" for alle | Projektet er sat på pause: Restore project på supabase.com |
| "Supabase kræver email-bekræftelse" | Slå **Confirm email** fra (B3) |
| "Oprettelse af konti er slået fra" | Slå **Allow new users to sign up** til (B3) |
| "Invitationen kunne ikke bruges" | Linket er brugt eller udløbet. Lav en ny invitation |
| "Åbn i mail" gør ingenting på computeren | Der er ingen mail-app. Brug **Kopiér**, og indsæt i Gmail |
| En ny version vises ikke | Genindlæs siden; den henter altid nyeste version først |

### Filstruktur

```
index.html              App-skal
skema.html              Spørgeskema om husene til ejerne (svar sendes som mail, gemmes kun på telefonen)
config.js               Supabase URL + publishable key + sidens navn
manifest.webmanifest    PWA
sw.js                   Service worker (network first)
css/                    base, components, calendar, pages
js/
  main.js               Opstart, routing, adgangskontrol
  api.js                Al kommunikation med Supabase (kun RPC)
  calendar.js           Kalenderkomponenten
  booking-form.js       Forespørgsel / booking / redigering
  booking-detail.js     Admin: detaljer, godkend, noter, historik
  mail.js               Færdige mails (mailto, kopiér, del)
  views/                Sider: forside, bolig, kalender, mine, admin, login, gæst, profil
supabase/
  setup.sql             Hele databasen (kan køres igen)
  first-admins.sql      De første invitationer
  demo-data.sql         Valgfri demo-ophold
dev/                    Lokal emulator, tests, billed- og ikonscripts (bruges ikke i produktion)
assets/                 Billeder, ikoner, skrifter
.github/workflows/      Keepalive-ping
```
