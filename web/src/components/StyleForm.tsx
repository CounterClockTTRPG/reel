import { useEffect, useState } from "react";
import { api, type Mask, type Source, type Style } from "../api";
import { errorText, useLoad } from "../hooks";

type Save = (body: { set?: Record<string, unknown>; unset?: string[] }) => Promise<void>;

/** Where a value comes from, and (when it is set here) a way back to the inherited one. */
function SourceBadge({ source, here, onReset }: { source: Source | undefined; here: Source; onReset: () => void }) {
  const text = source === "mission" ? "this mission" : source === "project" ? (here === "project" ? "this project" : "the project") : "default";
  return (
    <span className="source">
      <span className={`source ${source}`}>{text}</span>
      {source === here && <button className="small" style={{ marginLeft: 6, padding: "1px 8px" }} onClick={onReset}>Reset</button>}
    </span>
  );
}

function ListEditor({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [next, setNext] = useState("");
  return (
    <div className="chips">
      {values.map((v) => (
        <span className="chip" key={v}>{v}<button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button></span>
      ))}
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && next.trim()) {
            onChange([...values, next.trim()]);
            setNext("");
          }
        }}
      />
    </div>
  );
}

function Select({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  const all = options.includes(value) || !value ? options : [value, ...options];
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {all.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function NumberField({ value, onChange, label, step = 1 }: { value: number; onChange: (v: number) => void; label: string; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input aria-label={label} type="number" step={step} value={text} style={{ width: 100 }} onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== String(value) && Number.isFinite(Number(text)) && onChange(Number(text))} />
  );
}

/**
 * A project's style (here = "project") or a mission's overrides of it (here = "mission"). Each change is saved at
 * once; a value set here can be reset to what it inherits.
 */
export function StyleForm({ style, sources, here, save }: { style: Style; sources: Record<string, Source>; here: Source; save: Save }) {
  const voices = useLoad(() => api.voices(), []);
  const effects = useLoad(() => api.effects(), []);
  const music = useLoad(() => api.music(), []);
  const [problem, setProblem] = useState("");
  const put = (path: string, value: unknown) => save({ set: { [path]: value } }).then(() => setProblem(""), (e) => setProblem(errorText(e)));
  const reset = (...paths: string[]) => save({ unset: paths }).then(() => setProblem(""), (e) => setProblem(errorText(e)));
  const fx = effects.data;
  const row = (label: string, paths: string[], control: React.ReactNode) => (
    <div className="field" key={label}>
      <label>{label}</label>
      <div className="row">{control}</div>
      <SourceBadge source={paths.map((p) => sources[p]).find((s) => s === here) ?? sources[paths[0]]} here={here} onReset={() => reset(...paths)} />
    </div>
  );
  const masks = style.privacy.masks.map((m: Mask) => (typeof m === "string" ? m : m.selector));

  return (
    <div className="panel">
      {problem && <div className="notice">{problem}</div>}
      {row("Narrator", ["voice"], <Select label="Narrator" value={style.voice} options={Object.keys(voices.data ?? {})} onChange={(v) => put("voice", v)} />)}
      {row("Languages", ["languages"], <ListEditor values={style.languages} placeholder="add a language (nl)" onChange={(v) => v.length && put("languages", v)} />)}
      {row("Music moods", ["music.moods"], (
        <>
          <ListEditor values={style.music.moods} placeholder="add a mood" onChange={(v) => put("music.moods", v)} />
          {music.data && <span className="muted small">in the library: {music.data.moods.join(", ") || "none yet"}</span>}
        </>
      ))}
      {row("Music loudness (LUFS)", ["music.loudness"], <NumberField label="Music loudness" value={style.music.loudness} onChange={(v) => put("music.loudness", v)} />)}
      {row("Voice loudness (LUFS)", ["loudness.voice"], <NumberField label="Voice loudness" value={style.loudness.voice} onChange={(v) => put("loudness.voice", v)} />)}
      {row("Music under speech (dB)", ["loudness.check_margin"], <NumberField label="Check margin" value={style.loudness.check_margin} onChange={(v) => put("loudness.check_margin", v)} />)}
      {row("Overlay", ["overlay"], <Select label="Overlay" value={style.overlay} options={fx?.overlays ?? []} onChange={(v) => put("overlay", v)} />)}
      {row("Cards", ["cards.opening", "cards.chapter", "cards.credits"], (
        <>
          {(["opening", "chapter", "credits"] as const).map((k) => (
            <label key={k} className="small muted">{k} <Select label={`${k} card`} value={style.cards[k]} options={fx?.cards ?? []} onChange={(v) => put(`cards.${k}`, v)} /></label>
          ))}
        </>
      ))}
      {row("Transitions", ["transitions.chapter", "transitions.card", "transitions.cut"], (
        <>
          {(["chapter", "card", "cut"] as const).map((k) => (
            <label key={k} className="small muted">{k} <Select label={`${k} transition`} value={style.transitions[k]} options={Object.keys(fx?.transitions ?? {})} onChange={(v) => put(`transitions.${k}`, v)} /></label>
          ))}
        </>
      ))}
      {row("Picture size", ["size"], (
        <>
          <NumberField label="Width" value={style.size.width} onChange={(v) => put("size", { ...style.size, width: v })} /> ×
          <NumberField label="Height" value={style.size.height} onChange={(v) => put("size", { ...style.size, height: v })} />
        </>
      ))}
      {row("Hidden while recording", ["privacy.masks"], <ListEditor values={masks} placeholder="add a selector" onChange={(v) => put("privacy.masks", v)} />)}
      {row("Private strings", ["privacy.strings"], <ListEditor values={style.privacy.strings} placeholder="add a name, email, path" onChange={(v) => put("privacy.strings", v)} />)}
    </div>
  );
}
