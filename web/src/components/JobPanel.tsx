import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Job } from "../api";
import { errorText } from "../hooks";

/** Starts jobs on a mission and follows the running one's log. */
export function useJobs(onEnd: (job: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const source = useRef<EventSource | null>(null);
  useEffect(() => () => source.current?.close(), []);

  const start = async (kind: string, target: string, args: Record<string, unknown> = {}) => {
    setProblem("");
    try {
      const started = await api.startJob(kind, target, args);
      setJob(started);
      setLines([]);
      source.current?.close();
      const es = new EventSource(`/api/jobs/${started.id}/log`);
      source.current = es;
      es.onmessage = (e) => setLines((l) => [...l, JSON.parse(e.data)]);
      es.addEventListener("end", (e) => {
        const ended = JSON.parse((e as MessageEvent).data) as Job;
        setJob(ended);
        es.close();
        onEnd(ended);
      });
    } catch (e) {
      setProblem(errorText(e));
    }
  };
  return { job, lines, problem, start };
}

export function JobLog({ job, lines, problem, takeLink }: { job: Job | null; lines: string[]; problem: string; takeLink?: string }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [lines]);
  if (problem) return <div className="notice">{problem}</div>;
  if (!job) return null;
  return (
    <div style={{ margin: "14px 0" }}>
      <div className="row">
        <b>{job.kind}</b> <span className={`status ${job.status}`}>{job.status}</span>
        {job.error && <span className="status failed">{job.error}</span>}
        {job.status === "ok" && takeLink && <Link to={takeLink}>Open the take</Link>}
      </div>
      <pre className="log" ref={box} aria-live="polite">{lines.join("\n")}</pre>
    </div>
  );
}
