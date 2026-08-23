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
  ["responsibilities", /\b(responsibilities|what you('?ll)? ?(do|be doing|build|own)|what success looks like|in this role,? you will|you will|your (role|tasks?|mission|impact|day)|the (role|job|position|day[\s-]to[\s-]day)|the impact you will have|^role$|duties|tasks|scope|deine aufgaben|ihre aufgaben|aufgaben|tätigkeiten|jouw (rol|taken)|vos missions|tus funciones|funciones)\b/i],
  ["benefits", /\b(benefits?|what we (have to )?offer|what'?s in it for you|perks|compensation|salary|total rewards|time off|vacation|holidays?|why (join|us)|we (have to )?offer|wir bieten|was wir bieten|unser angebot|wij bieden|ce que nous t'?offrons|nous offrons|ofrecemos|te ofrecemos)\b/i],
  // "About this role" is NOT a company blurb — the bare `about <word>` rule
  // was swallowing it, and the fit view then dropped the role description.
  ["company", /(\babout (us|the company|the team|us at)\b|^about\s+(?!(this|the)\s+(role|position|job|opportunity|team\b))\S+|\b(who we are|who is \S+|why (join|work (at|with))\b|our (story|mission|company|team|culture)|the team|we are( proud)?\b|how we work|culture( at | of )?\S*|our values|key principles|what'?s it like to work at|company (profile|overview)|über uns|wir sind|over ons|à propos|sobre nosotros|quiénes somos)\b)/i],
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
  // ALL-CAPS short lines are headings, whatever the words are. Postings that
  // style their sections this way ("ABOUT VOODOO", "TEAM", "ROLE") defeated
  // every other rule: no colon, no bullet beneath, and vocabulary that does
  // not know a bare "ROLE". The whole role description then sat inside the
  // company blurb and the fit view threw it away. Caps is a structural
  // signal, so it works in any language.
  if (
    s === s.toUpperCase() && s.length <= 60 && !/[.!?,]$/.test(s) &&
    // Words, not figures: "$112,000 — $187,000 USD" is a salary VALUE that
    // happens to carry no lowercase, and reading it as a heading split the
    // pay range away from its own label.
    /^[^\d$€£+]/.test(s) && (s.match(/[a-zäöüáéíóúàèìòùçşğ]/gi) ?? []).length >= 3
  ) {
    return true;
  }
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
// Each kind gets a QUOTA, not just a place in a queue.
//
// Strict priority filling looked right and measured wrong: an audit of 6,000
// candidates found the fit view losing requirement text in 12.7% of postings
// and the embedding in 45.2%. The cause was greedy order — a posting with two
// long "what you'll do" sections spent the whole window before the
// requirements list was reached, so the judge read what the job DOES and
// never what it DEMANDS. Quotas reserve each kind its share first; whatever
// is left over is then handed out in the same priority order, so a posting
// that lacks a kind still gets a full window.
const VIEWS: Record<string, {
  budget: number;
  quota: Array<[SectionKind, number]>;
  // Kinds admitted ONLY when the view would otherwise starve (see below).
  rescue?: SectionKind[];
}> = {
  fit: {
    rescue: ["company", "benefits"],
    // Measured over 4,000 candidates (scripts/tune-fit-window.ts). Capping
    // requirements at 1200 delivered the section WHOLE in only 79.5% of
    // postings — one in five judgments was made on a truncated list of what
    // the job demands, which produces a confidently wrong verdict rather
    // than an obviously bad one. Uncapping it costs nothing at the same
    // budget (97.3% whole, prompt unchanged at ~9.6k chars); going to 4000
    // reaches 99.5% for about 94 extra tokens a job, against a context
    // window of 8192 that the prompt currently fills to ~2.5k.
    budget: 4000,
    quota: [
      ["requirements", 4000],     // what the job demands — never truncated
      ["responsibilities", 1200],
      ["niceToHave", 450],
      ["visa", 250],
      ["intro", 600],
      ["other", 500],
    ],
  },
  facts: {
    rescue: ["company", "benefits"],
    budget: 2400,
    quota: [
      ["visa", 500],
      ["requirements", 700],
      ["benefits", 600],          // sponsorship is advertised as a perk
      ["intro", 500],
      ["responsibilities", 300],
      ["other", 400],
    ],
  },
  embed: {
    rescue: ["company", "benefits"],
    // The 1500 budget is the embedding bake-off's measured winner, so it
    // stays until a new bake-off says otherwise. What CAN improve inside it
    // is the split: quotas that add up to more than the budget let a posting
    // with no responsibilities section spend the whole window on its
    // requirements instead of leaving it unused.
    budget: 1500,
    quota: [
      ["responsibilities", 900],
      ["requirements", 900],
      ["niceToHave", 300],
      ["intro", 300],
      ["other", 300],
    ],
  },
  keyword: {
    budget: 20000,
    quota: [
      ["intro", 20000], ["responsibilities", 20000], ["requirements", 20000],
      ["niceToHave", 20000], ["visa", 20000], ["other", 20000],
      ["benefits", 20000], ["company", 20000],
    ],
  },
};

export type Consumer = keyof typeof VIEWS;

// Project a posting down to what one stage needs.
//
// Safety property: a posting with no recognisable headings parses to a single
// `intro` section, which every view keeps — so unstructured postings degrade
// to exactly the old head-slice behaviour instead of coming back empty.
// The projection with its parts still separate: which section each kept
// block came from, and how long that section was in full. The audit needs
// this to measure RETENTION — "the requirements survived" is not the same
// claim as "half the requirements survived", and only the second number
// tells you whether the judge saw the whole list.
export function viewParts(
  text: string,
  consumer: Consumer,
): Array<{ kind: SectionKind; text: string; full: number }> {
  const view = VIEWS[consumer];
  const blocks = parseSections(text)
    // A heading whose body is empty carries no information — postings are
    // full of them (metadata labels, placeholder bullets). Printing
    // "Work Authorization:" with nothing under it spends tokens on nothing.
    .filter((s) => s.body.trim())
    .map((s, i) => ({ kind: s.kind, at: i, text: (s.heading ? `${s.heading}:\n` : "") + s.body }));

  const kept = new Map<number, string>(); // section index -> how much we kept
  let used = 0;

  // Take up to `cap` more characters from every section of one kind.
  const take = (kind: SectionKind, cap: number) => {
    let room = Math.min(cap, view.budget - used);
    for (const b of blocks) {
      if (room <= 0) break;
      if (b.kind !== kind) continue;
      const already = kept.get(b.at)?.length ?? 0;
      if (already >= b.text.length) continue;
      let end = already + Math.min(room, b.text.length - already);
      // Cut on a line boundary. Half a bullet is not a shorter requirement,
      // it is a DIFFERENT one — "- 5 years of experience with Kube" reads as
      // a Kubernetes-free job. Ending on the newline costs a few characters
      // and removes a whole class of silent misreading.
      if (end < b.text.length) {
        const nl = b.text.lastIndexOf("\n", end);
        if (nl > already + 40) end = nl;
      }
      const add = end - already;
      if (add <= 0) continue;
      // A 40-character fragment of a requirements list helps nobody and
      // reads as noise; skip a section rather than open it with a scrap.
      if (already === 0 && add < 120 && b.text.length > add) continue;
      kept.set(b.at, b.text.slice(0, end));
      room -= add;
      used += add;
    }
  };

  for (const [kind, quota] of view.quota) take(kind, quota);
  // Second pass: a posting that has no benefits section should not be
  // punished for it — spend the leftover budget in the same priority order.
  for (const [kind] of view.quota) take(kind, view.budget - used);

  // Starvation guard. Classification will sometimes be wrong in a way no
  // vocabulary fixes — a posting that files its entire role description
  // under "ABOUT US" leaves the fit view holding a 400-character skills list
  // out of 3,200 characters of posting. Sending a nearly empty prompt is
  // worse than sending an imperfectly filtered one, so when a view ends up
  // with far less than it could have had, let the excluded kinds back in.
  // Both conditions matter. A small share of the posting alone is fine — a
  // posting that IS mostly company blurb should be filtered hard, not padded
  // back out. It is only a problem when what survives is also too thin to
  // judge on, which is what a fraction plus an absolute floor together say.
  const available = blocks.reduce((n, b) => n + b.text.length, 0);
  // Short postings are exempt: there is nothing much to lose, and the view
  // already holds most of what exists.
  if (available >= 800 && used < available * 0.35 && used < view.budget * 0.4) {
    for (const kind of view.rescue ?? []) take(kind, view.budget - used);
  }

  // Gathered by priority, printed in document order: the model reads the
  // posting the way a person would.
  return [...kept.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, t]) => ({ kind: blocks.find((b) => b.at === at)!.kind, text: t, full: blocks.find((b) => b.at === at)!.text.length }));
}

export function postingView(text: string, consumer: Consumer): string {
  const joined = viewParts(text, consumer).map((p) => p.text).join("\n\n").trim();
  return joined || text.slice(0, VIEWS[consumer].budget);
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
