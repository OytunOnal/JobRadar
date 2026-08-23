// Preparing a posting's text for an LLM prompt. Shared by the fit judge and
// the facts extractor (and kept out of both to avoid a circular import).

// Trailing boilerplate (EEO declarations, benefits lists) wastes tokens and
// adds no fit signal. Cut from the earliest marker onward — but ignore matches
// in the leading window, where an "about us" blurb is real company context.
const BOILERPLATE_MARKERS: RegExp[] = [
  /\bequal[\s-]opportunity[\s-](employer|employment)\b/i,
  /\bwithout regard to\b.{0,60}(race|colou?r|sex|age|national origin|disability|veteran)/i,
  /\breasonable accommodations?\b/i,
  /\bwe (celebrate|embrace|champion|welcome)\b.{0,40}\bdiversity\b/i,
  /(?:^|\n)\s*(benefits|perks( and benefits)?|what we offer|total rewards)\s*[:\n]/im,
];
const BOILERPLATE_LEAD_WINDOW = 600;

export function trimBoilerplate(text: string): string {
  let cutAt = text.length;
  for (const marker of BOILERPLATE_MARKERS) {
    const m = marker.exec(text);
    if (m && m.index >= BOILERPLATE_LEAD_WINDOW && m.index < cutAt) cutAt = m.index;
  }
  // Safety floor: if trimming would gut the posting, keep it whole.
  if (cutAt < 300 || cutAt < text.length * 0.3) return text.trimEnd();
  return text.slice(0, cutAt).trimEnd();
}

// The sentences that decide visa / language / seniority, wherever they sit.
//
// MEASURED on 400 postings containing the word "sponsor": only 34% of them
// reached the model. 14% were destroyed by the trimmer above — sponsorship
// perks live under exactly the "What we offer" heading it cuts at — and 52%
// fell past the 3000-character prompt window, because these statements
// conventionally close a posting rather than open it. Truncating the head is
// fine for judging fit; it is fatal for extracting facts. So we keep the head
// AND carry the signal-bearing lines from the rest of the document.
const SIGNAL_RE =
  /\b(visa|sponsor\w*|relocation|work permit|right to work|arbeitserlaubnis|umzug\w*|deutschkenntnisse|fließend|fluent in|years? of experience|jahre\w* erfahrung|direct reports?)\b/i;

export function signalExcerpts(description: string, maxChars = 900, skipHead = 1800): string {
  const tail = description.slice(skipHead); // the head is already in the prompt
  const hits: string[] = [];
  let budget = 0;
  for (const sentence of tail.split(/(?<=[.!?;:])\s+|\n+/)) {
    if (!SIGNAL_RE.test(sentence)) continue;
    const clean = sentence.trim().replace(/\s+/g, " ").slice(0, 300);
    if (clean.length < 8) continue;
    hits.push(clean);
    budget += clean.length;
    if (budget > maxChars) break;
  }
  return hits.join("\n");
}
