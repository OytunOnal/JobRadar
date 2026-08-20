import { writeFileSync } from "node:fs";
import { user } from "../config/user";
import { CV_CONTEXT } from "../src/lib/cv";
import { generateProfile, GENERATED_PATH } from "../src/lib/profilegen";
import { familiesByKey, deriveRoleNegatives } from "../src/lib/taxonomy";

// Explicit generation step: CV (+ optional targetRoles in config/user.ts) →
// reviewed JSON at config/profile.generated.json. Nothing regenerates behind
// your back — rerun this after editing your CV. The file is plain JSON: edit
// keywords by hand freely; it is only rebuilt when YOU run this again.
//
//   npm run profile:generate

const u = user as typeof user & { targetRoles?: string };

console.log("=== JobRadar profile generation ===");
if (u.targetRoles) console.log(`Stated target: ${u.targetRoles}`);
console.log("Generating from CV (one strong-tier LLM call)…\n");

const profile = await generateProfile(CV_CONTEXT, u.targetRoles);

const fams = familiesByKey(profile.families);
console.log(`Families: ${fams.map((f) => f.label).join(", ")}`);
console.log(`\nTracks (${profile.tracks.length}, most-specific first):`);
for (const t of profile.tracks) {
  console.log(`  [${t.key}] ${t.label}`);
  console.log(`    title: ${t.titleKeywords.join(", ")}`);
  console.log(`    body:  ${t.bodyKeywords.join(", ")}`);
  if (t.searchVariants) {
    const langs = Object.entries(t.searchVariants).map(([l, v]) => `${l}: ${v!.join(" / ")}`);
    console.log(`    search: ${langs.join("  |  ")}`);
  }
}
console.log(`\nAggregator queries: ${profile.searchQueries.join(" | ")}`);
console.log(`\nThese role families will be FILTERED OUT (mirror of your selection):`);
console.log(`  ${deriveRoleNegatives(profile.families).slice(0, 12).join(", ")}, …`);

writeFileSync(GENERATED_PATH, JSON.stringify(profile, null, 2) + "\n");
console.log(`\nWritten to ${GENERATED_PATH} — review/edit it, then run npm run ingest.`);
console.log("Explicit `tracks` in config/user.ts would still override this file.");
