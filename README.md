# GRIMWARD

An open-world action-RPG in the tradition of the German RPGs of the early 2000s
— hand-placed world, no level scaling, learning points spent at trainers who
have to be found, guilds that lock each other out, NPCs who live on a clock and
notice what you take — running in a browser tab.

No engine. No framework. No build step. No binary assets: every mesh, texture,
animation and sound is generated in code.

```bash
npm start      # http://localhost:8090
npm test       # logic checks, no browser, under a second
npm run shot   # renders the canonical framings in headless Chromium and
               # asserts that something was actually drawn
```

`docs/BRIEF.md` is the full build brief — the design, the numbers and their
sources, the architecture, the five test layers and the milestone plan. It is
the specification this repository is being built against, and it is worth
reading before the code.

## Where it is

**M0 — skeleton.** Complete. What exists and is proven by a command:

| | |
| --- | --- |
| Capability gate | WebGPU / WebGL2 / audio / storage / workers / pointer-lock detection, with a real failure path for each and a readable refusal page |
| Renderer | WebGL2 backend behind a device interface, ACES tonemapping, hemisphere ambient, sun and moon key light, shader compilation that cannot fail silently |
| Loop | Fixed 60 Hz simulation, render decoupled, catch-up clamped, `?off=` switches, `F3` dev overlay with frame percentiles |
| World clock | Two-hour day, twilight, moonlight, sleep-until-hour |
| Progression | Experience curve, learning points, the melee and ranged damage formulas, combo tiers |
| Determinism | Seeded sfc32 with named sub-streams — the same seed is the same world on every machine |
| Tests | 36 logic checks (`npm test`) and a four-framing render gate (`npm run shot`) |

Next is **M1** (dev overlay, quality tiers, perf baseline) and **M2** (terrain,
collision, a character controller you can drive with real key events). The
milestone table is §14 of the brief.

## The render gate

`npm run shot` is the reason a black screen cannot be reported as progress. It
launches the Chromium already on the machine — no Playwright, no dependency —
renders four times of day, and then asks two independent questions about each:
what the page saw (draw calls, triangles, luminance range, distinct colours,
read back from the framebuffer) and what the PNG contains (decoded in Node with
`zlib`, no image library). A frame that is flat, black, or that the page and the
image disagree about fails the build.

It found two real bugs on its first day: a sky model that switched daylight off
at the horizon and photographed dusk as a single flat colour, and a ground plane
built as a cube the camera was standing inside.

## Licence and originality

MIT. Every proper noun, asset and line of code here is original — see
`docs/LEGAL.md` and `docs/GLOSSARY.md`.
