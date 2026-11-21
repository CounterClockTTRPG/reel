import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type StudioView } from "../api";
import { errorText, when } from "../hooks";

/** Every project and its missions, each with where its latest take stands. */
export function Studio({ studio, error, onChange }: { studio: StudioView | null; error: string | null; onChange: () => void }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ key: "", name: "", base: "" });
  const [problem, setProblem] = useState("");
  if (error) return <div className="notice">{error}</div>;
  if (!studio) return null;

  const add = async () => {
    try {
      await api.newProject({ key: form.key, name: form.name || undefined, base: form.base });
      onChange();
      navigate(`/p/${form.key}`);
    } catch (e) {
      setProblem(errorText(e));
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Studio</h1>
          <div className="muted small">{studio.dir}</div>
        </div>
        <button onClick={() => setAdding(!adding)}>New project</button>
      </div>
      {adding && (
        <div className="panel row" style={{ marginBottom: 18 }}>
          <input aria-label="Key" placeholder="key (e.g. guild)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          <input aria-label="Name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input aria-label="Address" placeholder="http://localhost:3000" value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} />
          <button className="primary" onClick={add} disabled={!form.key || !form.base}>Create project</button>
          {problem && <span className="status failed">{problem}</span>}
        </div>
      )}
      {studio.projects.length === 0 && <p>No projects yet. Create one, or run <code>reel new project</code>.</p>}
      {studio.projects.map((p) => (
        <section key={p.key}>
          <h2><Link to={`/p/${p.key}`}>{p.name}</Link> <span className="muted small">{p.base}</span></h2>
          <table>
            <thead><tr><th>Mission</th><th>Takes</th><th>Latest take</th><th>Review</th></tr></thead>
            <tbody>
              {p.missions.length === 0 && <tr><td colSpan={4} className="muted">No missions yet.</td></tr>}
              {p.missions.map((m) => (
                <tr key={m.key}>
                  <td><Link to={`/p/${p.key}/m/${m.key}`}>{m.title}</Link>{m.error && <div className="status failed small">{m.error}</div>}</td>
                  <td>{m.takes}</td>
                  <td>{m.latest ? <Link to={`/p/${p.key}/m/${m.key}/t/${m.latest.n}`}>Take {m.latest.n}, {when(m.latest.made)}</Link> : <span className="muted">none yet</span>}</td>
                  <td>{m.latest && <TakeState take={m.latest} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

export function TakeState({ take }: { take: { status: string; flagged: number; approved: number; scenes: number; stale?: string[] } }) {
  return (
    <span className="row">
      <span className={`status ${take.status}`}>{take.status}</span>
      <span className="muted small">{take.approved} of {take.scenes} approved</span>
      {take.flagged > 0 && <span className="status flagged">{take.flagged} flagged</span>}
      {(take.stale?.length ?? 0) > 0 && <span className="status stale">{take.stale!.length} stale</span>}
    </span>
  );
}
