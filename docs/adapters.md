# Writing an adapter

Reel knows no application: the core steps (goto, click, type, say, ...) are enough to film any web page. An
**adapter** adds what is specific to one application: steps that wait for it in its own way, read its API, set its
preferences, seat other players. It is an ES module built and versioned outside Reel's repository, and a project names
it in `project.yaml`:

```yaml
adapter: ../../../reel-delve      # a path (relative to the project's folder, absolute or ~), or an installed package
```

## The module

```js
import { z } from "zod";
// import { defineAdapter } from "reel/adapter";   // types only; a plain object works too

export default {
  name: "demo",            // its steps are written demo.<step> in scripts
  version: "1.0.0",        // part of every scene's cache key: bump it when a step changes what it shows
  masks: [".account-menu"],                 // hidden while recording, in every project using the adapter
  privateStrings: ["admin@example.com"],    // searched for in every take's frames
  steps: {
    act: {
      args: z.object({ text: z.string() }),   // checked before the step runs
      costs: true,                             // calls something that costs money
      changes: true,                           // changes the application's state
      async run(ctx, { text }) {
        await ctx.stage.type("#q", text);
        await ctx.stage.click("#go");
        // A marked wait: the edit cuts it (or speeds it up) instead of showing it whole.
        await ctx.stage.wait("Waiting for the answer (cut)", () => ctx.page.locator("#answer:not(:empty)").waitFor());
        return ctx.page.locator("#answer").innerText();   // kept in the state bag with `as:`
      },
      async dry(ctx) {
        return "stub";        // what a dry run returns instead (without it, the step is skipped)
      },
    },
  },
  async init({ page, state }) {
    // before each scene's first step, on the host's page
  },
};
```

`ctx` gives the step:

- `stage`: the scene's stage, with `say`, `click`, `type`, `card`, `spot`, `wait`, `mark` and the rest. Everything it
  shows goes on the timeline.
- `page`: the Playwright page, for anything else.
- `api`: requests to the application's own API (its base URL), signed in as the recording is. Use it, not
  `page.request`: the token is only ever sent to the app's own origin.
- `seat(name)`: another seat's stage.
- `state`: the mission's state bag. `get` and `set` values that later scenes use.
- `dry`: whether this is a dry run.
- `scene`: the scene's id.
- `log(message)`: a line for the run's log.

A step that throws fails the run, naming the scene and the step. Reel saves a screenshot of the page at that point.

The fixture adapter in `tests/fixtures/adapter/index.js` is a complete example. The Delve adapter is the first real one;
it lives in its own repository.
