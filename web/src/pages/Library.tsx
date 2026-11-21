import { useState } from "react";
import { NavLink, useParams } from "react-router";
import { api, isApiError, type Track } from "../api";
import { errorText, useLoad } from "../hooks";

function MoodEditor({ track, onSave }: { track: Track; onSave: (moods: string[]) => Promise<void> }) {
  const [next, setNext] = useState("");
  return (
    <div className="chips">
      {track.moods.map((m) => (
        <span className="chip" key={m}>{m}<button aria-label={`Remove ${m} from ${track.title}`} onClick={() => onSave(track.moods.filter((x) => x !== m))}>×</button></span>
      ))}
      <input aria-label={`Add a mood to ${track.title}`} placeholder="mood" size={8} value={next} onChange={(e) => setNext(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && next.trim()) onSave([...track.moods, next.trim()]).then(() => setNext(""));
        }} />
    </div>
  );
}

function Music() {
  const music = useLoad(() => api.music(), []);
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState("");
  const [scanned, setScanned] = useState("");
  if (music.error) return <div className="notice">{music.error}</div>;
  if (!music.data) return null;
  const q = query.toLowerCase();
  const tracks = music.data.tracks.filter((t) => !q || `${t.title} ${t.artist} ${t.moods.join(" ")}`.toLowerCase().includes(q));
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input aria-label="Search tracks" placeholder="Search title, artist, mood" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={() => api.scanMusic().then((r) => {
          setScanned(`${r.added.length} added, ${r.missing.length} missing`);
          music.reload();
        }, (e) => setProblem(errorText(e)))}>Scan {music.data.root}</button>
        {scanned && <span className="muted small">{scanned}</span>}
      </div>
      {problem && <div className="notice">{problem}</div>}
      {!music.data.tracks.length && <p>The library is empty. Scan the music folder to add its tracks, then give them moods.</p>}
      <table>
        <thead><tr><th>Track</th><th>Moods</th><th>Licence</th><th>Used by</th><th></th></tr></thead>
        <tbody>
          {tracks.map((t) => (
            <tr key={t.id}>
              <td><b>{t.title}</b><div className="muted small">{t.artist}{t.length ? `, ${Math.round(t.length)} s` : ""}</div>{t.missing && <div className="status failed small">file missing</div>}</td>
              <td><MoodEditor track={t} onSave={(moods) => api.editTrack(t.id, { moods }).then(music.reload, (e) => setProblem(errorText(e)))} /></td>
              <td className="small">{t.licence}<div className="muted">{t.attribution}</div></td>
              <td className="small">{t.usedBy.join(", ")}</td>
              <td>{!t.missing && <audio controls preload="none" src={`/api/library/music/${t.id}/audio`} style={{ width: 220 }} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Voices() {
  const voices = useLoad(() => api.voices(), []);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<{ name: string; usd: number } | null>(null);
  const [problem, setProblem] = useState("");
  const hear = (name: string, yes = false) =>
    api.sample(name, yes).then(
      (r) => setSamples({ ...samples, [name]: `${r.url}?t=${Date.now()}` }),
      (e) => {
        if (isApiError(e) && e.status === 402) setAsking({ name, usd: (e.details?.estimate as { usd: number }).usd });
        else setProblem(errorText(e));
      },
    );
  if (!voices.data) return null;
  return (
    <>
      {problem && <div className="notice">{problem}</div>}
      {asking && (
        <div className="notice info row">
          A sample of {asking.name} costs ${asking.usd.toFixed(4)}.
          <button className="gold" onClick={() => { hear(asking.name, true); setAsking(null); }}>Buy the sample</button>
          <button onClick={() => setAsking(null)}>Cancel</button>
        </div>
      )}
      <table>
        <thead><tr><th>Voice</th><th>Provider</th><th>Price per 1000 characters</th><th></th></tr></thead>
        <tbody>
          {Object.entries(voices.data).map(([name, v]) => (
            <tr key={name}>
              <td><b>{name}</b><div className="muted small">{v.voice}, {v.language}</div></td>
              <td className="small">{v.provider} <span className="muted">{v.model}</span></td>
              <td>${v.price_per_1000}</td>
              <td>{samples[name] ? <audio controls autoPlay src={samples[name]} /> : <button onClick={() => hear(name)}>Hear a sample</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Effects() {
  const fx = useLoad(() => api.effects(), []);
  if (!fx.data) return null;
  return (
    <div className="grid2">
      <div>
        <h3>Transitions</h3>
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Length</th><th>Preview</th></tr></thead>
          <tbody>
            {Object.entries(fx.data.transitions).map(([name, t]) => (
              <tr key={name}><td>{name}</td><td className="small">{t.kind}</td><td>{t.length} s</td>
                <td><video muted loop controls preload="none" style={{ width: 200 }} src={`/api/library/effects/transitions/${name}/preview.mp4`} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Cards</h3>
        {fx.data.cards.map((c) => (
          <figure key={c} style={{ margin: "0 0 12px" }}>
            <img src={`/api/library/effects/cards/${c}/preview.png`} alt={`The ${c} card`} style={{ width: "100%", borderRadius: 4 }} loading="lazy" />
            <figcaption className="small">{c}</figcaption>
          </figure>
        ))}
        <h3>Overlays</h3>
        <p>{fx.data.overlays.join(", ")}</p>
      </div>
    </div>
  );
}

export function Library() {
  const { tab = "music" } = useParams();
  return (
    <>
      <h1>Library</h1>
      <nav className="tabs" aria-label="Library">
        <NavLink to="/library/music">Music</NavLink>
        <NavLink to="/library/voices">Voices</NavLink>
        <NavLink to="/library/effects">Effects</NavLink>
      </nav>
      {tab === "music" && <Music />}
      {tab === "voices" && <Voices />}
      {tab === "effects" && <Effects />}
    </>
  );
}
