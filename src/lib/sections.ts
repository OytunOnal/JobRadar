import { htmlToText } from "./html-text";

// Splitting a posting into its sections, so each pipeline stage can be given
// the parts it actually needs.
//
// Why this exists: every stage used to receive the same blunt `head N chars`
// slice. That is wrong in both directions. The fit judge spent a third of its
// window on an "about us" blurb that says nothing about the candidate, while
// the sponsorship sentence it needed sat past the cut. The embedding read
// whatever the first 1500 characters happened to be — for a posting that opens
// with company history, the vector described the COMPANY, and every such job
// looked alike no matter what the role was.
//
// A posting is not prose; it is a form. Headings and bullets are how it tells
// us where its parts begin, and that structure survives to us now that
// htmlToText stops flattening it.

// Assemble a posting from parts a source hands us WITH their names.
//
// Several APIs do not ship one description — they ship an object of named
// fields (Lever's `lists`, SmartRecruiters' `jobAd.sections`, Landing.Jobs'
// role_description/main_requirements/nice_to_have/perks, Oracle's
// ExternalQualificationsStr and friends). Every one of those call sites used
// to join the VALUES with a newline and drop the KEYS, which threw away the
// only ground truth we ever get: the source telling us, in its own words,
// which part is the requirements list.
//
// Keep the names. A heading we were handed always beats one we inferred.
export function labelledSections(parts: Array<[string, unknown]>): string {
  const blocks: string[] = [];
  for (const [heading, raw] of parts) {
    const body = htmlToText(typeof raw === "string" ? raw : "");
    if (!body.trim()) continue;
    blocks.push(heading ? `${heading}:\n${body}` : body);
  }
  return blocks.join("\n\n");
}

export type SectionKind =
  | "intro"
  | "responsibilities"
  | "requirements"
  | "niceToHave"
  | "benefits"
  | "visa"
  | "company"
  | "process"
  | "legal"
  | "other";

export interface Section {
  kind: SectionKind;
  heading: string; // "" for the implicit intro
  body: string;
}

// Heading vocabulary. Multilingual on purpose: the pool is European and a
// German posting's "Dein Profil" is the same section as "Requirements".
// Order matters — the first matching entry wins, so the more specific
// patterns (nice-to-have before requirements) come first.
// The vocabulary below is not guesswork: it was grown from the headings the
// parser failed to classify on a 4,000-posting sample of the live pool.
const HEADING_RULES: Array<[SectionKind, RegExp]> = [
  ["visa", /\b(visa|sponsorship|work permit|relocation|arbeitserlaubnis|umzugshilfe)\b/i],
  ["niceToHave", /^(bonus|preferred|nice to haves?)$|\b(nice[\s-]to[\s-]haves?|bonus points?|added bonus|plus(\spoints)?|preferred qualifications|desirable|wünschenswert|pluspunkte|extra credit)\b/i],
  // NOTE the trailing \w* on the verbs: "looking" must match "look", and a
  // bare \b at the end of the alternation silently refuses it. That one
  // omission was hiding "what we're looking for", the single most common
  // requirements heading in the pool.
  ["requirements", /\b(requirements?|qualifications?|what you('?(ll|re|d| a))? ?(bring|have|need|want)\w*|what we('?(ll|re|d))? ?(need|expect|look|want)\w*|who you are|your profile|about you|we('?re| are)? ?look\w* for|we expect you|must[\s-]haves?|skills?( and experience)?|experience|education|essential|required|profile|key technologies|tech(nical)? stack|our stack|stack technique|you'?(ll|d|re)? ?(should |might |may |could |would )?(have|thrive|apply|bring|be a (great |good )?fit)|ideally,? you|(an )?ideal candidate|your (background|expertise|superpowers|profile)|we (prefer|hope)|even better if|minimum|gives you an edge|this opportunity is open to|dein profil|ihr profil|anforderungen|qualifikationen|wat (je|jij) meebrengt|jouw profiel|profil recherché|ce que tu apportes|tu perfil|perfil)\b/i],
  ["responsibilities", /\b(responsibilities|what you('?ll)? ?(do|be doing|build|own)|what success looks like|in this role,? you will|you will|your (role|tasks?|mission|impact|day)|the (role|job|position|day[\s-]to[\s-]day)|the impact you will have|duties|tasks|scope|deine aufgaben|ihre aufgaben|aufgaben|tätigkeiten|jouw (rol|taken)|vos missions|tus funciones|funciones)\b/i],
  ["benefits", /\b(benefits?|what we (have to )?offer|what'?s in it for you|perks|compensation|salary|total rewards|time off|vacation|holidays?|why (join|us)|we (have to )?offer|wir bieten|was wir bieten|unser angebot|wij bieden|ce que nous t'?offrons|nous offrons|ofrecemos|te ofrecemos)\b/i],
  ["company", /(\babout (us|the company|the team|us at)\b|^about\s+\S+|\b(who we are|who is \S+|why (join|work (at|with))\b|our (story|mission|company|team|culture)|the team|we are( proud)?\b|how we work|culture( at | of )?\S*|our values|key principles|what'?s it like to work at|company (profile|overview)|über uns|wir sind|over ons|à propos|sobre nosotros|quiénes somos)\b)/i],
  ["process", /\b(how to apply|application (process|procedure)|interview process|hiring process|next steps|recruitment process|what happens next|when you'?re ready to start|contact( information| us)?|kontakt\w*|bewerbungsprozess|so bewirbst du|sollicitatieprocedure)\b/i],
  ["legal", /\b(equal (opportunity|employment)|diversity|inclusion|data (protection|privacy)|privacy( and ai)? (policy|notice|guidelines)|gdpr|datenschutz|chancengleichheit|imprint|disclaimer|security notice|notice to recruitment agencies)\b/i],
];

// Postings are written by humans in word processors: the same heading arrives
// as "what you'll bring" and "what you’ll bring". Before the fold, the curly
// form was the single largest cause of unclassified headings on the sample.
function fold(s: string): string {
  return s.replace(/[’‘‛]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

function classify(heading: string): SectionKind {
  const h = fold(heading);
  for (const [kind, re] of HEADING_RULES) if (re.test(h)) return kind;
  return "other";
}

// Vocabulary alone cannot win here. Companies invent their own headings
// ("Your superpowers ⚡", "Dein Spielfeld"), and skills lists are often split
// under bare technology names ("PowerShell scripting"). Enumerating those is
// endless and, worse, English-shaped — a German or Portuguese posting with an
// invented heading would stay unclassified forever.
//
// So when a heading is unknown, read the BODY instead: requirement text has
// a recognisable fingerprint in any language ("5+ years", "proficiency in",
// "degree in", "Jahre Erfahrung"). Demand two independent markers, or one
// inside a bullet list, so a passing mention in a prose intro is not enough
// to relabel the section.
const REQ_MARKERS: RegExp[] = [
  /\b\d+\+?\s*(years?|jahre|años|ans|jaar)\b/i,
  /\b(years?|jahre\w*) (of )?(experience|erfahrung)\b/i,
  /\bproficien\w+|fluent in|fließend\b/i,
  /\bexperience (with|in|using)\b/i,
  /\b(bachelor|master'?s|degree in|abschluss|diploma)\b/i,
  /\b(you (have|are|know)|du (hast|bist)|familiar with|vertraut mit|solid understanding)\b/i,
];

// A benefits list trips the requirement markers by accident — "you have 30
// days of paid time off" carries both "you have" and a number. When the body
// reads like an offer to the candidate rather than a demand of them, leave it
// alone; a wrongly promoted perks list would push real requirements out of
// the fit window.
const PERK_MARKERS =
  /\b(paid time off|days? (of )?(paid )?(leave|holiday|vacation)|health insurance|pension|401k|stock options?|equity|budget for|free (lunch|snacks|gym)|urlaubstage|home[\s-]office (budget|allowance))\b/i;

function classifyByBody(body: string): SectionKind | null {
  if (PERK_MARKERS.test(body)) return null;
  const hits = REQ_MARKERS.filter((re) => re.test(body)).length;
  if (hits >= 2) return "requirements";
  const bulleted = /(^|\n)\s*[-•*]/.test(body);
  if (hits >= 1 && bulleted) return "requirements";
  return null;
}

// A line is a heading when it reads like a label rather than a sentence.
// Deliberately conservative: mislabelling a requirements line as a heading
// costs us the line, while missing a heading only means a fatter section.
function isHeading(line: string, next: string | undefined): boolean {
  const s = line.trim();
  if (s.length < 3 || s.length > 90) return false;
  if (/^[-•*\d]/.test(s)) return false; // a bullet or a numbered step
  if (/[.!]$/.test(s)) return false; // a sentence
  // Question-form headings are common ("Who is Acme?", "Why join us?") and
  // were the whole of the parser's remaining miss bucket on the sample. Take
  // them only when they are short AND recognised, so a rhetorical sentence in
  // the middle of a paragraph does not open a section.
  if (/\?$/.test(s)) return s.split(/\s+/).length <= 8 && classify(s) !== "other";
  // "Location: Berlin (hybrid)" is a labelled VALUE, not a section heading —
  // a colon with text after it on the same line disqualifies the line.
  if (/^[^:]{2,30}:\s+\S/.test(s)) return false;
  // A colon ends a label ("Requirements:"), and so does a following bullet.
  if (/:$/.test(s)) return true;
  if (next !== undefined && /^\s*[-•*]/.test(next)) return true;
  // Otherwise demand that it look like a title: few words, no trailing comma,
  // and vocabulary we recognise. Without the vocabulary check a short sentence
  // fragment ("We are growing fast") would open a bogus section.
  const words = s.split(/\s+/).length;
  return words <= 8 && !/,$/.test(s) && classify(s) !== "other";
}

export function parseSections(text: string): Section[] {
  const lines = text.split("\n");
  const out: Section[] = [];
  let cur: Section = { kind: "intro", heading: "", body: "" };
  const push = () => {
    cur.body = cur.body.trim();
    // Only a LABELLED but unrecognised section earns the body fallback; the
    // unlabelled intro keeps its own kind, since a posting's opening almost
    // always mentions experience without being the requirements list.
    if (cur.kind === "other" && cur.heading) {
      cur.kind = classifyByBody(cur.body) ?? "other";
    }
    if (cur.body || cur.heading) out.push(cur);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim() !== "");
    if (line.trim() && isHeading(line, nextNonEmpty)) {
      push();
      const heading = line.trim().replace(/:$/, "");
      cur = { kind: classify(heading), heading, body: "" };
    } else {
      cur.body += line + "\n";
    }
  }
  push();
  return out;
}

// Which sections each stage is given, in priority order. A stage takes
// sections in this order until its budget runs out, so when a posting is too
// long the LEAST useful part is what gets dropped — not, as before, whatever
// happened to sit past character 3000.
//
//   fit      judges a person against a role: what the job does and what it
//            demands. Company history and the benefits list are not evidence
//            about the candidate, and they were eating the window.
//   facts    reads posting-level facts. Sponsorship is usually advertised as
//            a PERK, so benefits is not boilerplate here — it is the payload.
//   embed    describes what the job IS. Benefits and company blurbs are near
//            identical across postings; including them pulls every vector
//            toward the same point and blunts the similarity we rank on.
//   keyword  is a cheap scan; it reads nearly everything, minus the legal and
//            process text that only ever produces false hits.
const VIEWS: Record<string, { keep: SectionKind[]; budget: number }> = {
  fit: {
    keep: ["intro", "responsibilities", "requirements", "niceToHave", "visa", "other"],
    budget: 3000,
  },
  facts: {
    keep: ["intro", "visa", "requirements", "benefits", "responsibilities", "other"],
    budget: 2400,
  },
  embed: {
    keep: ["responsibilities", "requirements", "intro", "other"],
    budget: 1500,
  },
  keyword: {
    keep: ["intro", "responsibilities", "requirements", "niceToHave", "visa", "other", "benefits", "company"],
    budget: 20000,
  },
};

export type Consumer = keyof typeof VIEWS;

// Project a posting down to what one stage needs.
//
// Safety property: a posting with no recognisable headings parses to a single
// `intro` section, which every view keeps — so unstructured postings degrade
// to exactly the old head-slice behaviour instead of coming back empty.
export function postingView(text: string, consumer: Consumer): string {
  const view = VIEWS[consumer];
  const sections = parseSections(text);
  const chosen: string[] = [];
  let used = 0;
  for (const kind of view.keep) {
    for (const s of sections) {
      if (s.kind !== kind) continue;
      const block = (s.heading ? `${s.heading}:\n` : "") + s.body;
      if (used + block.length > view.budget) {
        const room = view.budget - used;
        if (room > 200) {
          chosen.push(block.slice(0, room));
          used = view.budget;
        }
        continue;
      }
      chosen.push(block);
      used += block.length;
    }
    if (used >= view.budget) break;
  }
  // Sections are gathered by priority but printed in document order, so the
  // model reads the posting the way a person would.
  const order = new Map(sections.map((s, i) => [(s.heading ? `${s.heading}:\n` : "") + s.body, i]));
  chosen.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  const joined = chosen.join("\n\n").trim();
  return joined || text.slice(0, view.budget);
}

// How much of a posting a view keeps — used by the measurement script and the
// profile page's pool health panel.
export function viewStats(text: string): Record<Consumer, number> {
  return {
    fit: postingView(text, "fit").length,
    facts: postingView(text, "facts").length,
    embed: postingView(text, "embed").length,
    keyword: postingView(text, "keyword").length,
  };
}
