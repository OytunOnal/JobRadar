import { profile, generatedProfileStale, seniorityFor } from "@/lib/profile";
import { CV_CONTEXT, CV_PATH } from "@/lib/cv";
import { LANG_NAMES } from "@/lib/langreq";
import { SCORER_VERSION } from "@/lib/score";
import { EXTRACTOR_VERSION } from "@/lib/facts";
import { FIT_PROMPT_VERSION } from "@/lib/fit";
import { providerStatus } from "@/lib/llm";
import {
  addTrack, impactCounts, moveTrack, removeTrack, retierVisa,
  savePreferences, saveTrack, saveJudge, startTask, currentSettings,
} from "./actions";

export const dynamic = "force-dynamic";

// The control panel. Not a settings form: every field here invalidates work
// the pipeline already did, so each section states the consequence and offers
// the repair. A quietly inconsistent pool is the failure this page prevents.

function Impact({ n, what, stale, task }: { n: number; what: string; stale: string; task: string }) {
  if (n === 0) return <span className="ok">✓ {what} güncel</span>;
  return (
    <form action={startTask} className="impact">
      <input type="hidden" name="task" value={task} />
      <span className="stale">{n.toLocaleString("tr")} {stale}</span>
      <button className="btn" type="submit">çalıştır</button>
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
            <div className="sub">radarın neye göre nişan aldığı — ve değişikliğin havuza maliyeti</div>
          </div>
        </div>
        <nav className="pages">
          <a className="chip" href="/">radar</a>
          <a className="chip" href="/applied">applications</a>
          <a className="chip" href="/dismissed">dismissed</a>
          <a className="chip active" href="/profile">profile</a>
        </nav>
      </header>

      {/* ── Pool health / repairs ─────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Havuz durumu</h2>
        <div className="statstrip">
          <span><b>{counts.totalJobs.toLocaleString("tr")}</b> ilan</span>
          <span><b>{counts.candidates.toLocaleString("tr")}</b> aday</span>
          <span className="src">scorer {SCORER_VERSION} · facts {EXTRACTOR_VERSION} · prompt {FIT_PROMPT_VERSION}</span>
        </div>
        <div className="impacts">
          <Impact n={counts.staleScores} what="puanlar" stale="ilan eski puanlayıcı sürümünde" task="rescore" />
          <Impact n={counts.staleFacts} what="çıkarımlar" stale="ilan çıkarım bekliyor" task="facts" />
          <Impact n={counts.missingVectors} what="vektörler" stale="ilan vektörsüz" task="embed" />
          <Impact n={counts.staleJudgments} what="hükümler" stale="hüküm eski prompt sürümünde" task="fit" />
          {counts.visaDrift > 0 && (
            <form action={retierVisa} className="impact">
              <span className="stale">{counts.visaDrift} satırda vize kademesi sapmış (örneklemde)</span>
              <button className="btn" type="submit">yeniden hesapla</button>
            </form>
          )}
        </div>
      </section>

      {/* ── CV ────────────────────────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">CV</h2>
        {generatedProfileStale && (
          <p className="warn">
            ⚠ Profil, şu ankinden farklı bir CV'den üretilmiş — track'ler eski hedefe nişan alıyor olabilir.
          </p>
        )}
        <p className="hint">
          Kaynak: <code>{CV_PATH}</code> · {cvLines.length} satır · yalnızca bu makinede.
          Değiştirmek için: <code>npm run cv:import -- &quot;yol/CV.pdf&quot;</code>
        </p>
        <details className="cover">
          <summary>CV metnini göster</summary>
          <pre>{CV_CONTEXT.slice(0, 4000)}</pre>
        </details>
        <p className="hint">
          CV değişince <b>fit hükümleri ve vektörler bayatlar, çıkarılmış gerçekler bayatlamaz</b> —
          yeniden yargılama ve vektörleme yukarıdaki panelden başlatılır.
        </p>
      </section>

      {/* ── Tracks ────────────────────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Track&apos;ler ({profile.tracks.length})</h2>
        <p className="hint">
          Sıra önemli: eşit puanda <b>üstteki track kazanır</b>, o yüzden en özelden genele doğru dizin.
          Değişiklik puanlamayı etkiler → üstteki &quot;yeniden puanla&quot;yı çalıştırın.
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
                  {t.key.startsWith("general-") && <span className="badge">yakalama ağı</span>}
                </p>
                <label className="fieldrow">
                  <span>başlık kelimeleri</span>
                  <input className="inp" name="titleKeywords" defaultValue={t.titleKeywords.join(", ")} />
                </label>
                <label className="fieldrow">
                  <span>gövde kelimeleri</span>
                  <input className="inp" name="bodyKeywords" defaultValue={t.bodyKeywords.join(", ")} />
                </label>
                <div className="fieldrow2">
                  <label><span>seviye: istenen</span>
                    <input className="inp" name="boost" defaultValue={(t.seniority?.boost ?? band.boost).join(", ")} />
                  </label>
                  <label><span>seviye: kaçınılan</span>
                    <input className="inp" name="avoid" defaultValue={(t.seniority?.avoid ?? band.avoid).join(", ")} />
                  </label>
                </div>
              </div>
              <div className="actions">
                <button className="btn act" type="submit">kaydet</button>
                <button className="btn quiet" formAction={moveTrack} name="dir" value="up" disabled={i === 0}>▲</button>
                <button className="btn quiet" formAction={moveTrack} name="dir" value="down" disabled={i === profile.tracks.length - 1}>▼</button>
                <button className="btn quiet" formAction={removeTrack}>sil</button>
              </div>
            </form>
          );
        })}
        <form action={addTrack} className="job trackrow">
          <div className="jobmain">
            <div className="fieldrow2">
              <label><span>yeni track adı</span><input className="inp" name="label" placeholder="ör. Data Engineering" /></label>
              <label><span>başlık kelimeleri</span><input className="inp" name="titleKeywords" placeholder="data engineer, analytics engineer" /></label>
            </div>
          </div>
          <div className="actions"><button className="btn act" type="submit">ekle</button></div>
        </form>
      </section>

      {/* ── Judge (which model decides) ───────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Yargıç</h2>
        <p className="hint">
          İlanları hangi model değerlendirsin? Önerilen yerel model: kotası yok, ücreti yok,
          CV&apos;n bilgisayardan çıkmaz — ama 27B barındıramayan bir makine için bulut anahtarı
          da birinci sınıf seçenek. Anahtarlar <code>.env</code>&apos;de kalır; buradaki yalnızca tercih.
        </p>
        <form action={saveJudge} className="prefs">
          <label className="fieldrow">
            <span>önce denenecek</span>
            <select className="inp" name="lead" defaultValue={judge[0]?.name ?? "ollama"}>
              {judge.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.ready}>
                  {p.name}{p.model ? ` — ${p.model}` : ""}{p.ready ? "" : ` (kurulu değil: ${p.needs})`}
                </option>
              ))}
            </select>
            <em>Sıradakiler yedek kalır: biri kota yerse ya da hata verirse bir sonrakine geçilir.</em>
          </label>
          <label className="fieldrow">
            <span>yerel model</span>
            <input className="inp" name="localModel" defaultValue={settings.llm?.localModel ?? ""} placeholder="qwen3.8:27b" />
            <em>Ollama&apos;da kurulu bir model adı. Boş bırakılırsa <code>.env</code>&apos;deki OLLAMA_MODEL kullanılır.</em>
          </label>
          <label className="fieldrow chk">
            <input type="checkbox" name="localOnly" defaultChecked={(settings.llm?.disabled ?? []).includes("anthropic")} />
            <span>yalnızca yerel çalıştır</span>
            <em>Bulut sağlayıcıları tümden kapatır. Yerel model çalışmıyorsa değerlendirme durur — buluta düşmez.</em>
          </label>
          <button className="btn act" type="submit">yargıcı kaydet</button>
        </form>
      </section>

      {/* ── Preferences ───────────────────────────────────────────────── */}
      <section className="panel">
        <h2 className="grouphead">Tercihler</h2>
        <form action={savePreferences} className="prefs">
          <label className="fieldrow">
            <span>çalışma iznim olan yerler</span>
            <input className="inp" name="workAuthorization" defaultValue={profile.workAuthorization.join(", ")} placeholder="tr, eu" />
            <em>Buradaki ilanlar &quot;vize gerekmiyor&quot; sayılır; liste her yeri kapsıyorsa vize ekseni tümden kapanır.</em>
          </label>
          <label className="fieldrow">
            <span>çalışabildiğim diller</span>
            <input className="inp" name="languages" defaultValue={profile.languages.join(", ")} placeholder="en, tr" />
            <em>
              Şu an: {profile.languages.map((c) => LANG_NAMES[c] ?? c).join(", ")}. Başka bir dilde
              akıcılık şart koşan ilanlar dil-duvarı sayılır.
            </em>
          </label>
          <div className="fieldrow2">
            <label><span>seviye: istenen (genel)</span>
              <input className="inp" name="seniorityBoost" defaultValue={profile.seniorityBoost.join(", ")} />
            </label>
            <label><span>seviye: kaçınılan (genel)</span>
              <input className="inp" name="seniorityAvoid" defaultValue={profile.seniorityAvoid.join(", ")} />
            </label>
          </div>
          <label className="fieldrow">
            <span>kişisel rol dışlamaları</span>
            <input className="inp" name="extraRoleNegatives" defaultValue={(settings.extraRoleNegatives ?? []).join(", ")} placeholder="ios developer, android developer" />
            <em>Track eşleşmesi bunları ezer: &quot;Unity iOS Developer&quot; yine de kalır.</em>
          </label>
          <label className="fieldrow">
            <span>kabul edilen bölgeler</span>
            <input className="inp" name="acceptRegions" defaultValue={profile.acceptRegions.join(", ")} />
          </label>
          <label className="fieldrow">
            <span>maaş tabanı (EUR/yıl)</span>
            <input className="inp" name="salaryFloor" defaultValue={String(profile.salaryFloorEURYear)} />
          </label>
          <button className="btn act" type="submit">tercihleri kaydet</button>
        </form>
      </section>

      <p className="hint">
        Ayarlar <code>config/settings.json</code> dosyasında tutulur — elle de düzenlenebilir,
        dışa aktarılabilir, ve bu makineden hiçbir yere gönderilmez.
      </p>
    </main>
  );
}
