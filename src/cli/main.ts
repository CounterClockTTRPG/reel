#!/usr/bin/env node
// `reel`: every step of making a film is a command that reads files and writes files. Exit codes: 0 done, 1 failed,
// 2 usage, 3 a check failed, 4 would spend money without --yes.
import { Command, CommanderError } from "commander";
import { ReelError } from "../paths.js";
import { musicCommands } from "./commands/music.js";
import { recordCommands } from "./commands/record.js";
import { takeCommands } from "./commands/takes.js";
import { checkCommands } from "./commands/check.js";
import { cutCommands } from "./commands/cut.js";
import { voiceCommands } from "./commands/voice.js";
import { output, type Output } from "./output.js";

const program = new Command("reel")
  .description("Narrated tour and tutorial videos of web applications, from scripts")
  .option("--json", "print one JSON document (for scripts and Claude sessions)")
  .exitOverride();

const out = (): Output => output(Boolean(program.opts().json));

musicCommands(program, out);
recordCommands(program, out);
takeCommands(program, out);
checkCommands(program, out);
cutCommands(program, out);
voiceCommands(program, out);

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (e instanceof CommanderError) process.exit(e.exitCode === 0 ? 0 : 2);
  const code = e instanceof ReelError ? e.code : 1;
  const message = e instanceof Error ? e.message : String(e);
  if ((e as { reported?: boolean }).reported) process.exit(code);
  if (program.opts().json) process.stdout.write(`${JSON.stringify({ error: message, code, ...(e as ReelError).details }, null, 2)}\n`);
  else process.stderr.write(`reel: ${message}\n`);
  if (!(e instanceof ReelError)) process.stderr.write(`${(e as Error)?.stack ?? ""}\n`);
  process.exit(code);
}
