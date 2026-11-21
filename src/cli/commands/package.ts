import type { Command } from "commander";
import { setTranslation, sourceLines, translationStatus } from "../../i18n/translations.js";
import { effectiveStyle } from "../../model/style.js";
import { ReelError } from "../../paths.js";
import { packageTake } from "../../pub/package.js";
import type { Output } from "../output.js";
import { loadTakeTarget } from "../take-target.js";
import { loadTarget } from "../target.js";

export function packageCommands(program: Command, out: () => Output) {
  program
    .command("package <take>")
    .description("the YouTube package of a mixed take: video, subtitles per language, chapters, description, thumbnail")
    .option("--allow-missing", "package even when a language's translations are missing or stale")
    .option("--frame <seconds>", "a frame of the video for the thumbnail (default: the opening card)", Number)
    .action(async (target: string, o: { allowMissing?: boolean; frame?: number }) => {
      const { ref, project, mission } = await loadTakeTarget(target);
      const o2 = out();
      const result = await packageTake(ref, project, mission, { ...o, log: o2.log });
      o2.result(result, `Package: ${result.dir}`);
    });

  program
    .command("translations <mission>")
    .description("what is translated, stale or missing per language; --json lists the source lines to translate")
    .option("--lang <code>", "one language (default: every language of the style but the narration's)")
    .option("--set <key>", "write the translation of one line (with --text)")
    .option("--text <text>", "the translated line")
    .action(async (target: string, o: { lang?: string; set?: string; text?: string }) => {
      const { project, mission } = await loadTarget(target);
      if (o.set) {
        if (!o.lang || o.text === undefined) throw new ReelError(2, "--set needs --lang and --text");
        await setTranslation(mission, o.lang, o.set, o.text);
        out().result({ set: o.set, lang: o.lang }, `${o.lang} ${o.set}: written`);
        return;
      }
      const { style } = effectiveStyle(project, mission);
      const langs = o.lang ? [o.lang] : style.languages.slice(1);
      const source = sourceLines(mission);
      const report = Object.fromEntries(langs.map((lang) => {
        const s = translationStatus(mission, lang);
        const todo = [...s.missing, ...s.stale].map((key) => ({ key, source: source[key] }));
        return [lang, { ...s, todo }];
      }));
      out().result(report, langs.map((lang) => {
        const s = report[lang];
        return `${lang}: ${Object.keys(s.ok).length} done, ${s.stale.length} stale, ${s.missing.length} missing, ${s.orphaned.length} orphaned`;
      }).join("\n"));
    });
}
