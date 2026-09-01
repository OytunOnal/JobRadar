-- AlterTable
ALTER TABLE "CompanyProbe" ADD COLUMN "probeVersion" TEXT;

-- Existing verdicts were all produced under today's five-platform set; stamp
-- them so they don't read as stale the moment versioning ships.
UPDATE "CompanyProbe" SET "probeVersion" = 'greenhouse,personio,recruitee,smartrecruiters,workable';
