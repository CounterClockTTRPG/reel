import type { Command } from "commander";
import { voiceTake } from "../../sound/voice.js";
import type { Output } from "../output.js";
import { loadTakeTarget } from "../take-target.js";

export function voiceCommands(program: Command, out: () => Output) {
  program
    .command("voice <take>")
    .description("the narration of a cut take; prints what it would spend first (exit 4 without --yes)")
    .option("--yes", "spend what the estimate says")
    .option("--budget <usd>", "spend without asking when the estimate is at most this", Number)
    .option("--force", "voice a take with flagged or stale scenes (never one that failed its privacy check)")
    .action(async (target: string, o: { yes?: boolean; budget?: number; force?: boolean }) => {
      const { ref, project, mission } = await loadTakeTarget(target);
      const o2 = out();
      const r = await voiceTake(ref, project, mission, { ...o, log: o2.log });
      o2.result(
        { file: r.file, lines: r.lines.length, spent: r.spent, estimate: r.estimate },
        `Narration: ${r.file} (${r.lines.length} lines, spent $${r.spent.toFixed(4)})`,
      );
    });
}
