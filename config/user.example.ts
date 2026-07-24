// Copy this file to config/user.ts and fill in your own details.
// config/user.ts is gitignored, so your CV and contact info stay private.
export const user = {
  name: "Your Name",
  location: "Your City, Country (region)",

  // Paste a compact, factual CV summary here. The LLM uses ONLY this text to
  // score how well jobs fit you and to draft cover letters — so include your
  // real experience, skills, and the "voice" you want letters written in.
  cv: `
Name: Your Name. Based in <city, country>. Remote-ready.
Contact: you@example.com

Summary: <one paragraph — years of experience, main stack, what you do>.

Experience:
- <Company> (<years>) — <role, what you shipped, impact>.
- <Company> (<years>) — <role, what you shipped>.

Skills: <comma-separated list of your real skills>.

Voice: <how you want cover letters to sound — e.g. honest and grounded, not boastful>.
`.trim(),

  // ── Optional: retarget the radar ──────────────────────────────────────────
  // Uncomment to replace the default tracks (game-dev/AI/full-stack flavored)
  // with your own target roles. Track keys become the dashboard filter chips.
  //
  // tracks: [
  //   {
  //     key: "data",
  //     label: "Data Engineering",
  //     titleKeywords: ["data engineer", "analytics engineer", "etl"],
  //     bodyKeywords: ["airflow", "dbt", "spark", "snowflake", "python", "sql"],
  //   },
  // ],
  //
  // Uncomment to change which locations survive the region filter (a job must
  // be remote OR match one of these strings in its location).
  //
  // acceptRegions: ["remote", "europe", "netherlands", "amsterdam"],
};
