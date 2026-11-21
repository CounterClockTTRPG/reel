import type { Command } from "commander";
import { checkPrivacy } from "../../check/privacy.js";
import { ReelError } from "../../paths.js";
import type { Output } from "../output.js";
import { loadTakeTarget } from "../take-target.js";

export function checkCommands(program: Command, out: () => Output) {
  program
    .command("check <take>")
    .description("the privacy frame check: OCR of the take's frames against the private strings (exit 3 on a hit)")
    .action(async (target: string) => {
      const { ref, project, mission } = await loadTakeTarget(target);
      const o = out();
      const report = await checkPrivacy(ref, project, mission, o.log);
      o.result(report, report.ok
        ? `Privacy: ${report.frames} frames, no private strings`
        : `Privacy: ${report.hits.length} hits\n${report.hits.map((h) => `  scene ${h.scene} at ${h.t.toFixed(1)} s: "${h.match}" (${h.frame})`).join("\n")}`);
      if (!report.ok) throw Object.assign(new ReelError(3, `the privacy check found ${report.hits.length} private strings on screen`), { reported: true });
    });
}
