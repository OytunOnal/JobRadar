import { unzipSync, strFromU8 } from "fflate";
import { prisma } from "../db";
import { normalizeCompanyName } from "../discovery/nameprobe";

// Public visa-sponsor registers — a COMPANY-level sponsorship signal that is
// independent of what any posting says. The complete set of European
// countries that publish one (researched 2026-08; SE/NO/FI certify employers
// but publish no list, DE/FR/ES/PT/BE/AT need no employer licence):
//
//   nl  IND recognised sponsors (highly skilled migrant) — one HTML table,
//       ~12k organisations with KvK numbers
//   gb  Home Office licensed Worker sponsors — CSV behind the gov.uk Content
//       API (~143k rows; the HTML page intermittently hides the link, so the
//       API is primary — job-ops' lesson)
//   dk  SIRI fast-track certified companies — one HTML table, ~1k rows
//   ie  DETE employment permits issued to companies — XLSX, ~6k employers
//       (permits actually issued this year: slightly different semantics,
//       recorded in `detail`)
//
// Matching: normalized-and-collapsed EXACT name equality (plus the legal-
// suffix stripping normalizeCompanyName already does). Containment over 143k
// rows would be slow and false-positive-prone; exact-after-normalization is
// the honest tier.

const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";
export const REGISTER_COUNTRIES = ["nl", "gb", "dk", "ie"] as const;

export function collapseName(name: string): string {
  return normalizeCompanyName(name).replace(/ /g, "");
}

export interface SponsorRow {
  name: string;
  detail?: string;
}

// ── Parsers (exported for tests, fed by the fetchers below) ──────────────────

// IND page: <th scope="row">Organisation</th><td>KvK number</td>
export function parseNl(html: string): SponsorRow[] {
  const out: SponsorRow[] = [];
  for (const m of html.matchAll(/<th[^>]*scope=(["'])row\1[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const name = clean(m[2]);
    if (!name) continue;
    const kvk = clean(m[3]);
    out.push({ name, detail: kvk ? `IND recognised sponsor (KvK ${kvk})` : "IND recognised sponsor" });
  }
  return out;
}

// gov.uk CSV: Organisation Name,Town/City,County,Type & Rating,Route
export function parseGb(csv: string): SponsorRow[] {
  const out: SponsorRow[] = [];
  const seen = new Set<string>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cells = splitCsvLine(line);
    const name = (cells[0] ?? "").trim();
    if (!name) continue;
    const key = collapseName(name);
    if (!key || seen.has(key)) continue; // one company holds several routes
    seen.add(key);
    out.push({ name, detail: [cells[3], cells[4]].filter(Boolean).join(" — ") || undefined });
  }
  return out;
}

// nyidanmark page: plain <tr><td>Company</td><td>CVR</td>… table rows.
export function parseDk(html: string): SponsorRow[] {
  const out: SponsorRow[] = [];
  for (const m of html.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const name = clean(m[1]);
    const cvr = clean(m[2]);
    // Header rows and section dividers have no CVR digits.
    if (!name || !/\d{6,}/.test(cvr)) continue;
    out.push({ name, detail: `SIRI fast-track certified (CVR ${cvr})` });
  }
  return out;
}

// DETE XLSX: sharedStrings + sheet1 column A ("Employer Name" header).
export function parseIe(xlsx: Uint8Array): SponsorRow[] {
  const files = unzipSync(xlsx);
  const shared = strFromU8(files["xl/sharedStrings.xml"] ?? new Uint8Array());
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
  if (!shared || !sheet) return [];
  const strings = [...shared.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => decodeXml(m[1]));

  // The sheet is per-month: A = employer, then one "Permits Issued <Mon>"
  // column per elapsed month, plus a Grand Total. The first parser read only
  // column A and threw the counts away — the register's whole advantage over
  // a bare licence list is that these permits were actually ISSUED, and how
  // many is a strength signal ("40 this year" beats "appears on a list").
  // Columns are mapped from the header row because the file grows a column
  // every month; hardcoding letters would silently misread it from October.
  const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
  if (rows.length === 0) return [];
  const parseCells = (rowXml: string): Map<string, { shared: boolean; v: string }> => {
    const cells = new Map<string, { shared: boolean; v: string }>();
    for (const c of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*)><v>([^<]*)<\/v>/g)) {
      cells.set(c[1], { shared: /t="s"/.test(c[2]), v: c[3] });
    }
    return cells;
  };
  const resolve = (cell: { shared: boolean; v: string } | undefined): string =>
    cell ? (cell.shared ? (strings[Number(cell.v)] ?? "") : cell.v).trim() : "";

  const header = parseCells(rows[0][1]);
  const monthCols: Array<{ col: string; month: string }> = [];
  let totalCol: string | null = null;
  for (const [col, cell] of header) {
    const label = resolve(cell);
    const m = label.match(/^Permits Issued (\w{3})$/i);
    if (m) monthCols.push({ col, month: m[1] });
    else if (/grand total/i.test(label)) totalCol = col;
  }

  const out: SponsorRow[] = [];
  for (const row of rows.slice(1)) {
    const cells = parseCells(row[1]);
    const nameCell = cells.get("A");
    if (!nameCell?.shared) continue; // totals/footer rows carry numbers in A
    const name = resolve(nameCell);
    if (!name || /^(employer name|total)$/i.test(name)) continue;
    let total = totalCol ? Number(resolve(cells.get(totalCol))) : NaN;
    let latest = "";
    let summed = 0;
    for (const { col, month } of monthCols) {
      const n = Number(resolve(cells.get(col)));
      if (Number.isFinite(n) && n > 0) { summed += n; latest = month; }
    }
    if (!Number.isFinite(total) || total <= 0) total = summed;
    out.push({
      name,
      detail: total > 0
        ? `IE permits issued this year: ${total}${latest ? ` (latest ${latest})` : ""}`
        : "IE employment permit issued this year",
    });
  }
  return out;
}

// ── Fetch + refresh ──────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function fetchRows(country: string): Promise<SponsorRow[]> {
  switch (country) {
    case "nl":
      return parseNl(await fetchText("https://ind.nl/en/public-register-recognised-sponsors/public-register-work"));
    case "gb": {
      const api = JSON.parse(
        await fetchText("https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers"),
      );
      const csvUrl = api?.details?.attachments?.[0]?.url;
      if (typeof csvUrl !== "string" || !csvUrl.startsWith("https://assets.publishing.service.gov.uk/")) {
        throw new Error("gov.uk attachment URL missing or off-host");
      }
      return parseGb(await fetchText(csvUrl));
    }
    case "dk":
      return parseDk(await fetchText("https://nyidanmark.dk/en-GB/Words-and-concepts/SIRI/Certified-companies"));
    case "ie": {
      const res = await fetch(
        "https://enterprise.gov.ie/en/publications/publication-files/employment-permits-issued-to-companies-2026.xlsx",
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000), redirect: "follow" },
      );
      if (!res.ok) throw new Error(`ie xlsx -> HTTP ${res.status}`);
      return parseIe(new Uint8Array(await res.arrayBuffer()));
    }
    default:
      throw new Error(`unknown register country ${country}`);
  }
}

export interface SponsorRefreshReport {
  perCountry: Record<string, number>;
  errors: string[];
}

// Replace each country's rows wholesale — the registers ARE the truth; a
// company dropped from one has lost its licence.
export async function refreshSponsors(
  countries: readonly string[] = REGISTER_COUNTRIES,
): Promise<SponsorRefreshReport> {
  const report: SponsorRefreshReport = { perCountry: {}, errors: [] };
  for (const country of countries) {
    try {
      const rows = fetchRowsDedup(await fetchRows(country));
      if (rows.length < 50) throw new Error(`only ${rows.length} rows — parser or page drift, keeping old data`);
      await prisma.$transaction([
        prisma.visaSponsor.deleteMany({ where: { country } }),
        prisma.visaSponsor.createMany({
          data: rows.map((r) => ({ country, name: r.name, nameNorm: collapseName(r.name), detail: r.detail })),
        }),
      ]);
      report.perCountry[country] = rows.length;
    } catch (e: any) {
      report.errors.push(`${country}: ${String(e.message).slice(0, 120)}`);
    }
  }
  return report;
}

function fetchRowsDedup(rows: SponsorRow[]): SponsorRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = collapseName(r.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// True when the register set is empty or older than maxAgeDays.
export async function sponsorsStale(maxAgeDays = 14): Promise<boolean> {
  const newest = await prisma.visaSponsor.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  if (!newest) return true;
  return Date.now() - newest.updatedAt.getTime() > maxAgeDays * 86_400_000;
}

// ── Matching ─────────────────────────────────────────────────────────────────

// One in-memory map per process: country -> Set of collapsed names.
let matchSets: Map<string, Set<string>> | null = null;

export async function loadSponsorSets(): Promise<Map<string, Set<string>>> {
  if (matchSets) return matchSets;
  const rows = await prisma.visaSponsor.findMany({ select: { country: true, nameNorm: true } });
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.country)) map.set(r.country, new Set());
    map.get(r.country)!.add(r.nameNorm);
  }
  matchSets = map;
  return map;
}

export function resetSponsorCache(): void {
  matchSets = null;
}

// Exact collapsed-name match in the country's register. `country` is the
// job's resolved iso2 country; non-register countries are always false.
export async function isRegisteredSponsor(company: string, country: string | null | undefined): Promise<boolean> {
  if (!company || !country) return false;
  const sets = await loadSponsorSets();
  const set = sets.get(country);
  if (!set || set.size === 0) return false;
  const key = collapseName(company);
  return key.length >= 4 && set.has(key);
}

// ── small helpers ────────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
}

function clean(cell: string): string {
  return decodeXml(cell.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// Minimal CSV line splitter with quote support (the UK register quotes names
// containing commas).
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
