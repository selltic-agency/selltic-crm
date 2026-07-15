// Test regresyjny wysyłki zleceń do webhooka scrapera (ścieżka „cykl życia
// zadania scrapowania”). Sprawdza cztery gałęzie dispatchScrapeJobs:
//   • brak konfiguracji → zadania zostają 'pending', supabase nietknięty,
//   • HTTP błąd → zadania oznaczone jako 'error' (tylko te 'pending'),
//   • błąd sieci → zadania zostają 'pending' (backend mógł je przyjąć),
//   • sukces → ok:true.
// Uruchomienie: npm test
import assert from "node:assert";
import { dispatchScrapeJobs } from "./scraperDispatch.ts";

// ── Atrapa klienta Supabase: łańcuch from().update().in().eq() → { error } ──
function mockSupabase() {
  const calls: {
    table?: string;
    update?: Record<string, unknown>;
    inCol?: string;
    inIds?: string[];
    eqCol?: string;
    eqVal?: unknown;
    invoked: boolean;
  } = { invoked: false };
  const chain: Record<string, (...a: unknown[]) => unknown> = {
    from: (t) => ((calls.table = t as string), chain),
    update: (p) => ((calls.update = p as Record<string, unknown>), (calls.invoked = true), chain),
    in: (c, ids) => ((calls.inCol = c as string), (calls.inIds = ids as string[]), chain),
    eq: (c, v) => ((calls.eqCol = c as string), (calls.eqVal = v), Promise.resolve({ error: null })),
  };
  return { supabase: chain as never, calls };
}

// Zapamiętaj oryginały, żeby przywrócić globalny stan po teście.
const origFetch = globalThis.fetch;
const origEnv = { ...process.env };
const origLog = console.log;
const origError = console.error;

function silence() {
  console.log = () => {};
  console.error = () => {};
}
function restore() {
  globalThis.fetch = origFetch;
  process.env = { ...origEnv };
  console.log = origLog;
  console.error = origError;
}

async function run() {
  // ── 1) Brak konfiguracji webhooka → 'pending', bez dotykania bazy ─────────
  {
    silence();
    delete process.env.SCRAPER_WEBHOOK_URL;
    delete process.env.SCRAPER_WEBHOOK_SECRET;
    const { supabase, calls } = mockSupabase();
    const res = await dispatchScrapeJobs(supabase, "batch1", ["j1", "j2"]);
    console.log = origLog;
    assert.strictEqual(res.ok, false, "bez konfiguracji: ok=false");
    assert.match(res.warning ?? "", /nieskonfigurowany/i, "ostrzeżenie o braku konfiguracji");
    assert.strictEqual(calls.invoked, false, "supabase nie jest wołany, gdy brak konfiguracji");
  }

  // ── 2) HTTP błąd → oznacz podane zadania jako 'error' (tylko 'pending') ────
  {
    silence();
    process.env.SCRAPER_WEBHOOK_URL = "https://scraper.example.com/";
    process.env.SCRAPER_WEBHOOK_SECRET = "sekret";
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as typeof fetch;
    const { supabase, calls } = mockSupabase();
    const res = await dispatchScrapeJobs(supabase, "batch2", ["j1", "j2"]);
    console.log = origLog;
    assert.strictEqual(res.ok, false, "HTTP 500: ok=false");
    assert.strictEqual(calls.table, "scrape_jobs");
    assert.strictEqual((calls.update as { status?: string }).status, "error", "zadania oznaczone jako error");
    assert.deepStrictEqual(calls.inIds, ["j1", "j2"], "dokładnie podane job_id");
    assert.strictEqual(calls.eqCol, "status");
    assert.strictEqual(calls.eqVal, "pending", "nadpisujemy tylko zadania nadal 'pending'");
  }

  // ── 3) Błąd sieci → zadania zostają 'pending' (bez oznaczania error) ──────
  {
    silence();
    process.env.SCRAPER_WEBHOOK_URL = "https://scraper.example.com";
    process.env.SCRAPER_WEBHOOK_SECRET = "sekret";
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const { supabase, calls } = mockSupabase();
    const res = await dispatchScrapeJobs(supabase, "batch3", ["j1"]);
    console.log = origLog;
    assert.strictEqual(res.ok, false, "błąd sieci: ok=false");
    assert.strictEqual(calls.invoked, false, "błąd sieci nie oznacza zadań jako error");
    assert.match(res.warning ?? "", /pending/i);
  }

  // ── 4) Sukces (HTTP 200) → ok:true ────────────────────────────────────────
  {
    silence();
    process.env.SCRAPER_WEBHOOK_URL = "https://scraper.example.com";
    process.env.SCRAPER_WEBHOOK_SECRET = "sekret";
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as typeof fetch;
    const { supabase, calls } = mockSupabase();
    const res = await dispatchScrapeJobs(supabase, "batch4", ["j1"]);
    console.log = origLog;
    assert.strictEqual(res.ok, true, "HTTP 200: ok=true");
    assert.strictEqual(calls.invoked, false, "sukces nie oznacza zadań jako error");
  }
}

try {
  await run();
  restore();
  console.log("scraperDispatch.test.ts — OK");
} catch (e) {
  restore();
  throw e;
}
