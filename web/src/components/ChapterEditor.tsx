import CodeMirror from "@uiw/react-codemirror";
import { yaml as yamlMode } from "@codemirror/lang-yaml";
import { useEffect, useState } from "react";
import { parseDocument, YAMLSeq } from "yaml";
import { errorText } from "../hooks";

/** Moves scene `i` of a chapter's YAML by `by` places, keeping the rest of the file as it is. */
export function moveScene(text: string, i: number, by: number): string {
  const doc = parseDocument(text);
  const scenes = doc.get("scenes", true) as YAMLSeq;
  const j = i + by;
  if (!scenes || j < 0 || j >= scenes.items.length) return text;
  const [item] = scenes.items.splice(i, 1);
  scenes.items.splice(j, 0, item);
  return doc.toString({ lineWidth: 0 });
}

/** One chapter's scenes as YAML, with its scene list beside it to jump to and reorder. */
export function ChapterEditor({ name, text, mtimeMs, onSave }: {
  name: string;
  text: string;
  mtimeMs: number;
  onSave: (yaml: string, mtimeMs: number) => Promise<number>;
}) {
  const [value, setValue] = useState(text);
  // The text and mtime the editor last took from disk: what the owner's edits are based on.
  const [base, setBase] = useState({ text, mtimeMs });
  const [disk, setDisk] = useState<{ text: string; mtimeMs: number } | null>(null);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  const mtime = base.mtimeMs;
  useEffect(() => {
    if (text === base.text && mtimeMs === base.mtimeMs) return;
    // A new version on disk: take it when nothing was edited; otherwise keep the edits and offer both.
    if (value === base.text) {
      setValue(text);
      setBase({ text, mtimeMs });
      setDisk(null);
    } else setDisk({ text, mtimeMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mtimeMs]);
  const scenes = (() => {
    try {
      return ((parseDocument(value).toJS()?.scenes ?? []) as { id: string }[]).map((s) => s.id);
    } catch {
      return [];
    }
  })();
  const save = async (yaml = value, against = mtime) => {
    try {
      const m = await onSave(yaml, against);
      setBase({ text: yaml, mtimeMs: m });
      setValue(yaml);
      setDisk(null);
      setProblem("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setProblem(errorText(e));
    }
  };
  const line = Number(problem.match(/\.yaml:(\d+)/)?.[1] ?? 0);

  return (
    <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(200px, 1fr)", marginBottom: 24 }}>
      <div>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <code>chapters/{name}.yaml</code>
          <span className="row">
            {saved && <span className="status ok">Saved</span>}
            <button className="primary" onClick={() => save()} disabled={value === base.text && !problem}>Save chapter</button>
          </span>
        </div>
        {problem && !disk && <div className="notice">{problem}{line ? ` (line ${line})` : ""}</div>}
        {disk && (
          <div className="notice row">
            Changed on disk since you opened it; your edits are kept here.
            <button onClick={() => { setValue(disk.text); setBase(disk); setDisk(null); setProblem(""); }}>Load the version on disk</button>
            <button className="danger" onClick={() => save(value, disk.mtimeMs)}>Save mine over it</button>
          </div>
        )}
        <CodeMirror value={value} extensions={[yamlMode()]} onChange={setValue} basicSetup={{ foldGutter: false }} aria-label={`Chapter ${name}`} />
      </div>
      <div>
        <h3 style={{ marginTop: 28 }}>Scenes</h3>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          {scenes.map((id, i) => (
            <li key={id} className="row" style={{ justifyContent: "space-between" }}>
              <span>{id}</span>
              <span className="row">
                <button aria-label={`Move ${id} up`} disabled={i === 0} onClick={() => save(moveScene(value, i, -1))}>↑</button>
                <button aria-label={`Move ${id} down`} disabled={i === scenes.length - 1} onClick={() => save(moveScene(value, i, 1))}>↓</button>
              </span>
            </li>
          ))}
        </ol>
        <p className="muted small">Moving a scene saves the chapter.</p>
      </div>
    </div>
  );
}
