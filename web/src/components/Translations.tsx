import { useState } from "react";
import type { TranslationView } from "../api";
import { errorText } from "../hooks";

/** Each line the narrator says, and its translation in one language: missing, stale or done. */
export function Translations({ lang, view, onSave }: { lang: string; view: TranslationView; onSave: (key: string, text: string) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const state = (key: string) => (view.missing.includes(key) ? "missing" : view.stale.includes(key) ? "stale" : "ok");
  return (
    <section>
      <h3>{lang}: {Object.keys(view.ok).length} of {Object.keys(view.source).length} lines translated</h3>
      {problem && <div className="notice">{problem}</div>}
      <table>
        <thead><tr><th style={{ width: 110 }}>Line</th><th>Narration</th><th>Translation</th><th style={{ width: 80 }}></th></tr></thead>
        <tbody>
          {Object.entries(view.source).map(([key, text]) => {
            const current = drafts[key] ?? view.lines[key]?.text ?? "";
            const s = state(key);
            return (
              <tr key={key}>
                <td><code className="small">{key}</code><div className={`status ${s === "ok" ? "approved" : s === "stale" ? "stale" : "flagged"}`}>{s === "ok" ? "done" : s}</div></td>
                <td>{text}</td>
                <td><textarea aria-label={`${lang} ${key}`} rows={2} value={current} onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })} /></td>
                <td>
                  <button disabled={!current || (current === view.lines[key]?.text && s === "ok")}
                    onClick={() => onSave(key, current).then(() => setProblem(""), (e) => setProblem(errorText(e)))}>Save</button>
                </td>
              </tr>
            );
          })}
          {view.orphaned.map((key) => (
            <tr key={key}><td><code className="small">{key}</code><div className="status stale">orphaned</div></td><td className="muted">no longer in the script</td><td>{view.lines[key]?.text}</td><td /></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
