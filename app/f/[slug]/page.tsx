// app/f/[slug]/page.tsx — publiczna strona formularza.
// Server Component: pobiera OPUBLIKOWANY formularz po slugu, renderuje klienckim
// wrapperem PublicForm. Zarchiwizowany formularz (§1) → ekran „nieaktywny” (410).
// Tryb ?embed=1 ukrywa stopkę i włącza postMessage z wysokością.
import type { Metadata } from "next";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { resolvePublicMetaConfig, type PublicMetaConfig } from "@/lib/server/meta";
import type { FormSchema } from "@/lib/forms";
import PublicForm from "./public-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type FormRow = {
  id: string;
  owner: string;
  title: string;
  published: FormSchema | null;
  status: string;
  archived_at: string | null;
};

// Pobiera formularz przez service_role, ale RUCZNIE egzekwuje reguły publiczne
// (opublikowany + niezarchiwizowany) — dzięki temu możemy odróżnić „zarchiwizowany”
// (ekran 410) od „nie istnieje”.
async function fetchForm(slug: string): Promise<FormRow | null> {
  const db = createSupabaseAdmin();
  const { data } = await db
    .from("forms")
    .select("id, owner, title, published, status, archived_at")
    .eq("slug", slug)
    .maybeSingle();
  return (data as FormRow | null) ?? null;
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

  // §1 — zarchiwizowany formularz jest publicznie nieaktywny (410).
  if (form && form.archived_at) {
    return <Inactive embed={embed} />;
  }

  if (!form || form.status !== "published" || !form.published || !(form.published.steps?.length > 0)) {
    return <Unavailable embed={embed} />;
  }

  // §9b — publiczna konfiguracja Meta (tylko Pixel ID, NIGDY token CAPI).
  const meta: PublicMetaConfig = await resolvePublicMetaConfig(createSupabaseAdmin(), form.id, form.owner);

  const branding = form.published.branding;
  const showFooter = !embed && branding?.showFooter !== false;

  return (
    <main style={{ background: form.published.theme?.bg || "#FFFFFF", minHeight: "100dvh" }}>
      <PublicForm formId={form.id} schema={form.published} embed={embed} meta={meta} />
      {showFooter && <BrandFooter branding={branding} accent={form.published.theme?.primary} />}
    </main>
  );
}

// §4 — dyskretna stopka marki (prawy dolny róg). Pokazuje logo formularza oraz
// sterowalny przez właściciela podtytuł. Gdy brak logo/tekstu — subtelny,
// neutralny podpis. Nie odciąga uwagi od formularza.
function BrandFooter({
  branding,
  accent,
}: {
  branding?: FormSchema["branding"];
  accent?: string;
}) {
  const text = branding?.footerText?.trim() || "";
  const logo = branding?.logo?.trim() || "";
  const link = branding?.footerLink?.trim() || "";

  const inner = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: accent || "#8A92A6",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
      )}
      <span>{text || (branding?.name?.trim() || "")}</span>
    </span>
  );

  // Nic do pokazania — całkiem pomijamy stopkę.
  if (!logo && !text && !branding?.name?.trim()) return null;

  return (
    <footer
      style={{
        position: "fixed",
        bottom: 12,
        right: 16,
        fontSize: 12,
        color: "#8A92A6",
        background: "rgba(255,255,255,0.72)",
        padding: "5px 11px",
        borderRadius: 999,
        pointerEvents: "auto",
        backdropFilter: "blur(4px)",
        boxShadow: "0 1px 4px rgba(15,18,28,0.06)",
      }}
    >
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
          {inner}
        </a>
      ) : (
        inner
      )}
    </footer>
  );
}

// §1 — ekran „formularz nie jest już aktywny” (zarchiwizowany).
function Inactive({ embed }: { embed: boolean }) {
  return (
    <Screen embed={embed} emoji="🗄️" title="Ten formularz nie jest już aktywny">
      Formularz został zarchiwizowany i nie przyjmuje już zgłoszeń.
    </Screen>
  );
}

// Ekran zastępczy, gdy formularz nie istnieje lub nie jest opublikowany.
function Unavailable({ embed }: { embed: boolean }) {
  return (
    <Screen embed={embed} emoji="🔍" title="Formularz niedostępny">
      Ten formularz nie istnieje lub nie został jeszcze opublikowany.
    </Screen>
  );
}

function Screen({
  embed,
  emoji,
  title,
  children,
}: {
  embed: boolean;
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
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
        <div style={{ fontSize: 40, marginBottom: 8 }}>{emoji}</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>{title}</h1>
        <p style={{ fontSize: 14, color: "#8A92A6", margin: 0 }}>{children}</p>
      </div>
    </main>
  );
}
