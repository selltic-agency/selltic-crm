# Selltic CRM — Build Phases for Claude Code

Read REQUIREMENTS.md first for full context. Build phases in order below.
Each phase must be fully working before starting the next one.
After each phase: commit to main, verify Vercel deployment succeeds.

---

## PHASE 1 — Foundation + Auth + Admin Shell
**Goal: Working app skeleton with login and protected admin area.**

### Tasks:
1. Set up correct Next.js 15 App Router file structure
2. Install all dependencies from package.json
3. Create `app/layout.tsx` (root layout, Inter font from Google Fonts)
4. Create `app/page.tsx` (redirects to `/admin`)
5. Create `app/login/page.tsx`:
   - Email + password form
   - Supabase Auth sign-in (`signInWithPassword`)
   - Error message on wrong credentials
   - Redirect to `/admin` on success
   - Clean centered card layout using design system tokens (see REQUIREMENTS.md §9)
6. Create `app/admin/layout.tsx` — the main app shell:
   - Sidebar (230px): Selltic logo, nav items (Dashboard, Pipeline, Tasks, Analytics, Forms, Settings), Settings at bottom
   - Top bar: search input (UI only, not functional yet), bell icon, avatar circle with "D"
   - Main content area (`{children}`)
   - Use design tokens from REQUIREMENTS.md §9
7. Create `app/admin/page.tsx` — Dashboard placeholder:
   - "Dashboard" heading
   - 4 quick action cards (New Form, New Contact, New Task, Analytics) — UI only, no logic yet
   - Two empty card placeholders: "Leads in progress" and "Recent activity"
8. Verify middleware protects `/admin` (redirect to `/login` if no session)
9. Add `vercel.json` with cron placeholder

### Definition of done:
- `/login` shows login form
- Wrong password shows error
- Correct password redirects to `/admin`
- `/admin` without session redirects to `/login`
- Sidebar and topbar render correctly
- Vercel deployment succeeds with no errors

---

## PHASE 2 — CRM: Pipeline + Contact Drawer
**Goal: Working kanban pipeline with contact cards and full contact detail drawer.**

### Tasks:
1. Create `lib/types.ts` with TypeScript types: `Contact`, `Activity`, `Task`, `Stage`, `PropertyDef`
2. Create `app/admin/pipeline/page.tsx`:
   - Fetch contacts from Supabase (`contacts` table, owner = current user)
   - Kanban board: 5 columns (New Lead, Contact, Offer, Won, Lost)
   - Each column: stage name, count badge, total value in PLN
   - Contact cards: name, company, source label, value
   - Click card → opens Contact Drawer
3. Build `components/ContactDrawer.tsx`:
   - Slide-in from right with scrim overlay
   - Header: name, company, close button
   - Stage selector pills (5 stages, active = colored)
   - Properties section: Email, Phone, Source (static) + dynamic fields from `property_defs` table (editable inputs)
   - Activity composer: tabs (Note, Phone call, Email, Task), textarea, Save button
   - Task mode in composer: title + due date input
   - Activity timeline: icon, type label (uppercase), **exact timestamp** (`dd mmm yyyy, HH:MM`), body text
   - All actions save to Supabase in real time
4. Add sidebar nav item highlighting for active route
5. Update Dashboard "Leads in progress" table with real data from Supabase

### Definition of done:
- Pipeline loads real contacts from Supabase
- Can change contact stage (updates DB, adds stage activity)
- Can add note/call/email activity (saves to DB with exact timestamp)
- Can add task linked to contact
- Timeline shows all activities newest-first with exact timestamps
- Properties are editable and save on change

---

## PHASE 3 — CRM: Tasks + Settings
**Goal: Standalone task management and global property definitions.**

### Tasks:
1. Create `app/admin/tasks/page.tsx`:
   - Add task form: title + due date/time + Add button
   - Fetch tasks from Supabase for current user
   - Open tasks: checkbox (marks done), title, linked contact name (clickable), due timestamp, delete button
   - Done tasks: separate section, strikethrough, click to reopen
   - Real-time updates (optimistic UI)
2. Create `app/admin/settings/page.tsx` with two sections:
   - **Properties tab:**
     - List current `property_defs` from Supabase
     - Each row: key name + type badge + delete button
     - Add form: name input + type select (text/number/date/select) + Add button
     - Adding a def → inserts to `property_defs` table
     - Deleting a def → removes from `property_defs` (contact props JSON cleaned lazily)
   - **Notifications tab:**
     - Toggle: email on new lead (saves to `app_settings`)
     - Toggle: email reminder on task due (saves to `app_settings`)
     - Email address input (saves to `app_settings`)
     - Use toggle switch component (pill shape, smooth animation)
3. Update Dashboard "Tasks for today" with real data

### Definition of done:
- Can add/complete/delete tasks
- Tasks linked to contacts open the contact drawer
- Properties added in Settings appear on all contact cards immediately
- Notification toggles save to DB

---

## PHASE 4 — Form Builder
**Goal: Full Typeform-style form editor with live preview, routing, and theme controls.**

### Tasks:
1. Create `app/admin/forms/page.tsx`:
   - Grid of form cards: title, status badge (Draft/Published), created date
   - "New Form" button → inserts blank form to Supabase, redirects to editor
   - Delete form action
2. Create `app/admin/forms/[id]/page.tsx` — the form editor:
   - Three-pane layout (step list | editor + theme | live preview)
   - **Left pane — Step list:**
     - Ordered list of steps with type icon and truncated question text
     - Active step highlighted
     - Move up/down buttons, delete button per step
     - "Add step" button → dropdown with all step types
   - **Center pane — Step editor:**
     - Fields: question, description, image URL
     - Conditional fields: placeholder, required toggle (text inputs), CTA label (welcome), options editor (choice steps)
     - Options editor: label input + routing dropdown (next step selector) + delete, add option button
     - Default next step selector
     - Below step editor: Theme panel (font picker, 3 color pickers, layout selector)
   - **Right pane — Live preview:**
     - Fully interactive — renders current form state
     - Follows routing when clicking through
     - Animates step transitions (slide up/down)
     - Updates in real time as editor changes
   - Auto-save `schema` to Supabase with 800ms debounce
   - "Publish" / "Update" button → copies schema to `published`, sets status
   - Status badge: Draft / Published / Unsaved changes
3. Build shared `components/FormRenderer.tsx`:
   - Used by both live preview AND public form page
   - Accepts `form` object (schema), renders all step types
   - Routing logic, history stack, back button, progress bar
   - Keyboard navigation (Enter, A/B/C keys)
   - Animations: slide up forward, slide down backward

### Definition of done:
- Can create, edit, and publish a form
- All step types render and are editable
- Routing between steps works in live preview
- Theme changes reflect instantly in preview
- Schema auto-saves, published version is separate from draft

---

## PHASE 5 — Public Form + Submission Flow
**Goal: Public form URL, embed mode, and full submission-to-CRM pipeline.**

### Tasks:
1. Create `app/f/[slug]/page.tsx`:
   - Fetch published form by slug from Supabase (public read policy)
   - Render using `FormRenderer` component
   - On submit → POST to `/api/submit`
   - Show thank-you screen (end step) after submit
   - `?embed=1` mode: no header, `postMessage` with form height after each step
2. Finalize `app/api/submit/route.ts`:
   - Validate formId + answers
   - Save to `submissions`
   - Upsert contact by (owner, email)
   - Insert `submission` activity with answer summary
   - Send email via Resend if `email_new_lead = true`
3. Add embed snippet to Share tab in form list
4. Test full flow: fill public form → check contact appears in Pipeline at "New Lead" stage

### Definition of done:
- Public form loads at `/f/[slug]`
- Embed works in an iframe on external page
- Submitting form creates contact in CRM
- Activity "Wypełnił formularz" appears on contact timeline
- Email notification sent (if Resend configured)

---

## PHASE 6 — Analytics + Notifications
**Goal: Real data charts and working email notifications.**

### Tasks:
1. Create `app/admin/analytics/page.tsx`:
   - KPI cards (fetch from Supabase aggregates):
     - Total contacts count
     - Conversion rate: won / total contacts (%)
     - Won deals count
     - Total won value (PLN)
   - Area chart: submissions per day last 7 days (query `submissions` group by date)
   - Bar chart: contact count per stage
   - Pie chart: contact count per source
   - Use Recharts v3
2. Add notification bell functionality:
   - On new contact creation → insert to a `notifications` table (or use in-memory for now)
   - Bell badge shows unread count
   - Click bell → panel with list of notifications + mark all read
3. Create `app/api/cron/reminders/route.ts`:
   - Query tasks where `due_at` within next 60 minutes AND `done = false`
   - Send reminder email per task via Resend
   - Verify cron secret header to prevent unauthorized calls
4. Add `vercel.json` cron schedule (hourly)
5. Update Dashboard "Recent activity" feed with real data from `activities` table

### Definition of done:
- Analytics page shows real numbers from DB
- Charts render with actual data
- Bell notifications work for new leads
- Cron endpoint exists and is protected

---

## PHASE 7 — Polish + Production Hardening
**Goal: Production-ready app with good UX, error handling, and security.**

### Tasks:
1. Loading states on all data-fetching components (skeleton loaders)
2. Error boundaries with friendly error messages
3. Toast notifications for: save success, publish success, activity added, task completed
4. Optimistic UI updates (don't wait for DB before updating UI)
5. Search functionality in top bar (search contacts by name/email/company)
6. Mobile-responsive sidebar (collapsible on small screens)
7. Empty states for all lists (no contacts, no tasks, no forms)
8. Form validation messages (required fields, invalid email)
9. Confirm dialog before destructive actions (delete form, delete contact)
10. Add `CRON_SECRET` env var check in cron endpoint
11. Rate limiting on `/api/submit` (max 10 requests per IP per minute)
12. Custom domain setup instructions (`app.selltic-agency.pl`)

### Definition of done:
- All pages have loading and error states
- No unhandled promise rejections
- App works acceptably on mobile
- Cron endpoint is protected
- Ready for real use

---

## Notes for Claude Code

- Always use `createSupabaseServer()` (SSR client) in Server Components and Route Handlers for user-scoped queries
- Always use `createSupabaseAdmin()` (service role) in `/api/submit` and cron endpoints only
- Never import server-only modules in `'use client'` components
- Design tokens are in REQUIREMENTS.md §9 — use them consistently, no random colors
- Timestamps: store as `timestamptz` in DB, display as `dd mmm yyyy, HH:MM` in Polish locale
- All money values in PLN, formatted with `toLocaleString('pl-PL')`
- Form schema JSON structure: `{ title, theme: { font, primary, bg, text, layout }, steps: [...] }`
- Each step: `{ id, type, question, description, image, next, options?, placeholder?, required?, cta? }`
- Routing constants: `__next__` = linear next step, `__submit__` = submit form
