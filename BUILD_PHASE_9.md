# Selltic CRM — Phase 9: Contact-Centric Restructure (HubSpot-style Contacts + Leads)

Read REQUIREMENTS.md, BUILD_PHASES.md, and BUILD_PHASE_8.md first for full context.
This is a STRUCTURAL change to the data model — it touches nearly every existing
screen (Pipeline, Contact Drawer, Dashboard, Analytics, 8.4 filters, 8.5 table/columns).
Build sub-phases in strict order.

Note: there is no production data in the database yet, so this is a clean schema
build, not a data migration — no backfill or zero-data-loss concerns apply.

---

## Concept Summary (read before coding)

Today, `contacts` conflates two different things: a person/company identity AND
a single sales opportunity. We're splitting these:

- **Contact** = the person/company. Permanent identity. Has a master timeline
  containing EVERY activity that has ever happened with them, across all time —
  phone calls, emails, every form submission with its full answers, notes —
  regardless of which lead (if any) was open when it happened.
- **Lead** (was: the thing living in `contacts.stage`) = one sales opportunity/deal,
  scoped to a contact. Has its own stage, value, source, open/close dates, and its
  own SCOPED timeline showing only what happened between when that lead opened and
  when it closed (won/lost). A contact can have multiple leads over time (e.g. buys
  a website in January, comes back for Google Ads in July — two separate leads,
  same contact, full history visible on the contact, period-specific history visible
  on each lead).

Duplicate detection: when a new form submission comes in with an email that matches
an existing contact, the system creates a NEW lead under that EXISTING contact
(never silently merges or skips) — but the new lead's page must visibly show which
contact it belongs to, and flag if there's any ambiguity (e.g. phone matches a
different contact than the email did) as a potential duplicate needing manual review.

---

## 9.1 — Data Model: Split `contacts` into `contacts` (identity) + `leads` (opportunities)

**Goal: Build the target schema directly. No production data exists yet — this is a clean schema change, not a migration. Drop and recreate rather than ALTER where simpler.**

### Tasks:
1. Create new `leads` table:
   ```sql
   create table leads (
     id          uuid primary key default gen_random_uuid(),
     owner       uuid not null references auth.users on delete cascade,
     contact_id  uuid not null references contacts on delete cascade,
     stage       text not null default 'new',     -- references pipeline_stages.key
     value       numeric not null default 0,
     source      text,
     form_id     uuid references forms on delete set null,
     opened_at   timestamptz not null default now(),
     closed_at   timestamptz,                       -- set when stage becomes is_won/is_lost
     created_at  timestamptz not null default now(),
     updated_at  timestamptz not null default now()
   );
   create index idx_leads_owner_stage on leads (owner, stage);
   create index idx_leads_contact on leads (contact_id, opened_at desc);
   ```
2. Update `contacts` table — remove `stage`, `value`, `source`, `form_id` columns (these move to `leads`). Keep `name`, `email`, `phone`, `company`, `props`, `owner`, timestamps. Keep the `unique (owner, email)` constraint — contacts are still deduplicated by email. Since there's no data to preserve, just `alter table contacts drop column ...` directly (no backfill needed).
3. Add a `lead_id` (nullable) column to `activities`, alongside the existing `contact_id` (NOT NULL, keep it). This is the key mechanic:
   - `contact_id` is ALWAYS set — every activity belongs to a contact's master timeline.
   - `lead_id` is set ONLY if the activity happened while a specific lead was open (i.e., logged via that lead's scoped timeline UI) — null means it's a contact-level-only activity (e.g. a call logged outside any lead context).
   ```sql
   alter table activities add column lead_id uuid references leads on delete set null;
   create index idx_activities_lead on activities (lead_id, created_at desc);
   ```
4. Update RLS policies: add `owner = auth.uid()` policy on `leads`, consistent with other tables.
5. `property_defs` stay attached to `contacts.props` (properties describe the person/company, not the deal) — keep ALL properties as contact-level. (Lead-level custom properties can be a future phase if needed — don't build it now.)
6. Update any existing code (queries, types, components) across Phases 1-8 that reads/writes `contacts.stage`, `contacts.value`, `contacts.source`, or `contacts.form_id` directly — there's no data to break, but the code referencing these columns needs to be found and updated to use `leads` instead, or the app won't build/run.

### Definition of done:
- `leads` table exists with correct schema and RLS
- `contacts` table no longer has stage/value/source/form_id
- `activities` has the new `lead_id` column
- App builds and runs with no references to the removed `contacts` columns anywhere in the codebase

---

## 9.2 — Submission Flow: Create Lead, Link to Existing or New Contact

**Goal: Update `/api/submit` so it creates a NEW lead every time, attached to an existing contact if the email matches, or a new contact if not — and flags potential duplicates.**

### Tasks:
1. Rewrite `/api/submit` logic:
   - Extract email/name/phone from answers (unchanged from before).
   - Look up contact by `(owner, email)` — if found, use that `contact_id`. If not found, create a new contact.
   - **Always create a NEW `leads` row** (never update an existing lead's stage/value from a new submission) — `stage = 'new'` (or whatever the first `pipeline_stages` position is), `opened_at = now()`, `source`, `form_id` set from this submission.
   - Insert the `submission` activity with `contact_id` (always) AND `lead_id` (the new lead just created) — so it shows on both the contact's master timeline and this specific lead's scoped timeline.
   - **Duplicate flagging:** after resolving the contact by email, also check if the extracted `phone` matches a DIFFERENT contact (different `id`, same `owner`). If so, insert a flag — add a `duplicate_flags` table:
     ```sql
     create table duplicate_flags (
       id          uuid primary key default gen_random_uuid(),
       owner       uuid not null references auth.users on delete cascade,
       contact_a   uuid not null references contacts on delete cascade,
       contact_b   uuid not null references contacts on delete cascade,
       reason      text not null,   -- e.g. 'phone match, different email'
       resolved    boolean not null default false,
       created_at  timestamptz not null default now()
     );
     ```
   - Email notification (`email_new_lead`) now fires per new LEAD, not per contact — wording can stay similar but should be clear it's a new lead/opportunity, especially when the contact already existed ("Returning contact — new lead" vs "New contact — new lead").

### Definition of done:
- Submitting a form with a brand-new email creates both a new contact AND a new lead.
- Submitting a form with an email matching an existing contact creates a NEW lead under that SAME existing contact — does not touch any of that contact's other leads.
- A phone-number collision across two different email addresses creates a `duplicate_flags` entry.
- Activities from submissions always have both `contact_id` and `lead_id` set.

---

## 9.3 — UI: Contact Page (master timeline + lead list)

**Goal: A dedicated Contact view showing identity, ALL-time master timeline, and a list of every lead this contact has ever had.**

### Tasks:
1. New route: `app/admin/contacts/[id]/page.tsx`
2. Layout:
   - Header: name, company, email, phone, properties (same editable properties UI as before, now scoped to the contact, not a lead)
   - **"Leads" section** — list/cards of every lead this contact has, each showing: stage (with color), value, opened date, closed date (if closed), source. Click → navigates to that lead's page (9.4).
   - **"Duplicate" warning banner** if this contact has unresolved entries in `duplicate_flags` — shows the other contact's name/email, with at minimum a "Mark as not a duplicate" / "View other contact" action (a full merge feature is out of scope for this phase, see notes below).
   - **Master timeline** — ALL activities where `contact_id` = this contact, across all leads and all time, newest first, with exact timestamps (unchanged formatting from before). Each timeline entry, if it has a `lead_id`, should show a small badge/link indicating which lead it belongs to (e.g. "via Lead — Formularz: Wycena, Jan 2026").
3. Update navigation: contact names anywhere in the app (kanban cards, table rows, search results) link to `/admin/contacts/[id]` instead of opening the old all-in-one drawer.

### Definition of done:
- Visiting a contact shows their full identity, properties, every lead they've ever had, and their complete master timeline regardless of lead.
- Duplicate flags are visibly surfaced on the contact page.
- Timeline entries are traceable back to which lead (if any) they belong to.

---

## 9.4 — UI: Lead Page (scoped timeline + which contact it belongs to)

**Goal: A dedicated Lead view — replaces what the old Contact Drawer did for pipeline cards — showing stage/value/source, a link back to the parent contact, and ONLY the activity that happened during this lead's open period.**

### Tasks:
1. New route: `app/admin/leads/[id]/page.tsx` (or a drawer/modal if that fits the existing UX better — but it must comfortably fit slightly less content than before, given activity is now scoped)
2. Layout:
   - Header: lead identifier (e.g. contact name + source, like "Marta Nowak — Formularz: Wycena"), stage selector (same pill UI as before), value (editable), opened/closed dates
   - **"Belongs to contact" block** — clearly shows the parent contact's name/email/phone with a link to the full contact page (9.3). If this contact has other leads, show a small count/link ("This contact has 2 other leads").
   - **Scoped timeline** — only activities where `lead_id` = this lead. Same activity composer as before (note/call/email/task), but anything logged here gets BOTH `contact_id` and `lead_id` set, so it also appears on the contact's master timeline.
   - Closing the lead (changing stage to an `is_won` or `is_lost` stage) sets `closed_at = now()`.
3. Update Pipeline (kanban + table from 8.5) to query/display `leads` instead of `contacts` directly — cards/rows now represent leads, joined with their contact's name/company for display. Filters (8.4) and saved views (8.6, if built) need their field list updated: some filters are lead-level (stage, value, source, opened/closed date), some are contact-level (properties, email, phone) — the filter UI should clearly group these two categories.

### Definition of done:
- Lead page shows only what happened during that lead's lifecycle, not the contact's full history.
- Always clear which contact a lead belongs to, with a working link.
- Activities logged on a lead appear correctly on both the lead's scoped timeline and the contact's master timeline.
- Pipeline (kanban + table) now operates on leads, correctly displaying the associated contact's name/company.

---

## 9.5 — Dashboard & Analytics Updates

**Goal: Reconcile existing Dashboard/Analytics widgets with the new contact/lead split.**

### Tasks:
1. Dashboard "Leads in progress" table → now genuinely queries `leads` (not `contacts`), joined with contact name/company.
2. Dashboard "Recent activity" feed → pulls from `activities` across all contacts (unchanged data source, just confirm join still works with the new `lead_id` column present).
3. Analytics KPIs — "Total Contacts" now means unique contacts (people/companies), separate from a new "Total Leads" KPI (total opportunities, which may exceed contact count). Conversion rate, won count, won value all now calculate from `leads`, not `contacts`.
4. Nice-to-have if straightforward: "Leads per contact" distribution (how many contacts have 2+ leads — useful to see repeat-business rate) — skip if it adds too much complexity for this phase.

### Definition of done:
- All dashboard/analytics numbers are accurate against the leads/contacts split — no double-counting, no stale references to the old merged model.

---

## Build Order Summary

```
9.1 Schema change                → do first (no data to migrate, just build it)
9.2 Submission flow rewrite      → depends on 9.1 (needs leads table to exist)
9.3 Contact page UI              → depends on 9.1
9.4 Lead page UI + Pipeline      → depends on 9.1, 9.3 (links to contact page)
9.5 Dashboard/Analytics fixes    → depends on 9.2, 9.4 (needs leads to query correctly)
```

Recommended: do 9.1 and 9.2 in one sitting if possible (they're tightly coupled —
a broken submission flow on top of a half-built schema is hard to debug), then
9.3 → 9.4 → 9.5 each as their own checkpoint.

---

## Notes for Claude Code

- This phase changes the meaning of the primary entity the rest of the app
  (8.4 filters, 8.5 table/columns, 8.6 saved views if built) was written against.
  After 9.1, expect to revisit 8.4/8.5/8.6 code wherever it directly queries/displays
  `contacts.stage` or `contacts.value` — those fields no longer exist on contacts.
- Do NOT attempt a "merge contacts" feature in this phase — duplicate flags are
  surfaced for manual awareness only. Merging two contacts (combining their leads
  and activity histories, deciding which email/phone/props win) is meaningfully
  more complex and should be its own future phase if needed.
- Keep the existing `property_defs` + `props` jsonb pattern unchanged — it now
  describes contacts only, which is actually a simplification, not a complication.
- Test the full loop after 9.2: submit a form with a NEW email → check a contact
  and a lead were both created. Submit again with the SAME email → check it reused
  the same contact but created a SECOND, independent lead. Submit a third time with
  a different email but the same phone number as submission #1 → check a
  `duplicate_flags` row was created.
- Don't touch the Forms builder (Phase 4), public renderer (Phase 5), or auth
  (Phase 1) in this phase — only the contact/lead data model and the screens
  that display it.
