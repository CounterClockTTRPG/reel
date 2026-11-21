import type { Command } from "commander";
import { ReelError } from "../../paths.js";
import { mixTake } from "../../sound/mix.js";
import type { Output } from "../output.js";
import { loadTakeTarget } from "../take-target.js";

export function mixCommands(program: Command, out: () => Output) {
  program
    .command("mix <take>")
    .description("score and mix a voiced take by measurement, then check the loudness (exit 3 when the music is too loud)")
    .action(async (target: string) => {
      const { ref, project, mission } = await loadTakeTarget(target);
      const o = out();
      const { file, loudness } = await mixTake(ref, project, mission, o.log);
      o.result({ file, loudness }, `Mix: ${file}; speech ${loudness.speechLufs} LUFS, music-only at most ${loudness.musicOnlyMaxLufs ?? "–"} LUFS`);
      if (!loudness.ok) {
        throw Object.assign(new ReelError(3, `the music comes within ${loudness.margin} dB of the speech (at least ${loudness.required} wanted)`), { reported: o.json });
      }
    });
}
