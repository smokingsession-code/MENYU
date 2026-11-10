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
| 4 | Menu from a photo, review screen | Done |
| 5 | Plans, limits, trials, manual billing, reminders, grace period | Done |
| 6 | Specials, call the waiter, MoMo pay info, feedback, insights | Done |
| 7 | Admin: setup queue, agents, referrals, overview | Done |
| 8 | Directory, marketing site, Luganda, photo auto-fix, staff, branches | Done |
| 9 | Online payments with Pesapal (MTN MoMo, Airtel Money, cards) | Done |
| 10 | How diners order (show the waiter, WhatsApp, kitchen screen), pay with cash, loyalty stamps, Sell it today deals, today's orders, sales insights, deals and rankings in Menus near me | Done |
| 11 | Feature switches: Admin > Features (global) and per restaurant, Christmas theme | Done |

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
npm test                  # unit: price parsing, WhatsApp message, hours, plans, PDFs, SMS, i18n, menu import
npm run test:integration  # row-level security and database functions against the local database
npm run build && npm run test:e2e   # browser flows at 360px on throttled 3G
```

The browser tests need these lines in `.env.local`. The photo import then
uses a canned menu instead of calling Claude (`src/lib/import/fake.ts`; it
only works next to a local Supabase and never on Vercel). Online payments go
to a stand-in Pesapal that the tests start (`tests/e2e/fake-pesapal.ts`):

```bash
MENU_IMPORT_FAKE=1
PAYMENT_PROVIDER=pesapal
PESAPAL_CONSUMER_KEY=test-key
PESAPAL_CONSUMER_SECRET=test-secret
PESAPAL_IPN_ID=test-ipn
PESAPAL_BASE_URL=http://127.0.0.1:4010
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

**Marketing site and directory.** The home page (`/`) explains the product,
shows prices from `src/config/plans.ts`, links to the demo menu and opens
WhatsApp to the number in Admin > Settings. It is static and refreshed when
settings change. "Menus near me" (`/menus`) lists approved restaurants on
Standard and Pro by area, food, price and open now, and finds dishes as well
as names ("rolex", "pork"). Featured (Pro) restaurants come first. It stays
behind the switch in Admin > Directory (only admins can see it while it is
off), where you also approve the listings owners ask for (Dashboard > Profile)
and choose featured restaurants. Listed menus are indexable and appear in
`/sitemap.xml`.

**Pro: branches, staff and photo auto-fix.** Branches (Dashboard > Branches)
each get their own menu link, QR codes, hours and WhatsApp number, with the
main menu shared, copied or empty (`add_branch`). Once there is more than
one, a branch switcher appears at the top of the dashboard. Pro is charged
per branch. Staff are invited by phone (Dashboard > Staff) with a link to
send on WhatsApp; they can mark dishes sold out and read feedback, nothing
else. Photo auto-fix evens out exposure and colour on dish and cover photos
with sharp, shows before and after, and replaces the photo only when the
owner chooses. It sits behind a small interface (`src/lib/images/enhance.ts`)
so an AI service can be added later.

**Translations** are in `messages/en.json`. `messages/lg.json` has the same
keys with empty values for a native Luganda speaker to fill in; empty strings
fall back to English. Run `npm run i18n:sync` after adding English strings.
Never machine-translate Luganda into it. `TRANSLATING.md` is the guide for the
native speaker, and `npm run i18n:status` shows how far it has got. Owners can
write Luganda dish, section, special and description text; the diner's menu
then shows an English/Luganda switch.

**The diner menu** (`/r/[slug]`) is rendered once, cached for everyone and
expired through its cache tag when the owner changes something. The table
number (`?t=`) is read in the browser, so one cached page serves every table.
A service worker keeps menus on the phone (a second scan opens instantly,
even offline), and each view checks the live sold-out list in the same
request that records the visit. Budget: under 200 KB before images (about
174 KB today, first paint about 2.2 s on slow 3G). Menus get their own small
stylesheet (`src/app/menu.css`) and use the phone's font; Menyu's pages use
`src/app/site.css` with Nunito.

**Menu from photos** (`/dashboard/[id]/import`, also linked from the admin
restaurant page). Photos and PDFs go from the phone straight to private
storage through signed upload links. A Server Action creates the import and
reads it in the background (`after`), so the owner can leave the page:

1. Photos are turned upright and scaled to the most detail the model uses
   (2576 px, 3.75 megapixels) with sharp; PDFs go as they are. iPhone HEIC
   photos the server cannot decode get a clear message.
2. Claude (`claude-opus-5-5` by default, `MENU_IMPORT_MODEL` to change)
   returns sections and dishes through structured outputs
   (`src/lib/import/schema.ts`). It copies prices exactly as printed
   ("15k", "15,000/="); our own tested price parser turns them into
   shillings, so the model never does arithmetic on money. If a safety check
   declines, the API retries on its fallback model.
3. The owner checks a draft where everything the reader or the price parser
   was unsure about is highlighted, edits it (autosaved), and publishes. One
   database function (`publish_menu_import`) adds the sections after the
   current menu or replaces it (the old dishes are soft-deleted, so they can
   be restored). Nothing is visible to diners before that.

Imports are rate limited (10 an hour per person, 20 a day per restaurant)
and fail closed. Reading runs inside the page's 300 second limit
(`maxDuration`); Claude gets 270 seconds of it, and a read that stops early
is marked failed after six minutes so the owner can try again. Photos are
deleted once an import is published or discarded. Without
`ANTHROPIC_API_KEY` the import page offers "Send it to us" instead.

**Billing** (`src/lib/billing/`). The rules are pure functions in
`status.ts`, unit tested and also used for what screens show:

- New restaurants get a Standard trial (30 days by default; the admin sets
  the default in Admin > Settings and can change any restaurant's dates).
- When a trial or paid period ends unpaid, the restaurant is *overdue* but
  keeps its plan for the grace period (7 days by default, per restaurant).
  After that the daily job moves it to *Free*: the menu shows the first 30
  dishes, no ordering and the Menyu footer. Nothing is deleted, and paying
  brings everything back.
- A plan payment buys whole months (or years for Standard). Renewals
  continue from the due date, so paying early loses nothing and paying late
  gains nothing; paying during the trial starts after it; a restaurant
  already on Free starts again from the day it paid. Pro is charged per
  branch.

Payments are recorded through one function, `recordPayment()`, which
computes the period and calls the `record_payment` database function. That
function applies it atomically and refuses stale data (it compares the
subscription's `updated_at`). It records each provider reference and each
MoMo transaction ID only once. The admin records MoMo payments by hand
today. Flutterwave or Pesapal (phase 9) implement the `PaymentProvider`
interface in `src/lib/billing/providers/` and send confirmed payments to
`/api/payments/[provider]`, which uses the same `recordPayment()`.

**Paying online (Pesapal).** With `PAYMENT_PROVIDER=pesapal`, the owner's
billing page has a "Pay now" button. It creates an order with Pesapal
(recorded as a pending payment) and opens Pesapal's page, where the owner pays
with MTN MoMo, Airtel Money or a card. Pesapal then calls
`/api/payments/pesapal` (its IPN) and sends the owner back through
`/api/payments/pesapal/return`. Neither carries the payment's status, so both
ask Pesapal's GetTransactionStatus. The payment is credited (the same
`recordPayment` as manual payments, so agents and referrals are rewarded too)
only when Pesapal says it completed and the amount and currency match the
bill. Repeats are recorded once. The daily job also asks about orders still
pending (a missed notification), and gives up on them after a week. Manual
MoMo payments keep working alongside.

The daily job is `/api/cron/billing`, scheduled in `vercel.json` (06:00
Kampala time) and protected by `CRON_SECRET`. The admin billing page lists
who is overdue, due within 7 days or recently moved to Free, with a
ready-written WhatsApp reminder for each, and can run the job on demand.
Owners see their plan, due date, how to pay (the business merchant codes
from Admin > Settings), a "send us the transaction ID" WhatsApp button and
their payment history. Staff never see billing.

**Pro tools on the menu** (each shown only when the plan includes it):

- *Specials and happy hours* are scheduled by day and time (Kampala) in
  Dashboard > Specials. The menu page is cached, so the server cannot know
  which special is on: every special is sent hidden, and a tiny inline script
  (`specialOnAt` in `src/lib/specials.ts`, the same function the tests and
  React use) shows the right ones as the browser reads them. Nothing moves
  when the page finishes loading. Diners can add a special to their order.
- *Call the waiter* and *Bring the bill* send a short WhatsApp message with
  the table number, so they show only when the menu was opened from a table
  QR code.
- *Pay with Mobile Money* (Standard and Pro) shows the branch's MTN and
  Airtel merchant codes with copy buttons and the order total.
- *Private feedback*: 1 to 5 stars and a comment, through the rate-limited
  `/api/feedback` route (`submit_feedback`: 3 an hour per phone per
  restaurant). Owners and staff read it in Dashboard > Feedback with the
  average rating; new feedback shows a count on the owner's home screen.
- *Insights* (`restaurant_insights`, owners only): menu views, visitors,
  WhatsApp orders, waiter calls, views per day, busiest hours, most viewed
  dishes and tables over 7 or 30 Kampala days. The charts are plain HTML
  rendered on the server, each with a table view. Crawlers and headless
  browsers are never counted.

**How diners order** (Dashboard > How diners order, per branch). The order
button on the menu does one of three things:

- *Show to waiter* (Standard and Pro): a full-screen bill with the table
  number, the dishes, the total and how the diner will pay. No WhatsApp
  needed, so menus without a WhatsApp number can still take orders.
- *Send on WhatsApp* (Standard and Pro): the original message, now with the
  payment choice and any deal.
- *Send to kitchen* (Pro): the order appears on Dashboard > Kitchen (New,
  Cooking, Ready, refreshed every few seconds, with a beep for new orders)
  for owners and staff; the diner's phone follows its order number until it
  is ready. Delivery always goes on WhatsApp.

Every order goes through `/api/orders` and `place_order`, which works out
every price from the menu itself (the phone only sends dish, size and
add-on ids), refuses dishes that are hidden, gone or sold out, numbers
kitchen orders per branch per day, and rate-limits per network and phone.
Sending the same cart again updates the same order (each cart has a random
ref). The owner's home shows today's orders and their value, and Insights
adds orders and sales per day and the most ordered dishes. These are orders
placed from the menu, not money received, and the screens say so.

*Pay with cash* sits beside the Mobile Money codes, and diners can say how
they will pay. *Loyalty stamps* (Pro): owners choose the reward, the number
of stamps and an optional smallest order. A phone gets at most one stamp a
day when it sends or shows an order; the phone keeps a random id and only
its hash is stored. The diner uses the reward on the waiter's screen, which
then shows "Reward used" with the time.

*Sell it today* (Pro, Dashboard > Sell it today): a discount on one dish
until a time later today (at most 24 hours). Deals show at the top of the
menu, on the dish itself and in Menus near me, and end by themselves. As
with specials, the page never decides on the server whether a deal is on:
both prices are in the page and a small style sheet, written by an inline
script before the dishes are drawn (`src/lib/deals.ts`), shows the right
one. Orders get the deal price for 15 minutes after the end, so a diner who
added it just in time still gets it.

*Top in {area} this week* in Menus near me ranks listed places by menu
visitors and orders in the last 7 days (`directory_top`; an order counts as
three visitors). Private ratings are never used, and only the order is
shown, never the numbers.

**Feature switches** (Admin > Features). One switch per feature for the
whole app (Diner: specials and Sell it today, each way of ordering, MoMo
codes and cash, call the waiter, ratings, loyalty, Christmas theme; Owner:
menu from a photo, insights, kitchen screen; Network: Menus near me, area
rankings), each with "On for X of Y restaurants". Each restaurant's admin
page has a Features section to set a switch On, Off or "Use global
default" for that restaurant only. A feature works for a restaurant only
if it is on globally AND not turned off there (and its plan includes it),
so the global switch is always a kill switch: "On" for one restaurant
cannot beat a global Off. The switches live in `feature_flags` and
`restaurant_features` (row-level security: only the admin changes them)
and the database enforces them too: `private.plan_allows` checks the
feature's switch, so everything that already checked the plan (specials,
feedback, loyalty, insights, the kitchen, the directory) follows them. A
change expires every cached menu at once and moves each menu's version, so
phones refresh; nothing is deleted, so switching a feature back on restores
it exactly. Switched-off features disappear from menus, dashboards, price
lists and the marketing site; their pages show a short "not available"
note. Keys and launch defaults are in `src/config/features.ts`.

**Admin tools.** The admin home (`/admin`) is the overview: restaurants by
status, paying restaurants, money collected this month and last, monthly
recurring revenue, money overdue, menu views in the last 7 days and open
setup requests (numbers from `src/lib/admin/overview.ts`, unit tested). The
request queue (`/admin/requests`) shows the photos and notes owners sent,
with a WhatsApp link to the owner. "Import these photos" runs the photo
import on copies of the photos, and the request has a status to track it.

**Agents and referrals.** Agents (`/admin/agents`) get a code that owners
enter at signup. Each restaurant that pays earns its agent a flat fee: the
agent's own amount, or the default in Admin > Settings (UGX 20,000). The
page shows what each agent has earned, been paid and is owed, and records
payouts. Every restaurant also has a referral link (`/join/CODE`, on the
owner's home screen). The code is remembered through sign-in, and when the
invited restaurant first pays, the referrer gets a free month: a longer
trial, a later due date, or a month of Standard if they are on Free. Both
rewards come from the first plan payment, whether recorded by hand or by a
provider webhook (`payment_rewards`). Removing that payment takes the
agent's fee back.

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
6. **Claude API**: create a key at console.anthropic.com and set
   `ANTHROPIC_API_KEY` on Vercel (server only; it never reaches the browser).
   Set a monthly spend limit in the Console. Expect roughly US$0.05 to 0.20
   per menu page at Opus 5.5 prices ($4 in / $20 out per million tokens);
   each import stores its token `usage`, so check real costs after the first
   few.
7. **Billing**: set `CRON_SECRET` on Vercel (the daily billing job uses it),
   then fill in your MoMo merchant codes and WhatsApp number in
   Admin > Settings before the first trials end.
8. **Pesapal** (optional; manual MoMo works without it): open a merchant
   account, try it first with Pesapal's sandbox test keys
   (`PESAPAL_ENV=sandbox`), then set `PAYMENT_PROVIDER=pesapal`,
   `PESAPAL_ENV=live`, `PESAPAL_CONSUMER_KEY` and `PESAPAL_CONSUMER_SECRET`
   on Vercel. Once the site is live, run `npm run pesapal:ipn` with the same
   values and `NEXT_PUBLIC_SITE_URL` to register
   `https://<your-domain>/api/payments/pesapal`, and set the printed
   `PESAPAL_IPN_ID` on Vercel.
9. **First admin**: sign in once with your phone, then
   `npm run admin:add -- 07xx xxx xxx` with `.env.local` pointing at production.
