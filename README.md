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
| Lighting | One shadow cascade with 3×3 PCF, slope-scaled bias and texel snapping; a gradient sky with sun disc, glow and horizon haze; exposure, ACES and a saturation/split-tone grade | `npm run shot` |
| Instancing | Every box in the world — limbs, beams, barrels, roof slabs — is one instanced draw call | `npm run perf` |
| Materials | Sixteen tiles synthesised in code at startup — plaster, timber, slate, cobble, grass, rock, cloth, steel, leather, plank, thatch, skin, bark, foliage, dirt — in one array texture, sampled triplanar down the dominant axis | `npm run shot` |

Two preview framings exist alongside the four times of day:
`npm run shot -- --lineup` is a character sheet of every kit, and
`npm run shot -- --vista` looks back at the town from a ridge, which is the
framing that shows whether the distance holds up.

Next is **M3** (the worldgen tool, the in-browser placement editor, baked nav
data), then the rest of **M4/M5**: interiors you can walk into, and a
skinned mesh for the characters. The milestone table is §14 of the brief.

Two things are tied to the quality tier: shadows and material detail. Both are
nearly free on a GPU and both are expensive on a software rasteriser — one
dependent texture fetch per pixel of a screen that is mostly ground — so `low`
goes without them, and `?off=shadows` / `?off=textures` switch them off
anywhere.



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

## The frame-time probe

`npm run perf` walks a fixed route for a fixed time on a fixed seed and reports
p50/p95/p99 with the environment stapled to them. On a machine without a GPU —
CI, and the container this was built in — Chromium rasterises on the CPU
through SwiftShader, so the numbers are a regression signal and the probe says
so in its own output. The hardware budgets in §9.7 of the brief have not been
measured yet, and until they are, nothing in this repository claims a frame
rate.

## Licence and originality

MIT. Every proper noun, asset and line of code here is original — see
`docs/LEGAL.md` and `docs/GLOSSARY.md`.
