-- CreateTable
CREATE TABLE "AtsBoard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "companyName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "discoveredVia" TEXT NOT NULL,
    "validatedAt" DATETIME,
    "lastFetchedAt" DATETIME,
    "hitRate" REAL NOT NULL DEFAULT 0,
    "fetchIntervalDays" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompanyProbe" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "found" BOOLEAN NOT NULL DEFAULT false,
    "deepChecked" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LocationCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raw" TEXT NOT NULL,
    "country" TEXT,
    "resolvedBy" TEXT NOT NULL DEFAULT 'llm',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Job" (
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
    "workMode" TEXT NOT NULL DEFAULT 'onsite',
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

-- CreateTable
CREATE TABLE "PostingFacts" (
    "jobId" TEXT NOT NULL PRIMARY KEY,
    "visaOffered" TEXT,
    "seniorityLevel" TEXT,
    "langReq" TEXT,
    "ghostRisk" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostingFacts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobContent" (
    "jobId" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "coverLetter" TEXT,
    "textVersion" TEXT,
    CONSTRAINT "JobContent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobEmbedding" (
    "jobId" TEXT NOT NULL PRIMARY KEY,
    "model" TEXT NOT NULL,
    "vector" BLOB NOT NULL,
    "builtFrom" TEXT,
    CONSTRAINT "JobEmbedding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobListingHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobListingHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeywordScoreHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" TEXT NOT NULL,
    "scorerVersion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "track" TEXT,
    "reason" TEXT,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KeywordScoreHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmJudgmentHistory" (
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
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmJudgmentHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserActionLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" TEXT,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserActionLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DashboardStatsSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stats" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "VisaSponsor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "country" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "detail" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SourceState" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "lastFetchedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AtsBoard_status_idx" ON "AtsBoard"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AtsBoard_platform_token_region_key" ON "AtsBoard"("platform", "token", "region");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProbe_name_key" ON "CompanyProbe"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LocationCache_raw_key" ON "LocationCache"("raw");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_score_idx" ON "Job"("score");

-- CreateIndex
CREATE INDEX "Job_contentKey_idx" ON "Job"("contentKey");

-- CreateIndex
CREATE INDEX "Job_disqualified_status_delistedAt_fitScore_idx" ON "Job"("disqualified", "status", "delistedAt", "fitScore");

-- CreateIndex
CREATE INDEX "Job_country_idx" ON "Job"("country");

-- CreateIndex
CREATE INDEX "Job_postedAt_idx" ON "Job"("postedAt");

-- CreateIndex
CREATE INDEX "Job_lastSeenAt_idx" ON "Job"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Job_visaTier_idx" ON "Job"("visaTier");

-- CreateIndex
CREATE INDEX "JobListingHistory_jobId_idx" ON "JobListingHistory"("jobId");

-- CreateIndex
CREATE INDEX "KeywordScoreHistory_jobId_idx" ON "KeywordScoreHistory"("jobId");

-- CreateIndex
CREATE INDEX "LlmJudgmentHistory_jobId_idx" ON "LlmJudgmentHistory"("jobId");

-- CreateIndex
CREATE INDEX "UserActionLog_jobId_idx" ON "UserActionLog"("jobId");

-- CreateIndex
CREATE INDEX "VisaSponsor_country_nameNorm_idx" ON "VisaSponsor"("country", "nameNorm");

