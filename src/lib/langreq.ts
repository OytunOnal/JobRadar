// Universal language-requirement detector. DETECTION lives here and is the
// same for every user; the JUDGMENT (is a required language a barrier?) is
// per-profile — profile.languages says what the candidate speaks.
//
// Born from dismissal data: postings with an English title and a buried
// "Deutschkenntnisse erforderlich" were reaching fit 85 untouched.

const LANG_PATTERNS: Array<{ code: string; re: RegExp }> = [
  {
    code: "de",
    re: /flie(ß|ss)end(e[sn]?)? deutsch|deutschkenntnisse|verhandlungssicher(e[sn]?)? deutsch|sehr gute deutsch|deutsch (auf )?(mindestens )?[bc][12]|german (at )?([bc][12]|native|fluen(t|cy)|business|professional)|fluent (in )?german|native german/i,
  },
  {
    code: "fr",
    re: /fran(ç|c)ais courant|ma(î|i)trise du fran(ç|c)ais|french (native|fluen(t|cy)|[bc][12])|fluent (in )?french|bilingue fran(ç|c)ais/i,
  },
  {
    code: "nl",
    re: /vloeiend nederlands|nederlands (als moedertaal|op [bc][12])|dutch (native|fluen(t|cy)|[bc][12])|fluent (in )?dutch/i,
  },
  {
    code: "es",
    re: /espa(ñ|n)ol (nativo|fluido|avanzado)|spanish (native|fluen(t|cy)|[bc][12])|fluent (in )?spanish/i,
  },
  {
    code: "it",
    re: /italiano (madrelingua|fluente)|italian (native|fluen(t|cy)|[bc][12])|fluent (in )?italian/i,
  },
  {
    code: "pl",
    re: /j(ę|e)zyk polski|polish (native|fluen(t|cy)|[bc][12])|fluent (in )?polish/i,
  },
  {
    code: "sv",
    re: /flytande svenska|swedish (native|fluen(t|cy)|[bc][12])|fluent (in )?swedish/i,
  },
  {
    code: "da",
    re: /flydende dansk|danish (native|fluen(t|cy)|[bc][12])|fluent (in )?danish/i,
  },
  {
    code: "fi",
    re: /sujuva suomi|finnish (native|fluen(t|cy)|[bc][12])|fluent (in )?finnish/i,
  },
  {
    code: "no",
    re: /flytende norsk|norwegian (native|fluen(t|cy)|[bc][12])|fluent (in )?norwegian/i,
  },
];

// "nice to have" hedges near the match neutralize it — a plus is not a wall.
const HEDGE = /(nice to have|a plus|ist ein plus|von vorteil|w(ü|u)nschenswert|preferred but not|not required|optional)/i;

export function detectLanguageRequirements(text: string): string[] {
  const found: string[] = [];
  for (const { code, re } of LANG_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    // Look around the match for a hedge; a hedged mention is not a requirement.
    const ctx = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
    if (HEDGE.test(ctx)) continue;
    found.push(code);
  }
  return found;
}

export const LANG_NAMES: Record<string, string> = {
  de: "German", fr: "French", nl: "Dutch", es: "Spanish", it: "Italian",
  pl: "Polish", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
  en: "English", tr: "Turkish",
};
