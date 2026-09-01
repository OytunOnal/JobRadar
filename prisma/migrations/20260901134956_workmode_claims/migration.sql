-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT,
    "workMode" TEXT NOT NULL DEFAULT 'unknown',
    "workModeBy" TEXT,
    "salaryText" TEXT,
    "contentKey" TEXT NOT NULL DEFAULT '',
    "sourceTrust" INTEGER NOT NULL DEFAULT 1,
    "score" INTEGER NOT NULL DEFAULT 0,
    "track" TEXT,
    "scoreReason" TEXT,
    "scoredBy" TEXT,
    "fitScore" INTEGER,
    "fitBy" TEXT,
    "fitVerdict" TEXT,
    "fitComment" TEXT,
    "fitCategory" TEXT,
    "fitPromptVersion" TEXT,
    "ghostRisk" BOOLEAN NOT NULL DEFAULT false,
    "visa" TEXT NOT NULL DEFAULT 'unknown',
    "sponsorReg" BOOLEAN NOT NULL DEFAULT false,
    "visaBy" TEXT,
    "visaTier" TEXT NOT NULL DEFAULT 'unknown',
    "appliedAt" DATETIME,
    "statusAt" DATETIME,
    "followUpAt" DATETIME,
    "note" TEXT,
    "dismissReason" TEXT,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "postedAt" DATETIME,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delistedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "seniorityLevel" TEXT,
    "seniorityBy" TEXT,
    "langReq" TEXT
);
INSERT INTO "new_Job" ("appliedAt", "company", "contentKey", "country", "createdAt", "dedupeKey", "delistedAt", "dismissReason", "disqualified", "duplicateOfId", "externalId", "firstSeenAt", "fitBy", "fitCategory", "fitComment", "fitPromptVersion", "fitScore", "fitVerdict", "followUpAt", "ghostRisk", "id", "langReq", "lastSeenAt", "location", "note", "notes", "postedAt", "remote", "salaryText", "score", "scoreReason", "scoredBy", "seniorityBy", "seniorityLevel", "source", "sourceTrust", "sponsorReg", "status", "statusAt", "title", "track", "updatedAt", "url", "visa", "visaBy", "visaTier", "workMode") SELECT "appliedAt", "company", "contentKey", "country", "createdAt", "dedupeKey", "delistedAt", "dismissReason", "disqualified", "duplicateOfId", "externalId", "firstSeenAt", "fitBy", "fitCategory", "fitComment", "fitPromptVersion", "fitScore", "fitVerdict", "followUpAt", "ghostRisk", "id", "langReq", "lastSeenAt", "location", "note", "notes", "postedAt", "remote", "salaryText", "score", "scoreReason", "scoredBy", "seniorityBy", "seniorityLevel", "source", "sourceTrust", "sponsorReg", "status", "statusAt", "title", "track", "updatedAt", "url", "visa", "visaBy", "visaTier", "workMode" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE INDEX "Job_score_idx" ON "Job"("score");
CREATE INDEX "Job_contentKey_idx" ON "Job"("contentKey");
CREATE INDEX "Job_disqualified_status_delistedAt_fitScore_idx" ON "Job"("disqualified", "status", "delistedAt", "fitScore");
CREATE INDEX "Job_country_idx" ON "Job"("country");
CREATE INDEX "Job_postedAt_idx" ON "Job"("postedAt");
CREATE INDEX "Job_lastSeenAt_idx" ON "Job"("lastSeenAt");
CREATE INDEX "Job_visaTier_idx" ON "Job"("visaTier");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
