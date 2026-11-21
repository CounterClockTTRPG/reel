import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Caption, type TakeView } from "../api";
import { JobLog, useJobs } from "../components/JobPanel";
import { errorText, useLoad, when } from "../hooks";

const secs = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** A scene's captions as frames on a strip, in the order they come up. */
function Strip({ captions }: { captions: Caption[] }) {
  if (!captions.length) return <p className="muted small" style={{ padding: "0 14px 12px" }}>No captions in this scene.</p>;
  return (
    <div className="strip">
      <div className="frames">
        {captions.map((c) => (
          <figure className="frame" key={c.n} style={{ margin: 0 }}>
            {c.frame ? <img src={c.frame} alt={`Frame at caption ${c.n + 1}: ${c.caption}`} loading="lazy" /> : <div className="blank" title="Run the privacy check for the frames" />}
            <figcaption>
              <div className="meta"><span>{c.n + 1}</span><span>{secs(c.t)} into the scene</span></div>
              <div className="line">{c.label && <b>{c.label}: </b>}{c.caption}</div>
              {c.spoken !== c.caption && <div className="spoken">Spoken: {c.spoken}</div>}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function SceneReview({ scene, n, data, onReview, onRetake }: {
  scene: TakeView["scenes"][number];
  n: number;
  data: TakeView;
  onReview: (state: "approved" | "flagged" | null, note?: string) => Promise<void>;
  onRetake: () => void;
}) {
  const review = data.review.scenes[scene.id];
  const [note, setNote] = useState(review?.note ?? "");
  const [flagging, setFlagging] = useState(false);
  const stale = data.stale.includes(scene.id);
  return (
    <article className={`scene ${review?.state ?? ""}`} aria-label={`Scene ${scene.id}`}>
      <header>
        <div>
          <b>{n}. {scene.title ?? scene.id}</b> <span className="muted small">{scene.chapter}, {scene.duration.toFixed(1)} s</span>
          {review && <span className={`status ${review.state}`} style={{ marginLeft: 10 }}>{review.state}{review.note ? `: ${review.note}` : ""}</span>}
          {stale && <span className="status stale" style={{ marginLeft: 10 }}>stale: its script changed, or a scene it needs was retaken</span>}
          {!scene.exists && <span className="status stale" style={{ marginLeft: 10 }}>no longer in the script</span>}
        </div>
        <div className="row">
          <button aria-label={`${review?.state === "approved" ? "Unapprove" : "Approve"} ${scene.id}`} onClick={() => onReview(review?.state === "approved" ? null : "approved")}>{review?.state === "approved" ? "Unapprove" : "Approve"}</button>
          <button className="danger" aria-label={`Flag ${scene.id}`} onClick={() => setFlagging(!flagging)}>Flag</button>
          <button aria-label={`Retake ${scene.id}`} onClick={onRetake}>Retake</button>
        </div>
      </header>
      {flagging && (
        <div className="row" style={{ padding: "0 14px 12px" }}>
          <input aria-label={`Why flag ${scene.id}`} style={{ flex: 1 }} placeholder="What's wrong (for the retake)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="danger" onClick={() => onReview("flagged", note).then(() => setFlagging(false))}>Flag for a retake</button>
        </div>
      )}
      <Strip captions={data.captions.filter((c) => c.scene === scene.id)} />
    </article>
  );
}

function Checks({ data }: { data: TakeView }) {
  const { privacy, loudness } = data;
  return (
    <div className="grid2">
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Privacy</h3>
        {!privacy && <p className="muted">Not checked yet.</p>}
        {privacy?.ok && <p><span className="status ok">No private strings</span> <span className="muted small">in {privacy.frames} frames, {privacy.strings} strings</span></p>}
        {privacy && !privacy.ok && (
          <>
            <p className="status failed">{privacy.hits.length} private strings on screen</p>
            {privacy.hits.map((h, i) => (
              <figure key={i} style={{ margin: "8px 0" }}>
                <img src={h.url} alt={`"${h.match}" in scene ${h.scene}`} style={{ width: "100%", borderRadius: 4 }} />
                <figcaption className="small">Scene {h.scene} at {h.t.toFixed(1)} s: "{h.match}"</figcaption>
              </figure>
            ))}
          </>
        )}
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Loudness</h3>
        {!loudness && <p className="muted">Not mixed yet.</p>}
        {loudness && (
          <>
            <p><span className={`status ${loudness.ok ? "ok" : "failed"}`}>{loudness.ok ? "The voice is clearly louder" : "The music is too loud"}</span></p>
            <p className="small">Speech {loudness.speechLufs} LUFS; music alone at most {loudness.musicOnlyMaxLufs ?? "–"} LUFS: {loudness.margin ?? "–"} dB apart ({loudness.required} wanted).</p>
            {loudness.stretches.map((s, i) => <div key={i} className="small status failed">{secs(s.from)}–{secs(s.to)}: {s.lufs} LUFS</div>)}
          </>
        )}
      </div>
    </div>
  );
}

function Package({ data, p, m, n, onChange }: { data: TakeView; p: string; m: string; n: number; onChange: () => void }) {
  const [copied, setCopied] = useState(false);
  const pkg = data.package;
  const description = pkg ? `${pkg.description}` : "";
  const thumb = pkg?.files.find((f) => f.name === "thumbnail.png");
  return (
    <div className="grid2">
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Description</h3>
        {!pkg && <p className="muted">Not packaged yet: Make the take.</p>}
        {pkg && (
          <>
            <textarea aria-label="Description" rows={12} readOnly value={description} className="code" />
            <button onClick={() => navigator.clipboard.writeText(description).then(() => setCopied(true))}>{copied ? "Copied" : "Copy the description"}</button>
          </>
        )}
      </div>
      <div className="panel">
        {thumb && <img src={thumb.url} alt="Thumbnail" style={{ width: "100%", borderRadius: 4 }} />}
        <h3>Files</h3>
        <ul>{pkg?.files.filter((f) => !f.name.endsWith("-full.png")).map((f) => <li key={f.name}><a href={f.url} download>{f.name}</a></li>)}</ul>
        <h3>Status: <span className={`status ${data.review.status}`}>{data.review.status}</span></h3>
        <div className="row">
          {data.review.status !== "approved" && <button className="primary" onClick={() => api.takeStatus(p, m, n, "approved").then(onChange)}>Approve the take</button>}
          {data.review.status === "approved" && <button className="gold" onClick={() => api.takeStatus(p, m, n, "published").then(onChange)}>Mark as published</button>}
          {data.review.status !== "draft" && <button onClick={() => api.takeStatus(p, m, n, "draft").then(onChange)}>Back to draft</button>}
        </div>
      </div>
    </div>
  );
}

export function TakePage() {
  const { p = "", m = "", n = "0" } = useParams();
  const num = Number(n);
  const take = useLoad(() => api.take(p, m, num), [p, m, num]);
  const [problem, setProblem] = useState("");
  const jobs = useJobs(() => take.reload());
  if (take.error) return <div className="notice">{take.error}</div>;
  const data = take.data;
  if (!data) return null;
  const flagged = Object.values(data.review.scenes).filter((s) => s.state === "flagged").length;
  const approved = Object.values(data.review.scenes).filter((s) => s.state === "approved").length;
  const review = (scene: string) => (state: "approved" | "flagged" | null, note?: string) =>
    api.review(p, m, num, scene, state, note).then(take.reload, (e) => setProblem(errorText(e)));

  return (
    <>
      <div className="crumbs"><Link to="/">Studio</Link> / <Link to={`/p/${p}`}>{p}</Link> / <Link to={`/p/${p}/m/${m}`}>{m}</Link></div>
      <div className="head">
        <div>
          <h1>Take {num}</h1>
          <div className="muted small">Made {when(data.take.made)}; {approved} of {data.scenes.length} scenes approved{flagged ? `, ${flagged} flagged` : ""}</div>
        </div>
        <div className="row">
          {!data.steps.checked && <button onClick={() => jobs.start("check", `${p}/${m}/${num}`)}>Check for private data</button>}
          <button onClick={() => jobs.start("record", `${p}/${m}`, { flagged: true })} disabled={!flagged}>Retake flagged</button>
        </div>
      </div>
      {problem && <div className="notice">{problem}</div>}
      <JobLog {...jobs} />

      {data.video && (
        <video controls preload="metadata" src={data.video}>
          {data.chaptersVtt && <track kind="chapters" src={data.chaptersVtt} default label="Chapters" />}
        </video>
      )}
      {!data.video && <div className="notice info">Not cut yet. The frames below are from the recordings; Make the take for the finished video.</div>}

      <h2>Scenes</h2>
      {data.scenes.map((s, i) => (
        <SceneReview key={`${s.id}-${s.recording}`} scene={s} n={i + 1} data={data} onReview={review(s.id)}
          onRetake={() => jobs.start("record", `${p}/${m}`, { scenes: [s.id] })} />
      ))}

      <h2>Checks</h2>
      <Checks data={data} />

      <h2>YouTube package</h2>
      <Package data={data} p={p} m={m} n={num} onChange={take.reload} />
    </>
  );
}
