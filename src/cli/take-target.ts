// A take named on the command line, with its project and mission loaded.
import { parseTakeRef, type TakeRef } from "../take/take.js";
import type { Mission, Project } from "../model/load.js";
import { loadTarget } from "./target.js";

export async function loadTakeTarget(target: string): Promise<{ ref: TakeRef; project: Project; mission: Mission }> {
  const ref = parseTakeRef(target);
  const { project, mission } = await loadTarget(`${ref.project}/${ref.mission}`);
  return { ref, project, mission };
}
