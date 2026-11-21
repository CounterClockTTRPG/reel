// What a command prints: plain lines for people, or one JSON document with --json (for Claude sessions and scripts).
export interface Output {
  json: boolean;
  log(msg: string): void;
  result(data: unknown, human?: string): void;
}

export function output(json: boolean): Output {
  return {
    json,
    log: (msg) => (json ? process.stderr : process.stdout).write(`${msg}\n`),
    result(data, human) {
      if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      else if (human !== undefined) process.stdout.write(`${human}\n`);
    },
  };
}
