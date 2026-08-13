# Open questions

Unfinished thinking lives here rather than in a `TODO` nobody reads. Each entry
says what is unknown, what it blocks, and when it has to be answered.

## Answered by measurement so far

- **Does headless Chromium without a GPU render WebGL2 well enough to gate on?**
  Yes, through SwiftShader — four framings at 800×450, five draw calls, correct
  lighting. Answered at M0 by `tools/shot.mjs`.
- **Can the render gate avoid a Playwright dependency?** Yes. Chromium's own
  `--screenshot` and `--dump-dom`, plus a PNG decoder built on Node's `zlib`.

## Open, blocking a milestone

- **M1 — what is the real frame budget?** `tools/perf.mjs` exists and records
  p50/p95/p99 with the environment attached, but every number so far comes from
  SwiftShader on a CPU. They are a regression signal and nothing else. The
  hardware budgets in §9.7 of the brief remain unmeasured, and no claim about
  anyone's frame rate may be made until the probe has run on a machine with a
  GPU.
- ~~**M2 — key events through CDP without a WebSocket client.**~~ **Decided:**
  written out, in `tools/cdp.mjs`. About 150 lines of HTTP upgrade and frame
  parsing buys real `Input.dispatchKeyEvent` against the real page and keeps
  `npm install` unnecessary for the entire project — CI checks out and runs.
  The one subtlety that would have bitten later: Chrome fragments large
  evaluate results across continuation frames, so the reader stitches them
  rather than parsing a half message.
- **M3 — navmesh or grid?** A 0.5 m grid with jump links is simpler, bakeable and
  adequate for 60–80 NPCs; a real navmesh is smaller and smoother. The schedule
  validator (every routine waypoint pathable from the previous within its
  window) needs whichever it is to exist first.

## Open, not blocking anything yet

- **How dark is too dark?** Night currently reads at mean luma 18 in the gate.
  It looks right in a still. Whether it is playable is a question for a human at
  M10, and the answer will probably be a torch that is easier to get.
- **Twilight length.** The day is two real hours, which makes the twilight band
  about six real minutes. That may be too short to enjoy the best-looking hour
  of the game; consider stretching the band without stretching the day.
- **Where the difficulty option applies.** The brief says enemy damage only,
  never placement. Worth re-testing at M10 whether a ±25% band is enough for the
  people who bounce off the first wolf pack.


## Emissive things do not light their surroundings

A bolt in flight is drawn with an emissive term — one float per instance, mixed
in after the lighting — so it stays bright at midnight. It does **not** cast
light on the ground, the caster or anything it passes.

Doing that properly needs a list of point lights uploaded per frame and either
a second pass or a forward-plus tile assignment, which is a real piece of
renderer work rather than a tweak. Until it exists, a fire bolt at night is a
bright object in a dark wood rather than a moving lamp, and that is a thing to
know rather than a thing to be surprised by.
