// middleware.ts  (w katalogu głównym projektu)
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { FORMS_DOMAIN } from "@/lib/publicUrl";

// Host żądania bez portu, małymi literami.
function hostname(request: NextRequest): string {
  return (request.headers.get("host") || "").split(":")[0].toLowerCase();
}

// Subdomena formularzy (np. go.selltic-agency.pl): serwuje TYLKO publiczne
// formularze. „/<slug>” przepisujemy na wewnętrzną trasę „/f/<slug>”, dzięki
// czemu klient nigdy nie widzi ścieżki /f/… ani panelu /admin.
function handleFormsHost(request: NextRequest): NextResponse {
  const url = request.nextUrl;
  const path = url.pathname;

  // API, zasoby Next, pliki oraz już-przepisane trasy /f/ zostawiamy bez zmian.
  if (
    path.startsWith("/api") ||
    path.startsWith("/_next") ||
    path.startsWith("/f/") ||
    path === "/favicon.ico" ||
    path.includes(".")
  ) {
    return NextResponse.next();
  }

  // Wejście na sam korzeń subdomeny → strona główna Selltic.
  if (path === "/") {
    return NextResponse.redirect("https://selltic-agency.pl");
  }

  // „/<slug>” → „/f/<slug>” (zachowujemy parametry, np. ?embed=1).
  const slug = path.replace(/^\/+/, "").split("/")[0];
  const rewritten = url.clone();
  rewritten.pathname = `/f/${slug}`;
  return NextResponse.rewrite(rewritten);
}

export async function middleware(request: NextRequest) {
  if (FORMS_DOMAIN && hostname(request) === FORMS_DOMAIN) {
    return handleFormsHost(request);
  }
  return updateSession(request);
}

export const config = {
  // pomijamy pliki statyczne i obrazy
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
