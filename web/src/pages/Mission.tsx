import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Estimate } from "../api";
import { ChapterEditor } from "../components/ChapterEditor";
import { JobLog, useJobs } from "../components/JobPanel";
import { StyleForm } from "../components/StyleForm";
import { Translations } from "../components/Translations";
import { useLoad, when } from "../hooks";
import { TakeState } from "./Studio";

const TABS = ["Takes", "Script", "Style", "Translations"] as const;

function MakeDialog({ estimate, onCancel, onConfirm }: { estimate: Estimate | null | undefined; onCancel: () => void; onConfirm: (allowMissing: boolean) => void }) {
  const [allowMissing, setAllowMissing] = useState(false);
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label="Make the latest take">
      <div>
        <h2 style={{ marginTop: 0 }}>Make the latest take</h2>
        <p>Checks it for private data, cuts it, voices it, mixes it and packages it for YouTube.</p>
        {estimate ? (
          estimate.toBuy ? (
            <p>The narration buys at most <b>{estimate.toBuy} lines</b> ({estimate.characters} characters): about <b>${estimate.usd.toFixed(4)}</b>. {estimate.cached} lines are cached.</p>
          ) : <p>Every line of the narration is cached: it costs nothing.</p>
        ) : <p className="muted">No estimate: the narrator isn't in the voices library.</p>}
        <label className="row small"><input type="checkbox" checked={allowMissing} onChange={(e) => setAllowMissing(e.target.checked)} /> Package even when translations are missing</label>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onCancel}>Cancel</button>
          <button className="gold" onClick={() => onConfirm(allowMissing)}>{estimate?.toBuy ? `Make it and spend $${estimate.usd.toFixed(4)}` : "Make it"}</button>
        </div>
      </div>
    </div>
  );
}

export function MissionPage() {
  const { p = "", m = "" } = useParams();
  const mission = useLoad(() => api.mission(p, m), [p, m]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Takes");
  const [making, setMaking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const mtime = useRef<number | undefined>(undefined);
  const jobs = useJobs(() => mission.reload());
  if (mission.error) return <div className="notice">{mission.error}</div>;
  const data = mission.data;
  if (!data) return null;
  const target = `${p}/${m}`;
  const latest = data.takes?.at(-1);
  const result = jobs.job?.kind === "record" && jobs.job.status === "ok" && data.takes?.length ? `/p/${p}/m/${m}/t/${data.takes.at(-1)!.n}` : latest && jobs.job?.kind === "make" ? `/p/${p}/m/${m}/t/${latest.n}` : undefined;

  if (data.error) {
    return (
      <>
        <div className="crumbs"><Link to="/">Studio</Link> / <Link to={`/p/${p}`}>{p}</Link></div>
        <h1>{m}</h1>
        <div className="notice">This mission doesn't load: {data.error.message}</div>
        <ChapterEditor name="../mission" text={data.raw.mission.yaml} mtimeMs={data.raw.mission.mtimeMs}
          onSave={async (yaml, mt) => (await api.putMissionFile(p, m, yaml, mt).finally(mission.reload)).mtimeMs} />
        {data.raw.chapters.map((c) => (
          <ChapterEditor key={c.key} name={c.key} text={c.yaml} mtimeMs={c.mtimeMs}
            onSave={async (yaml, mt) => (await api.putChapter(p, m, c.key, yaml, mt).finally(mission.reload)).mtimeMs} />
        ))}
      </>
    );
  }
  mtime.current ??= data.mtimeMs;
  const scenes = data.chapters!.flatMap((c) => c.scenes.map((s) => s.id));

  return (
    <>
      <div className="crumbs"><Link to="/">Studio</Link> / <Link to={`/p/${p}`}>{p}</Link></div>
      <div className="head">
        <div>
          <h1>{data.file!.title}</h1>
          <div className="muted small">{scenes.length} {scenes.length === 1 ? "scene" : "scenes"} in {data.chapters!.length} {data.chapters!.length === 1 ? "chapter" : "chapters"}{data.file!.cut_waits ? ", waits cut" : ""}</div>
        </div>
        <div className="row">
          <button onClick={() => jobs.start("dry", target)}>Dry run</button>
          <button onClick={() => jobs.start("record", target, picked.length ? { scenes: picked } : {})}>{picked.length ? `Record ${picked.length} scenes` : "Record"}</button>
          <button onClick={() => jobs.start("record", target, { flagged: true })} disabled={!latest?.flagged}>Retake flagged</button>
          <button className="gold" onClick={() => setMaking(true)} disabled={!latest}>Make</button>
        </div>
      </div>
      <JobLog {...jobs} takeLink={result} />
      {making && <MakeDialog estimate={data.estimate} onCancel={() => setMaking(false)}
        onConfirm={(allowMissing) => {
          setMaking(false);
          jobs.start("make", target, { yes: true, allowMissing });
        }} />}

      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === "Takes" && (
        <>
          {!data.takes!.length && <p>No takes yet. Record the mission, or try a dry run first: it clicks through every scene without anything that costs money.</p>}
          {data.takes!.length > 0 && (
            <table>
              <thead><tr><th>Take</th><th>Made</th><th>Review</th></tr></thead>
              <tbody>
                {[...data.takes!].reverse().map((t) => (
                  <tr key={t.n}><td><Link to={`/p/${p}/m/${m}/t/${t.n}`}>Take {t.n}</Link></td><td>{when(t.made)}</td><td><TakeState take={t} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Record only some scenes</h3>
          <div className="chips">
            {scenes.map((id) => (
              <label key={id} className="chip" style={{ paddingRight: 10 }}>
                <input type="checkbox" checked={picked.includes(id)} onChange={(e) => setPicked(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))} /> {id}
              </label>
            ))}
          </div>
        </>
      )}

      {tab === "Script" && data.chapters!.map((c) => (
        <ChapterEditor key={c.key} name={c.key} text={c.yaml} mtimeMs={c.mtimeMs}
          onSave={async (yaml, mt) => (await api.putChapter(p, m, c.key, yaml, mt).finally(mission.reload)).mtimeMs} />
      ))}

      {tab === "Style" && (
        <>
          <p className="muted">This mission's style: what it inherits from the project, and what it sets itself.</p>
          <StyleForm style={data.style!} sources={data.sources!} here="mission"
            save={async (body) => {
              try {
                mtime.current = (await api.missionStyle(p, m, { ...body, mtimeMs: mtime.current })).mtimeMs;
              } finally {
                mission.reload();
              }
            }} />
        </>
      )}

      {tab === "Translations" && (
        Object.keys(data.translations!).length
          ? Object.entries(data.translations!).map(([lang, view]) => (
              <Translations key={lang} lang={lang} view={view} onSave={async (key, text) => {
                await api.putTranslation(p, m, lang, key, text);
                mission.reload();
              }} />
            ))
          : <p className="muted">The style has one language; add another under Style to translate the subtitles.</p>
      )}
    </>
  );
}
