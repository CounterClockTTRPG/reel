import type { Command } from "commander";
import { loadAdapter } from "../../adapter/load.js";
import { ReelError } from "../../paths.js";
import { listTakes, parseTakeRef, setSceneReview, setTakeStatus, staleScenes, takeRef } from "../../take/take.js";
import type { Output } from "../output.js";
import { loadTarget } from "../target.js";

export function takeCommands(program: Command, out: () => Output) {
  program
    .command("takes <mission>")
    .description("a mission's takes: status, flagged and stale scenes")
    .action(async (target: string) => {
      const { project, mission } = await loadTarget(target);
      const version = (await loadAdapter(project.file.adapter, project.dir))?.version ?? "";
      const takes = (await listTakes(project.key, mission.key)).map((t) => ({
        ...t,
        stale: staleScenes(mission, takeRef(project.key, mission.key, t.n), version),
      }));
      out().result(
        takes,
        takes.length
          ? takes.map((t) => `${t.n}  ${t.made.slice(0, 16).replace("T", " ")}  ${t.status.padEnd(9)} ${t.approved}/${t.scenes} approved` +
              `${t.flagged ? `, ${t.flagged} flagged` : ""}${t.stale.length ? `, stale: ${t.stale.join(", ")}` : ""}`).join("\n")
          : "No takes yet.",
      );
    });

  program
    .command("review <take>")
    .description("approve or flag a scene of a take (project/mission[/n]), or set the take's status")
    .option("--approve <scene>", "approve a scene")
    .option("--flag <scene>", "flag a scene for a retake")
    .option("--note <text>", "why it is flagged")
    .option("--clear <scene>", "remove a scene's review")
    .option("--status <status>", "draft, approved or published")
    .action(async (target: string, o: { approve?: string; flag?: string; note?: string; clear?: string; status?: string }) => {
      const ref = parseTakeRef(target);
      let review;
      if (o.approve) review = setSceneReview(ref, o.approve, "approved", o.note, "claude");
      if (o.flag) review = setSceneReview(ref, o.flag, "flagged", o.note, "claude");
      if (o.clear) review = setSceneReview(ref, o.clear, null, undefined, "claude");
      if (o.status) {
        if (!["draft", "approved", "published"].includes(o.status)) throw new ReelError(2, `status is draft, approved or published`);
        review = setTakeStatus(ref, o.status as "draft");
      }
      if (!review) throw new ReelError(2, "say what to review: --approve, --flag, --clear or --status");
      out().result(review, `Take ${ref.project}/${ref.mission}/${ref.n}: ${review.status}`);
    });
}
