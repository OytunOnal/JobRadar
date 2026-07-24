import { user } from "../../config/user";

// The CV context the drafter/scorer feeds the LLM. Sourced from your private
// config/user.ts (gitignored) so it never gets committed.
export const CV_CONTEXT = user.cv;
