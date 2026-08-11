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

- **M1 — what is the real frame budget on this machine class?** The perf probe
  does not exist yet, so every number in §9.7 of the brief is a target and none
  is a measurement. Nothing may be claimed about frame time until `tools/perf.mjs`
  runs on hardware with a GPU.
- **M2 — key events through CDP without a WebSocket client.** The render gate
  needs no input, but the character-controller test does, and driving real key
  events means talking to the DevTools protocol. Either write a minimal
  WebSocket client (~120 lines, no dependency) or accept `playwright` as the
  single dev dependency. Decide before M2 starts; do not let it be decided by
  whichever is convenient at the time.
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
