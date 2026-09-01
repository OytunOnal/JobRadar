import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { prisma } from "../../src/lib/db";
import { chat } from "../../src/lib/llm/llm";
import {
  parseWebsiteAnswers,
  scanCompanySite,
  verifyScanHit,
  websitePrompt,
} from "../../src/lib/discovery/deepprobe";
import { PROBE_SIGNATURE, probeCompany } from "../../src/lib/discovery/nameprobe";

// Discovery health: is the board database growing healthily, or are name-probe
// misses hiding live boards? Samples N random misses and classifies each:
//
//   probe-now-hits   today's coverage finds it — the stale-miss backlog (#3)
//                    hasn't drained yet, or coverage just grew (#2)
//   board-elsewhere  the company's own site links a live ATS board our
//                    name-guessing can't reach (unguessable token, or an
//                    enterprise platform — workday/successfactors/oracle/...)
//   site-no-ats      official site found, no ATS evidence on it — custom
//                    portal or genuinely no public board
//   no-website       the LLM couldn't name an official site — agencies and
//                    tiny SMBs land here; presumed correct negatives
//
// False-negative rate = (probe-now-hits + board-elsewhere) / N. Track it over
// time in discovery-health.md (dated sections, newest last) — a rising rate
// means the probe is falling behind the market's platform mix.
//
// Read-only against the DB (measure convention); the markdown file is the
// embed-eval precedent. LLM resolves website domains only — verdicts come
// from the company's own pages and live probes.

const N = (() => {
  const flag = process.argv.indexOf("--n");
  if (flag !== -1) return Number(process.argv[flag + 1]) || 30;
  return Number(process.argv[2]) || 30;
})();

const ENTERPRISE_PLATFORMS = new Set(["workday", "successfactors", "oracle", "csod", "avature", "phenom", "radancy", "eightfold", "jibe", "beesite"]);

interface Verdict {
  name: string;
  category: "probe-now-hits" | "board-elsewhere" | "site-no-ats" | "no-website" | "llm-unavailable";
  evidence: string;
}

async function main() {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, name, displayName, website FROM CompanyProbe WHERE found = 0 ORDER BY RANDOM() LIMIT ${N}`,
  )) as Array<{ id: number; name: string; displayName: string | null; website: string | null }>;
  const missPool = Number(
    ((await prisma.$queryRawUnsafe("SELECT COUNT(*) as c FROM CompanyProbe WHERE found = 0")) as any)[0].c,
  );

  console.log(`discovery-health: sampling ${rows.length} of ${missPool} misses`);
  console.log(`probe signature: ${PROBE_SIGNATURE}\n`);

  // Resolve websites for the sample in ONE batched LLM call (rows that
  // already carry one skip it). Read-only: nothing is written back.
  const names = rows.map((r) => r.displayName ?? r.name);
  const domains: Array<string | null> = rows.map((r) => r.website ?? null);
  const unknownIdx = rows.map((_, i) => i).filter((i) => !domains[i]);
  let llmUp = true;
  if (unknownIdx.length > 0) {
    const answer = await chat(
      [{ role: "user", content: websitePrompt(unknownIdx.map((i) => names[i])) }],
      { temperature: 0, maxTokens: 800, tier: "fast" },
    );
    if (answer === null) llmUp = false;
    else {
      const resolved = parseWebsiteAnswers(answer, unknownIdx.length);
      unknownIdx.forEach((rowI, k) => {
        domains[rowI] = resolved[k] ?? null;
      });
    }
  }

  const verdicts: Verdict[] = [];
  for (let i = 0; i < rows.length; i++) {
    const name = names[i];

    // Tier 1: would today's name-probe find it?
    const hit = await probeCompany(name);
    if (hit) {
      verdicts.push({ name, category: "probe-now-hits", evidence: `${hit.platform}:${hit.token}` });
      console.log(`  ${name} -> probe-now-hits (${hit.platform}:${hit.token})`);
      continue;
    }

    // Tier 2: does the company's own site point at a live board?
    const domain = domains[i];
    if (!domain) {
      const category = llmUp ? "no-website" : "llm-unavailable";
      verdicts.push({ name, category, evidence: "" });
      console.log(`  ${name} -> ${category}`);
      continue;
    }
    let evidence = "";
    for (const scanHit of (await scanCompanySite(domain)).slice(0, 3)) {
      const verified = await verifyScanHit(name, scanHit);
      if (verified) {
        const tag = ENTERPRISE_PLATFORMS.has(verified.platform) ? " [enterprise]" : "";
        evidence = `${verified.platform}:${verified.token}${tag}`;
        break;
      }
    }
    if (evidence) {
      verdicts.push({ name, category: "board-elsewhere", evidence });
      console.log(`  ${name} -> board-elsewhere (${evidence})`);
    } else {
      verdicts.push({ name, category: "site-no-ats", evidence: domain });
      console.log(`  ${name} -> site-no-ats (${domain})`);
    }
  }

  const count = (c: Verdict["category"]) => verdicts.filter((v) => v.category === c).length;
  const leakage = count("probe-now-hits") + count("board-elsewhere");
  const rate = verdicts.length ? ((100 * leakage) / verdicts.length).toFixed(1) : "0.0";

  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "",
    `## ${date} — n=${verdicts.length} of ${missPool} misses`,
    "",
    `Probe signature: \`${PROBE_SIGNATURE}\``,
    "",
    "| category | count |",
    "|---|---|",
    `| probe-now-hits | ${count("probe-now-hits")} |`,
    `| board-elsewhere | ${count("board-elsewhere")} |`,
    `| site-no-ats | ${count("site-no-ats")} |`,
    `| no-website | ${count("no-website")} |`,
    `| llm-unavailable | ${count("llm-unavailable")} |`,
    "",
    `**False-negative rate: ${rate}%** (${leakage}/${verdicts.length})`,
    "",
    ...verdicts.filter((v) => v.category === "probe-now-hits" || v.category === "board-elsewhere")
      .map((v) => `- ${v.name}: ${v.category} (${v.evidence})`),
  ];

  const file = "discovery-health.md";
  if (!existsSync(file)) {
    writeFileSync(file, "# Discovery health\n\nMonthly sampled false-negative rate of name-probe misses.\nRun: `npm run measure:discovery` (optionally `-- --n 30`).\n");
  }
  appendFileSync(file, lines.join("\n") + "\n");
  console.log("\n" + lines.join("\n"));
  console.log(`\nappended to ${file}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
