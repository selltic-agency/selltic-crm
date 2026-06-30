# Selltic CRM — Phase 8: Validation, Motion, Configurable Pipeline & Views

Read REQUIREMENTS.md and BUILD_PHASES.md (Phases 1-7) first for full context.
This phase builds on top of the completed app. Build sub-phases in order —
8.3 depends on 8.2 (stages must be dynamic before views can filter by them).

---

## 8.1 — Field Validation in Form Builder

**Goal: Real validation rules per field, configurable in the editor, enforced in the renderer.**

### Tasks:
1. Extend step schema with a `validation` object:
   ```ts
   validation?: {
     pattern?: string;       // regex, e.g. polish phone: ^(\+48)?\s?\d{3}\s?\d{3}\s?\d{3}$
     minLength?: number;
     maxLength?: number;
     min?: number;           // for number-like text
     max?: number;
     customMessage?: string; // shown on failure
   }
   ```
2. In the step editor (center pane), add a "Validation" sub-panel visible for `short_text`, `long_text`, `email` step types:
   - Preset dropdown: None / Email (already built-in) / Polish phone / NIP / Custom regex
   - Selecting a preset fills `pattern` + `customMessage` automatically
   - "Custom regex" reveals a raw pattern input + message input
   - Min/max length inputs for text fields
3. In `FormRenderer.tsx`:
   - Validate on blur AND before allowing "next" / Enter
   - Show inline error message below the field (red text, small, using design tokens)
   - Block advancing until valid if `required` or `validation` is set
   - Field border turns to error color (`#EB5757` or similar) on invalid state, animate with a subtle shake (use Framer Motion if 8.2 done first, otherwise CSS)
4. Built-in presets to ship:
   - Polish phone: `^(\+48)?\s?\d{3}[\s-]?\d{3}[\s-]?\d{3}$`
   - NIP: `^\d{10}$`
   - Postal code PL: `^\d{2}-\d{3}$`

### Definition of done:
- Can set validation rules per field in the editor
- Public form blocks submission on invalid input with clear inline error
- Presets work out of the box, custom regex works for edge cases

---

## 8.2 — Framer Motion Animation Pass

**Goal: Replace CSS keyframe animations with Framer Motion for smoother, more "alive" interactions across the whole app — not just the form renderer.**

### Tasks:
1. Add `framer-motion` to `package.json`
2. **Form renderer** (`FormRenderer.tsx`):
   - Replace slide-up/slide-down CSS animation with `AnimatePresence` + `motion.div`
   - `initial`, `animate`, `exit` variants based on direction (forward/back)
   - Spring physics for a more natural feel (`type: "spring", stiffness: 300, damping: 30`)
   - Animate progress bar width with `motion.div` + `layout` prop
   - Stagger option entrance on `single_choice` steps (each option fades/slides in with small delay)
3. **Contact Drawer:**
   - Replace CSS slide-in with `motion.div`, spring transition
   - Animate scrim opacity in sync
   - Stage pill selection: animated background "pill" that slides between options (shared layout animation, `layoutId`)
4. **Kanban board:**
   - Card hover: subtle scale/lift with `whileHover`
   - Card appearing/disappearing (stage change, filter change): `AnimatePresence` with fade+scale
   - Optional: drag-to-reorder/drag-to-change-stage using `Reorder` or `drag` from Framer Motion (stretch goal — only if time permits, see 8.3 for stage editing which is separate from drag-and-drop)
5. **Toasts:** spring slide-up + fade, auto-dismiss with exit animation
6. **Dashboard action cards:** subtle stagger-in on page load
7. **General rule:** respect `prefers-reduced-motion` — wrap all motion config to fall back to instant transitions

### Definition of done:
- All major transitions (form steps, drawer, toasts, kanban cards) use Framer Motion
- Animations feel springy/natural, not linear
- No animation breaks `prefers-reduced-motion` accessibility
- No jank — test with 20+ contacts in pipeline

---

## 8.3 — Configurable Pipeline Stages (Settings)

**Goal: Stages are no longer hardcoded — admin defines and reorders them in Settings.**

⚠️ Do this BEFORE 8.4/8.5 — saved views and table columns need to read stages dynamically.

### Tasks:
1. New table:
   ```sql
   create table pipeline_stages (
     id          uuid primary key default gen_random_uuid(),
     owner       uuid not null references auth.users on delete cascade,
     key         text not null,        -- stable identifier, e.g. 'new', 'contact'
     label       text not null,        -- display name, editable
     color       text not null,        -- hex
     position    int not null default 0,
     is_won      boolean not null default false,   -- marks a "won" terminal stage
     is_lost     boolean not null default false,   -- marks a "lost" terminal stage
     unique (owner, key)
   );
   ```
   Seed migration: insert the current 5 hardcoded stages (new, contact, offer, won, lost) for the existing owner so nothing breaks.
2. Add RLS policy: `owner = auth.uid()`, full access.
3. Settings → new "Pipeline Stages" tab:
   - List of stages in order, drag-to-reorder (use Framer Motion `Reorder.Group` if 8.2 done, otherwise simple up/down buttons)
   - Each row: color swatch (click to change via color input), label (editable inline), is_won/is_lost checkboxes, delete button
   - "Add stage" button → new row with default color, editable label
   - Deleting a stage that has contacts on it → confirm dialog, must choose a replacement stage to move those contacts to (don't allow orphaned contacts)
4. Replace all hardcoded `STAGES` constant usage across the app (Pipeline, Dashboard, Analytics, Contact Drawer stage pills) with a fetch from `pipeline_stages`, ordered by `position`
5. `contacts.stage` now stores the `key` from `pipeline_stages` — keep as `text` column, no FK needed (keeps it simple, avoids cascade issues)

### Definition of done:
- Stages are fully editable in Settings: add, rename, recolor, reorder, delete (with reassignment)
- Pipeline, Dashboard, Analytics, Contact Drawer all reflect custom stages
- Existing contacts/data unaffected by the migration

---

## 8.4 — Lead Filtering by Properties

**Goal: Filter the contact list (pipeline or table) by any property — built-in or custom.**

### Tasks:
1. Build `components/FilterBar.tsx`:
   - "Add filter" button → dropdown of available fields: built-in (Stage, Source, Value, Created date) + all `property_defs` keys
   - Selecting a field shows an operator + value input appropriate to its type:
     - text properties → "contains" / "equals" / "is empty"
     - number/value → "greater than" / "less than" / "between"
     - date → "before" / "after" / "in last N days"
     - select/stage → multi-select checkboxes
   - Multiple filters combine with AND (keep it simple — no OR groups in this phase)
   - Active filters shown as removable chips above the list
   - "Clear all" button
2. Filter logic applied client-side if dataset is small, or as a Supabase query builder if it grows — build a `buildFilterQuery(filters)` helper that translates the filter state into Supabase `.filter()` / `.gte()` / `.ilike()` chains
3. Apply `FilterBar` to both Pipeline (kanban) and the new Table view (8.5)

### Definition of done:
- Can filter contacts by any built-in field or custom property
- Filters combine correctly (AND)
- Filter state is shareable as URL query params (so a filtered view can be bookmarked/linked)

---

## 8.5 — Table View + Configurable Columns

**Goal: Second view mode for contacts — sortable/configurable table, alongside the existing kanban.**

### Tasks:
1. Add a view switcher (Kanban / Table toggle, icon buttons) at the top of `/admin/pipeline`
2. Build `components/ContactTable.tsx`:
   - Columns: built-in (Name, Company, Email, Phone, Stage, Value, Source, Created) + any `property_defs` as additional columns
   - Click column header → sort asc/desc
   - Row click → opens Contact Drawer (same as kanban card click)
   - Pagination or infinite scroll if contact count is large
3. **Column configuration:**
   - "Columns" button → panel listing all available columns with checkboxes (show/hide) and drag handles (reorder)
   - Persist column config per user in a new table:
     ```sql
     create table table_view_config (
       owner   uuid primary key references auth.users on delete cascade,
       columns jsonb not null default '[]'  -- [{ key: "name", visible: true, width: 200, position: 0 }, ...]
     );
     ```
   - Reordering updates `position`, hiding sets `visible: false`
   - Column resize (drag right edge) — store `width` in same config, optional nice-to-have
4. Table view respects active `FilterBar` filters (8.4) exactly like kanban does

### Definition of done:
- Can switch between Kanban and Table view, state persists across reloads (localStorage or URL param)
- Table shows all configured columns including custom properties
- Can show/hide and reorder columns, persisted per user
- Sorting works on any column
- Filters from 8.4 apply identically in both views

---

## 8.6 — Saved Views (HubSpot-style)

**Goal: Save a combination of view mode + filters + sort as a named, reusable view.**

### Tasks:
1. New table:
   ```sql
   create table saved_views (
     id        uuid primary key default gen_random_uuid(),
     owner     uuid not null references auth.users on delete cascade,
     name      text not null,                 -- "All Deals", "Lost Deals", "Hot Leads This Week"
     view_mode text not null default 'kanban', -- kanban | table
     filters   jsonb not null default '[]',    -- serialized FilterBar state
     sort      jsonb,                          -- { column, direction } — table view only
     position  int not null default 0,
     is_default boolean not null default false
   );
   ```
2. UI: tab bar above the Kanban/Table switcher showing saved views (like HubSpot's deal view tabs)
   - Default seeded views on first load: "All Deals" (no filters), "Won" (stage = won), "Lost" (stage = lost)
   - "+" tab → save current filter/sort/view-mode state as a new named view
   - Right-click or "..." menu on a tab → rename, duplicate, delete, set as default
   - Reorder tabs (drag)
3. Loading a saved view → applies its `filters`, `sort`, and `view_mode` to the FilterBar/Table/Kanban
4. The currently active view's filters stay editable — editing them prompts "Save changes to this view?" / "Save as new view" rather than silently mutating

### Definition of done:
- Can create, rename, delete, and switch between saved views
- Each view remembers its filter criteria, sort, and view mode (kanban/table)
- Editing a loaded view's filters offers save/save-as choice, doesn't silently overwrite
- "All Deals" / "Won" / "Lost" exist by default for new users

---

## Build Order Summary

```
8.1 Validation        → independent, do anytime
8.2 Framer Motion     → independent, do anytime (do early — makes 8.3-8.6 nicer to use while testing)
8.3 Pipeline Stages   → MUST come before 8.4/8.5/8.6
8.4 Filtering         → depends on 8.3 (filters by stage need dynamic stages)
8.5 Table View        → depends on 8.4 (reuses FilterBar)
8.6 Saved Views       → depends on 8.4 + 8.5 (saves filter+view_mode state)
```

Recommended order: **8.2 → 8.1 → 8.3 → 8.4 → 8.5 → 8.6**
(Motion first so every subsequent UI you build already feels polished;
validation is isolated and quick; then the pipeline-stages chain in order.)

---

## Notes for Claude Code

- Keep `pipeline_stages.key` stable once created — it's referenced by `contacts.stage` as plain text, not a foreign key, so renaming `label` is safe but changing `key` requires updating all contacts with that stage
- `FilterBar` filter state shape should be reusable as-is by `saved_views.filters` — design it as a clean serializable array of `{ field, operator, value }` from the start
- All new tables need RLS: `owner = auth.uid()`, full access, consistent with existing tables
- Framer Motion: import only `motion`, `AnimatePresence`, `Reorder` as needed — avoid pulling in unused features
- Don't break Phases 1-7 — this phase modifies existing components (Pipeline, Contact Drawer, Settings), so test the existing flows (create contact, change stage, add activity) still work after each sub-phase
