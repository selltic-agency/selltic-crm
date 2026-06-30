// app/f/[slug]/page.tsx — publiczna strona formularza.
// Server Component: pobiera OPUBLIKOWANY formularz po slugu (polityka public read),
// po czym renderuje go klienckim wrapperem PublicForm.
// Tryb ?embed=1 ukrywa stopkę i włącza postMessage z wysokością.
import type { Metadata } from "next";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { FormSchema } from "@/lib/forms";
import PublicForm from "./public-form";

// Render zawsze świeży (publiczny odczyt, bez cache na sesji).
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PublishedForm = {
  id: string;
  title: string;
  published: FormSchema | null;
  status: string;
};

async function fetchForm(slug: string): Promise<PublishedForm | null> {
  const db = await createSupabaseServer();
  const { data } = await db
    .from("forms")
    .select("id, title, published, status")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  return (data as PublishedForm | null) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const form = await fetchForm(slug);
  const title = form?.published?.title || form?.title;
  return {
    title: title ? `${title} — Selltic` : "Formularz — Selltic",
    robots: { index: false, follow: false },
  };
}

export default async function PublicFormPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const embedRaw = sp?.embed;
  const embed = embedRaw === "1" || embedRaw === "true";

  const form = await fetchForm(slug);

  if (!form || !form.published || !(form.published.steps?.length > 0)) {
    return <Unavailable embed={embed} />;
  }

  return (
    <main style={{ background: form.published.theme?.bg || "#FFFFFF", minHeight: "100dvh" }}>
      <PublicForm formId={form.id} schema={form.published} embed={embed} />
      {!embed && (
        <footer
          style={{
            position: "fixed",
            bottom: 12,
            right: 16,
            fontSize: 12,
            color: "#8A92A6",
            background: "rgba(255,255,255,0.7)",
            padding: "4px 10px",
            borderRadius: 999,
            pointerEvents: "auto",
          }}
        >
          <a
            href="https://selltic-agency.pl"
            target="_blank"
            rel="noreferrer"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            ⚡ Selltic
          </a>
        </footer>
      )}
    </main>
  );
}

// Ekran zastępczy, gdy formularz nie istnieje lub nie jest opublikowany.
function Unavailable({ embed }: { embed: boolean }) {
  return (
    <main
      style={{
        minHeight: embed ? 420 : "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#F6F7F9",
        color: "#1A1D26",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔍</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>
          Formularz niedostępny
        </h1>
        <p style={{ fontSize: 14, color: "#8A92A6", margin: 0 }}>
          Ten formularz nie istnieje lub nie został jeszcze opublikowany.
        </p>
      </div>
    </main>
  );
}
