// scripts/register-loader.mjs — aktywuje ts-alias-loader jako hook rozwiązywania
// modułów. Preładowany przez `npm test` flagą --import, wywołuje module.register,
// dzięki czemu import "@/..." działa w czystym Node podczas testów.
import { register } from "node:module";
register("./ts-alias-loader.mjs", import.meta.url);
