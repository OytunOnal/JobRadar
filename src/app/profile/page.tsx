import { profile, generatedProfileStale, seniorityFor } from "@/lib/user/profile";
import { CV_CONTEXT, CV_PATH } from "@/lib/llm/cv";
import { LANG_NAMES } from "@/lib/scoring/langreq";
import { SCORER_VERSION } from "@/lib/scoring/score";
import { EXTRACTOR_VERSION } from "@/lib/llm/facts";
import { FIT_PROMPT_VERSION } from "@/lib/llm/fit";
import { providerStatus } from "@/lib/llm/llm";
import { settingsUnreadable } from "@/lib/user/settings";
import {
  addTrack, impactCounts, moveTrack, removeTrack, retierVisa,
  savePreferences, saveTrack, saveJudge, startTask, currentSettings,
} from "./actions";

export const dynamic = "force-dynamic";

// The control panel. Not a settings form: every field here invalidates work
// the pipeline already did, so each section states the consequence and offers
// the repair. A quietly inconsistent pool is the failure this page prevents.

function Impact({ n, what, stale, task }: { n: number; what: string; stale: string; task: string }) {
  if (n === 0) return <span className="ok">✓ {what} up to date</span>;
  return (
    <form action={startTask} className="impact">
      <input type="hidden" name="task" value={task} />
      <span className="stale">{n.toLocaleString("en")} {stale}</span>
      <button className="btn" type="submit">run</button>
    </form>
  );
}

export default async function ProfilePage() {
  const [counts, settings] = await Promise.all([impactCounts(), currentSettings()]);
  const judge = providerStatus();
  const cvLines = CV_CONTEXT.split("\n").filter(Boolean);

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <div>
            <h1>PROFILE</h1>
            <div className="sub">what the radar aims at — and what changing it costs the pool</div>
          </div>
        </div>
        <nav className="pages">
          <a className="chip" href="/">radar</a>
          <a className="chip" href="/applied">applications</a>
          <a className="chip" href="/dismissed">dismissed</a>
          <a className="chip active" href="/profile">profile</a>
        </nav>
      </header>

      {settingsUnreadable && (
        <p className="warn">
          ⚠ The settings file could not be read ({settingsUnreadable}) — <b>every preference fell back to
          its default</b>. The last good copy is in <code>config/settings.json.bak</code>; rename it and
          reload this page.
        </p>
      )}

      {/* ── Pool health / repairs ─────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Pool health</h2>
        <div className="statstrip">
          <span><b>{counts.totalJobs.toLocaleString("en")}</b> postings</span>
          <span><b>{counts.open.toLocaleString("en")}</b> open</span>
          <span className="src">scorer {SCORER_VERSION} · facts {EXTRACTOR_VERSION} · prompt {FIT_PROMPT_VERSION}</span>
        </div>
        <div className="impacts">
          <Impact n={counts.staleScores} what="scores" stale="postings scored by an older scorer" task="rescore" />
          <Impact n={counts.staleFacts} what="facts" stale="postings waiting on extraction" task="facts" />
          <Impact n={counts.missingVectors} what="vectors" stale="postings with no vector" task="embed" />
          <Impact n={counts.staleJudgments} what="verdicts" stale="verdicts from an older prompt" task="fit" />
          {counts.visaDrift > 0 && (
            <form action={retierVisa} className="impact">
              <span className="stale">{counts.visaDrift} rows drifted from their visa tier (in a sample)</span>
              <button className="btn" type="submit">recompute</button>
            </form>
          )}
        </div>
      </section>

      {/* ── CV ────────────────────────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">CV</h2>
        {generatedProfileStale && (
          <p className="warn">
            ⚠ This profile was generated from a different CV than the one on disk — the tracks may still be
            aiming at the old target.
          </p>
        )}
        <p className="hint">
          Source: <code>{CV_PATH}</code> · {cvLines.length} lines · never leaves this machine.
          To replace it: <code>npm run cv:import -- &quot;path/to/CV.pdf&quot;</code>
        </p>
        <details className="cover">
          <summary>show the CV text</summary>
          <pre>{CV_CONTEXT.slice(0, 4000)}</pre>
        </details>
        <p className="hint">
          A new CV makes <b>fit verdicts and vectors stale, but not extracted facts</b> — facts are about
          the posting, fit is about the pairing. Re-judging and re-embedding start from the panel above.
        </p>
      </section>

      {/* ── Tracks ────────────────────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Tracks ({profile.tracks.length})</h2>
        <p className="hint">
          Order matters: on an equal score <b>the higher track wins</b>, so list them most specific first.
          Changing one changes what postings score → run &quot;rescore&quot; above afterwards.
        </p>
        {profile.tracks.map((t, i) => {
          const band = seniorityFor(t.key);
          return (
            <form action={saveTrack} className="job trackrow" key={t.key}>
              <input type="hidden" name="key" value={t.key} />
              <div className="jobmain">
                <p className="title">
                  <input className="inp strong" name="label" defaultValue={t.label} />
                  <code className="trackkey">{t.key}</code>
                  {t.key.startsWith("general-") && <span className="badge">catch-all</span>}
                </p>
                <label className="fieldrow">
                  <span>title keywords</span>
                  <input className="inp" name="titleKeywords" defaultValue={t.titleKeywords.join(", ")} />
                </label>
                <label className="fieldrow">
                  <span>body keywords</span>
                  <input className="inp" name="bodyKeywords" defaultValue={t.bodyKeywords.join(", ")} />
                </label>
                <div className="fieldrow2">
                  <label><span>seniority: wanted</span>
                    <input className="inp" name="boost" defaultValue={(t.seniority?.boost ?? band.boost).join(", ")} />
                  </label>
                  <label><span>seniority: avoided</span>
                    <input className="inp" name="avoid" defaultValue={(t.seniority?.avoid ?? band.avoid).join(", ")} />
                  </label>
                </div>
              </div>
              <div className="actions">
                <button className="btn act" type="submit">save</button>
                <button className="btn quiet" formAction={moveTrack} name="dir" value="up" disabled={i === 0}>▲</button>
                <button className="btn quiet" formAction={moveTrack} name="dir" value="down" disabled={i === profile.tracks.length - 1}>▼</button>
                <button className="btn quiet" formAction={removeTrack}>delete</button>
              </div>
            </form>
          );
        })}
        <form action={addTrack} className="job trackrow">
          <div className="jobmain">
            <div className="fieldrow2">
              <label><span>new track name</span><input className="inp" name="label" placeholder="e.g. Data Engineering" /></label>
              <label><span>title keywords</span><input className="inp" name="titleKeywords" placeholder="data engineer, analytics engineer" /></label>
            </div>
          </div>
          <div className="actions"><button className="btn act" type="submit">add</button></div>
        </form>
      </section>

      {/* ── Judge (which model decides) ───────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Judge</h2>
        <p className="hint">
          Which model reads the postings? The local one is recommended: no quota, no bill, and your CV
          never leaves the machine — but on hardware that cannot hold a 27B model, a cloud key is a
          first-class choice. Keys stay in <code>.env</code>; this is only the preference.
        </p>
        <form action={saveJudge} className="prefs">
          <label className="fieldrow">
            <span>try first</span>
            <select className="inp" name="lead" defaultValue={judge[0]?.name ?? "ollama"}>
              {judge.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.ready}>
                  {p.name}{p.model ? ` — ${p.model}` : ""}{p.ready ? "" : ` (not configured: ${p.needs})`}
                </option>
              ))}
            </select>
            <em>The rest stay as fallbacks: if one hits its quota or errors, the next one answers.</em>
          </label>
          <label className="fieldrow">
            <span>local model</span>
            <input className="inp" name="localModel" defaultValue={settings.llm?.localModel ?? ""} placeholder="qwen3.8:27b" />
            <em>A model name installed in Ollama. Left empty, <code>OLLAMA_MODEL</code> from <code>.env</code> is used.</em>
          </label>
          <label className="fieldrow chk">
            <input type="checkbox" name="localOnly" defaultChecked={(settings.llm?.disabled ?? []).includes("anthropic")} />
            <span>run locally only</span>
            <em>Turns every cloud provider off. If the local model is not running, judging stops rather than falling through to the cloud.</em>
          </label>
          <button className="btn act" type="submit">save judge</button>
        </form>
      </section>

      {/* ── Preferences ───────────────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Preferences</h2>
        <form action={savePreferences} className="prefs">
          <label className="fieldrow">
            <span>where I may already work</span>
            <input className="inp" name="workAuthorization" defaultValue={profile.workAuthorization.join(", ")} placeholder="tr, eu" />
            <em>Postings here count as &quot;no visa needed&quot;; if the list covers everywhere, the visa axis closes entirely.</em>
          </label>
          <label className="fieldrow">
            <span>languages I can work in</span>
            <input className="inp" name="languages" defaultValue={profile.languages.join(", ")} placeholder="en, tr" />
            <em>
              Currently: {profile.languages.map((c) => LANG_NAMES[c] ?? c).join(", ")}. A posting that
              requires fluency in another language counts as a language wall.
            </em>
          </label>
          <div className="fieldrow2">
            <label><span>seniority: wanted (overall)</span>
              <input className="inp" name="seniorityBoost" defaultValue={profile.seniorityBoost.join(", ")} />
            </label>
            <label><span>seniority: avoided (overall)</span>
              <input className="inp" name="seniorityAvoid" defaultValue={profile.seniorityAvoid.join(", ")} />
            </label>
          </div>
          <label className="fieldrow">
            <span>personal role exclusions</span>
            <input className="inp" name="extraRoleNegatives" defaultValue={(settings.extraRoleNegatives ?? []).join(", ")} placeholder="ios developer, android developer" />
            <em>A track match outranks these: &quot;Unity iOS Developer&quot; still gets through.</em>
          </label>
          <label className="fieldrow">
            <span>regions I accept</span>
            <input className="inp" name="acceptRegions" defaultValue={profile.acceptRegions.join(", ")} />
          </label>
          <label className="fieldrow">
            <span>salary floor (EUR/year)</span>
            <input className="inp" name="salaryFloor" defaultValue={String(profile.salaryFloorEURYear)} />
          </label>
          <button className="btn act" type="submit">save preferences</button>
        </form>
      </section>

      <p className="hint">
        Settings live in <code>config/settings.json</code> — editable by hand, exportable, and sent
        nowhere from this machine.
      </p>
    </main>
  );
}
