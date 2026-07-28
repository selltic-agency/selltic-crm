// app/api/settings/facebook/route.ts — Ustawienia → Facebook Lead Ads.
// Trzyma token Conversions API WYŁĄCZNIE po stronie serwera: GET zwraca tylko
// informację, czy token jest ustawiony (nigdy jego wartości — jak przy SMSAPI
// i Meta per-form). POST zapisuje (pusty token = bez zmian; `clearToken` = usuń).
//
// Mapowanie pól formularzy (fb_lead_forms) i log wysyłek (meta_lead_events)
// mają RLS na właściciela, więc UI czyta i zapisuje je bezpośrednio przez
// supabase-js — tutaj są tylko sekrety.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { GRAPH_API_VERSION } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { data } = await supabase
    .from("app_settings")
    .select(
      "meta_crm_dataset_id, meta_crm_token, meta_crm_test_event_code, meta_crm_enabled, fb_leads_notify, meta_pixel_id, meta_capi_token"
    )
    .eq("owner", user.id)
    .maybeSingle();

  return NextResponse.json({
    datasetId: data?.meta_crm_dataset_id ?? "",
    tokenConfigured: !!(data?.meta_crm_token && String(data.meta_crm_token).trim()),
    testEventCode: data?.meta_crm_test_event_code ?? "",
    enabled: !!data?.meta_crm_enabled,
    notify: data?.fb_leads_notify !== false,
    // Gdy dataset/token nie są ustawione osobno, wysyłka spada na globalną
    // konfigurację Meta — UI musi to pokazać, żeby „puste pole” nie wyglądało
    // na brak konfiguracji.
    fallbackPixelId: data?.meta_pixel_id ?? "",
    fallbackTokenConfigured: !!(data?.meta_capi_token && String(data.meta_capi_token).trim()),
    // Czy serwer ma klucz do ingestu z Make (zmienna środowiskowa).
    ingestKeyConfigured: !!process.env.FB_LEADS_KEY,
  });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { datasetId, token, testEventCode, enabled, notify, clearToken, action } =
    (await req.json()) as {
      datasetId?: string;
      token?: string;
      testEventCode?: string;
      enabled?: boolean;
      notify?: boolean;
      clearToken?: boolean;
      action?: "test";
    };

  // „Sprawdź połączenie” — pyta Graph API o nazwę datasetu. Weryfikuje token
  // i identyfikator bez wysyłania jakiegokolwiek zdarzenia.
  if (action === "test") {
    return testConnection(supabase, user.id, datasetId, token);
  }

  const update: Record<string, unknown> = { owner: user.id };
  if (typeof datasetId === "string") update.meta_crm_dataset_id = datasetId.trim() || null;
  if (typeof testEventCode === "string") update.meta_crm_test_event_code = testEventCode.trim() || null;
  if (typeof enabled === "boolean") update.meta_crm_enabled = enabled;
  if (typeof notify === "boolean") update.fb_leads_notify = notify;
  if (clearToken) update.meta_crm_token = null;
  else if (token && token.trim()) update.meta_crm_token = token.trim();

  const { error } = await supabase.from("app_settings").upsert(update, { onConflict: "owner" });
  if (error) {
    console.error("[/api/settings/facebook]", error);
    const missingColumn =
      error.code === "PGRST204" || /column .*(meta_crm_|fb_leads_notify)/i.test(error.message || "");
    const msg = missingColumn
      ? "Baza nie ma kolumn dla integracji z Facebookiem. Uruchom migrację migration_facebook_leads.sql w Supabase."
      : `Nie udało się zapisać ustawień: ${error.message}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// Weryfikacja pary dataset + token. Token bierzemy z payloadu (gdy właściciel
// właśnie go wkleił) albo z bazy (gdy sprawdza zapisaną konfigurację).
async function testConnection(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
  owner: string,
  datasetId?: string,
  token?: string
) {
  const { data } = await supabase
    .from("app_settings")
    .select("meta_crm_dataset_id, meta_crm_token, meta_pixel_id, meta_capi_token")
    .eq("owner", owner)
    .maybeSingle();

  const id = (datasetId || "").trim() || data?.meta_crm_dataset_id || data?.meta_pixel_id || "";
  const accessToken = (token || "").trim() || data?.meta_crm_token || data?.meta_capi_token || "";
  if (!id || !accessToken) {
    return NextResponse.json({ ok: false, error: "Uzupełnij identyfikator zbioru danych i token." });
  }

  // Sprawdzamy DOKŁADNIE tę ścieżkę, z której korzysta integracja: POST na
  // /{dataset_id}/events z pustą tablicą zdarzeń. Nic nie wysyła (0 zdarzeń),
  // ale przechodzi przez to samo uwierzytelnienie co realna wysyłka.
  //
  // Odczyt metadanych (GET /{dataset_id}) wyglądałby prościej, ale wymaga
  // uprawnień do zarządzania reklamami — token wygenerowany w Events Managerze
  // pod Conversions API ich nie ma i zwracał „(#100) Missing Permission”
  // mimo w pełni sprawnej konfiguracji.
  try {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(id)}/events`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [], access_token: accessToken }),
    });
    const body = (await res.json().catch(() => null)) as
      | { events_received?: number; error?: { message?: string; code?: number; error_subcode?: number } }
      | null;

    if (res.ok) return NextResponse.json({ ok: true, datasetName: id });

    const verdict = explainGraphError(body?.error, id, res.status);
    return NextResponse.json(
      verdict.authenticated ? { ok: true, datasetName: id } : { ok: false, error: verdict.message }
    );
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : "Błąd sieci przy połączeniu z Meta.",
    });
  }
}

// Tłumaczy kod błędu Graph API na wskazówkę, co konkretnie poprawić — surowy
// komunikat Meta („Missing Permission”) nie mówi, gdzie szukać przyczyny.
//
// `authenticated: true` oznacza, że Meta odrzuciła sam payload (pusta tablica
// zdarzeń), ale token i zbiór danych są poprawne — z punktu widzenia testu
// połączenia to sukces.
function explainGraphError(
  error: { message?: string; code?: number; error_subcode?: number } | undefined,
  datasetId: string,
  status: number
): { authenticated: boolean; message: string } {
  const raw = error?.message || `Meta odrzuciła zapytanie (HTTP ${status}).`;
  const fail = (message: string) => ({ authenticated: false, message });

  switch (error?.code) {
    case 190:
      return fail(
        `Token nieprawidłowy lub wygasł — wygeneruj nowy w Events Managerze (Ustawienia → Conversions API). [${raw}]`
      );
    case 100:
      // Błąd walidacji parametru `data` (a nie uprawnień) = token przeszedł
      // uwierzytelnienie przy tym zbiorze danych.
      if (/\bdata\b/i.test(raw) && !/permission/i.test(raw)) {
        return { authenticated: true, message: "" };
      }
      return fail(
        `Token nie ma dostępu do zbioru danych ${datasetId}. Sprawdź, czy token wygenerowano w Events Managerze DLA TEGO zbioru danych i czy Dataset ID jest poprawny. [${raw}]`
      );
    case 803:
      return fail(`Nie znaleziono zbioru danych o ID ${datasetId} — sprawdź identyfikator. [${raw}]`);
    default:
      return fail(raw);
  }
}
