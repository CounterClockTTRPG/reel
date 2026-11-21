import { api } from "../api";
import { useLoad, when } from "../hooks";

const usd = (n: number) => `$${n.toFixed(4)}`;

/** What the narration has cost: in all, by project and mission, and the latest calls. */
export function Spend() {
  const spend = useLoad(() => api.spend(), []);
  if (!spend.data) return null;
  const { data } = spend;
  return (
    <>
      <h1>Spend</h1>
      <p><span style={{ fontFamily: "var(--serif)", fontSize: "2rem" }}>{usd(data.total)}</span> <span className="muted">on {data.lines} spoken lines; cached lines cost nothing again.</span></p>
      <div className="grid2">
        <table>
          <thead><tr><th>Project</th><th>Lines</th><th>Spent</th></tr></thead>
          <tbody>{Object.entries(data.byProject).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.lines}</td><td>{usd(v.usd)}</td></tr>)}</tbody>
        </table>
        <table>
          <thead><tr><th>Mission</th><th>Lines</th><th>Spent</th></tr></thead>
          <tbody>{Object.entries(data.byMission).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.lines}</td><td>{usd(v.usd)}</td></tr>)}</tbody>
        </table>
      </div>
      <h2>Latest calls</h2>
      {!data.recent.length && <p className="muted">Nothing spent yet.</p>}
      {data.recent.length > 0 && (
        <table>
          <thead><tr><th>When</th><th>Mission</th><th>Line</th><th>Characters</th><th>Cost</th></tr></thead>
          <tbody>
            {data.recent.map((e, i) => (
              <tr key={i}><td className="small">{when(e.at)}</td><td>{e.project}/{e.mission}{e.take ? ` take ${e.take}` : ""}</td><td className="small">{e.text}</td><td>{e.characters}</td><td>{usd(e.usd)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
