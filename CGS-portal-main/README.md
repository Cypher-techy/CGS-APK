# Cypher Green Systems (CGS)

Environmental Intelligence Infrastructure for Africa: environmental project management, GIS, field monitoring,
MRV and a carbon project marketplace, built around an interactive Earth. Users move from the globe to Africa,
a country, a county, a project and a single site, and the project tools are available at each level.

## The Earth and GIS layer

| Area | What it does |
|---|---|
| `/` | Home page whose hero is the working globe, with figures counted from the public project feed |
| `/explore` | Public Explore mode: 3D Earth / 2D GIS switch, drill-down, search, layers and legend, project panel |
| `/projects`, `/marketplace`, `/how-it-works`, `/features`, `/faq` | Public pages |
| `/dashboard/gis` | Workspace Earth: the projects the signed-in user may see |
| `/dashboard/command` | Admin Global Command Center: every project, with alerts and activity per selected area |
| `/dashboard/organizations` | Organizations, members and CGS verification |
| Project form | Country, county, sub-county, location picked on the map, boundary drawn or uploaded |
| Project page | Geographic breadcrumb back to the Earth, publish to Explore, carbon project stage, sites |

How it is built:

- **Engine:** MapLibre GL JS renders the globe and the flat map from the same sources, so switching between
  3D and 2D keeps the camera and the selected place. The location is kept in the `?at=` URL parameter
  (`Africa/KE/Nakuru/<project id>/<site id>`) and in the session, so it can be shared and is restored when the
  user returns from a project workspace. The older Leaflet map remains on the project **Map** tab for boundary drawing.
- **Reference data** shipped in `public/geo/`: country outlines from Natural Earth 1:110m (public domain) and the
  47 Kenya counties from geoBoundaries ADM1 (source RCMRD, public domain). Basemaps are Esri World Imagery,
  Esri Light Gray Canvas and OpenStreetMap; map fonts come from OpenFreeMap. Check each service's terms before
  production traffic.
- **Regions of other countries** are fetched on demand by `/geo/regions/<ISO2>` (`src/app/geo/regions/[iso]/route.ts`)
  from geoBoundaries ADM1, trimmed and cached for a month. The licence varies by country (for example ODbL where the
  source is OpenStreetMap); the map credits geoBoundaries. A country without published ADM1 outlines simply has no
  region level.
- **Layer registry** in `src/modules/geo/layers.ts`: every layer states its source and whether its data is
  reference, user-submitted, derived, a field record or a third-party estimate. Protected areas come from the
  World Database on Protected Areas map service (UNEP-WCMC and IUCN); its terms restrict commercial use, so check
  them before launch. The forest-change layer is listed as unavailable until a real dataset is connected there.
- **Visual language** (`src/app/globals.css`, `src/components/Motion.tsx`): near-black canvas, white Satoshi type,
  frosted-glass cards, pill buttons with an icon circle, one orange accent, an opening loader with rotating dashed
  rings whose percentage follows the real loading stages of the Earth, and content that rises in on scroll.
  Satoshi is loaded from Fontshare in the browser, so the build needs no network access. Motion is switched off
  for visitors who prefer reduced motion.
- **Public visibility is opt-in.** A project appears on `/explore` only after CGS approval and after its manager
  (or an administrator) publishes it. The public feed (`explore_public()`) exposes name, category, location,
  boundary, sites, area, stage and counts of reviewed field records. It never exposes the owner, documents or
  individual observations, and shows an organization's name only once CGS has verified it.
- **No sample data.** Every figure is counted from the database; empty states say "No projects available".
- **Carbon project stage** (`projects.lifecycle_stage`, 11 stages from idea to marketplace) records the work in
  progress. It is not a credit claim; owners may only declare the first four stages.

Database objects added by `supabase/migrations/20261006090000_geo_intelligence.sql`: `organizations`,
`organization_members`, `project_sites`, new `projects` columns (`country`, `sub_county`, `organization_id`,
`lifecycle_stage`, `is_public`, PostGIS `location`), `monitoring_records.site_id` and `location`, and the functions
`explore_public()`, `geo_project_insights()` and `add_organization_member()`. **Apply this migration to the
hosted Supabase project before deploying this version** (`supabase db push`, or run the file in the SQL editor).

`scripts/geo-check.mjs` tests this layer and its access rules in the same way as `scripts/e2e-check.mjs`:

```
node --env-file=.env.local --env-file=.env.test.local scripts/geo-check.mjs
```

A local database for testing: `supabase start` (Docker required) applies all migrations; point `.env.local` at the
URL and publishable key it prints.

## FERD Student Portal

A separate student area under `/ferd`, sharing this application and its Supabase project. The CGS public site
is unchanged apart from one **FERD Student Portal** button in its header.

| Area | Routes |
|---|---|
| Public | `/ferd`, `/ferd/login`, `/ferd/register`, `/ferd/forgot-password`, `/ferd/help`, `/ferd/status` |
| Student portal | `/ferd/dashboard`, `/courses`, `/resources`, `/manuals`, `/opportunities`, `/events`, `/community`, `/notifications`, `/profile`, `/content/[id]`, `/checkout/[slug]` |
| Administration | `/ferd/admin` (also `/admin/ferd`): `/students`, `/content`, `/courses`, `/products`, `/payments`, `/settings`, `/staff`, `/audit` |
| API | `POST /api/payments/stk-push`, `POST /api/payments/callback`, `GET /api/payments/status`, `GET /api/ferd/files/[id]` |

How it works:

- **Sign-in is by registration number and password.** The server maps the normalised number to its account
  (`src/modules/ferd/auth-actions.ts`); students never type an e-mail address. Every failed sign-in gets the same
  message, and five failures for a number (or twenty from one network address) within 15 minutes lock sign-in.
- **Registration numbers are written `N12/12345/25`** (prefix, serial number, two-digit year) and a **mobile number is
  required** at registration, stored as `2547XXXXXXXX`: it is the default number for the M-Pesa prompt, and the
  student can type a different M-Pesa line at checkout. Both rules are enforced by the form and by database
  constraints.
- **Sign-in without approval (default).** The department is derived in the database from the configurable prefix
  rules (`ferd_prefix_rules`) and the status is decided there too, never by what the form sends. With
  `ferd_settings.auto_verify_students` on (the default, switchable under **Departments and features → Student
  verification**), a student whose number matches a department is verified at registration and can sign in at
  once. Nobody checks identity first, so a person who knows someone else's registration number could register it
  before its owner does; administrators can compare each account with the official records on **Students** and
  suspend or correct it. A number that matches no rule stays pending until an administrator assigns a department.
  With the switch off, every new student waits for review.
- **CGS accounts.** `system_settings.require_account_approval` is now off by default: new project owners, investors
  and community members are active as soon as they register. People who register as Project Manager or Field
  Officer still wait for an administrator, because those roles can read other users' details and field data.
  Added by `supabase/migrations/20261011190000_sign_in_without_approval.sql`, which also activates accounts that
  were already waiting.
- **People who already have an account.** One e-mail address is one account. Someone who already has a Cypher
  Green Systems account (for example one created with Google) signs in to it at `/login` and opens
  `/ferd/register`, which then shows **Add your student record**; the record is attached to that account by
  `ferd_enroll_self()` under the same department and verification rules. They keep signing in the way they
  already do (registration number sign-in needs a password, which **Forgot your password?** can set). The
  registration form says so plainly when the address or the number is already in use.
- **Administrators are told about new students.** Every new student record adds a notification for the CGS
  super administrators, linking to **Students**. Added by
  `supabase/migrations/20261012090000_ferd_enroll_existing_accounts.sql`.
- **No confirmation e-mail for students.** A student is identified by registration number and password, so
  FERD registration creates the account already confirmed (on the server, with the secret key) and a student
  who registered earlier with an unconfirmed address is confirmed at their first correct sign-in. The
  consequence: an address is not proven to belong to the student, so a mistyped address means the
  **Forgot your password?** e-mail goes nowhere; an administrator can correct it. Password-reset e-mails still
  need working mail delivery: configure custom SMTP in Supabase (Authentication → Emails → SMTP Settings),
  because the built-in service sends only a few messages an hour.
- **Google accounts.** An account created with Google has no password, so the FERD sign-in page also has
  **Continue with Google**; it returns to the FERD portal (or to **Add your student record** if the account
  has none yet).
- **Where administrators find it.** A CGS super administrator is also the FERD Super Admin: the workspace menu
  has **FERD Student Portal** (`/ferd/admin`) and the administration dashboard shows the FERD figures. Every
  FERD screen has a **Cypher Green Systems** button back to the CGS home page.
- **Uploading files.** Under **Content library → New content**, the form has a **Files and photos** picker:
  the item and its files are saved together when you press Create. More files can be added later under
  **Files and photos** on the item's page. Files travel from the browser straight to the private `ferd-files` bucket through a
  one-time upload link (a web server would cap a request at about 4.5 MB on Vercel), with a progress bar; the
  server issues the links and records each file only after reading its real size and type from storage.
  Up to 100 files at a time (sent in batches of 10), 2 GB each. The 2 GB limit needs a paid Supabase plan with the
  project's upload limit raised under Storage → Settings; the Free plan stops every file at 50 MB. A large file
  is sent in one request, so an interrupted upload starts again from the beginning.
- **Search.** The student dashboard has a search box (`/ferd/search`) over everything published for the student's
  department: titles, summaries, the text, sources, tags, and the names and captions of uploaded files.
- **Departments, menus and content are data.** Department names, colours and focus areas, the dashboard modules
  (global and per department), units, content, libraries and prices are all rows edited in `/ferd/admin`; no
  deployment is needed for a content or feature change.
- **Roles are enforced by Row Level Security and triggers**, not by the menu: Platform Super Admin (every CGS
  super administrator, plus anyone given that FERD role), Department Admin, Content / Resource Manager,
  Opportunities Manager, Finance Admin, Environmental Project Manager, Student. There is no way to become an
  administrator through a sign-up form. The first Super Admin is the existing CGS administrator.
- **Premium libraries.** A product (`ferd_products`) is a library; premium content is attached to it. One
  confirmed payment creates one entitlement that unlocks every item in the library. Price changes never alter a
  finished payment or an existing entitlement.
- **Files are private.** Everything is stored in the private bucket `ferd-files`. A file is released only by
  `/api/ferd/files/[id]`, after the database function `ferd_can_access_content` confirms department, publication
  window and entitlement, through a signed link that lasts one minute. Downloads are logged and rate limited.
  This cannot stop a student from sharing a file they have legitimately opened.
- **Audit log.** `ferd_audit_logs` is written by triggers for verifications, corrections, content, prices, access
  grants, roles, settings and payment outcomes, and cannot be written or edited through the API.

### M-Pesa (Daraja STK Push)

Server-side only, in `src/modules/ferd/mpesa.ts`. **Payments stay off until `MPESA_ENABLED=true`.**

1. `POST /api/payments/stk-push` (verified student, product slug, phone) creates a `pending` row in
   `ferd_payments` at the product's current price and asks Daraja to prompt the phone.
2. Safaricom calls `POST /api/payments/callback`. Callbacks are unsigned, so the message is treated as a hint:
   the server asks Daraja for the state of its own request (STK query) and only then records the outcome.
3. `ferd_finalize_payment` records the result exactly once and, on success, grants the entitlement in the same
   transaction. Repeated callbacks change nothing.
4. `GET /api/payments/status` (polled by the checkout page) and **Payments → Check with Safaricom** run the same
   reconciliation, so a late or lost callback is recovered. Finished payment rows cannot be edited or deleted.

Before switching payments on, confirm with Safaricom that the Daraja app and the short code are approved for STK
Push ("Lipa na M-Pesa Online"). For a **Buy Goods till**, `MPESA_SHORTCODE` is the store (head office) number,
`MPESA_PARTY_B` is the till number and `MPESA_TRANSACTION_TYPE` is `CustomerBuyGoodsOnline`; for a Pay Bill the
defaults apply. Credentials alone do not prove the till is ready: make one real KSh payment end to end first.

### FERD environment variables

Set these in `.env.local` for local work **and** in Vercel → Project → Settings → Environment Variables for the
deployment (a local file never reaches Vercel). None of them may start with `NEXT_PUBLIC_`.

| Variable | Purpose |
|---|---|
| `SUPABASE_SECRET_KEY` | Supabase secret (service-role) key. Used only by FERD server code: registration-number lookup, sign-in attempts, payment finalisation, signed file links. Without it FERD sign-in, files and payments are unavailable |
| `MPESA_ENABLED` | `true` to take payments. Anything else keeps them off |
| `MPESA_ENVIRONMENT` | `production` or `sandbox` |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | Daraja app credentials |
| `MPESA_SHORTCODE`, `MPESA_PASSKEY` | Business short code and its Lipa na M-Pesa passkey |
| `MPESA_CALLBACK_URL` | Public https address of `/api/payments/callback` on the deployed site |
| `MPESA_TRANSACTION_TYPE` | Optional. `CustomerPayBillOnline` (default) or `CustomerBuyGoodsOnline` |
| `MPESA_PARTY_B` | Optional. Till number for Buy Goods; defaults to the short code |
| `MPESA_CALLBACK_TOKEN` | Optional. If set, the callback URL must end with `?token=<the same value>` |
| `GEMINI_API_KEY` | Optional. Google Gemini API key for the AI study assistant. Keep server-side; without it the assistant is off |
| `FERD_ASSISTANT_MODEL` | Optional. Gemini model name; defaults to `gemini-2.5-flash` |

### FERD database and checks

`supabase/migrations/20261011090000_ferd_student_portal.sql` adds the `ferd_*` tables, their policies, the
private bucket and the functions `ferd_can_access_content` and `ferd_finalize_payment`. It is additive; the only
existing object it changes is the sign-up trigger function, which gains a branch for FERD registrations.
**Apply it (after `20261006090000_geo_intelligence.sql`) before deploying this version.**

`scripts/ferd-check.mjs` tests the rules: registration, verification, department isolation, staff roles, premium
access, payment finalisation (simulated; it never calls Safaricom), private files and, with `APP_URL`, the pages
and endpoints. It refuses to run against a database that is not local unless `FERD_CHECK_REMOTE=yes`.

### AI study assistant

`/ferd/assistant` (module `assistant`, switchable per department like the others) answers questions with Google Gemini
through the Gemini API (`src/modules/ferd/assistant.ts`, `POST /api/ferd/assistant`).

- **Grounding and access.** For each question the server searches the published text of the student's own
  department, running as the student so Row Level Security applies, and gives the model only items that
  `ferd_can_access_content` allows. A premium item the student has not unlocked is passed by title only, marked
  locked. The model is told to name the item behind each statement, to label general knowledge as such, and to
  say when the portal has nothing on a topic. The page lists the items that were given to the model.
- **Limits.** Text published in the portal is read; uploaded PDF and document files are not. 30 questions a day
  and 6 per ten minutes per user, counted in `ferd_assistant_usage` (token counts only; questions and answers are
  not stored). Answers can be wrong and the page says so.
- **Configuration.** `GEMINI_API_KEY` (server-side) switches it on; without it the page says the assistant is
  not set up. `FERD_ASSISTANT_MODEL` optionally overrides the Gemini model (default `gemini-2.5-flash`).
- Added by `supabase/migrations/20261011150000_ferd_assistant.sql`.

Not built yet: event registration, content version history, per-file upload progress bars and purchaser
watermarks on files.

## Project management modules

It covers eight roles: Super Admin, Project Manager, Project Owner / Landowner, Field Officer, GIS Analyst,
MRV Specialist, Investor / Project Developer and Community Member.

## Status of modules

| Module | Status |
|---|---|
| Authentication, profiles, role-based access | Available |
| Project registration, submission and approval | Available |
| Role dashboards (all 8 roles) | Available |
| Tasks, milestones, comments, task history | Available |
| Document management (private storage, review) | Available |
| Field monitoring (forms, GPS, photographs, review) | Available |
| In-app notifications, daily deadline reminders | Available |
| Reports with CSV and PDF export | Available |
| Administration (users, approvals, categories, settings, activity log) | Available |
| GIS: interactive map, PostGIS boundaries, GeoJSON import/export, drawing, area in hectares | Available |
| MRV: carbon estimates, monitoring schedules, data quality checks, measurement history | Available |
| Community: announcements, meetings and records, feedback and grievances | Available |
| Marketplace: listings, development stages, saved projects, enquiries and due diligence status | Available |
| Boundary import from GeoJSON, KML and zipped shapefile | Available |
| Land cover: class areas inside the boundary per year (2017 onwards), change between years, map overlay | Available. Uses a third-party satellite classification, see below |
| Benefit-sharing terms and financial records (budget, expenses, income, benefit payments) | Available. Records only |
| Offline field capture with automatic synchronisation | Available. Not yet tested on devices, see below |
| Notification e-mails to registered addresses | Built and deployed. Sends once an e-mail provider key is added, see below |
| KMZ import, CGS-run image classification, automated change alerts | Not built |
| Carbon credit trading, valuation, payments, registry integrations | Not offered, by design |

The Terms and Privacy pages are drafts and are marked as such. They need legal review before launch.

## Technology

Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 · Supabase (PostgreSQL, PostGIS, Auth,
Storage, pg_cron) · MapLibre GL JS (Earth and 2D GIS) · Leaflet (boundary drawing) · Recharts · jsPDF.

Map tiles come from OpenStreetMap and Esri World Imagery. Land-cover figures and the land-cover map layer come
from the Sentinel-2 10 m Land Use/Land Cover time series (Impact Observatory, Microsoft and Esri, CC BY 4.0),
queried live from Esri's public image service. Check the usage terms of these services before production traffic.

The CGS portal only uses the Supabase **publishable** key together with the signed-in user's session. It never
uses the service-role key, so every query is subject to Row Level Security.

## Project structure

```
supabase/migrations/     database schema, triggers, RLS policies, storage bucket, cron schedule
scripts/e2e-check.mjs    end-to-end workflow and permission test
src/proxy.ts             session refresh; keeps signed-out visitors out of /dashboard and /api
src/lib/                 Supabase client, session helpers, validation helpers, constants, formatting
src/components/          shared UI: dashboard shell, forms, tables, cards, chart
src/modules/             one folder per domain, holding its server actions and components
  auth/  projects/  tasks/  documents/  monitoring/  notifications/  reports/  admin/  dashboard/
  gis/  mrv/  community/  marketplace/  finance/
supabase/functions/      Edge Function that e-mails notifications
public/sw.js             service worker for offline field capture
src/app/                 routes: public pages, auth pages, /dashboard/**, /api/documents, /api/reports
```

## Environment variables

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key. Safe for the browser |
| `NEXT_PUBLIC_SITE_URL` | Public base URL of this deployment, used in e-mail links |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional. Contact e-mail shown on the public site. No address is shown until it is set |

No secret keys are required. Do not add the service-role key to this application.

## Run locally

```
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm run build
```

## Database

Migrations are in `supabase/migrations` and are applied in file-name order.

| Table | Contents |
|---|---|
| `profiles` | One row per user: name, contact details, role, account status, consent timestamps |
| `projects` | Project details, owner, manager, status, progress, unique `CGS-YYYY-NNNN` code |
| `project_members` | Team membership per project |
| `tasks` | Assignments with priority, due date and status |
| `milestones` | Project targets and completion |
| `documents` | File metadata, category, review status, storage path |
| `monitoring_records` | Field observations, measurements (JSON), GPS, measured/estimated basis, review |
| `notifications` | Per-user alerts |
| `project_comments` | Project and task comments |
| `approvals` | Review decisions on project submissions |
| `activity_logs` | Append-only audit trail |
| `project_categories`, `system_settings`, `contact_messages` | Configuration and the public contact form |
| `project_boundaries` | One PostGIS MultiPolygon (EPSG:4326) per project, with calculated area in hectares |
| `carbon_estimates`, `monitoring_schedules` | MRV records. Every carbon figure is an estimate with a required methodology |
| `project_announcements`, `project_meetings`, `grievances` | Community engagement |
| `marketplace_listings`, `marketplace_saved`, `marketplace_interests` | Marketplace listing, saved projects, enquiries |
| `land_cover_analyses` | Hectares per land-cover class inside the boundary, one row per project and year |
| `benefit_sharing_terms`, `financial_records` | Benefit-sharing arrangement and bookkeeping entries. No payments are processed |

How rules are enforced:

- **Row Level Security** is enabled on every table. A user reads a project only as its owner, its manager, a
  team member or an administrator; child records follow the project.
- **Workflow triggers** (schema `private`, not exposed through the API) control status transitions, who may
  change which columns, and derive project progress from completed tasks.
- **Approval decisions** exist only as rows in `approvals`; inserting one changes the project status.
- **Notifications and audit entries** are written by triggers. Clients cannot insert them.
- **Monitoring records** are visible to the project owner only after the manager approves them.
- **Files** are in the private bucket `project-files` under `<project_id>/…`, limited to 10 MB and to PDF,
  DOCX, XLSX, JPG, PNG, WEBP, GeoJSON, KML, ZIP and CSV. Downloads use signed URLs valid for 60 seconds.
- **Team roles** follow account roles. Community members and observers see the project overview, milestones,
  approved monitoring, the map, approved reports and community information, but not tasks, internal documents
  or discussion. Investor accounts can never be project team members.
- **Boundaries** are written through `save_project_boundary`, which validates and repairs GeoJSON with PostGIS.
  Only the project's manager, GIS analyst or an administrator may change them.
- **Marketplace:** investors never read project tables. They see published listings through
  `marketplace_browse`, which leaves out the owner's identity, coordinates and documents. Only an administrator
  can publish a listing. The stages validated, verified and issued require a named standard and an approved
  evidence document (database constraint).
- **Grievances** are visible only to the sender, the project manager and administrators.
- **Financial records** are written by the project manager or an administrator. The owner sees all of them;
  community members see only benefit-sharing payments and the benefit-sharing terms.
- **Deadline reminders** run daily at 04:00 UTC (07:00 EAT) through pg_cron.

## Google sign-in

Google sign-in goes through Supabase Auth, so there is one user store and one session for both sign-in methods.
The "Continue with Google" button appears on the sign-in and registration pages only once the provider is
enabled.

To enable it:

1. Google Cloud Console → your OAuth Web client → **Authorised redirect URIs**: add
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. Under **Authorised JavaScript origins** keep the
   portal's own URLs (`http://localhost:3000` and the production URL).
2. Supabase dashboard → Authentication → Sign In / Providers → Google: enable it and paste the client ID and
   client secret. They are stored in Supabase only; the application has no Google environment variables.
3. Supabase dashboard → Authentication → URL Configuration: the portal's `/auth/callback` URL must be in
   Redirect URLs (same entry as for e-mail links).

How accounts are handled:

- A Google sign-in whose verified e-mail matches an existing account signs that account in, with its existing
  role, status and profile. Nothing from Google can change a role.
- A Google sign-in with a new e-mail creates a **pending Community Member** account. The user accepts the Terms
  and Privacy Policy on first visit, and an administrator activates the account and sets the role under **Users**.
- Suspended and terminated accounts can authenticate but see only their account status.
- A cancelled or failed Google sign-in returns to the sign-in page with a plain message; details go to the
  server log.

## Land-cover analysis

On a project's Map tab, a manager, GIS analyst or MRV specialist picks a year and the portal asks the land-cover
service for the number of 10 m pixels of each class inside the stored boundary. The counts are converted to
hectares by their share of the PostGIS boundary area and saved, so results stay available if the service is
down. Running several years shows the change per class.

Limits to state whenever these figures are used: the classification is produced by a third party's model and
is not ground-truthed by CGS; parcels of a few hectares contain few pixels; and differences between years can
be classification noise. The figures are supporting information, not a carbon measurement.

## Notification e-mails

Every in-app notification is also queued for e-mail to the user's registered address. Users can opt out under
Profile. Accounts that are not active, and addresses on the reserved `.test` domain, are skipped.

Delivery is done by the Edge Function `send-notification-emails`, called every 5 minutes by pg_cron through
pg_net. It needs an e-mail provider. Until the secrets below are set it does nothing and leaves the queue as is;
when they are set it sends notifications from the previous 48 hours.

1. Create a Resend account (https://resend.com) and verify the sending domain.
2. Supabase dashboard → Edge Functions → Secrets: add `RESEND_API_KEY`, `EMAIL_FROM`
   (for example `CGS Project Portal <notifications@your-domain>`) and `SITE_URL`.
3. Check delivery: `select title, emailed_at, email_error from notifications order by created_at desc limit 20;`
   A failed message keeps the provider's answer in `email_error` and is not retried automatically.

The function runs inside Supabase with the service role so that it can read each user's queue and address.
The web application itself still never uses that key.

For a new Supabase project, deploy the function (`supabase functions deploy send-notification-emails`) and
create the schedule, replacing the project reference and the anon key:

```sql
select cron.schedule('cgs-notification-emails', '*/5 * * * *', $
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-notification-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR-ANON-KEY'),
    body := '{}'::jsonb);
$);
```

## Offline field capture

`/dashboard/monitoring/offline` (Monitoring → Offline capture) lets a field officer record reports without a
connection.

- Open the page once while online and stay signed in. A service worker keeps a copy of the page and the
  application files on the device.
- Reports and photographs are stored in the browser's IndexedDB and sent automatically when the device is online
  again, or with **Send now**. Each report carries an identifier so that a report sent twice is stored once.
- Unsent reports exist only on that device and browser. Clearing browser data, or using a private window,
  loses them. Reports are only sent by the account that recorded them.
- If the session expired while offline, sign in again; the queued reports are sent afterwards.
- Service workers require HTTPS (or localhost).

This feature has been checked at the data level (duplicate protection, the page and the service worker being
served) but not exercised on a phone without a connection. Test it on the devices the field team uses before
relying on it.

## First-time setup of a Supabase project

1. Create a Supabase project and apply the migrations in order (SQL editor, or `supabase db push` with the
   Supabase CLI linked to the project).
2. Authentication → URL Configuration: set **Site URL** to the deployment URL and add
   `<site url>/auth/callback` to **Redirect URLs** (add `http://localhost:3000/auth/callback` for development).
3. Authentication → Sign In / Providers: keep **Confirm email** enabled. Enable **leaked password protection**.
4. Authentication → SMTP: configure a custom SMTP provider before the pilot. The built-in mailer is limited to
   a few e-mails per hour and is for testing only.
5. Create the first administrator: register through `/register`, confirm the e-mail address, then run in the
   SQL editor:

   ```sql
   update public.profiles set role = 'super_admin', status = 'active' where email = 'you@example.com';
   ```

   Later administrators are appointed from **Users** in the portal.

## Roles and registration

Visitors can register as Project Owner, Field Officer, Project Manager, Investor or Community Member. GIS Analyst
and MRV Specialist accounts are appointed by an administrator under **Users**. The requested role is only a request:
accounts start as *pending* and an administrator activates them and confirms the role under **Users**.
Administrator accounts cannot be self-registered. Project Owner accounts can be set to activate automatically
under **Settings**.

## Test accounts and automated check

Test data is kept apart from real records: the accounts use the reserved `cgs-portal.test` domain, carry
"(TEST)" in their names, and test records are titled "[TEST]".

`scripts/e2e-check.mjs` signs in as the eight test accounts (`test.admin`, `test.manager`, `test.owner`,
`test.officer`, `test.gis`, `test.mrv`, `test.investor`, `test.community`, all `@cgs-portal.test`), runs a project through the whole lifecycle, asserts what each role may and may not do, and
deletes the project afterwards. Put the shared test password in `.env.test.local` as `TEST_PASSWORD=…`.

```
node --env-file=.env.local --env-file=.env.test.local scripts/e2e-check.mjs
# with the app running, also request every page and the exports as each role:
APP_URL=http://localhost:3000 node --env-file=.env.local --env-file=.env.test.local scripts/e2e-check.mjs
```

Delete the test accounts before go-live (Supabase dashboard → Authentication → Users). Use a separate Supabase
project for production so that test runs never touch production records.

## Deployment (Netlify or any Next.js host)

1. Push the repository to GitHub and create a site from it.
2. Build command `npm run build`. Netlify detects Next.js and applies its runtime; on Vercel no settings are needed.
3. Set the three environment variables for the production Supabase project.
4. Add the production URL to Supabase Auth (Site URL and Redirect URLs, see above).
5. Run the automated check against a staging deployment before promoting it.

## Maintenance

- **Backups:** Supabase takes daily backups on paid plans only. On the Free plan, schedule
  `supabase db dump` (or `pg_dump`) and keep the files off-site. Storage objects are not part of database
  backups; copy the `project-files` bucket separately.
- **Recovery:** restore the database dump into a new project, apply any newer migrations, restore the bucket,
  then point the environment variables at the new project.
- **Free plan pause:** Supabase pauses Free projects after a week without activity.
- **Monitoring:** review Supabase logs and the Security Advisor after each schema change, and the host's
  function logs for application errors. No external error monitoring is wired in yet.
- **Schema changes:** add a new file to `supabase/migrations`. Do not edit applied migrations.
- **Accounts:** suspend or terminate users under **Users**. Rows are kept for the audit trail.
