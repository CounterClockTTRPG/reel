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
  const [mtime, setMtime] = useState(mtimeMs);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setValue(text);
    setMtime(mtimeMs);
  }, [text, mtimeMs]);
  const scenes = (() => {
    try {
      return ((parseDocument(value).toJS()?.scenes ?? []) as { id: string }[]).map((s) => s.id);
    } catch {
      return [];
    }
  })();
  const save = async (yaml = value) => {
    try {
      setMtime(await onSave(yaml, mtime));
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
            <button className="primary" onClick={() => save()} disabled={value === text && !problem}>Save chapter</button>
          </span>
        </div>
        {problem && <div className="notice">{problem}{line ? ` (line ${line})` : ""}</div>}
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
