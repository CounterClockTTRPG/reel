import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { StyleForm } from "../components/StyleForm";
import { errorText, useLoad } from "../hooks";

export function ProjectPage({ onChange }: { onChange: () => void }) {
  const { p = "" } = useParams();
  const navigate = useNavigate();
  const project = useLoad(() => api.project(p), [p]);
  const studio = useLoad(() => api.studio(), [p]);
  const mtime = useRef<number | undefined>(undefined);
  const [form, setForm] = useState({ key: "", title: "" });
  const [problem, setProblem] = useState("");
  if (project.error) return <div className="notice">{project.error}</div>;
  if (!project.data) return null;
  mtime.current ??= project.data.mtimeMs;
  const { data } = project;
  const missions = studio.data?.projects.find((x) => x.key === p)?.missions ?? [];

  const save = async (body: { set?: Record<string, unknown>; unset?: string[] }) => {
    try {
      const r = await api.projectStyle(p, { ...body, mtimeMs: mtime.current });
      mtime.current = r.mtimeMs;
    } finally {
      project.reload();
    }
  };
  const addMission = async () => {
    try {
      await api.newMission(p, { key: form.key, title: form.title || undefined });
      onChange();
      navigate(`/p/${p}/m/${form.key}`);
    } catch (e) {
      setProblem(errorText(e));
    }
  };

  return (
    <>
      <div className="crumbs"><Link to="/">Studio</Link></div>
      <div className="head">
        <div>
          <h1>{data.file.name}</h1>
          <div className="muted small">{data.file.app.base}, signing in with {data.file.app.auth === "none" ? "nothing" : data.file.app.auth === "token" ? "an API token" : "a saved login"}</div>
        </div>
      </div>

      <h2>Missions</h2>
      <table>
        <tbody>
          {missions.map((m) => (
            <tr key={m.key}><td><Link to={`/p/${p}/m/${m.key}`}>{m.title}</Link></td><td className="muted">{m.takes} takes</td></tr>
          ))}
          <tr>
            <td colSpan={2}>
              <div className="row">
                <input aria-label="Mission key" placeholder="key (e.g. tour)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
                <input aria-label="Mission title" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <button onClick={addMission} disabled={!form.key}>New mission</button>
                {problem && <span className="status failed">{problem}</span>}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Style</h2>
      <p className="muted">What every mission of {data.file.name} inherits. A mission can override any of it.</p>
      <StyleForm style={data.style} sources={data.sources} here="project" save={save} />

      <h2>Adapter</h2>
      {!data.adapter && <p className="muted">No adapter: the core steps only (goto, click, type, say, ...).</p>}
      {data.adapter?.error && <div className="notice">{data.adapter.error}</div>}
      {data.adapter?.name && (
        <div className="panel">
          <div><b>{data.adapter.name}</b> <span className="muted">version {data.adapter.version}</span> <span className="muted small">{data.file.adapter}</span></div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Step</th><th>Costs money</th><th>Changes state</th></tr></thead>
            <tbody>
              {data.adapter.steps?.map((s) => <tr key={s.name}><td><code>{s.name}</code></td><td>{s.costs ? "yes" : ""}</td><td>{s.changes ? "yes" : ""}</td></tr>)}
            </tbody>
          </table>
          <p className="muted small">A dry run skips the steps that cost money or change state.</p>
        </div>
      )}
    </>
  );
}
