import { existsSync, readFileSync } from "node:fs";
import { user } from "../../../config/user";

// The CV context everything reads: profile generation, fit scoring, cover
// letters. Two sources, imported file wins:
//   1. config/cv.txt — written by `npm run cv:import <resume.pdf|.txt|.md>`
//   2. the inline `cv` field in config/user.ts (the original hand-written way)
// Both are gitignored; personal data never gets committed.

export const CV_PATH = "config/cv.txt";

function loadCv(): string {
  // Hermetic tests must see the template CV from user.example-style config,
  // not whatever resume was imported on this machine.
  if (!process.env.NODE_TEST_CONTEXT && existsSync(CV_PATH)) {
    const text = readFileSync(CV_PATH, "utf8").trim();
    if (text.length > 100) return text;
  }
  return user.cv;
}

export const CV_CONTEXT = loadCv();
