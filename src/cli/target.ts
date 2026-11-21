// Naming things on the command line: `project/mission`.
import { loadMission, loadProject, loadStudio, type Mission, type Project } from "../model/load.js";
import { ReelError } from "../paths.js";

export async function loadTarget(target: string): Promise<{ project: Project; mission: Mission }> {
  const [p, m, ...rest] = target.split("/");
  if (!p || !m || rest.length) throw new ReelError(2, `"${target}" is not a mission (project/mission)`);
  const project = await loadProject(await loadStudio(), p);
  return { project, mission: await loadMission(project, m) };
}
