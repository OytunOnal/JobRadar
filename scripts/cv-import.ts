import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { CV_PATH } from "../src/lib/cv";

// CV import — the onboarding step: hand it your resume file and it becomes the
// CV context for everything (fit scoring, cover letters, profile generation).
//
//   npm run cv:import -- "C:\path\to\Resume.pdf"     (.pdf, .txt, or .md)
//
// Writes the extracted text to config/cv.txt (gitignored). The inline cv field
// in config/user.ts remains as the fallback when no import exists.

const path = process.argv[2];
if (!path) {
  console.error('usage: npm run cv:import -- "path/to/resume.pdf|.txt|.md"');
  process.exit(2);
}

// PDF text arrives with layout artifacts; collapse them without losing the
// line structure the LLM uses to read sections.
export function normalizeCvText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let text: string;
const ext = extname(path).toLowerCase();
if (ext === ".pdf") {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
  const extracted = await extractText(pdf, { mergePages: true });
  text = normalizeCvText(extracted.text);
} else if (ext === ".txt" || ext === ".md") {
  text = normalizeCvText(readFileSync(path, "utf8"));
} else {
  console.error(`unsupported file type "${ext}" — use .pdf, .txt, or .md`);
  process.exit(2);
}

if (text.length < 200) {
  console.error(`extracted only ${text.length} characters — that doesn't look like a CV; nothing written.`);
  process.exit(1);
}

writeFileSync(CV_PATH, text + "\n");
console.log(`=== JobRadar CV import ===`);
console.log(`Imported ${text.length} characters from ${path}`);
console.log(`\nPreview (first 400 chars):\n${text.slice(0, 400)}…`);
console.log(`\nWritten to ${CV_PATH} (gitignored).`);
console.log("Next: npm run profile:generate — re-aim the radar at this CV.");
