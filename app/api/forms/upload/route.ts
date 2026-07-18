// app/api/forms/upload/route.ts — upload obrazków kreatora formularzy.
// Dawniej klient wgrywał plik bezpośrednio do Supabase Storage — jeśli bucket
// „form-assets” nie istniał (migracja nieuruchomiona), użytkownik dostawał
// błąd „Bucket not found”. Ten endpoint działa na service_role: SAM tworzy
// bucket, gdy go brak, więc upload zawsze się powiedzie bez ręcznej migracji.
// Autoryzacja: tylko zalogowany właściciel panelu (cookie sesji).
import { NextResponse } from "next/server";
import { createSupabaseServer, createSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const IMAGE_BUCKET = "form-assets";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Tworzy bucket „form-assets” (publiczny odczyt), jeśli jeszcze nie istnieje.
// Idempotentne — błąd „już istnieje” jest ignorowany.
async function ensureBucket(admin: ReturnType<typeof createSupabaseAdmin>) {
  const { data: existing } = await admin.storage.getBucket(IMAGE_BUCKET);
  if (existing) return;
  const { error } = await admin.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: ALLOWED_IMAGE_TYPES,
  });
  // Wyścig/„already exists” — bucket i tak jest, kontynuuj.
  if (error && !/exist/i.test(error.message)) throw error;
}

export async function POST(req: Request) {
  try {
    // Autoryzacja — tylko zalogowany operator panelu.
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    const formId = String(form.get("formId") || "").trim();
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Brak pliku." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Dozwolone formaty: JPEG, PNG, WEBP lub GIF." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Plik jest za duży — maksymalny rozmiar to 5 MB." }, { status: 400 });
    }

    const admin = createSupabaseAdmin();
    await ensureBucket(admin);

    const ext = EXT_BY_TYPE[file.type] || "png";
    const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const path = `${formId || "shared"}/${rand}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { cacheControl: "3600", upsert: false, contentType: file.type });
    if (upErr) {
      console.error("[/api/forms/upload]", upErr);
      return NextResponse.json({ error: "Nie udało się wgrać pliku. " + (upErr.message || "") }, { status: 500 });
    }

    const { data } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (e) {
    console.error("[/api/forms/upload]", e);
    return NextResponse.json({ error: "Błąd serwera podczas wgrywania pliku." }, { status: 500 });
  }
}
