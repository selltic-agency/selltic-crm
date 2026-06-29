// app/page.tsx — strona główna przekierowuje do panelu.
// Middleware zadba o wysłanie niezalogowanych do /login.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/admin");
}
