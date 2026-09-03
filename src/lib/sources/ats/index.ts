// The ATS registry.
//
// Generic connectors for the major applicant-tracking systems. Each takes a
// company's board token and returns that company's postings, normalized. These
// are the highest-signal sources: you choose exactly which companies to watch
// (see companies.ts) instead of filtering a firehose.
//
// This used to be one 1,021-line file. Two thirds of it was mapping logic —
// the half that decides what a posting IS — and none of it had a test, because
// every mapper lived inside its fetcher and could not be reached without a
// network call. The uncovered source files were exactly the source files with
// no exported mapper: testability and coverage were the same fact.
//
// So each platform is its own module now, and each exports its mapping as a
// pure function beside the fetcher that feeds it. The quirks stay with the
// platform they belong to — Workday's relative "Posted 3 Days Ago" strings,
// SuccessFactors' locale gating, Comeet's and CSOD's token bootstraps — rather
// than sitting in one file where 28 platforms' oddities read as one system's.
//
// This file is now only the registry, and adding a platform is one line here
// plus one module.

import type { RawJob } from "../types";

import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { ashby } from "./ashby";
import { smartrecruiters } from "./smartrecruiters";
import { workable } from "./workable";
import { recruitee } from "./recruitee";
import { personio } from "./personio";
import { workday } from "./workday";
import { teamtailor } from "./teamtailor";
import { bamboohr } from "./bamboohr";
import { breezy } from "./breezy";
import { join } from "./join";
import { manatal } from "./manatal";
import { hrmanager } from "./hrmanager";
import { pinpoint } from "./pinpoint";
import { oracle } from "./oracle";
import { beesite } from "./beesite";
import { successfactors } from "./successfactors";
import { eightfold } from "./eightfold";
import { jibe } from "./jibe";
import { rippling } from "./rippling";
import { phenom } from "./phenom";
import { gem } from "./gem";
import { comeet } from "./comeet";
import { getro } from "./getro";
import { avature } from "./avature";
import { radancy } from "./radancy";
import { csod } from "./csod";
import { jobvite } from "./jobvite";
import { softgarden } from "./softgarden";

// Uniform shape: fetchers that are single-instance (Greenhouse, Ashby,
// SmartRecruiters, Workable, Recruitee, Personio, Workday) simply ignore the
// region argument.
export type AtsFetcher = (token: string, company: string, region?: string) => Promise<RawJob[]>;

export const atsFetchers = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  recruitee,
  personio,
  workday,
  teamtailor,
  bamboohr,
  breezy,
  join,
  manatal,
  hrmanager,
  pinpoint,
  oracle,
  beesite,
  successfactors,
  eightfold,
  jibe,
  rippling,
  phenom,
  gem,
  comeet,
  getro,
  avature,
  radancy,
  csod,
  jobvite,
  softgarden,
} as const satisfies Record<string, AtsFetcher>;

export type AtsProvider = keyof typeof atsFetchers;

// Lever's section parts are read by ingest's assembler through the seam, but
// the function is also the clearest example of what a mapper reports versus
// what ingest decides — so it stays reachable by name.
export { leverSections } from "./lever";
