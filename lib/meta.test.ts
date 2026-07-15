// Testy §9c — normalizacja telefonu do E.164 (bez plusa) i wyprowadzanie _fbc.
import assert from "node:assert";
import { normalizePhoneE164, deriveFbc, hashEmail, sha256 } from "./meta.ts";

// Polski numer 9-cyfrowy → prefiks kraju 48, bez plusa.
assert.strictEqual(normalizePhoneE164("512 345 678"), "48512345678");
assert.strictEqual(normalizePhoneE164("+48 512 345 678"), "48512345678");

// Numer z innym prefiksem zachowuje kod kraju.
assert.strictEqual(normalizePhoneE164("+49 151 12345678"), "4915112345678");

// Pusty → null.
assert.strictEqual(normalizePhoneE164(""), null);

// _fbc w formacie Meta.
assert.strictEqual(deriveFbc("abc123", 1000), "fb.1.1000.abc123");
assert.strictEqual(deriveFbc(null), null);

// Hash e-mail: lowercase + trim, stabilny SHA-256.
assert.strictEqual(hashEmail("  A@B.PL "), sha256("a@b.pl"));

console.log("meta.test.ts — OK");
