import type { Command } from "commander";
import { scanMusic } from "../../library/music.js";
import { loadStudio } from "../../model/load.js";
import type { Output } from "../output.js";

export function musicCommands(program: Command, out: () => Output) {
  const music = program.command("music").description("the music library");
  music
    .command("scan")
    .description("add new tracks from the music root, mark vanished ones missing (moods are kept)")
    .action(async () => {
      const result = await scanMusic(await loadStudio());
      out().result(result, `${result.added.length} added${result.added.length ? `: ${result.added.join(", ")}` : ""}; ` +
        `${result.missing.length} missing${result.missing.length ? `: ${result.missing.join(", ")}` : ""}`);
    });
}
