// lib/fbLeadsAuth.ts — autoryzacja endpointu ingestu leadów z formularzy
// błyskawicznych Facebooka (wołanego przez scenariusz w Make.com) nagłówkiem
// X-API-Key. Ten sam wzorzec co lib/prospectingAuth.ts: bez sekretu endpoint
// jest świadomie zablokowany (503), zły klucz to 401.
import { NextResponse } from "next/server";

export function checkFbLeadsApiKey(req: Request): NextResponse | null {
  const key = process.env.FB_LEADS_KEY;
  if (!key) {
    console.error("[fb-leads] Brak FB_LEADS_KEY — endpoint zablokowany.");
    return NextResponse.json({ error: "Endpoint nieskonfigurowany" }, { status: 503 });
  }
  const provided = req.headers.get("x-api-key") || bearer(req.headers.get("authorization"));
  if (provided !== key) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  return null;
}

// Make pozwala wysłać klucz albo we własnym nagłówku, albo jako Bearer —
// przyjmujemy oba, żeby konfiguracja scenariusza nie była źródłem 401.
function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
