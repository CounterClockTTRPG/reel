// Where Reel keeps things: the studio (text, the owner's git repository) and the vault (recordings, takes, caches,
// secrets; never in git). Both can be moved with REEL_STUDIO and REEL_DATA.
import { homedir } from "node:os";
import { join } from "node:path";

/** An error with the exit code it should end the command with (see the README's exit codes). */
export class ReelError extends Error {
  constructor(
    public code: 1 | 2 | 3 | 4,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ReelError";
  }
}

const expand = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export function studioDir(): string {
  return expand(process.env.REEL_STUDIO || join(homedir(), "reel-studio"));
}

export function vaultDir(): string {
  return expand(process.env.REEL_DATA || join(homedir(), ".reel"));
}

export function expandHome(p: string): string {
  return expand(p);
}

export function takeDir(project: string, mission: string, n: number): string {
  return join(vaultDir(), "takes", project, mission, String(n));
}

export function sceneDir(project: string, mission: string, scene: string, recordingId: string): string {
  return join(vaultDir(), "scenes", project, mission, scene, recordingId);
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** A language code: en, nl, pt-BR. */
export const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Project, mission and scene names are slugs: lower case, digits and dashes. */
export function assertSlug(s: string, what: string): void {
  if (!SLUG.test(s)) throw new ReelError(2, `${what} "${s}" is not a slug (lower case letters, digits and dashes)`);
}
