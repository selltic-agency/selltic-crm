// app/admin/inbox/page.tsx — dawna strona „Zgłoszenia" została przeniesiona
// na stronę Formularze (zakładka „Zgłoszenia"). Trasa zostaje jako redirect,
// żeby stare linki/zakładki przeglądarki nie pękały.
import { redirect } from "next/navigation";

export default function InboxPage() {
  redirect("/admin/forms?tab=zgloszenia");
}
