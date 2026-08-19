import { test } from "node:test";
import assert from "node:assert/strict";
import { countryPassesAccept, regionsOf, resolveCountry } from "../src/lib/geo";

// ── resolveCountry — real location strings from our own pool ─────────────────

test("resolves native-language country names (the Allemagne hole)", () => {
  assert.equal(resolveCountry("Frankfurt am Main, Hesse, Allemagne"), "de");
  assert.equal(resolveCountry("München, Deutschland"), "de");
  assert.equal(resolveCountry("İstanbul, Türkiye"), "tr");
});

test("resolves via city/district when no country is present", () => {
  assert.equal(resolveCountry("Sarıyer, Istanbul"), "tr");
  assert.equal(resolveCountry("Berlin"), "de");
  assert.equal(resolveCountry("Greater London Area"), "gb");
  assert.equal(resolveCountry("Warsaw"), "pl");
});

test("handles code prefixes and separators", () => {
  assert.equal(resolveCountry("PL - Warsaw"), "pl");
  assert.equal(resolveCountry("Berlin, DE"), "de");
  assert.equal(resolveCountry("London, UK"), "gb"); // via "london"
});

test("non-places resolve to null, never a wrong country", () => {
  assert.equal(resolveCountry("Remote"), null);
  assert.equal(resolveCountry("Worldwide"), null);
  assert.equal(resolveCountry("EMEA"), null);
  assert.equal(resolveCountry(""), null);
  assert.equal(resolveCountry(null), null);
  assert.equal(resolveCountry("Planet Earth HQ"), null);
});

// ── regions ──────────────────────────────────────────────────────────────────

test("region membership: overlapping regions are intentional", () => {
  assert.deepEqual(regionsOf("de").sort(), ["dach", "emea", "eu"]);
  assert.deepEqual(regionsOf("tr").sort(), ["emea", "tr"]);
  assert.deepEqual(regionsOf("gb").sort(), ["emea", "uk-ie"]);
  assert.deepEqual(regionsOf("jp"), ["apac"]);
  assert.deepEqual(regionsOf("us"), ["americas"]);
});

// ── countryPassesAccept — the region gate, with the user's real legacy list ──

const LEGACY = ["remote", "europe", "emea", "türkiye", "turkey", "germany", "berlin", "netherlands"];

test("legacy substring entries act as country and region grants", () => {
  assert.equal(countryPassesAccept("de", LEGACY), true); // "germany" + "europe"
  assert.equal(countryPassesAccept("tr", LEGACY), true); // "türkiye" + "emea"
  assert.equal(countryPassesAccept("pl", LEGACY), true); // via "europe" region grant
  assert.equal(countryPassesAccept("il", LEGACY), true); // via "emea"
  assert.equal(countryPassesAccept("us", LEGACY), false); // no grant reaches the US
  assert.equal(countryPassesAccept("jp", LEGACY), false);
});

test("alpha-2 codes work as accept entries too", () => {
  assert.equal(countryPassesAccept("nl", ["nl"]), true);
  assert.equal(countryPassesAccept("de", ["nl"]), false);
});
