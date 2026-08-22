import { DatabaseSync } from "node:sqlite";
import { appendFileSync } from "node:fs";

// One-shot data migration to the layered schema (docs/ARCHITECTURE.md).
// Run AFTER `prisma db push` created the new tables and BEFORE the phase-B
// push that drops the fat columns from Job. Pure SQL copies — half a million
// rows move in minutes, no ORM overhead. Idempotent: every INSERT is guarded
// by a WHERE NOT EXISTS, so a crashed run can simply be rerun.
//
//   npx tsx scripts/migrate-layered.ts

function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("migrate-layered.log", stamped + "\n");
}

const db = new DatabaseSync("prisma/dev.db");
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=60000");

const count = (sql: string): number =>
  (db.prepare(sql).get() as { c: number }).c;

log("=== layered-schema migration ===");
log(`jobs: ${count("select count(*) c from Job")}`);

// Create the new tables ourselves (this script runs BEFORE the phase-B
// `prisma db push`, which would otherwise drop the fat Job columns before
// their data was copied). Prisma's push then reconciles constraint deltas
// with data preserved.
db.exec(`
CREATE TABLE IF NOT EXISTS "JobContent" (
  "jobId" TEXT NOT NULL PRIMARY KEY,
  "description" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL DEFAULT '',
  "coverLetter" TEXT,
  CONSTRAINT "JobContent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "JobEmbedding" (
  "jobId" TEXT NOT NULL PRIMARY KEY,
  "model" TEXT NOT NULL,
  "vector" BLOB NOT NULL,
  CONSTRAINT "JobEmbedding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "JobListingHistory" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "jobId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "at" DATETIME NOT NULL,
  CONSTRAINT "JobListingHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "KeywordScoreHistory" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "jobId" TEXT NOT NULL,
  "scorerVersion" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "track" TEXT,
  "reason" TEXT,
  "disqualified" BOOLEAN NOT NULL DEFAULT false,
  "at" DATETIME NOT NULL,
  CONSTRAINT "KeywordScoreHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "LlmJudgmentHistory" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "jobId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "fitScore" INTEGER NOT NULL,
  "verdict" TEXT NOT NULL,
  "category" TEXT,
  "seniorityLevel" TEXT,
  "ghostRisk" BOOLEAN NOT NULL DEFAULT false,
  "comment" TEXT,
  "at" DATETIME NOT NULL,
  CONSTRAINT "LlmJudgmentHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "UserActionLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "jobId" TEXT,
  "type" TEXT NOT NULL,
  "payload" TEXT,
  "at" DATETIME NOT NULL,
  CONSTRAINT "UserActionLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "DashboardStatsSnapshot" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "at" DATETIME NOT NULL,
  "stats" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "JobListingHistory_jobId_idx" ON "JobListingHistory"("jobId");
CREATE INDEX IF NOT EXISTS "KeywordScoreHistory_jobId_idx" ON "KeywordScoreHistory"("jobId");
CREATE INDEX IF NOT EXISTS "LlmJudgmentHistory_jobId_idx" ON "LlmJudgmentHistory"("jobId");
CREATE INDEX IF NOT EXISTS "UserActionLog_jobId_idx" ON "UserActionLog"("jobId");
`);
log("tables ready");

// 1) Fat text -> JobContent
db.exec(`
  INSERT INTO JobContent (jobId, description, contentHash, coverLetter)
  SELECT j.id, j.description, '', j.coverLetter FROM Job j
  WHERE NOT EXISTS (SELECT 1 FROM JobContent c WHERE c.jobId = j.id)
`);
log(`JobContent: ${count("select count(*) c from JobContent")}`);

// 2) Vectors -> JobEmbedding
db.exec(`
  INSERT INTO JobEmbedding (jobId, model, vector)
  SELECT j.id, 'qwen3-embedding:0.6b', j.embedding FROM Job j
  WHERE j.embedding IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM JobEmbedding e WHERE e.jobId = j.id)
`);
log(`JobEmbedding: ${count("select count(*) c from JobEmbedding")}`);

// 3) Seed LlmJudgmentHistory from the current fit projection. Provenance:
//    fitBy null = the 8B/free-cloud era; prompt version is best-effort
//    "pre-v3" (the exact prompt text of that era wasn't versioned — that's
//    the very gap this table closes going forward).
db.exec(`
  INSERT INTO LlmJudgmentHistory (jobId, model, promptVersion, fitScore, verdict, category, seniorityLevel, ghostRisk, comment, at)
  SELECT j.id, COALESCE(j.fitBy, '8b-era'), 'pre-v3', j.fitScore,
         COALESCE(j.fitVerdict, 'weak'), j.fitCategory, NULL, j.ghostRisk, j.fitComment, j.updatedAt
  FROM Job j
  WHERE j.fitScore IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM LlmJudgmentHistory h WHERE h.jobId = j.id)
`);
log(`LlmJudgmentHistory: ${count("select count(*) c from LlmJudgmentHistory")}`);

// 4) Seed KeywordScoreHistory with the current scores as the pre-migration
//    baseline version.
db.exec(`
  INSERT INTO KeywordScoreHistory (jobId, scorerVersion, score, track, reason, disqualified, at)
  SELECT j.id, 'pre-migration', j.score, j.track, j.scoreReason, j.disqualified, j.updatedAt
  FROM Job j
  WHERE NOT EXISTS (SELECT 1 FROM KeywordScoreHistory h WHERE h.jobId = j.id)
`);
log(`KeywordScoreHistory: ${count("select count(*) c from KeywordScoreHistory")}`);

// 5) Best-effort UserActionLog seed from surviving projections (full history
//    was never recorded — that is what the log fixes going forward).
db.exec(`
  INSERT INTO UserActionLog (jobId, type, payload, at)
  SELECT j.id, 'applied', NULL, COALESCE(j.appliedAt, j.updatedAt)
  FROM Job j WHERE j.appliedAt IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM UserActionLog l WHERE l.jobId = j.id AND l.type = 'applied')
`);
db.exec(`
  INSERT INTO UserActionLog (jobId, type, payload, at)
  SELECT j.id, 'dismissed', CASE WHEN j.dismissReason IS NULL THEN NULL ELSE '{"reason":"' || j.dismissReason || '"}' END, j.updatedAt
  FROM Job j WHERE j.status = 'ignored'
    AND NOT EXISTS (SELECT 1 FROM UserActionLog l WHERE l.jobId = j.id AND l.type = 'dismissed')
`);
log(`UserActionLog: ${count("select count(*) c from UserActionLog")}`);

// 6) Seed JobListingHistory: one 'listed' event per live job (firstSeenAt)
//    and one 'delisted' for the delisted (state-change semantics from day 1).
db.exec(`
  INSERT INTO JobListingHistory (jobId, source, event, at)
  SELECT j.id, j.source, 'listed', j.firstSeenAt FROM Job j
  WHERE NOT EXISTS (SELECT 1 FROM JobListingHistory h WHERE h.jobId = j.id AND h.event = 'listed')
`);
db.exec(`
  INSERT INTO JobListingHistory (jobId, source, event, at)
  SELECT j.id, j.source, 'delisted', j.delistedAt FROM Job j
  WHERE j.delistedAt IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM JobListingHistory h WHERE h.jobId = j.id AND h.event = 'delisted')
`);
log(`JobListingHistory: ${count("select count(*) c from JobListingHistory")}`);

log("=== copy complete — phase-B push may now drop Job.description/embedding/coverLetter ===");
db.close();
