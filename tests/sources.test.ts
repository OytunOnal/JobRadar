import test from "node:test";
import assert from "node:assert/strict";
import { mapGreenjobsEntry } from "../src/lib/sources/greenjobsde";
test("greenjobsde: atom entry parses title/location/company; gender marker is not a location", () => {
  const entry = `<title>CAD-Konstrukteur (m/w/d) (Meißen / bundesweit) - UKA Umweltgerechte Kraftanlagen GmbH &amp; Co. KG</title>` +
    `<link href="https://www.greenjobs.de/angebote/index.html?id=100154571&amp;anz=html" />` +
    `<updated>2026-08-21T14:18:11+02:00</updated>`;
  const j = mapGreenjobsEntry(entry)!;
  assert.equal(j.externalId, "100154571");
  assert.equal(j.title, "CAD-Konstrukteur (m/w/d)");
  assert.equal(j.location, "Meißen / bundesweit");
  assert.match(j.company, /^UKA Umweltgerechte/);
  // A title whose ONLY parenthetical is the gender marker keeps it, no location
  const j2 = mapGreenjobsEntry(`<title>Entwickler (m/w/d) - ACME GmbH</title><link href="https://x.de/?id=5" /><updated>2026-08-21T00:00:00+02:00</updated>`)!;
  assert.equal(j2.title, "Entwickler (m/w/d)");
  assert.equal(j2.location, "");
});
