// The shape of every file in the studio and the vault. The CLI, the server and the web UI's editors all validate with
// these, so a file that loads in one loads in all of them.
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "a slug: lower case letters, digits and dashes");
const selector = z.string().min(1);

// ---- studio.yaml

export const StudioFile = z.object({
  music_root: z.string().default("~/music"),
  default_licence: z.string().default(""),
  default_attribution: z.string().default(""),
  port: z.number().int().default(7779),
  host: z.string().default("127.0.0.1"),
  allowed_hosts: z.array(z.string()).default([]),
});
export type StudioFile = z.infer<typeof StudioFile>;

// ---- style (project.yaml and mission.yaml)

export const Mask = z.union([selector, z.object({ selector, blur: z.boolean().default(false) })]);
export type Mask = z.infer<typeof Mask>;

export const Style = z.object({
  voice: z.string(),
  languages: z.array(z.string().min(2)).min(1),
  music: z.object({ moods: z.array(z.string()), loudness: z.number() }),
  loudness: z.object({ voice: z.number(), music_under: z.number(), check_margin: z.number() }),
  overlay: z.string(),
  cards: z.object({ opening: z.string(), chapter: z.string(), credits: z.string() }),
  transitions: z.object({ chapter: z.string(), card: z.string(), cut: z.string() }),
  size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  privacy: z.object({ masks: z.array(Mask), strings: z.array(z.string()) }),
});
export type Style = z.infer<typeof Style>;

/** A style as written in a file: any key may be left out (it is inherited). */
export const PartialStyle = z
  .object({
    voice: z.string(),
    languages: z.array(z.string().min(2)).min(1),
    music: z.object({ moods: z.array(z.string()), loudness: z.number() }).partial(),
    loudness: z.object({ voice: z.number(), music_under: z.number(), check_margin: z.number() }).partial(),
    overlay: z.string(),
    cards: z.object({ opening: z.string(), chapter: z.string(), credits: z.string() }).partial(),
    transitions: z.object({ chapter: z.string(), card: z.string(), cut: z.string() }).partial(),
    size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    privacy: z.object({ masks: z.array(Mask), strings: z.array(z.string()) }).partial(),
  })
  .partial()
  .strict();
export type PartialStyle = z.infer<typeof PartialStyle>;

// ---- project.yaml

export const ProjectFile = z
  .object({
    name: z.string().min(1),
    adapter: z.string().optional(),
    /** Settings for the adapter (its seeding, say), checked by the adapter's own schema. */
    adapter_options: z.record(z.string(), z.unknown()).optional(),
    app: z
      .object({
        base: z.string().url().optional(),
        auth: z.enum(["token", "login", "none"]).default("none"),
        local_storage: z.record(z.string(), z.string()).default({}),
        /** Reel starts the app itself, with its data in the vault (see src/app/serve.ts). */
        serve: z
          .object({
            command: z.array(z.string()).min(1),
            cwd: z.string().optional(),
            port: z.number().int().min(1024).max(65535),
            env: z.record(z.string(), z.string()).default({}),
            ready: z.string().default("/"),
            token_file: z.string().optional(),
            timeout: z.number().positive().default(60),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((a) => a.base || a.serve, "app needs a base address, or a serve block Reel starts it with")
      .transform((a) => ({ ...a, base: a.base ?? `http://127.0.0.1:${a.serve!.port}` })),
    style: PartialStyle.default({}),
  })
  .strict();
export type ProjectFile = z.infer<typeof ProjectFile>;

// ---- steps

/** The keys any step may carry besides its action. */
export const STEP_COMMON_KEYS = ["optional", "if", "unless", "seat", "as"] as const;
const common = {
  optional: z.boolean().optional(),
  if: selector.optional(),
  unless: selector.optional(),
  seat: z.string().optional(),
  as: z.string().optional(),
};

const target = z.object({ target: selector });

/** The arguments of each core step. A step written as a bare string (`- uncard`) has no arguments. */
export const CORE_STEP_ARGS = {
  goto: z.string(),
  navigate: z.string(),
  click: z.union([selector, target.extend({ rest: z.number().optional(), after: z.number().optional() })]),
  hover: z.union([selector, target]),
  type: target.extend({ text: z.string(), delay: z.number().optional() }),
  scroll: z.union([z.number(), z.object({ dy: z.number(), target: selector.optional(), duration: z.number().optional() })]),
  zoom: target.extend({ notches: z.number().int() }),
  say: z.union([
    z.string(),
    z.object({
      text: z.string(),
      label: z.string().optional(),
      spoken: z.string().optional(),
      spot: selector.optional(),
      place: z.enum(["bottom", "top"]).optional(),
      hold: z.number().optional(),
      keep: z.boolean().optional(),
    }).strict(),
  ]),
  unsay: z.null(),
  card: z.object({ title: z.string(), text: z.string().optional(), hold: z.number().optional() }).strict(),
  uncard: z.null(),
  spot: selector,
  "wait-for": z.union([selector, target.extend({ state: z.enum(["visible", "hidden", "attached"]).optional(), timeout: z.number().optional() })]),
  pause: z.number().nonnegative(),
  mark: z.union([z.string(), z.object({ title: z.string(), note: z.string().optional() })]),
  wait: z.object({ title: z.string(), until: selector, state: z.enum(["visible", "hidden", "attached"]).optional(), timeout: z.number().optional() }),
  css: z.string(),
  select: target.extend({ value: z.string().optional(), label: z.string().optional() })
    .refine((a) => (a.value === undefined) !== (a.label === undefined), "select takes a value or a label (one of them)"),
} as const;
export type CoreStepName = keyof typeof CORE_STEP_ARGS | "parallel";

/**
 * A step: one action key (a core step, `parallel`, or an adapter step `name.step`) plus the common keys. Its action's
 * arguments are checked by `checkStep` (core) or by the adapter when it is loaded (adapter steps).
 */
export type Step =
  | string
  | ({ [action: string]: unknown } & { optional?: boolean; if?: string; unless?: string; seat?: string; as?: string });

export const StepShape: z.ZodType<Step> = z.union([
  z.string(),
  z.object(common).catchall(z.unknown()),
]);

export const Scene = z
  .object({
    id: slug,
    title: z.string().optional(),
    music: z.string().optional(),
    needs: z.array(slug).default([]),
    speed: z.number().min(2).max(4).optional(),
    steps: z.array(StepShape).min(1),
  })
  .strict();
export type Scene = z.infer<typeof Scene>;

export const ChapterFile = z
  .object({
    title: z.string(),
    text: z.string().optional(),
    setup: z.array(StepShape).default([]),
    teardown: z.array(StepShape).default([]),
    scenes: z.array(Scene).min(1),
  })
  .strict();
export type ChapterFile = z.infer<typeof ChapterFile>;

// ---- mission.yaml

export const Card = z.object({ title: z.string(), text: z.string().optional(), spoken: z.string().optional(), hold: z.number().optional() });
export type Card = z.infer<typeof Card>;

export const MissionFile = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    opening: Card,
    closing: Card.optional(),
    chapters: z.array(z.string().min(1)).min(1),
    cut_waits: z.boolean().default(false),
    interstitials: z.boolean().default(true),
    outputs: z.array(z.enum(["youtube"])).default(["youtube"]),
    style: PartialStyle.default({}),
  })
  .strict();
export type MissionFile = z.infer<typeof MissionFile>;

// ---- translations/<lang>.yaml

export const TranslationFile = z.object({
  lines: z.record(z.string(), z.object({ text: z.string(), source: z.string() })).default({}),
});
export type TranslationFile = z.infer<typeof TranslationFile>;

// ---- library

export const Track = z.object({
  id: slug,
  file: z.string(),
  title: z.string(),
  artist: z.string().default(""),
  album: z.string().optional(),
  licence: z.string().default(""),
  attribution: z.string().default(""),
  moods: z.array(z.string()).default([]),
  length: z.number().optional(),
  missing: z.boolean().optional(),
});
export type Track = z.infer<typeof Track>;

export const MusicLibrary = z.object({ tracks: z.array(Track).default([]) });
export type MusicLibrary = z.infer<typeof MusicLibrary>;

export const VoiceDef = z.object({
  provider: z.string(),
  model: z.string(),
  voice: z.string(),
  language: z.string().default("en"),
  price_per_1000: z.number().nonnegative(),
});
export type VoiceDef = z.infer<typeof VoiceDef>;

export const Voices = z.object({ voices: z.record(z.string(), VoiceDef).default({}) });
export type Voices = z.infer<typeof Voices>;

export const Transition = z.object({ kind: z.string(), length: z.number().nonnegative() });
export type Transition = z.infer<typeof Transition>;

export const Transitions = z.object({ transitions: z.record(z.string(), Transition).default({}) });
export type Transitions = z.infer<typeof Transitions>;
