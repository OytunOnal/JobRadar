// Universal role-family taxonomy. This is GLOBAL knowledge, not personal
// configuration: every white-collar job title should land in exactly one
// family. The generated profile (lib/profilegen.ts) only SELECTS families —
// the user's roleSignals become the selected families' keywords, and
// roleNegatives become everyone else's. That mirror relationship is what makes
// the whole pipeline persona-agnostic: a PM's signal list is a developer's
// negative list, derived from the same table.
//
// Deliberately coarse (a dozen families, not fifty): granularity is the job of
// the generated TRACKS inside a family, not of the taxonomy.

export interface RoleFamily {
  key: string;
  label: string;
  // Lowercase title substrings, same matching semantics as profile.roleSignals.
  titleKeywords: string[];
}

export const ROLE_FAMILIES: readonly RoleFamily[] = [
  {
    key: "engineering",
    label: "Software Engineering",
    titleKeywords: [
      "developer", "engineer", "programmer", "architect", "swe", "sde",
      "full stack", "fullstack", "full-stack", "backend", "back-end", "back end",
      "frontend", "front-end", "front end", "devops", "sre", "coder", "dev ",
      // European market spellings — the role-signal gate was English-only and
      // silently eliminated "Softwareentwickler"/"Desarrollador"/"Programista"
      // titles from the national sources (verified live, 5 of 8 test titles).
      "entwickler", "ingenieur", "informatiker", // de
      "ontwikkelaar", // nl
      "développeur", "developpeur", "ingénieur", "ingenieur logiciel", // fr
      "desarrollador", "programador", "ingeniero", // es (+pt programador)
      "engenheiro", // pt
      "programista", "inżynier", "inzynier", // pl
      "sviluppatore", "ingegnere", // it
      "utvecklare", "udvikler", "utvikler", "kehittäjä", // sv/da/no/fi
      // Senior/AI-lab titles the audit caught dying at the gate: Tech Lead,
      // Member of Technical Staff (the standard AI-lab engineer title), and
      // German activity-noun compounds (Softwareentwicklung ≠ -entwickler).
      "tech lead", "technical lead", "member of technical staff",
      "softwareentwicklung", "webentwicklung", "spieleentwicklung", "it-spezialist",
      // Third audit round (real eliminated titles): development-phrases,
      // German/Portuguese profession names, tech-consulting compounds.
      "application development", "software development", "web development",
      "anwendungsentwicklung", "fachinformatiker", "informática", "informático",
      "ai specialist", "ai consultant", "ml consultant", "ai/ml",
      "data consultant", "software consultant", "it consultant", "it-consultant",
    ],
  },
  {
    key: "qa",
    label: "QA / Testing",
    titleKeywords: ["qa ", "quality assurance", "test engineer", "tester", "sdet", "test automation"],
  },
  {
    key: "data",
    label: "Data / ML Science",
    titleKeywords: [
      "data scientist", "data analyst", "data engineer", "machine learning",
      "ml scientist", "research scientist", "analytics engineer", "bi analyst",
      "business intelligence", "statistician",
      // Bare forms — "AI Researcher" and "Staff Scientist" died at the gate.
      "researcher", "scientist",
      // "AI Integration Analyst" and Dutch "Data Analist" died too. Bare
      // analyst also covers Datenanalyst/Data-Analyst compounds via substring.
      "analyst", "analist",
    ],
  },
  {
    key: "product",
    label: "Product Management",
    titleKeywords: [
      "product manager", "product owner", "product lead", "head of product",
      "cpo", "product director", "program manager", "project manager",
      "delivery manager", "scrum master", "producer",
      // German one-word compounds and activity nouns died at the gate.
      "produktmanager", "projektmanager", "projektleiter", "projektleitung",
      "chef de projet", "kierownik projektu",
    ],
  },
  {
    key: "design",
    label: "Design / Creative",
    titleKeywords: [
      "designer", "ux", "ui ", "art director", "creative director", "illustrator",
      "artist", "animator", "motion design", "visual design", "brand design",
    ],
  },
  {
    key: "devrel",
    label: "Developer Relations",
    titleKeywords: ["developer relations", "devrel", "developer advocate", "evangelist", "developer educator"],
  },
  {
    key: "marketing",
    label: "Marketing / Growth / Content",
    titleKeywords: [
      "marketing", "growth marketing", "growth manager", "head of growth", "seo ",
      "content writer", "copywriter", "content manager", "market research",
      "social media", "community manager", "brand manager", "communications", "pr manager",
    ],
  },
  {
    key: "sales",
    label: "Sales / Business Development",
    titleKeywords: [
      "sales", "account executive", "account manager", "business development",
      "partnerships", "customer success", "pre-sales", "solutions consultant",
      "solutions architect", "solution engineer",
      "vertrieb", "verkauf", "verkoop", "ventas", "sprzedaż", "vendite", // de/nl/es/pl/it
    ],
  },
  {
    key: "support",
    label: "Customer Support",
    titleKeywords: ["customer support", "support engineer", "support specialist", "help desk", "technical support"],
  },
  {
    key: "people",
    label: "People / HR / Recruiting",
    titleKeywords: [
      "recruiter", "talent", "people partner", "people operations", "hr ",
      "human resources", "compensation", "workplace",
    ],
  },
  {
    key: "finance",
    label: "Finance / Legal",
    titleKeywords: [
      "finance", "accountant", "accounting", "controller", "counsel", "legal",
      "payroll", "treasury", "auditor", "compliance",
      "financial analyst", "fp&a", "buchhalter", "steuerberater", "steuerfachangestellte",
    ],
  },
  {
    key: "operations",
    label: "Operations / Admin",
    titleKeywords: [
      "operations manager", "office manager", "executive assistant", "chief of staff",
      "operations analyst", "procurement", "logistics", "supply chain", "events lead",
    ],
  },
] as const;

export const FAMILY_KEYS = ROLE_FAMILIES.map((f) => f.key);

export function familiesByKey(keys: readonly string[]): RoleFamily[] {
  const set = new Set(keys);
  return ROLE_FAMILIES.filter((f) => set.has(f.key));
}

// The mirror: signals from the selected families, negatives from the rest.
export function deriveRoleSignals(selected: readonly string[]): string[] {
  return familiesByKey(selected).flatMap((f) => f.titleKeywords);
}

export function deriveRoleNegatives(selected: readonly string[]): string[] {
  const set = new Set(selected);
  return ROLE_FAMILIES.filter((f) => !set.has(f.key)).flatMap((f) => f.titleKeywords);
}
