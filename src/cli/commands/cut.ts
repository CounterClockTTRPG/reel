import type { Command } from "commander";
import { cutTake } from "../../edit/join.js";
import type { Output } from "../output.js";
import { loadTakeTarget } from "../take-target.js";

export function cutCommands(program: Command, out: () => Output) {
  program
    .command("cut <take>")
    .description("cut and join a take: waits cut or sped up, cards, transitions, chapter marks (cut.mp4, no sound)")
    .action(async (target: string) => {
      const { ref, project, mission } = await loadTakeTarget(target);
      const o = out();
      const { file, plan } = await cutTake(ref, project, mission, o.log);
      o.result({ file, total: plan.total, chapters: plan.chapters }, `Cut: ${file} (${plan.total.toFixed(1)} s, ${plan.chapters.length} chapters)`);
    });
}
