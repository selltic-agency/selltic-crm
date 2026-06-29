# Selltic — Product Requirements Document
**Forms Builder + CRM for solo operator (Dominik, Selltic Agency, Wrocław PL)**

---

## 1. Overview

A self-hosted web application combining a **Typeform-style form builder** with a **lightweight CRM pipeline**. Built exclusively for internal use by one admin (no client-facing login). Forms are published publicly and embedded on client websites. Submissions automatically create CRM leads.

**Stack:** Next.js 15 (App Router) · Supabase (Postgres + Auth) · Vercel · TypeScript · Tailwind (optional) · Recharts · Lucide icons

---

## 2. Authentication & Access

- **Single admin account** — email + password via Supabase Auth
- `/admin/*` routes protected by Next.js middleware (redirect to `/login` if no session)
- Logged-in user hitting `/login` → redirect to `/admin`
- **No client/public registration** — forms are filled anonymously, no login required
- Service role key used only server-side (never exposed to browser)

---

## 3. Form Builder (`/admin/forms`)

### 3.1 Form List
- Grid/list of all forms with title, status badge (Draft / Published), creation date
- "New Form" button → creates blank form and opens editor
- Delete, duplicate actions per form

### 3.2 Form Editor (`/admin/forms/[id]`)
**Three-pane layout:**
- **Left pane** — step list (ordered, drag-to-reorder), add step button with type picker
- **Center pane** — step editor + theme panel
- **Right pane** — live interactive preview (updates in real time as you edit)

**Step types:**
- `welcome` — title, description, CTA button text
- `short_text` — single line input, placeholder, required toggle
- `long_text` — textarea, placeholder, required toggle
- `email` — email input, placeholder, required toggle
- `single_choice` — options list (each option has its own routing target)
- `multi_choice` — multiple select options
- `statement` — text block, no input, just a "Next" button
- `end` — thank-you screen, title, description

**Step editor fields (per step):**
- Question / heading text
- Description / subtext (optional)
- Image or icon URL (optional — shows inline or in split layout)
- Placeholder (for text inputs)
- Required toggle (for text inputs)
- CTA label (for welcome step)
- Options + per-option routing (for choice steps)
- Default next step (fallback routing)

**Routing system:**
- Each step has a `next` field: `__next__` (linear), a specific step ID, or `__submit__`
- Each option in `single_choice` / `multi_choice` can override routing → enables branching paths
- Live preview reflects routing — clicking through the preview follows the actual configured paths

### 3.3 Theme Panel
- **Font** picker: DM Sans, Inter, Space Grotesk, Playfair Display, Lora
- **Color pickers:** accent/primary color, background color, text color
- **Layout:** Center · Left-aligned · Split (image left, form right)
- All changes reflected instantly in the live preview

### 3.4 Draft / Publish
- `schema` column = work-in-progress (always editable, auto-saved with debounce)
- `published` column = frozen snapshot of last publish
- Public page always renders `published` — editing draft never breaks live form
- Status badge: **Draft** / **Published** / **Unsaved changes**
- "Publish" button copies `schema` → `published`, sets `status = 'published'`
- "Update" button (when already published) does the same

---

## 4. Public Form Renderer (`/f/[slug]`)

- Reads `published` JSON from Supabase (not `schema`)
- Renders all step types with full routing logic
- **Animations:** slide up (forward) / slide down (backward), CSS cubic-bezier, respects `prefers-reduced-motion`
- **Keyboard navigation:** Enter to advance, letter keys (A/B/C) to select options
- Back button with history stack
- Progress bar at top
- On submit → POST to `/api/submit`

### 4.1 Embed Mode (`/f/[slug]?embed=1`)
- Renders form without site header/footer
- Sends `postMessage` with `{ formHeight: px }` after each step change
- Embed snippet (for client websites):
```html
<iframe src="https://app.selltic-agency.pl/f/wycena?embed=1"
  style="width:100%;border:0;min-height:600px" title="Formularz"></iframe>
```
- Works cross-domain (Framer, WordPress, any HTML)

---

## 5. Form Submission API (`/api/submit`)

Single POST endpoint, server-side only, uses Supabase service role key.

**Flow:**
1. Validate `formId` + `answers` present
2. Fetch form (must be `status = 'published'`)
3. Save raw submission to `submissions` table
4. Extract `email`, `name`, `phone` from answers (via step `map` field or heuristic)
5. **Upsert contact** by `(owner, email)` — if exists: update name/phone; if new: create at stage `new`
6. Insert `activity` of type `submission` with summary of answers
7. Check `app_settings.email_new_lead` → if true, send email notification via Resend API
8. Return `{ ok: true }`

---

## 6. CRM (`/admin` — main app shell)

### 6.1 Layout
- **Sidebar** (230px, always visible):
  - Workspace logo + name (Selltic)
  - "Simulate new lead" / "Add" button
  - Nav items: Dashboard · Pipeline · Tasks · Analytics · Forms · Settings
  - Mini pipeline stage list with live counts
  - Settings at bottom
- **Top bar:** search input, notification bell (with unread badge), admin avatar
- **Main content area:** changes by nav item

### 6.2 Dashboard (`/admin`)
- Quick action cards: New Form · New Contact · New Task · Analytics
- "Leads in progress" table (all non-won/lost contacts): name, company, stage pill, value
- "Recent activity" feed: icon + body text + who + **exact timestamp**
- "Tasks for today" list with checkboxes

### 6.3 Pipeline (`/admin/pipeline`)
- Kanban board, 5 columns: New Lead · Contact · Offer · Won · Lost
- Each column shows: stage name, count, total value (PLN)
- Cards show: name, company, source (📋 Form name or manual), value
- Click card → opens Contact Drawer

### 6.4 Contact Drawer (slide-in from right, overlay)
- Header: name + company + close button
- **Stage selector** — pill buttons for all 5 stages, active stage highlighted in stage color; changing stage adds automatic `stage` activity
- **Properties section** (read from global `property_defs`):
  - Fixed: Email, Phone, Source (read-only display)
  - Dynamic: all fields defined in Settings → Properties, editable inline
  - Footer hint: "Manage fields in Settings → Properties"
- **Activity composer:**
  - Type tabs: Note · Phone call · Email · Task
  - Textarea for note/call/email body
  - Task mode: title input + due date/time input
  - Save button → inserts activity with **exact timestamp** (`dd mmm yyyy, HH:MM`)
- **Activity timeline** (newest first):
  - Icon per type (StickyNote / Phone / Mail / FileText / CircleDot)
  - Type label (uppercase, accent color) + **exact timestamp** on same line
  - Body text below
  - Empty state: "No activity yet"

### 6.5 Tasks (`/admin/tasks`)
- Add task form: title input + due date/time input + Add button (or Enter)
- Open tasks list: checkbox · title · linked contact name (clickable → opens drawer) · due timestamp · delete button
- Done tasks list (strikethrough, reduced opacity): click checkbox to reopen
- Tasks can be created standalone or linked to a contact (from drawer)

### 6.6 Analytics (`/admin/analytics`)
- KPI cards: Total Contacts · Conversion rate (won/total %) · Won deals count · Won value (k PLN)
- Area chart: submissions per day (last 7 days)
- Bar chart: leads by stage
- Pie/donut chart: leads by source
- Data comes from Supabase aggregate queries

### 6.7 Settings (`/admin/settings`)

**Properties tab:**
- List of global property definitions (shared across all contacts)
- Each def: key name + type badge (text / number / date / select)
- Add new: name input + type selector + Add button
- Delete property → removes from all contact `props` JSON
- Adding a property → instantly available on all contact cards (value = empty string)

**Notifications tab:**
- Toggle: "Email when new lead arrives" (default: on)
- Toggle: "Email reminder for task due dates" (default: off)
- Input: notification email address

---

## 7. Notifications

### New Lead (event-driven)
- Triggered in `/api/submit` after contact upsert
- Checks `app_settings.email_new_lead`
- Sends via **Resend API** (`RESEND_API_KEY` env var)
- Email: subject `🎯 New lead: {name}`, body with name/email/phone
- If `RESEND_API_KEY` not set → skips silently (logs to console)
- In-app: bell icon in top bar gets unread badge, notification panel shows entry

### Task Reminders (scheduled)
- **Vercel Cron** → `/api/cron/reminders` runs every hour
- Queries `tasks` where `due_at` within next 60 minutes AND `done = false`
- Sends reminder email per task via Resend
- `vercel.json` cron config:
```json
{ "crons": [{ "path": "/api/cron/reminders", "schedule": "0 * * * *" }] }
```

---

## 8. Database Schema (Supabase / Postgres)

```
forms            — id, owner, title, slug, schema (jsonb), published (jsonb), status, timestamps
submissions      — id, form_id, answers (jsonb), meta (jsonb), created_at
contacts         — id, owner, name, email, phone, company, stage, value, source, form_id, props (jsonb), timestamps
activities       — id, owner, contact_id, type, body, meta (jsonb), created_at
property_defs    — id, owner, key, type, options (jsonb), position
tasks            — id, owner, contact_id (nullable), title, due_at, done, created_at
app_settings     — owner (pk), email_new_lead, email_task_due, notify_email
```

- RLS enabled on all tables — `owner = auth.uid()` for all admin operations
- Public policy: `forms` SELECT where `status = 'published'`
- `/api/submit` uses service role key → bypasses RLS
- `updated_at` auto-trigger on `forms` and `contacts`
- Unique constraint: `(owner, email)` on contacts (enables upsert)
- Unique constraint: `(owner, key)` on property_defs

---

## 9. Design System

Inspired by: clean SaaS dashboard aesthetic (light background, white cards, soft border, violet accent, large border-radius).

| Token | Value |
|---|---|
| Background | `#F6F7F9` |
| Card | `#FFFFFF` |
| Border | `#ECEEF3` |
| Text | `#1A1D26` |
| Muted | `#8A92A6` |
| Accent | `#6C5CE7` (violet) or `#1A73E7` (Selltic blue) |
| Accent soft | `rgba(108,92,231,0.10)` |
| Success | `#18A957` |
| Warning | `#F2994A` |
| Border radius | `16px` |
| Font | Inter |

**Animations:**
- Card hover: `translateY(-2px)` + border accent glow
- Contact drawer: slide in from right, `cubic-bezier(.22,1,.36,1)`
- Form steps: slide up (forward) / slide down (backward), same easing
- Toast notifications: slide up from bottom
- Progress bar: width transition
- Stage selector: background color transition
- All animations respect `prefers-reduced-motion: reduce`

---

## 10. File Structure

```
selltic-crm/
├── middleware.ts                        # Route protection (Next.js entry)
├── next.config.ts
├── package.json
├── tsconfig.json
├── vercel.json                          # Cron jobs
├── schema.sql                           # Full DB schema (run once in Supabase)
├── .env.example
├── app/
│   ├── layout.tsx                       # Root layout
│   ├── page.tsx                         # Redirects to /admin
│   ├── login/
│   │   └── page.tsx                     # Login page (Supabase Auth)
│   ├── admin/
│   │   ├── page.tsx                     # Dashboard
│   │   ├── layout.tsx                   # Admin shell: sidebar + topbar
│   │   ├── pipeline/page.tsx
│   │   ├── tasks/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── settings/page.tsx
│   │   └── forms/
│   │       ├── page.tsx                 # Form list
│   │       └── [id]/page.tsx            # Form editor
│   ├── f/
│   │   └── [slug]/page.tsx             # Public form renderer
│   └── api/
│       ├── submit/route.ts             # Form submission handler
│       └── cron/
│           └── reminders/route.ts      # Task reminder emails
└── lib/
    ├── supabase/
    │   ├── client.ts                   # Browser client
    │   ├── server.ts                   # SSR client + admin client
    │   └── middleware.ts               # Session refresh helper
    └── types.ts                        # Shared TypeScript types
```

---

## 11. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL         # Project URL from Supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY    # Legacy anon key (public, safe for browser)
SUPABASE_SERVICE_ROLE_KEY        # Legacy service_role key (server only, secret)
RESEND_API_KEY                   # From resend.com (optional, for emails)
RESEND_FROM                      # e.g. "Selltic <leady@selltic-agency.pl>"
```

---

## 12. Build & Deploy

- **Repo:** GitHub (`selltic-agency/selltic-crm`, private)
- **Deploy:** Vercel, auto-deploy on push to `main`
- **DB:** Supabase, region `eu-central-1` (Frankfurt)
- **Framework preset on Vercel:** Next.js
- **Environment variables:** set in Vercel project settings (not committed to repo)
- **Domain:** `app.selltic-agency.pl` (add in Vercel → Domains)
