// Runs on postinstall: seeds config/user.ts from the example if it doesn't
// exist yet, so a fresh clone builds immediately. Your real config/user.ts is
// gitignored and never overwritten.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "config", "user.ts");
const example = join(root, "config", "user.example.ts");

if (!existsSync(target) && existsSync(example)) {
  copyFileSync(example, target);
  console.log("[jobradar] Created config/user.ts from the example — edit it with your own CV.");
}
