# Menyu

**Your menu, on every phone.** A QR menu for restaurants, cafés, lounges and
bars in Kampala. Diners scan a code on the table, see the menu on their phone
and order on WhatsApp. No app download, no signup.

The product name is a placeholder: change it in `src/config/brand.ts`.

## Stack

- Next.js 16 (App Router, Cache Components), TypeScript, Tailwind CSS 4, on Vercel
- Supabase: Postgres, Auth, Storage, row-level security on every table
- SMS sign-in codes through Africa's Talking (direct routes to MTN and Airtel Uganda)
- Claude API (vision) for reading menu photos: server side only

## Build status

| Phase | What | Status |
| --- | --- | --- |
| 1 | Setup, data model, RLS, auth, admin creates a restaurant | Done |
| 2 | Diner menu, cart, WhatsApp ordering, QR codes and print PDF, demo data | Done |
| 3 | Owner dashboard: menu editor, profile, tables, sold-out | Done |
| 4 | Menu from a photo, review screen | Next |
| 5 | Plans, limits, trials, manual billing, reminders, grace period | |
| 6 | Specials, call the waiter, MoMo pay info, feedback, insights | |
| 7 | Admin: setup queue, agents, referrals, overview | |
| 8 | Directory, marketing site, Luganda, photo auto-fix, staff, branches | |
| 9 | Flutterwave or Pesapal mobile money | |

## Run it locally

Needs Node 22+ and Docker.

```bash
npm install
cp .env.example .env.local          # then fill in the values printed by db:start
cp supabase/.env.example supabase/.env
npm run db:start                    # local Supabase (Postgres, Auth, Storage, Mailpit)
npm run db:reset                    # apply migrations and seed
npm run dev -- -H 0.0.0.0           # 0.0.0.0 so Supabase Auth can reach the SMS hook
```

Sign in at http://localhost:3000/login as the seeded admin:

- phone **0700 000 001**: the code is printed in the Next.js terminal (and in `.data/dev-sms.jsonl`)
- or email **admin@menyu.test**: the code arrives in Mailpit at http://127.0.0.1:54324

## Tests

```bash
npm test                  # unit: price parsing, WhatsApp message, hours, plans, PDFs, SMS, i18n
npm run test:integration  # row-level security against the local database
npm run build && npm run test:e2e   # browser flows at 360px on throttled 3G
```

## How it fits together

**Tenancy and security.** Every tenant table has `restaurant_id`, and foreign
keys between tenant tables are composite `(id, restaurant_id)`, so a row can
never point at another restaurant's data. Row-level security decides who sees
and changes what (`supabase/migrations/*_rls.sql`):

- Diners (anon) cannot read any table. The public menu is served by one
  security-definer function that returns only public fields. Diner writes
  (events, feedback) go through rate-limited server routes.
- Owners read and write their own restaurants; staff can only toggle
  sold-out and read feedback; admins (rows in `admins`) see everything.
- Privileged columns (billing, agent, slug, featured, directory approval)
  are not granted to signed-in users at all. They change only in server code
  that has checked the caller is an admin.
- Plan features are enforced in the database as well as the app: the
  `plans` table is generated from `src/config/plans.ts`.

**Plans** live in one file, `src/config/plans.ts`. After editing it, run
`npm run plans:sql` to write a migration; an integration test fails if the
database and the config disagree.

**Sign-in.** Phone number + SMS code, with email as a fallback. Supabase
generates the code and calls `/api/auth/sms-hook` (signed with Standard
Webhooks), which sends it through Africa's Talking. Codes only go to
allowed country codes (Uganda by default), and sending is rate limited per
IP and per number. The SMS ends with a WebOTP line so Chrome on Android can
fill the code in.

**Translations** are in `messages/en.json`. `messages/lg.json` has the same
keys with empty values for a native Luganda speaker to fill in; empty strings
fall back to English. Run `npm run i18n:sync` after adding English strings.
Never machine-translate Luganda into it.

**The diner menu** (`/r/[slug]`) is rendered once, cached for everyone and
expired through its cache tag when the owner changes something. The table
number (`?t=`) is read in the browser, so one cached page serves every table.
A service worker keeps menus on the phone (a second scan opens instantly,
even offline), and each view checks the live sold-out list in the same
request that records the visit. Budget: under 200 KB before images (about
174 KB today, first paint about 2.2 s on slow 3G). Menus get their own small
stylesheet (`src/app/menu.css`) and use the phone's font; Menyu's pages use
`src/app/site.css` with Nunito.

**Money** is whole Ugandan shillings in integer `*_ugx` columns, shown as
"UGX 15,000". Times are shown in Africa/Kampala.

## Going live

1. **Domain first.** QR codes encode `NEXT_PUBLIC_SITE_URL`. Settle the domain
   before printing table cards; if it ever changes, keep the old domain
   redirecting.
2. **Supabase** (Pro plan for production; free projects pause when idle).
   Pick a region near Vercel's (for example Frankfurt `eu-central-1` with
   Vercel `fra1`). Apply migrations with `npx supabase db push`.
3. **Auth settings** in the Supabase dashboard:
   - Phone provider on. Authentication > Hooks > **Send SMS**: HTTP hook to
     `https://<your-domain>/api/auth/sms-hook`, with a generated secret (also
     set as `SUPABASE_AUTH_HOOK_SEND_SMS_SECRET` on Vercel).
   - SMS OTP expiry **300 seconds** (SMS can be slow on busy networks).
   - Email: custom SMTP (the built-in sender is for testing only), and edit
     the Magic Link template to show `{{ .Token }}`; see
     `supabase/templates/sign-in-code.html`.
   - Site URL = your domain.
4. **Africa's Talking**: create an app, top up airtime, register a sender ID
   if you want "MENYU" as the sender, and set `SMS_PROVIDER=africastalking`
   with the username and API key.
5. **Vercel**: set every variable from `.env.example`. A commercial product
   needs a Vercel Pro team (Hobby is for non-commercial use).
6. **First admin**: sign in once with your phone, then
   `npm run admin:add -- 07xx xxx xxx` with `.env.local` pointing at production.
