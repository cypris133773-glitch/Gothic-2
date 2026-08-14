# GRIMWARD

An open-world action-RPG in the tradition of the German RPGs of the early 2000s
— hand-placed world, no level scaling, learning points spent at trainers who
have to be found, guilds that lock each other out, NPCs who live on a clock and
notice what you take — running in a browser tab.

No engine. No framework. No build step. No binary assets: every mesh, texture,
animation and sound is generated in code.

```bash
npm start          # http://localhost:8090 — walk around with WASD
npm test           # 48 logic checks, no browser, under a second
npm run shot       # renders four times of day and proves something was drawn
npm run sim        # plays the game end to end, headless, with no renderer
npm run play       # drives the real game with real key events through CDP
npm run perf       # frame-time percentiles on a fixed route
npm run check      # all three of the above
```

Nothing above needs `npm install`. There are no dependencies, runtime or
development: the render gate drives the Chromium already on the machine, and
`tools/cdp.mjs` speaks the DevTools protocol directly.

`docs/BRIEF.md` is the full build brief — the design, the numbers and their
sources, the architecture, the five test layers and the milestone plan. It is
the specification this repository is being built against, and it is worth
reading before the code.

## Where it is

**M0 (skeleton), M1 (loop and instrumentation), M2 (terrain and traversal) are
done, and M4/M5 have started: there is a town, and there are people in it.**
What exists, and the command that proves it:

| | | Proven by |
| --- | --- | --- |
| Capability gate | WebGPU / WebGL2 / audio / storage / workers / pointer lock, each with a real failure path and a readable refusal page | `npm run play` |
| Renderer | WebGL2 behind a device interface, ACES tonemapping, hemisphere ambient, sun and moon key light, aerial-perspective fog, shader compilation that cannot fail silently | `npm run shot` |
| Terrain | Seeded heightfield with authored control curves — a settlement pad and a wandering road that bend the noise rather than sit on it — slope- and altitude-blended colour, rule-based scatter | `npm test`, `npm run shot` |
| Streaming | 576 m of ground around the player in 64 m chunks, four levels of detail by ring, skirts over the seams, deep water never built, rebuilt only when the player crosses a chunk boundary | `npm test`, `npm run shot -- --vista` |
| Traversal | Capsule character with mass, acceleration, friction, gravity, jump, sneak, slope sliding, and collision against both round obstacles and oriented wall rectangles | `npm run play`, `npm test` |
| Camera | Spring arm that pulls in instantly and eases out, never enters terrain or a tree, leads the character when they move | `npm test`, `npm run play` |
| Loop | Fixed 60 Hz simulation, rendering decoupled, catch-up clamped and capped, `?off=` switches, `F3` overlay with frame percentiles | `npm run perf` |
| World clock | Two-hour day, twilight, moonlight, sleep-until-hour | `npm test` |
| Progression | Experience curve, learning points, melee and ranged damage, combo tiers — the §5 numbers with their confidence labels | `npm test` |
| Determinism | Seeded sfc32 with named sub-streams; the same seed is the same world and the same 600-tick simulation on every machine | `npm test` |
| Characters | A twenty-two part jointed humanoid — plate, tabard, pauldrons, sword — posed by a walk cycle whose phase follows distance, not time, so feet do not skate. Four kits: knight, guard, villager, smith | `npm run shot` |
| Town | Nine half-timbered houses from a grammar (stone base, jettied upper floor, timber lattice, 49° gabled roof, doors and windows), a well, market stalls, a cobbled square the terrain flattens for | `npm run shot` |
| People | Six townsfolk, three of them walking routes with a pause and a turn at each end | `npm run play` |
| Combat | The §6.2 state machine in ticks: wind-up, active, recovery, a nine-tick parry window, poise, stagger with an immunity window, knockback, combos you earn by connecting, and no way out of a swing you started | `npm test`, `npm run play` |
| Beasts | Wolves and boar out past the fields, never in town; one decision every 0.4 s, a visible tell before the lunge, and a body that drops and reaches while it winds up | `npm test` |
| Character sheet | Experience, levels, learning points on the five-band curve, weapon percentages, one-way guild oaths, and a rule that nothing can raise a number without naming its source | `npm test` |
| Conversations | A dialogue graph gated by flags, gold, guild and quest state; trainers who name a price and a ceiling; a parchment panel driven by number keys | `npm run play` |
| Quests | Told in town, advanced by doing — the stolen ore is found by walking to it, the pack is cleared by killing it | `npm test` |
| Saving | Deltas against the seed, not snapshots of the world: a played character is about 600 bytes. Versioned with a migration chain, IndexedDB with an in-memory fallback, and a corrupt save is a message rather than a broken game | `npm test`, `npm run play` |
| Lighting | One shadow cascade with 3×3 PCF, slope-scaled bias and texel snapping; a gradient sky with sun disc, glow and horizon haze; exposure, ACES and a saturation/split-tone grade | `npm run shot` |
| Instancing | Every box in the world — limbs, beams, barrels, roof slabs — is one instanced draw call | `npm run perf` |
| Ground cover | Grass tufts and stones scattered on a disc around the player, rebuilt when he walks out of the patch, swayed by a global wind field the shadow pass shares | `npm run shot -- --vista` |
| Materials | Sixteen tiles synthesised in code at startup — plaster, timber, slate, cobble, grass, rock, cloth, steel, leather, plank, thatch, skin, bark, foliage, dirt — in one array texture, sampled triplanar down the dominant axis | `npm run shot` |

Two preview framings exist alongside the four times of day:
`npm run shot -- --lineup` is a character sheet of every kit, and
`npm run shot -- --vista` looks back at the town from a ridge, which is the
framing that shows whether the distance holds up.

Next is **M3** (the worldgen tool, the in-browser placement editor, baked nav
data), then the rest of **M4/M5**: interiors you can walk into, and a
skinned mesh for the characters. The milestone table is §14 of the brief.

Three things are tied to the quality tier: shadows, material detail and ground
cover. Both are
nearly free on a GPU and both are expensive on a software rasteriser — one
dependent texture fetch per pixel of a screen that is mostly ground — so `low`
goes without them, and `?off=shadows` / `?off=textures` / `?clutter=0` switch
them off anywhere.



## The render gate

`npm run shot` is the reason a black screen cannot be reported as progress. It
launches the Chromium already on the machine — no Playwright, no dependency —
steps one browser through four times of day over the DevTools protocol, and
then asks two independent questions about each:
what the page saw (draw calls, triangles, luminance range, distinct colours,
read back from the framebuffer) and what the PNG contains (decoded in Node with
`zlib`, no image library). A frame that is flat, black, or that the page and the
image disagree about fails the build.

It found two real bugs on its first day — a sky model that switched daylight
off at the horizon and photographed dusk as a single flat colour, and a ground
plane built as a cube the camera was standing inside — and it has kept
earning it since: a settlement built on what the shading had decided was a
beach, a roof whose trigonometry was inside out, a town rendered in a snowstorm
because there was no exposure control, and a fragment shader that would not
compile for want of a precision qualifier — reported with the driver's log next
to a numbered listing of the source.

## The input harness

`npm run play` is the other half. It launches the game, waits for it to reach
the playing state, and then presses keys — real `Input.dispatchKeyEvent` calls
through the DevTools protocol, going through the browser's own focus and
dispatch. It never calls into the game to make something happen, and it never
reads input state back (the loop drains that every frame, so reading it proves
nothing); every assertion reads simulation state instead. Eighteen checks: the
character walks, stops, turns without pointer lock, strafes without turning,
sneaks slower than it runs, jumps and lands, and the camera stays behind it and
out of the hillside.

It also asserts which *way* those things go, which it did not always do. The
turn check was `Math.abs(yaw1 - yaw0) > 0.5` — a test that a turn happened, not
that it went where it was asked — and under it the right arrow turned the camera
left and D strafed left for months, green every run. The world's yaw is
`atan2(dx, dz)` and forward is `(sin yaw, cos yaw)`, so a man at yaw 0 faces +Z
and a right-handed view standing behind him has **screen right at −X**; the
mapping from a device delta to a world intent therefore needs a minus sign on
both horizontal axes, and it is the input layer's job to carry it. The checks now
measure against `cameraRight` — the same vector the renderer builds in
`lookAt` — so nothing can agree with itself into being wrong again.

## On a phone

The game is playable with two thumbs, and it got there by one decision rather
than by a port: **every touch control except the movement stick presses a key.**
A button dispatches a real `keydown`/`keyup` with the same `code` the desk
binding uses, so movement, the book, the shop, a conversation and the save slots
are all already listening for it. There is no second dispatch table to keep in
step and no `if (touch)` inside the gameplay code.

The stick is the one exception, because a thumb is analogue and a key is not:
pushing it half way walks and pushing it all the way runs, which is a distinction
the keyboard needs a modifier for. `src/core/touch.js` is the whole of it.

- Left half of the screen is a stick that is drawn where the thumb lands, not
  where a designer put it. Right half drags to look and turn.
- **Hit · Guard · Jump · Talk** sit under the right thumb; everything used less
  than once a minute (runes, locks, purses, sneak, the book's five tabs, save,
  load, mute) is behind the **☰**.
- Every list the number keys act on also answers to a tap — dialogue lines, shop
  rows, pack rows, attributes, runes, the tabs, the title menu's save slots — and
  each panel has a close cross, because Esc is not a key a phone has.
- A panel that is open stands the thumb controls down, so reaching for a line of
  dialogue does not walk you into a wall.
- The controls do not appear because the browser reports a touchscreen. They
  appear the first time somebody touches the glass, because a laptop with a
  touchscreen is a laptop. `?touch=1` forces them on a desk machine.
- A phone keeps its textures and gives up the shadow pass and the device pixel
  ratio instead (capped at 1.4): a current handset's GPU draws this world
  happily, and what it cannot afford is nine fragments per point.

`npm run play` drives all of it with real `Input.dispatchTouchEvent` calls —
sixteen of the browser checks are the touch layer, including that half a stick
is measurably a walk (1.05 m/s) and a whole one a run (5.40 m/s).
`npm run shot:phone` photographs the game at 390×844 with a device ratio of two.

## The duel harness

`npm test` runs 200 headless duels between two policies — one that holds the
attack button, one that spaces, baits and parries — and fails if the second does
not win at least 80% of them at every skill level. It is the brief's own
assertion (§13.2) and it is the reason three design decisions exist, each of
which was found by watching the harness rather than by playing:

- **A whiffed swing recovers 70% slower than a landed one.** Without it, flailing
  costs nothing but time the flailer meant to spend swinging anyway.
- **A combo has to be earned by connecting.** Chaining off a miss is free uptime.
- **A stagger grants brief immunity to being staggered again.** Without it, two
  landed hits break poise, the stagger is shorter than a swing cycle, and the
  aggressor's next blade lands before the victim can act — for ever.

Before those three, hold-the-button beat space-and-parry at every skill level.
After them the spacer wins 80–100%.

## The golden path

`npm run sim` plays the game. Not a scripted replay — a bot that steers, fights
and talks: it walks to the smith, takes the ore job, buys a lesson, walks the
north road, finds the crates, walks back, gets paid, and uses the smith's word
to get into the Watch. About twenty seconds a playthrough, and it is the only
thing that can prove the world is completable, which is why the whole simulation
was built to run without a renderer.

If the bot cannot get somewhere, that is a finding about the world, not about
the bot.

## What the validators check

`npm test` will not let content rot quietly. Every conversation must have a way
out and a door that closes behind you; every `when` clause must survive both an
empty world and a maximal one; every flag written must be read *somewhere*,
including by the world code rather than only by another conversation; every
speaker must exist; and no number anywhere can rise without naming its source —
the error for that one quotes the pillar it breaks.

## The frame-time probe

`npm run perf` walks a fixed route for a fixed time on a fixed seed and reports
p50/p95/p99 with the environment stapled to them. On a machine without a GPU —
CI, and the container this was built in — Chromium rasterises on the CPU
through SwiftShader, so the numbers are a regression signal and the probe says
so in its own output. The hardware budgets in §9.7 of the brief have not been
measured yet, and until they are, nothing in this repository claims a frame
rate.

## Deploying it

There is nothing to build. The game is `index.html`, `styles.css` and `src/` —
vanilla ES modules, zero runtime dependencies, no bundler, no binary assets — so
any static host serves it as-is, and the only thing a deployment has to get
right is not trying to compile something.

`vercel.json` says exactly that: the output directory is the repository root,
there is no build step, and the two files a player's browser must never cache
stale (`index.html` and everything under `src/`) are marked
`max-age=0, must-revalidate`. `.vercelignore` keeps `tools/`, `docs/`, `shots/`
and CI out of the upload, because they are how the game is made rather than part
of it.

To put it up the first time: import this repository at
[vercel.com/new](https://vercel.com/new), leave the framework preset on **Other**
and every build field empty, and deploy. After that every push to `main`
redeploys it. From a machine that is logged in, `npx vercel --prod` does the same
thing without GitHub.

## Licence and originality

MIT. Every proper noun, asset and line of code here is original — see
`docs/LEGAL.md` and `docs/GLOSSARY.md`.
