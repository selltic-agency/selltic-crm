// lib/supabase/server.ts
// Klienty serwerowe: SSR (Server Components / Route Handlers) + admin (service role).
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// SSR — związany z sesją użytkownika przez cookies. Next 15: cookies() jest async.
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // wywołane z Server Component — middleware odświeży sesję, można zignorować
          }
        },
      },
    }
  );
}

// ADMIN — omija RLS. Używaj WYŁĄCZNIE po stronie serwera (np. /api/submit).
// Klucz service_role NIGDY nie trafia do przeglądarki.
export function createSupabaseAdmin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
