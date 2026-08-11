# BUILD PROMPT — "GRIMWARD": a Gothic II–class open-world RPG that runs in a browser tab

> **What this file is.** A complete, self-contained build brief to hand to a
> strong coding model (Opus 5, or any peer). Paste the whole thing. It is written
> to be executed, not admired: every section either constrains a decision, fixes a
> number, or defines a test that proves the work is real.
>
> **Why it is this long.** The failure mode for "build me a AAA game" is not that
> the model writes bad code. It is that the model invents a design as it goes,
> writes six thousand lines that never ran, and reports success. Every section
> below exists to remove one of those degrees of freedom.

---

## 0. How to use this prompt

**If you are the human:** create an empty repo, paste this file into the model as
the first message, and add one line: *"Start at §14 Milestone M0. Do not skip the
Contract in §3."* Nothing else. The prompt is the spec.

**If you are the model:** read all of it before writing a line of code. Then:

1. Post the **Understanding Check** (§3.4) — 15 bullets, no code. Wait for a "go"
   if a human is present; if you are running unattended, post it anyway and
   continue, because it is what a later reader will diff your work against.
2. Execute milestones in order (§14). One milestone per commit series. Never
   start M(n+1) with M(n)'s exit criteria unmet.
3. Every claim you make about the running game must be backed by a command you
   actually ran, with its output pasted. See §3.1.

**Hard rule that overrides everything else in this document:** if a section here
conflicts with something you observe in the actual code you have written, the
code wins and you say so out loud. This document is the plan, not the territory.

---

## 1. The mission in one paragraph

Build **GRIMWARD**: a third-person, open-world, low-fantasy action-RPG in the
exact tradition of *Gothic II: Night of the Raven* (Piranha Bytes, 2003) — a
hand-placed world with no level scaling, a hostile early game, learning-point
character growth gated behind trainers who must be found and persuaded, guilds
that lock each other out, NPCs with 24-hour schedules who notice trespass and
theft, chaptered story escalation that visibly rewrites the world map, and melee
combat that is about spacing, timing and commitment rather than numbers. It runs
in a browser tab at 60 fps, from a static host, with no install and no plugin. It
looks and sounds like a game with a budget: real-time shadows, physically-plausible
lighting, a full day–night cycle with weather, procedurally authored art with a
single deliberate art direction, layered adaptive music, and animation that reads
at 60 fps. It ships with a test suite that can prove, headlessly and in CI, that
the world is completable.

Everything else in this document is that paragraph, made unambiguous.

---

## 2. Originality: what we copy and what we absolutely do not

This is a design homage, not a port. Get this wrong and the project is
undistributable, so it is section 2 and not an appendix.

**Copy freely (not protected, and the whole point):** systems, mechanics,
formulas, pacing, progression math, the *feel* of a stat threshold gating a
sword, faction exclusivity, chapter-based world escalation, NPC daily routines,
the design philosophy of a world that does not care whether you are ready.

**Never reproduce:** Piranha Bytes' assets, meshes, textures, sounds, music,
voice lines, scripts, dialogue text, map geometry, quest text, character names,
place names, or logos. Do not decompile, extract, transcode or "reference" the
original game's files. Do not fetch anything from a Gothic mod repository. Do not
name the game *Gothic* anything, and do not describe it as a remake — it is
"inspired by the 2003 German RPG tradition".

**Every proper noun in GRIMWARD is original.** Use this mapping when your instinct
reaches for the original name. If you need a name not on this list, invent one
that fits the phonology (hard consonants, short vowels, Old-Germanic feel) and
add it to `docs/GLOSSARY.md` in the same commit.

| Gothic II concept | GRIMWARD name | Notes |
| --- | --- | --- |
| Khorinis (island) | **Verath** | The island the whole game happens on |
| Khorinis (city) | **Halden** | Walled port city, ~40 named residents |
| Valley of Mines | **The Cleft** | Ore valley, late-game, orc-held |
| Jharkendar | **The Drowned Coast** | Optional mid-game region, ruins + pirates |
| Magic barrier | **the Ward** | Collapsed a year before the game opens |
| Innos / Adanos / Beliar | **Aurin / Meren / Skarn** | Fire-law / water-balance / dark-entropy |
| Paladins | **Sunblades** | Mainland order, arrive in Ch.2 |
| City militia | **the Watch** | |
| Fire mages | **the Ember Chapter** (novices, then **Emberwardens**) | |
| Mercenaries | **Freeblades**, upgraded to **Wyrmhunters** | |
| Pirates | **Tidecutters** | |
| Magic ore | **blackore** | The only metal that bites a dragon |
| Scavenger / molerat / snapper / shadowbeast | **carrion-runner / delver / ripper / shadeclaw** | |
| Orcs | **the Vharn** | Clan-organised, not comic |
| Nameless Hero | **the Warden's Man** (player, unvoiced, named by the player) | |
| Xardas | **Ossric**, the tower necromancer | |

**Licence:** ship under a licence that covers original code and generated
assets (MIT for code is fine). Put the originality statement in `README.md` and
in `docs/LEGAL.md`, verbatim from this section.

---

## 3. The Contract: how you are allowed to report progress

This is the anti-hallucination protocol. It is not optional and it is the section
most likely to be quietly dropped under context pressure. Re-read it at the start
of every milestone.

### 3.1 Evidence rules

1. **No untested claims.** You may never write "this should work", "this now
   supports", or "the game runs at 60 fps" unless the message containing that
   claim also contains the command you ran and its real output. If you did not
   run it, the sentence is "not yet verified".
2. **Every feature lands with a test in the same commit.** A commit that adds
   behaviour and no test is an incomplete commit. See §13 for which of the five
   test layers applies.
3. **Screenshots are evidence.** Visual features (lighting, shadows, weather,
   animation, UI) are proven by `npm run shot -- --scene=<name>`, which writes a
   PNG via headless Chromium. Look at the PNG you generated before claiming the
   feature works. If it is a black rectangle, say so.
4. **Perf claims come from the probe.** Frame-time claims come only from
   `npm run perf`, which reports p50/p95/p99 frame time over a fixed 30-second
   camera path, on a fixed seed. Never estimate frame time by reasoning about
   the code.
5. **Numbers come from §5 or from a measurement.** Do not invent balance numbers
   mid-file. If §5 does not fix it, add it to `src/data/` with a comment stating
   the reasoning, and reference it everywhere.
6. **When you are unsure, mark it.** Inline `// UNVERIFIED:` comments and a
   running `docs/OPEN-QUESTIONS.md`. A known unknown that is written down is
   fine. A guess presented as fact is a defect.

### 3.2 API rules — the single most common way this goes wrong

You will be writing WebGPU/WebGL2, Web Audio, IndexedDB, Pointer Lock, Gamepad
and Playwright/CDP code from memory. Memory is not good enough at this level of
detail.

- **Never invent an API surface.** Before first use of any browser API in this
  project, write a five-line probe in `tools/probe/` that calls it and prints the
  result, and run it. Only then use it in the engine.
- **Feature-detect, never assume.** `navigator.gpu`, `HTMLCanvasElement.getContext('webgl2')`,
  `AudioContext` vs `webkitAudioContext`, `requestPointerLock` returning a
  promise or not, `OffscreenCanvas`, `navigator.storage.estimate`. Every one of
  these gets a capability entry in `src/core/caps.js` and a fallback path.
- **Shaders fail loudly.** Every shader compile/link and every WebGPU pipeline
  creation checks its status and throws with the full info log. A silent black
  screen is the worst possible failure and it is entirely preventable.
- **No dependency you did not verify exists.** This project has **zero runtime
  dependencies**. Dev dependencies are limited to `playwright` (for the browser
  test harness) and nothing else. If you find yourself wanting three.js, stop —
  §9 explains why and what to do instead.

### 3.3 Scope honesty — read this before you promise anything

*Gothic II: Night of the Raven* was built by roughly 20–30 people over about two
years on top of an engine from a previous shipped game. You are one model with a
context window. Anyone who tells you the full game is a weekend is lying to you,
and if you repeat that lie in a status update you have failed the Contract.

What is genuinely achievable to a high standard, and what this prompt is
therefore scoped to:

| | Gothic II: NotR | GRIMWARD target (this prompt) |
| --- | --- | --- |
| World area | ~7–8 km² across 3 regions | **1.2–2.0 km² of dense, hand-placed world** — Halden city + surrounding valley + one dungeon-heavy region |
| Named NPCs | ~350 | **60–80 named, with real schedules** |
| Quests | ~250 | **45–60**, of which 12–15 are multi-stage and 3 have mutually exclusive resolutions |
| Chapters | 6 | **4** (Ch.1–3 full, Ch.4 as the finale) |
| Guilds | 4 + pirates | **3, mutually exclusive**, each with a distinct mid-game and its own ending beat |
| Monsters | ~60 types | **22 types**, each with a distinct read, tell and counter |
| Playtime | 60–100 h | **10–15 h for a first playthrough**, replayable across 3 guilds |

That is not a small game. It is a *finishable* game, and the systems are the
full-fat versions — nothing in §5 through §8 is a simplification. Extending
content afterwards is a data problem, not an engineering one, which is exactly
the property §11 exists to engineer for.

**If asked to cut, cut content, never systems.** A world half the size with
routines, faction consequence and honest combat is Gothic. A world twice the size
with respawning markers is not.

### 3.4 Understanding Check (post this before M0)

Fifteen bullets, no code, in your own words:

1. The one-sentence pitch, and the three things that make it *Gothic* rather than
   a generic action RPG.
2. The name of the game, island, city, and three gods.
3. Why there is no level scaling, and what replaces it as difficulty pacing.
4. The exact melee damage formula you will implement, and why non-critical hits
   are weak.
5. What a Learning Point is, where it comes from, and the two things it buys.
6. Why a player who joins the Watch can never become an Emberwarden.
7. What an NPC does at 03:00, and what happens if the player is standing in their
   bedroom at 03:00.
8. Which renderer path you will implement first, and what happens on a machine
   without it.
9. The five test layers and one example assertion from each.
10. The frame budget in milliseconds, and the three sub-budgets inside it.
11. What "no binary assets" means for textures, meshes, animation and audio.
12. Your M0 exit criterion, stated as a command someone else can run.
13. The three most likely ways this project fails, from §17.
14. What you will do when you are not sure whether a browser API behaves as you
    remember.
15. Anything in this document you believe is wrong or contradictory. (There is at
    least one judgement call you should push back on. Find it.)

---

## 4. Design pillars — the twelve things that make it Gothic

Each pillar names the feeling, the mechanism that produces it, and the test that
proves the mechanism survived contact with the codebase. If a change breaks a
pillar test, the change is wrong, not the test.

**P1 — The world does not scale to you.** Every creature and NPC has fixed stats
placed by hand. A ripper at the north bridge is lethal at level 3 and trivial at
level 18, and the difference is the entire progression fantasy.
*Test:* `content.test` asserts no spawn record references player level; `sim.test`
asserts a level-3 bot loses to the north-bridge ripper ≥90% of trials and a
level-18 bot wins ≥95%.

**P2 — Geography is the difficulty curve.** There are no invisible walls and no
"you are not high enough level" prompts. There is a road, and the things off the
road are worse. The player is *allowed* to walk into the Cleft at level 2 and
die, and one player in fifty will sneak past and steal a sword, and that is a
feature.
*Test:* pathability check — a bot can physically reach every region from spawn
without a scripted unlock; the danger-gradient probe asserts monotone increasing
threat-per-km from Halden gate outward along each of the four corridors.

**P3 — Strength is permission, not a percentage.** A weapon has a hard attribute
requirement. Under it, you cannot equip it at all. Crossing 30 STR is a *door
opening*, not a 4% DPS increase.
*Test:* every weapon has a requirement; the equip path refuses under-requirement
items; the progression sim asserts at least 9 distinct "gear doors" open across a
playthrough.

**P4 — Growth is bought, not sprinkled.** Levels give Learning Points; Learning
Points are spent at *trainers you have to find, unlock, or bribe*. You cannot
learn one-handed combat from a menu in the woods.
*Test:* no attribute or skill increase happens outside a trainer interaction, a
scripted quest reward, or a permanent-effect consumable. Enforced by a runtime
assertion in dev builds and a static check in `content.test`.

**P5 — Factions are doors that close.** Three guilds. Joining one permanently
locks the other two, changes the dialogue tree of ~30 NPCs, changes which
district you may enter armed, and changes chapter 3 entirely.
*Test:* `content.test` proves every guild-gated node is reachable by exactly the
intended guild; three golden-path sims (one per guild) complete the game.

**P6 — Chapters rewrite the world.** Advancing a chapter is a global event: new
spawn tables, new NPCs, NPCs who move house or die, new trader stock, new quests,
music changes. The world at chapter 3 is visibly not the world at chapter 1.
*Test:* world-diff snapshot per chapter — asserts ≥25 changed world facts per
chapter transition and that no chapter transition strands an active quest.

**P7 — NPCs live on a clock.** Everyone has a 24-hour routine: bed, work,
tavern, patrol. Shops close. Streets empty at night and the Watch patrols with
torches. Talking to a smith at 03:00 gets you told to come back tomorrow.
*Test:* schedule validator — every NPC's day sums to 24 h with no gaps, every
routine waypoint is pathable from the previous one within its window, and no NPC
is scheduled inside geometry.

**P8 — Property is real.** Doors lock. Chests belong to someone. Taking things in
front of a witness makes them hostile; taking things unseen is a skill check.
Drawing a weapon in the city is a crime. The Watch escalates: warning, arrest,
fight.
*Test:* crime matrix test — 12 (action × witness × district × guild) cases with
asserted outcomes; a theft with no witness never raises alarm; a theft with a
witness always does, even through a doorway with line-of-sight.

**P9 — Combat is commitment.** Attacks have wind-up, active and recovery frames.
You cannot cancel a swing. Blocking costs you the initiative. Two wolves are a
real fight. Being surrounded is death. Enemies have tells you learn to read.
*Test:* combat state-machine test asserts frame counts per weapon class,
no-cancel invariants, and that a bot spamming attack loses to a bot that spaces
and parries, ≥80% over 200 duels.

**P10 — Dialogue is a wall with doors in it.** No dialogue wheel, no moral meter.
A list of things you may say, gated by guild, chapter, items held, and things you
have been told. NPCs remember what you said. Some doors only open once.
*Test:* dialogue graph validator — no unreachable nodes, no dead ends without an
exit, every flag written is read somewhere, no node references a missing flag.

**P11 — The economy is scarce and physical.** Money is heavy in the sense that
matters: everything worth buying costs a real fraction of what the region can
give you. Traders have finite stock and finite gold, and they restock on a
chapter boundary, not a timer. Nothing respawns to be farmed.
*Test:* economy sim — over a full playthrough, total gold earned is within 15% of
the authored target curve; no trader's gold is infinite; loot tables contain no
infinite source.

**P12 — Atmosphere over spectacle.** A dark forest at night with wind, distant
wolves, and a single torch is worth more than any particle effect. Everything in
§10 serves this. When the art budget and the atmosphere disagree, atmosphere
wins.
*Test:* the shot suite renders 12 canonical framings each build; they are
compared against committed reference PNGs with a perceptual diff, and a >2%
regression fails CI (with an explicit `--bless` path for intended changes).

---

## 5. Reference numbers, with confidence labels

These are the *source* numbers from Gothic II: NotR, gathered from community
documentation. They are here so you tune against a known-good curve instead of
inventing one. **Each row is labelled.** `[V]` = corroborated by more than one
source. `[C]` = single community source, plausible, treat as a starting point.
`[D]` = our design decision, not from the original.

Never present a `[C]` number to a user as fact about the original game. Never
copy a number into code without also copying its label into the comment.

### 5.1 Progression

| Fact | Value | Label |
| --- | --- | --- |
| XP to reach level 1 | 500 | `[V]` |
| XP for each next level | previous requirement + 500 (level *n* costs 500·*n*) | `[V]` |
| Learning Points per level | 10 | `[V]` |
| HP per level | +12 | `[C]` |
| Attribute LP cost, value 10–30 | 1 LP per point | `[V]` |
| Attribute LP cost, 31–60 | 2 LP per point | `[V]` |
| Attribute LP cost, 61–90 | 3 LP per point | `[V]` |
| Attribute LP cost, 91–120 | 4 LP per point | `[V]` |
| Attribute LP cost, 121+ | 5 LP per point | `[V]` |
| Non-attribute skills (sneak, lockpick, …) | 5 LP each, one-off | `[C]` |
| Guild affiliation affects LP costs | No | `[V]` |

### 5.2 Combat math (the important one)

The original's melee model, as documented by the community:

```
normal hit:    dmg = max(5, floor((weaponDamage + STR - targetArmor - 1) / 10))
critical hit:  dmg = max(5,        weaponDamage + STR - targetArmor)          [C]
ranged normal: dmg = max(5,        weaponDamage + DEX - targetArmor - 1)      [C]
crit chance    = weapon skill %  (1H% for one-handers, 2H% for two-handers)   [V]
```

Read what that says: **a non-critical melee hit does a tenth of the damage.** The
weapon-skill percentage is therefore not a small multiplier — it is the whole
combat curve. A player at 10% one-handed is chipping; a player at 60% is a
different character with the same sword. This single asymmetry is why Gothic
combat feels like it *turns on* partway through the game, and you must reproduce
it. Do not "smooth it out" into a linear damage scale; the discontinuity is the
design.

Combo length is gated by weapon skill: `[C]`

| Skill % | Chained swings |
| --- | --- |
| 10–29% | 2 |
| 30–59% | 3 |
| 60%+ | 4 |

`[D]` **Our adjustment, stated openly:** the raw formula floors at 5 damage,
which makes early hits feel like nothing against armoured targets. We keep the
formula exactly, and we fix the *feel* in presentation (§10.5): a floored hit
plays a distinct "clang" impact, a sparks decal and zero hitstop, so the player
reads "my weapon is not good enough" instead of "the game is broken". Same math,
legible.

### 5.3 What we deliberately do differently `[D]`

Say these out loud in `docs/DESIGN-DELTAS.md` so no reviewer thinks they are bugs:

1. **Locked-on strafing is smoother.** The original's tank-adjacent movement is a
   product of 2001 controls, not of design intent. We keep commitment frames and
   lose the friction.
2. **A stamina bar does not exist**, same as the original. Attack spam is punished
   by recovery frames and enemy counters, not by a resource. Resist the urge.
3. **One save slot per character plus autosaves**, not save-anywhere-scumming.
   Autosave on region change, chapter change, and quest state change. Manual save
   anywhere except during combat and dialogue.
4. **A quest log that tells the truth** — entries record what you were told and by
   whom, never a map marker to walk to. One optional "last known location" hint
   per quest, unlocked by asking someone.
5. **Difficulty option** with three settings that change *enemy damage taken and
   dealt only* (±25%), never spawn placement, never loot. Placement is the game.

### 5.4 Sources

Community references used for the numbers above; consult them, do not trust a
single one, and never scrape assets from them:

- StrategyWiki, *Gothic II: Night of the Raven / Training* — LP cost tables.
- World of Players forum, damage-formula threads — melee/ranged formulas.
- Steam Community guides, *Gothic 2 New Player Guide* — combo tiers, parry timing.
- Wikipedia, *Gothic II: Night of the Raven* — chapters, regions, structure.
- gothic.wiki — experience and level tables.

---

## 6. Systems specification

This is the game. Everything here is authored as data in `src/data/`, validated
by `content.test`, and consumed by systems that contain no content.

### 6.1 Character

**Attributes:** Strength, Dexterity, Mana. Start 10 / 10 / 0. Health starts 40,
+12 per level, plus permanent items. Mana starts 0 and only exists once you have
a reason for it.

**Skills** (bought with LP at trainers, one-off unless noted):

| Skill | LP | Effect |
| --- | --- | --- |
| One-handed % | 1 per % below 30, 2 per % to 60, 3 per % to 90, 5 above | crit chance + combo tier |
| Two-handed % | same curve | as above |
| Bow % / Crossbow % | same curve | crit chance + draw speed |
| Sneak | 5 | crouch-move at 55% speed, halves detection radius |
| Lockpick | 5 | enables the lockpick minigame; without it, picks snap instantly |
| Pickpocket | 5 | enables the steal-from-person check |
| Acrobatics | 5 | halves fall damage, enables the roll, +0.5 m jump |
| Skinning / trophies (3 tiers) | 5 each | claws, hides, teeth — the early-game income |
| Alchemy (3 circles) | 5/10/15 | potions, including the permanent ones |
| Smithing (3 tiers) | 5/10/15 | forge weapons; the best one-hander in Ch.2 is forged, not found |
| Rune-making (per circle) | 10 per circle | Ember Chapter only |

**Guild-exclusive skills:** Sunblades get heavy-armour training and shield-bash;
Freeblades get two-handed mastery and the dirty-fighting kick; Emberwardens get
runes and circle progression. `[D]`

### 6.2 Combat state machine — exact, because "feels good" is not a spec

One state machine, `src/game/combat.js`, driven at a fixed 60 Hz simulation tick
regardless of render rate. Frame counts are in ticks (1 tick = 16.67 ms).

| Weapon class | Wind-up | Active | Recovery | Combo window | Reach |
| --- | --- | --- | --- | --- | --- |
| One-handed | 10 | 5 | 14 | ticks 15–24 of recovery | 1.9 m |
| Two-handed | 18 | 7 | 22 | 25–36 | 2.4 m |
| Dual/fast (dagger) | 6 | 4 | 9 | 10–16 | 1.5 m |
| Bow | draw 24 (hold ok) | release | 18 | — | ballistic |
| Crossbow | 40 reload | release | 10 | — | flat to 30 m |

Invariants that `combat.test` enforces:

- **No cancel.** Once `ACTIVE` begins, nothing but taking damage-with-stagger can
  leave the state early. Not blocking, not rolling, not sheathing.
- **Blocking has a cost.** Parry is a 9-tick window on the block press; a
  successful parry staggers the attacker 20 ticks. Holding block after the window
  becomes a passive block: absorbs 60% damage, but you are pushed back and lose
  positional advantage. Blocking a two-hander with a one-hander at <30 STR
  advantage breaks your guard entirely.
- **Hit reactions are directional** — four react animations, chosen by the
  attack's approach angle relative to the target's facing.
- **Stagger has a budget.** Each creature has `poise`; damage accumulates and
  staggers at a threshold that resets after 90 ticks. A boar is not staggerable by
  a dagger, ever, and the player learns that by trying.
- **Enemies telegraph.** Every attack has a ≥12-tick readable wind-up with a
  distinct pose and, for heavy attacks, a subtle audio tell 6 ticks before active.
  This is a hard requirement, tested by asserting no enemy attack has wind-up < 12.
- **Attacks are hitbox-swept**, not hit-scanned at a single frame — a capsule
  swept from the previous to current blade transform, so fast swings cannot pass
  through a target between frames.

**Targeting:** soft lock-on. Nearest enemy in a 60° cone within 12 m, sticky with
hysteresis, dropped on death or LOS loss for >0.8 s. Free-aim for ranged.

### 6.3 Monsters — 22 types, each a lesson

Every entry needs: model recipe, 3 attacks max, one tell, one counter, fixed
stats, XP, drops, and where it lives. Sample rows to establish the shape and
scale; author the remaining ones in the same schema.

| Creature | HP | Prot | Dmg | XP | Tell | Counter | Region |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Carrion-runner | 40 | 0 | 12 | 30 | hops back before a lunge | strike on the hop | farmland |
| Delver | 55 | 5 | 15 | 40 | burrow puff before surfacing | walk off the puff | caves, fields |
| Wolf | 70 | 5 | 20 | 60 | crouch, then leap | parry the leap | forest, packs of 3–5 |
| Boar | 120 | 20 | 35 | 100 | paws the ground | sidestep, never block | forest edge |
| Ripper | 150 | 15 | 45 | 150 | rears onto hind legs | back out of the 2-hit combo | river gorge |
| Shadeclaw | 300 | 40 | 90 | 500 | shoulder-drop, sound tell | high ground; do not fight two | deep forest, night |
| Vharn raider | 220 | 60 | 70 | 400 | shield-raise before overhead | bait overhead, punish recovery | the Cleft |
| Dragon (Ch.4) | 2000 | 150 | 200 | 5000 | wing-beat before breath | blackore weapon required | the Cleft |

Rules: **packs, not swarms** (max 5, with a leader that fights differently);
**no respawns** except three authored, story-justified restock points; sleeping
creatures that can be avoided or ambushed; predators that fight each other if you
lead one into another (this is free emergence — implement it, it earns more
goodwill than any effect).

### 6.4 NPCs, schedules and AI

Every named NPC is a data record:

```js
// src/data/npcs/halden.js
export const HARL_SMITH = {
  id: 'harl_smith',
  name: 'Harl',
  faction: 'halden_city', guild: null,
  stats: { hp: 180, str: 60, oneHanded: 45, prot: { edge: 30 } },
  trainer: { oneHanded: { max: 45, price: 200, requires: 'flag:harl_respect' } },
  trades: { gold: 900, stock: ['longsword_plain', 'ore_dagger', 'whetstone#5'] },
  home: 'halden.smithy', bed: 'halden.smithy.bed',
  routine: [                        // must sum to 24h, validated
    { from: '06:00', to: '07:00', at: 'halden.smithy.well',  do: 'wash' },
    { from: '07:00', to: '12:00', at: 'halden.smithy.anvil', do: 'forge' },
    { from: '12:00', to: '13:00', at: 'halden.tavern.table3', do: 'eat' },
    { from: '13:00', to: '19:00', at: 'halden.smithy.anvil', do: 'forge' },
    { from: '19:00', to: '23:00', at: 'halden.tavern.bar',   do: 'drink' },
    { from: '23:00', to: '06:00', at: 'halden.smithy.bed',   do: 'sleep' },
  ],
  dialogue: 'harl',
};
```

**The AI is a small, debuggable hierarchy** — no behaviour-tree library, no ML:

- **Routine layer** — walk to the current waypoint, play the activity loop.
- **Reaction layer** — interrupts routine: greeting, trespass warning, theft
  accusation, combat, fleeing, calling for the Watch. Each reaction has a
  cooldown and a memory entry.
- **Combat layer** — a per-archetype controller (brawler, spearman, archer,
  caster, beast) with a single decision every 0.4 s: approach, circle, attack,
  block, retreat, call for help.

**Perception** is explicit and testable: a vision cone (110°, 18 m day / 9 m
night / 6 m if the observer is sitting), a hearing radius (running 12 m, sneaking
3 m, combat noise 35 m), line-of-sight raycast against a coarse occlusion mesh,
and a light term (torch or district lamp doubles night vision).

**Memory:** every NPC keeps a bounded event list (last 16 events, 72 in-game
hours). "Saw you steal" persists; "saw you draw a weapon" decays. Crime state is
per-faction, not global.

**Nobody is invincible and nobody is essential-by-fiat.** If an NPC required by a
quest can die, the quest must have a fallback resolution or the world must record
the failure honestly. `content.test` proves every quest has a valid state after
any single NPC death. This is the single hardest content rule here and it is what
separates a living world from a fragile one.

### 6.5 Dialogue

A directed graph per NPC in `src/data/dialogue/*.js`. Nodes are data; conditions
are pure functions of world state.

```js
{ id: 'harl.train_ask',
  when: (w) => w.has('flag:harl_respect') && w.gold >= 200,
  text: 'Teach me to hold a sword properly.',
  reply: 'You have hands like a scribe. Two hundred, and I will fix that.',
  effects: [{ openTrainer: 'oneHanded' }],
  once: false, priority: 20 }
```

Requirements: no voice acting (text + subtitle-style presentation with a portrait
and a talking-head camera); a **conversation camera** that frames both speakers
with over-the-shoulder cuts on a 2-shot; the world keeps running behind the
dialogue (time passes, NPCs walk past, and yes, you can be attacked mid-sentence —
this is a feature, and the dialogue closes cleanly when it happens).

### 6.6 Quests

45–60 quests, authored as data with an explicit state machine:

```js
{ id: 'q_missing_hunter', title: 'The hunter who did not come back',
  giver: 'bosk_hunter', chapter: 1,
  stages: [
    { id: 'told',   log: 'Bosk says his brother has not returned from the north wood.' },
    { id: 'found',  log: 'I found the camp. Wolves. And a torn militia sash.' },
    { id: 'truth',  log: 'The sash is not from wolves. Someone wanted it to look that way.' },
  ],
  resolutions: [
    { id: 'honest',  gives: { xp: 400, gold: 0,   flags: ['bosk_trusts'] } },
    { id: 'silent',  gives: { xp: 250, gold: 150, flags: ['watch_owes_you'] } },
    { id: 'failed',  when: 'bosk_dead', log: 'Nobody left to tell.' },
  ],
  fallback: 'failed' }
```

Rules: **at least 3 quests have irreversible, mutually exclusive resolutions**
with visible consequence 2+ hours later; **no fetch quest without a reason to go
somewhere interesting**; **every quest is completable without combat OR without
dialogue** in at least a third of cases (sneak, steal, persuade, kill — pick two
paths minimum for the significant ones).

### 6.7 Economy, loot and crafting

- Gold has no weight; **inventory has no weight limit** (the original's choice —
  friction lives elsewhere). Instead, the limit is *what is worth carrying*.
- **Traders:** finite gold, finite stock, buy at 30–40% of value, restock only on
  chapter change. Selling 40 wolf pelts should visibly drain a trader's purse.
- **Loot is hand-placed.** Every chest is authored. Random drops exist only for
  creature trophies. There is exactly one procedural table in the game (creature
  drops) and it is boring on purpose.
- **Smithing** is a real minigame: heat (timing bar), 4 hammer strikes with a
  rhythm window, quench. Quality bonus from performance, capped at +15% damage.
- **Alchemy** turns herbs into potions, and the *permanent* potions (+1 STR, +1
  DEX, +5 HP) are the reason players comb the map. There are exactly 34 permanent
  potions' worth of ingredients in the world. Finite. Authored. Missable.
- **Ore:** blackore is the Ch.3–4 currency of power. It cannot be bought.

### 6.8 Magic

Six circles, Ember Chapter only. Runes are permanent castables carved from ore +
a scroll; scrolls are single-use. Mana regenerates slowly out of combat only, so a
mage is a resource-management character rather than a machine gun.

| Circle | Requires | Signature spells |
| --- | --- | --- |
| 1 | Mana 10 | Light, Firebolt, Heal Light Wounds |
| 2 | Mana 30 | Ice Lance, Sleep, Charm Beast |
| 3 | Mana 60 | Fireball, Summon Skeleton, Windfist |
| 4 | Mana 90 | Firestorm, Ice Wave, Death's Breath |
| 5 | Mana 120 | Pyrokinesis, Army of Darkness, Waterfist |
| 6 | Mana 150 | Firerain, Breath of Death, Master's Word |

Non-mages get scrolls and rare wands; magic is never fully closed off, only
mostly. `[D]`

### 6.9 Time, weather and the world clock

- **1 real minute = 12 in-game minutes** (a full day is 2 h real). Sleeping in a
  bed you have the right to advances time; sleeping rough is riskier.
- Sun/moon positions drive the directional light; **shadow direction is the
  clock** and the player should be able to tell the hour by looking at the ground.
- Weather is a state machine (clear → overcast → rain → storm → clearing) with
  ~40 min real cadence, seeded per save. Rain wets materials (roughness shift),
  raises ambient noise, reduces NPC vision by 30%, sends townsfolk indoors, and
  makes torches fail outdoors.
- Night is genuinely dark. If a player without a torch can navigate the forest
  comfortably at 01:00, the lighting is wrong.

---

## 7. The world

### 7.1 Shape

One contiguous island region, ~1.6 km², no loading screens above ground. Four
zones radiating from the city, each with its own silhouette, palette and threat
level:

| Zone | Area | Threat | What it is for |
| --- | --- | --- | --- |
| **Halden** (walled city + harbour) | 0.15 km² | none (crime only) | Density: 40 NPCs, 6 traders, 5 trainers, guild halls, the tavern |
| **The Vale** (farms, road, mill, forest edge) | 0.5 km² | low | The tutorial that is not a tutorial. Wolves, bandits, the first cave |
| **The Drowned Coast** (cliffs, ruins, pirate cove) | 0.4 km² | medium | Optional mid-game, opens Ch.2, contains the addon-flavoured arc |
| **The Cleft** (ore valley, orc-held, mines) | 0.55 km² | high → lethal | Ch.3–4. Enterable from hour one. Will kill you |

Plus ~14 interiors and 6 dungeons (300–1200 m² each), streamed as separate cells
with a door transition of ≤400 ms.

### 7.2 Authoring pipeline — the part that decides whether this is finishable

**Do not hand-place 40,000 objects in JavaScript literals.** Build one tool
first, at M3, and everything after is cheap:

1. **Heightmap and zone masks** are generated by a seeded, deterministic
   procedural pass (`tools/worldgen.mjs`) with *hand-authored control curves*:
   ridgelines, river paths, road splines and settlement pads are authored as
   polylines in a text file; the generator carves terrain to obey them. This is
   how you get a world that feels designed without placing every vertex.
2. **Scatter** (trees, rocks, grass) is rule-based per zone: slope, altitude,
   moisture, distance-to-road, with authored exclusion polygons. Deterministic
   from the seed, so the world is identical for every player and every test.
3. **Hand placement** is a text file per zone (`src/data/world/vale.world`) with
   one entity per line: `type x z yaw [props]`. A tiny in-browser editor
   (`?edit=1`) lets you click to place and writes the same text format to the
   clipboard. This is the highest-leverage tool in the project — build it, and
   world-building becomes an evening's work instead of a month's.
4. **Nav data is baked**, not runtime-computed: `tools/navbake.mjs` produces a
   navmesh (or a 0.5 m grid + jump links, which is simpler and adequate) and
   commits it as a compact binary-in-base64 or a typed-array JSON. Bake time
   ≤60 s, checked into the repo, regenerated by a script and diffed in CI.

### 7.3 Landmarks and legibility

A player must be able to navigate without a minimap. That requires: a **silhouette
landmark visible from most of the map** (the necromancer's tower on the ridge, the
lighthouse, the Cleft's cracked peak); **roads that actually lead somewhere**;
**biome transitions that are visible at 300 m**; and **no two clearings that look
the same**. The map screen is a hand-drawn-looking parchment with no player dot
unless the player buys the compass. `[D]`

---

## 8. Repository layout and architecture

Zero runtime dependencies. Zero build step for development. ES modules served
over HTTP, loaded natively. A bundler exists only to produce an optional
single-file release build.

```
/
  index.html                  # canvas, loader, capability gate, nothing else
  styles.css                  # UI only; the game is drawn on the canvas
  package.json                # scripts only; devDeps: playwright
  src/
    main.js                   # boot, capability detect, main loop, fixed-step accumulator
    core/
      caps.js                 # feature detection, one source of truth
      math.js                 # vec3/mat4/quat, no allocation in the hot path
      rng.js                  # seeded PRNG (xorshift128+), deterministic everywhere
      time.js                 # world clock, day/night, calendar
      events.js               # typed pub/sub, the only cross-system coupling allowed
      save.js                 # IndexedDB, versioned schema + migrations
      input.js                # keyboard+mouse, gamepad, touch; rebindable
      log.js                  # dev overlay, ring buffer, no console spam in prod
    render/
      device.js               # WebGPU or WebGL2 selection behind ONE interface
      webgpu/…  webgl2/…      # two backends, same interface, no leaks either way
      frame.js                # render graph: shadow → depth → opaque → sky → water → transparent → post
      shadow.js               # 3-cascade CSM
      terrain.js              # clipmap/quadtree LOD, GPU-driven where available
      instances.js            # instanced vegetation and props with per-cell culling
      sky.js                  # analytic sky + sun/moon, cloud layer, aerial perspective
      water.js                # screen-space refraction, planar-ish reflection, shore fade
      post.js                 # tonemap (ACES), bloom, SSAO, FXAA/TAA, grade LUT
      char.js                 # skinned mesh path, GPU skinning, per-bone palette
    assets/                   # GENERATORS, not files
      meshgen/                # parametric meshes: trees, rocks, buildings, props, creatures
      texgen/                 # procedural material synthesis to texture arrays
      animgen/                # procedural + hand-keyed animation clips as data
      soundgen/               # DSP synthesis of every SFX
      musicgen/               # layered adaptive score
    world/
      streaming.js            # cell load/unload, budgeted per frame
      collision.js            # broadphase grid + capsule/triangle, terrain heightfield
      nav.js                  # path queries against baked nav data
      interior.js             # cell transitions
    game/
      player.js  camera.js  combat.js  ai.js  perception.js  crime.js
      inventory.js  equipment.js  progression.js  trade.js  craft.js  magic.js
      quests.js  dialogue.js  factions.js  chapters.js  director.js
    ui/
      hud.js  menus.js  inventory-ui.js  dialogue-ui.js  map.js  charsheet.js
    data/                     # ALL content. No logic. Validated by content.test
      npcs/ dialogue/ quests/ items/ creatures/ world/ trainers/ loot/ strings/
  tools/
    serve.js  worldgen.mjs  navbake.mjs  bundle.js
    test.js  sim.mjs  play.mjs  perf.mjs  shot.mjs  content.mjs  probe/
  docs/
    DESIGN.md GLOSSARY.md LEGAL.md DESIGN-DELTAS.md OPEN-QUESTIONS.md PERF.md TESTING.md
```

### 8.1 Architectural laws

1. **Data has no logic; logic has no data.** A number in `src/game/` that is not
   derived is a bug. `content.test` greps for numeric literals in gameplay files
   and fails on any not in an allowlist.
2. **The simulation is deterministic and headless-capable.** Every gameplay
   system must run without a canvas, an audio context, or a DOM, driven by a
   fixed 60 Hz tick from Node. This is what makes §13's sim layer possible, and
   it is worth every constraint it imposes. Render code reads simulation state;
   it never owns it.
3. **Fixed-step simulation, interpolated rendering.** Accumulator loop; render
   interpolates between the last two sim states. Never scale gameplay by frame
   time.
4. **No allocation in the hot path.** Pre-allocated pools for vectors, matrices,
   particles, entities. A GC spike is a stutter and a stutter is a review score.
   `perf.mjs` asserts zero major GCs during a 30-second traverse.
5. **One-way dependencies:** `core ← world ← game ← ui`, and `render` reads from
   `game`/`world` but nothing reads from `render`. Enforced by an import-graph
   check in `test.js`.
6. **Every system has an off switch** for bisecting: `?off=ai,weather,post`.

---

## 9. Rendering: what "AAA in a tab" actually requires

### 9.1 Backend strategy

**WebGPU primary, WebGL2 fallback, behind one device interface.** As of 2026,
WebGPU ships in Chrome/Edge (desktop + Android), Safari 26+, and Firefox 147+ on
Windows and ARM64 macOS — roughly 70% of users, with Linux Firefox and Android
Firefox still landing. That is a majority you should not leave on the table and a
minority you cannot abandon. `[V]`

- Write the renderer against `src/render/device.js`: buffers, textures, pipelines,
  bind groups, draw/dispatch. WebGL2 emulates the bind-group model with uniform
  blocks and texture units; it does not get compute, so compute paths need a CPU
  or vertex-shader fallback.
- **Ship WebGL2 first** (M4) because it is the one that must work everywhere, then
  add WebGPU (M9) for compute culling, larger instance counts and better shadows.
  Doing it the other way round produces a game that cannot run on a third of
  machines and a rewrite you will not have time for.
- Quality tiers: `low / medium / high / ultra`, auto-selected from a 2-second
  startup benchmark, always overridable. Ultra assumes WebGPU.

### 9.2 The frame

Fixed order, each stage individually toggleable and individually timed:

1. **Shadow pass** — 3 cascades (near 20 m, mid 70 m, far 220 m), 2048² each at
   high, PCF 3×3 + a slope-scaled bias, stabilised to texel grid so shadows do
   not swim when the camera moves. Cascade 3 updates every other frame.
2. **Depth prepass** — cheap on a scene this overdrawn; enables SSAO and cuts
   opaque shading cost.
3. **Opaque** — front-to-back, sorted by material then distance, instanced. One
   uber-shader with static permutations (not branches): terrain, foliage, skinned,
   static, water.
4. **Sky** — analytic Preetham/Hosek-style scattering, sun disc, moon with phase,
   two cloud layers (a scrolling cirrus texture + a raymarched cumulus layer at
   high only). Aerial perspective applied to everything beyond 80 m.
5. **Transparent** — foliage alpha-tested (not blended) at distance, blended
   near; particles; god rays as a radial blur on the sun's occlusion buffer.
6. **Post** — SSAO (16-tap, half-res, bilateral upsample), bloom (5-level
   downsample karis-average, threshold in the tonemapper's domain), ACES
   tonemapping, colour grading via a 32³ LUT authored per time-of-day and
   weather, vignette, film grain at 3%, FXAA at low / TAA at high.

### 9.3 Terrain

Quadtree-chunked heightfield, 128×128 vertex chunks with skirts, 5 LOD levels,
morphing between levels in the vertex shader so there is no popping. Materials
are splat-blended from a 4-channel weight map with height-based blending (so rock
punches through grass at the transition rather than fading). Triplanar mapping on
slopes above 40°. Detail normal at 2 m tiling to kill the flatness that gives
browser games away.

### 9.4 Vegetation — the single biggest visual win

Forests are what will make this look expensive. Budget: **~90,000 rendered
instances** in a frame at high.

- Trees: 6 species × 4 variants, parametric (§9.6), with 3 mesh LODs and a
  cross-billboard imposter beyond 90 m rendered from the mesh at load into an
  atlas (impostor baking is a one-time GPU pass at startup, ~200 ms).
- Grass: GPU-instanced quads in a 40 m radius, density from the splat map,
  animated by a wind field (two summed gnarly sine fields + gust noise), with a
  player-interaction ripple.
- Wind is **one global uniform set** consumed by grass, trees, cloth and water,
  so the whole world moves together. This coherence is what reads as "real".

### 9.5 Characters

- GPU skinning, ≤72 bones, one bone-matrix texture per character type per frame.
- **Animation is data, not files:** clips are keyframed pose arrays generated by
  `assets/animgen/` — procedural locomotion (a proper gait model with foot
  placement), plus hand-authored key poses for combat, interpolated with
  spline easing. Blend tree: locomotion (idle/walk/run/strafe/back) → upper-body
  additive (aim, carry, torch) → one-shot layers (attack, hit, death).
- **Foot IK** on terrain slopes and stairs, **look-at IK** for head/eyes in
  conversation and toward threats. These two IK features cost a day and buy more
  perceived quality than any post-processing effect.
- Ragdolls on death: a 9-body constraint solver, 3 iterations, blended from the
  last animated pose over 0.15 s. Do not skip this; a canned death animation on a
  slope is the tell of a cheap game.

### 9.6 Every asset is generated in code

No binary assets in the repo (this is a hard constraint — it keeps the game a
static site with a small download and makes every asset diffable and tweakable):

- **Meshes:** parametric generators. Trees from an L-system with per-species
  parameters. Rocks from a subdivided icosahedron with layered noise displacement
  and a flat-shaded low-poly variant. Buildings from a grammar (footprint →
  storeys → roof → openings → trim), which is how you get a whole believable city
  from ~600 lines. Creatures from a segment/limb rig builder.
- **Textures:** synthesised into 2D texture arrays at startup on the GPU where
  possible, CPU worker otherwise: noise stacks (fBm, worley, ridged), a
  weathering pass, and a shared albedo/normal/roughness/AO packing. Budget: all
  materials in ≤48 MB GPU memory at high, ≤16 MB at low. Cache the generated
  arrays in IndexedDB keyed by generator version, so a repeat visit skips it.
- **Audio:** every SFX from DSP (§12.2).
- Total download target: **< 3 MB gzipped** for the whole game. That is the
  headline number to defend, and it is achievable precisely because nothing is
  binary.

### 9.7 Performance contract

Fixed budgets. These are what `perf.mjs` asserts; a PR that breaks them fails CI.

| Tier / device | Resolution | Target | Hard floor |
| --- | --- | --- | --- |
| High (desktop dGPU, WebGPU) | 1920×1080 | 60 fps (16.6 ms) | p99 < 22 ms |
| Medium (desktop iGPU, WebGL2) | 1600×900 | 60 fps | p99 < 25 ms |
| Low (2021 laptop iGPU) | 1280×720, 0.8 scale | 45 fps | p99 < 33 ms |
| Mobile (recent phone) | native ÷ 2 | 30 fps | p99 < 45 ms |

Per-frame sub-budgets at high (measured with GPU timestamp queries where
available, `performance.now()` fences otherwise):

```
simulation (fixed 60 Hz tick, amortised)   ≤ 3.0 ms
culling + draw submission                   ≤ 2.0 ms
shadow pass                                 ≤ 2.5 ms
opaque + terrain + vegetation               ≤ 5.0 ms
post-processing                             ≤ 2.5 ms
UI                                          ≤ 0.8 ms
headroom                                    ≥ 0.8 ms
```

Also fixed: **draw calls ≤ 900/frame** (WebGL2) or **≤ 250** (WebGPU with
indirect); **triangles ≤ 3.5 M**; **JS heap ≤ 400 MB steady**; **zero major GC**
during traverse; **time to first playable frame ≤ 4 s** on a cold cache at
medium; **streaming hitch ≤ 4 ms** on any single frame (budgeted cell loading,
worker-decoded, uploads split across frames).

---

## 10. The AAA quality bar, stated concretely

"AAA" is not a resolution. It is the absence of a hundred small cheapnesses. Each
line below is a checkable requirement.

**10.1 Art direction.** One palette document (`docs/ART.md`) fixing hue ranges per
zone and time of day, and a rule that nothing in the game uses a colour outside
it except fire, blood, magic and gold. Low-saturation, high-value-contrast,
Northern-European autumn. Reference the *mood*, never copy the images.

**10.2 Lighting.** Physically-plausible units; one sun; a sky-light irradiance
term (SH-9 from the analytic sky, updated when the sun moves >1°); ~24 dynamic
point lights (torches, forges, windows) with a clustered forward pass; every
torch flickers on a per-instance noise offset (never in sync); shadow-casting is
limited to the sun plus the 4 nearest important lights.

**10.3 Camera.** Third-person over-the-shoulder, spring-arm with collision
(sphere-cast, smooth pull-in, no snap), FOV 68° exploring → 60° combat, subtle
camera lag on turns, and **no camera shake above 0.4° amplitude** except on
scripted impacts. A dead zone so idle breathing does not move the frame. Optional
first-person toggle costs a day and doubles the immersion for some players.

**10.4 Animation quality.** Every transition is blended (≥0.12 s), no snapping.
Root motion on attacks so a swing moves the body. Turn-in-place for angles >100°.
Weight: acceleration curves on start/stop, a settle frame at the end of every
attack. NPCs use the activity animation their routine names — a smith actually
hammers, and the hammer's sound is on the contact frame.

**10.5 Game feel.** Hit-stop of 60–90 ms on a critical hit and 0 on a floored hit
(§5.3); directional impact particles keyed to material (sparks on metal, dust on
stone, blood on flesh); a low-frequency controller rumble equivalent in audio; a
0.06 s desaturation flash on player damage; enemy death that always includes
ragdoll + a decal + a settle sound. Input latency: **≤ 2 frames** from key to
animation start, measured with the CDP harness.

**10.6 UI.** Diegetic where possible; parchment and ink, not glass and neon. No
minimap, no floating markers, no damage numbers by default (an option, off).
Every screen readable at 1280×720 and on a phone. Full keyboard, gamepad and
touch navigation of every menu. Loading states never show a spinner alone — they
show the world name and a line of in-fiction text.

**10.7 Accessibility, non-negotiable.** Rebindable everything; no
colour-only information; subtitle size and background opacity; a "reduce camera
motion" toggle; a "reduce flashing" toggle; UI scale 80–150%; a toggle for
hold-to-block vs press-to-block; and a colourblind-safe palette for the three
danger telegraph colours.

**10.8 Audio mix.** Three buses (world / character / UI) with ducking under
dialogue; distance attenuation and a cheap occlusion term (one raycast, low-pass
filter when occluded); reverb zones per interior with a convolution-free
Schroeder reverb; footsteps by material; wind that rises with altitude and
exposure.

---

## 11. Content pipeline and extensibility

The engineering goal is that **hour 200 of content authoring costs the same as
hour 2**. Six properties get you there:

1. **All content is data** in `src/data/`, loaded through one registry that
   validates schemas at boot (dev) and at test time (CI).
2. **Hot reload in dev:** `tools/serve.js` watches `src/data/` and pushes a
   reload event over an SSE endpoint; the game re-reads content without losing
   the running world. Editing a dialogue line and seeing it in-game in a second
   is worth more than any framework.
3. **The in-browser placement editor** (`?edit=1`, §7.2.3) with: click-to-place,
   drag-to-rotate, snap-to-ground, a palette of every entity type, undo, and
   "copy world diff" that emits text to paste into the `.world` file. No
   server-side write path — the clipboard is the transport, which keeps the game
   a static site.
4. **A schema per content type**, with helpful errors: `"npcs/harl: routine gap
   13:00–13:00 is 0 minutes; NPC would teleport"` beats a stack trace every time.
5. **Strings are separated** into `data/strings/en.js` from day one, so
   localisation is a file, not a refactor.
6. **Everything is deterministic from `(seed, contentVersion)`** so a bug report
   can be replayed: the save file records the seed, the content version, and an
   input log for the last 60 seconds.

---

## 12. Non-gameplay systems

### 12.1 Save

IndexedDB, one object store per save slot, versioned schema with a migration
chain (`migrations[from] → to`). A save records: seed, content version, world
clock, player state, inventory, quest states, flags, NPC deltas (only what
differs from authored state — do not serialise 80 NPCs' worth of static data),
world deltas (opened chests, taken items, dead creatures, placed objects), and a
60-second rolling input log for repro. Target: **< 400 KB per save**, < 120 ms to
write, never on the main thread if it can be helped. Autosave triggers per §5.3.
Corrupt-save handling is a first-class path, tested by writing garbage into the
store and asserting the game offers a clean recovery.

### 12.2 Audio, synthesised

Web Audio, everything generated:

- **Impacts** — noise burst through a resonant band-pass whose centre frequency
  and decay encode the material; three variants per material selected by a hash
  of the hit position so repeats do not sound identical.
- **Creatures** — layered: a formant-filtered growl oscillator, a noise breath
  layer, and a transient. Pitch varies ±8% per instance.
- **Footsteps** — per material, per gait, with a small random offset; the
  single highest-value SFX in the game and worth an afternoon of tuning alone.
- **Ambience** — wind (filtered pink noise modulated by exposure and altitude),
  birds by time of day, insects at night, water proximity, town murmur.
- **Music** — an adaptive layered score: 4–6 stems per region (drone, low
  strings, a lead motif, percussion), crossfaded by a director that reads
  threat level, time of day, and chapter. Composed as note tables driven by
  synth voices (a simple subtractive synth plus a plucked-string Karplus-Strong
  voice covers a shocking amount of ground). Themes: one per region, one per
  guild, one for the antagonist, stated in `docs/AUDIO.md`.
- Everything is behind a user gesture (browsers block autoplay), with a proper
  "click to begin" title screen that also serves as the WebGPU warm-up.

### 12.3 Input

Keyboard+mouse (pointer lock, with a graceful path when the lock is refused),
gamepad (standard mapping, with the same combat feel), and touch (virtual stick +
context buttons; the phone build targets 30 fps and reduced draw distance).
All bindings rebindable and persisted. Sensitivity, invert-Y, and a toggle for
hold-vs-press on block and sneak.

---

## 13. Test plan — five layers, and the code to start each one

Testing is not a phase here; it is how you are permitted to make claims (§3.1).
Five layers, each cheap to run, each catching a class of bug the others cannot.

### 13.1 Layer 1 — logic tests (`npm test`, Node, no browser, < 5 s)

Pure functions and simulation invariants. Hundreds of small assertions. The
harness is 30 lines and has no dependencies:

```js
// tools/test.js — run: npm test
import { LEVEL_XP, lpForAttribute, meleeDamage, comboTier } from '../src/game/progression.js';
import { CREATURES } from '../src/data/creatures/index.js';

let passed = 0; const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — expected ${b}, got ${a}`);

// --- progression -----------------------------------------------------------
check('level 1 costs 500 xp', () => eq(LEVEL_XP(1), 500, 'level 1'));
check('each level costs 500 more', () => {
  for (let n = 2; n <= 40; n++) eq(LEVEL_XP(n) - LEVEL_XP(n - 1), 500, `step at ${n}`);
});
check('attribute LP cost follows the five bands', () => {
  eq(lpForAttribute(10), 1, '10→11'); eq(lpForAttribute(30), 1, '30→31');
  eq(lpForAttribute(31), 2, '31→32'); eq(lpForAttribute(61), 3, '61→62');
  eq(lpForAttribute(91), 4, '91→92'); eq(lpForAttribute(121), 5, '121→122');
});

// --- combat ----------------------------------------------------------------
check('a normal hit is a tenth, floored at 5', () => {
  // weapon 40, STR 30, armour 20 → (40+30-20-1)/10 = 4.9 → floor 4 → floored to 5
  eq(meleeDamage({ weapon: 40, str: 30, armor: 20, crit: false }), 5, 'normal');
  eq(meleeDamage({ weapon: 40, str: 30, armor: 20, crit: true }), 50, 'critical');
});
check('combo tier follows skill bands', () => {
  eq(comboTier(9), 1, 'untrained'); eq(comboTier(10), 2, 'rookie');
  eq(comboTier(30), 3, 'trained');  eq(comboTier(60), 4, 'master');
});

// --- content invariants (see also layer 5) ---------------------------------
check('every creature telegraphs', () => {
  for (const c of CREATURES) for (const a of c.attacks)
    assert(a.windup >= 12, `${c.id}/${a.id} wind-up ${a.windup} < 12 ticks`);
});

console.log(failures.length
  ? `\n${passed} passed, ${failures.length} FAILED\n` + failures.map((f) => '  ✗ ' + f).join('\n')
  : `\n${passed} checks passed\n`);
process.exit(failures.length ? 1 : 0);
```

**Minimum coverage before M5:** progression math, damage math, combo tiers,
inventory/equip rules, trade pricing, crime matrix, schedule validity, dialogue
graph reachability, quest state machines, save round-trip, save migration.

### 13.2 Layer 2 — simulation (`npm run sim`, Node, headless world, < 60 s)

The whole game runs without a renderer (§8.1.2). A scripted bot plays it. This is
the layer that finds soft-locks, and it is the reason the architecture insists on
a headless simulation.

```js
// tools/sim.mjs — run: npm run sim [trials]
import { World } from '../src/world/world.js';
import { GoldenPathBot } from './bots/golden.mjs';

const trials = Number(process.argv[2] || 20);
const results = [];
for (let seed = 1; seed <= trials; seed++) {
  const w = World.headless({ seed });
  const bot = new GoldenPathBot(w, { guild: ['watch', 'ember', 'freeblade'][seed % 3] });
  let ticks = 0;
  const MAX = 60 * 60 * 60 * 12;              // twelve in-game hours of ticks
  while (!w.gameOver && ticks < MAX) { bot.think(); w.tick(); ticks++; }
  results.push({ seed, guild: bot.guild, done: w.chapter, ticks,
                 stuck: ticks >= MAX, deaths: bot.deaths, level: w.player.level });
}
// Assertions, not just a report: CI fails on any of these.
const stuck = results.filter((r) => r.stuck);
if (stuck.length) { console.error(`SOFT-LOCK on seeds ${stuck.map(r=>r.seed)}`); process.exit(1); }
```

Bots to write, in this order: `GoldenPathBot` (completes the critical path per
guild), `TouristBot` (walks every road, opens every door, never fights — proves
the world is traversable and no interior traps you), `MurderBot` (kills every
killable NPC, then asserts every quest still resolves — this is how you enforce
§6.4's hardest rule), `GreedBot` (buys and sells everything, proves the economy
cannot be broken), `IdleBot` (does nothing for 72 in-game hours — proves NPC
routines do not desync, drift, or wander into the sea).

### 13.3 Layer 3 — real browser, real input (`npm run play`, Playwright/CDP, < 3 min)

The rule from a project that learned it the hard way: **the harness may not call
game internals to make things happen.** Start the run by clicking the real menu.
Move by dispatching real key and touch events through CDP so they go through the
browser's hit-testing. Assert on *game state* sampled inside a rAF probe, never
on input state (the loop drains it), and run the page in a sandboxed iframe with
`allow-scripts` only, because that is the hostile host a static game ships into.

```js
// tools/play.mjs (sketch) — real clicks, real keys, real state
await page.click('#btn-new-game');
await page.waitForFunction(() => window.GRIMWARD?.state === 'playing', { timeout: 15000 });
const before = await sample(page, 'player.pos');
await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
const after = await sample(page, 'player.pos');
assert(dist(before, after) > 2.5, `W for 1s moved ${dist(before, after).toFixed(2)} m`);
// combat: swing must be uncancellable
await page.keyboard.press('Space');                       // draw weapon
await page.mouse.down(); await page.waitForTimeout(80);
await page.keyboard.press('ShiftLeft');                   // try to cancel with a roll
assert(await sample(page, 'combat.state') === 'ACTIVE', 'swing was cancellable');
```

Checks in this layer: boot with no console errors; first playable frame < 4 s;
every menu reachable and closable by keyboard, gamepad and touch; pointer lock
acquired and released cleanly; save/load round-trip through the real UI; a door
transition; a full dialogue; a kill; a level-up; and portrait + landscape phone
viewports.

### 13.4 Layer 4 — performance regression (`npm run perf`)

Headless Chromium with GPU, a fixed 30-second camera spline through the four
zones at 12:00 and 23:00, fixed seed, fixed quality tier. Reports p50/p95/p99
frame time, draw calls, triangles, heap, and GC count; compares against
`perf-baseline.json`; fails on >8% regression. Prints a per-stage breakdown so a
regression names its own culprit. This is the only source of a frame-time claim.

### 13.5 Layer 5 — content validation (`npm run content`)

Static analysis over `src/data/`. Fast, brutal, and the reason a 60-quest game
does not collapse under its own flags:

- Every referenced id exists (npc, item, quest, flag, waypoint, dialogue node,
  string key). Every authored id is referenced somewhere.
- Every NPC routine covers 24 h with no gap or overlap; every waypoint exists, is
  on the navmesh, and is reachable from the previous one inside the window at
  walk speed.
- Dialogue: no unreachable nodes, no node without an exit, every flag written is
  read, every `when` compiles, no node references a chapter that cannot occur.
- Quests: every stage reachable; every quest has a fallback; no quest depends on
  an NPC who can die without one; no two quests write the same flag with
  different meanings.
- Guild gating: three passes (one per guild) prove that guild's critical path is
  complete and the other two guilds' exclusive content is unreachable.
- Economy: total authored gold and total authored value are within 15% of the
  target curve in `docs/ECONOMY.md`.
- Placement: nothing intersecting geometry, nothing below terrain, no unreachable
  chest, no light without an emitter mesh.

### 13.6 CI

GitHub Actions on push and PR: `npm test` → `npm run content` → `npm run sim 6` →
`npm run play` → `npm run perf --compare` → `npm run shot --diff`. Under 12
minutes total. Artifacts: screenshots, perf JSON, sim logs. A red CI is a broken
build, not a flaky test — if a check is flaky, fix the check or delete it.

---

## 14. Milestones

Each milestone ends with a **command anyone can run** and a **thing anyone can
see**. Do not proceed with an exit criterion unmet. Do not build two milestones
at once — the ordering exists because each one de-risks the next.

The order is deliberate in one respect worth stating: **the vertical slice comes
before the world.** A 200 m² garden where combat, an NPC with a routine, a
dialogue, a trainer and a save all work is worth more than 1.6 km² of empty
terrain, because it proves every system boundary. Content scales; boundaries do
not.

| M | Name | Exit criterion (a command + a visible result) |
| --- | --- | --- |
| **M0** | Skeleton | `npm start` serves a page; `npm test` passes with ≥5 real checks; `npm run shot` writes a PNG of a lit spinning cube. Capability gate reports WebGL2/WebGPU/audio/storage. Repo layout of §8 exists, empty files included. |
| **M1** | Loop and camera | Fixed-step loop with interpolation, dev overlay (frame ms, tick ms, draw calls), quality tiers, `?off=` switches. `npm run perf` reports a baseline on an empty scene. |
| **M2** | Terrain and traversal | Heightfield with LOD morphing, collision, a capsule character with acceleration and slope handling, spring-arm camera. `npm run play` proves W moves the player ≥2.5 m/s and the camera never enters geometry. |
| **M3** | Worldgen + editor | `npm run worldgen` builds the island from the seed and control curves; `?edit=1` places entities and copies a world diff; `npm run navbake` bakes nav data. A screenshot of the island from the ridge. |
| **M4** | The look (WebGL2) | Full frame graph of §9.2: CSM, sky, water, vegetation, post. `npm run shot` produces the 12 canonical framings and they are committed as references. **This is the "does it look expensive" gate** — if the answer is no, stop and fix it here, not later. |
| **M5** | Characters and animation | Skinned characters, locomotion blend tree, foot IK, look-at, ragdoll. 200 NPCs on screen at 60 fps in the perf probe. |
| **M6** | Combat | The §6.2 state machine, swept hitboxes, parry, stagger, three creature archetypes, hit feel per §10.5. `npm test` covers frame counts and no-cancel; `npm run sim` runs 200 duels and the spacing bot beats the spam bot ≥80%. |
| **M7** | Character systems | XP, levels, LP, trainers, attributes, skills, inventory, equipment with hard requirements, save/load. `npm test` covers all of §5.1 and §5.2. |
| **M8** | NPCs alive | Routines, perception, crime, dialogue graph, trade, the first 20 NPCs of Halden. `npm run sim` runs `IdleBot` for 72 in-game hours with zero desyncs; `npm run content` validates every schedule. |
| **M9** | WebGPU backend | Same interface, compute-driven culling, higher instance counts. Both backends produce the 12 framings within a 2% perceptual diff. |
| **M10** | The vertical slice | Halden + the Vale, 25 NPCs, 12 quests, one guild joinable, one dungeon, chapter 1 → 2 transition. **Playable end to end by a stranger for 90 minutes.** Get a human to play it and write down where they were confused. |
| **M11** | Content build-out | All four zones, 60–80 NPCs, 45–60 quests, three guilds, 22 creatures, six dungeons, chapters 1–4. `npm run sim` completes all three golden paths. |
| **M12** | Polish and mix | Audio pass, music director, colour grading per time/weather, UI pass, accessibility pass, input latency ≤2 frames, all §10 checks. |
| **M13** | Ship | Single-file build, static deploy, cold-load < 4 s, `docs/` complete, CI green, `npm run accept` (§16) all green. |

**Per-milestone ritual:** open with a one-paragraph plan and the files you will
touch; close with the exit command's real output, a screenshot where visual, and
a two-line note of what surprised you. That note is the most valuable artifact you
will produce for whoever reads this later.

---

## 15. Working agreement

- **Commits:** small, one concern each, message says *why* in the imperative
  ("Blocking a two-hander at low strength now breaks the guard"). Never "fix
  stuff". Never a commit that does not run.
- **Comments explain why, not what.** The house style in this repository family
  is prose comments at the top of a file explaining the decision the file
  embodies, and inline comments only where a reader would otherwise ask "why is
  it like that". Match it.
- **No dead code, no commented-out code, no TODO without an owner and a
  milestone.** `docs/OPEN-QUESTIONS.md` is where unfinished thinking lives.
- **File size:** if a file passes ~600 lines, it is probably two files. `combat.js`
  and `ai.js` are allowed to be bigger; everything else should justify it.
- **When you break a test, you fix the code or you change the test *and say so
  loudly with the reason*.** Silently loosening an assertion is the most serious
  process failure available to you.
- **Definition of done for a feature:** it runs; it has a test in the right
  layer; it is data-driven if it is content; it has an entry in the relevant doc;
  it has a screenshot if it is visible; it does not regress `npm run perf`.

---

## 16. Acceptance checklist (`npm run accept`)

The ship gate. A script that runs everything and prints one green or red line per
item. Nothing here is aspirational; every line is mechanically checkable.

**Engineering**
1. `npm test`, `npm run content`, `npm run sim 12`, `npm run play`, `npm run perf --compare`, `npm run shot --diff` all pass.
2. Zero runtime dependencies; `npm ls --prod` is empty.
3. Cold load to first playable frame < 4 s at medium; total transfer < 3 MB gzipped.
4. No binary asset files in the repo (a glob check).
5. Works in Chrome, Edge, Firefox and Safari current-1; degrades correctly with
   WebGPU absent, audio blocked, storage denied, pointer lock refused.
6. No console errors or warnings in a 10-minute play session.

**Game**
7. Three guild playthroughs complete headlessly.
8. Every quest resolves after any single NPC death (`MurderBot`).
9. No level scaling anywhere (static check + sim).
10. Every creature attack telegraphs ≥12 ticks.
11. Every NPC's 24 hours are accounted for and pathable.
12. A player can reach every region on foot from spawn with no scripted unlock.
13. Chapters 1→4 each change ≥25 world facts.
14. Save/load preserves world deltas exactly; corrupt saves recover.

**Feel**
15. Input latency ≤ 2 frames, measured.
16. Frame budgets of §9.7 met on all four tiers.
17. The 12 canonical framings match their references within 2%.
18. Accessibility checklist of §10.7 complete.

---

## 17. Failure modes, and what to do instead

These are ranked by how often they actually happen. Read this list at the start
of each milestone; most projects like this die of the first four.

1. **Writing an engine instead of a game.** Six weeks of renderer, no NPC. The
   milestone order forbids it: M6–M8 (combat, character, NPCs) must land before
   any renderer work beyond M4. If you catch yourself refactoring the render
   graph before the vertical slice is playable, stop.
2. **Code that never ran.** Thousands of lines, zero commands executed. The
   Contract (§3.1) is the countermeasure. Run something every 20 minutes.
3. **Silent black screen.** A shader failed to compile and nothing checked. §3.2:
   every compile, link and pipeline creation is checked and throws with the log.
4. **Hallucinated API surface.** `device.createRenderPipeline` with 2023's
   descriptor shape; `AudioBufferSourceNode.start(when, offset)` argument order
   guessed. Probe first (§3.2), then use.
5. **Scope panic at 60%.** The world is huge, the systems are half-done. Cut
   content, never systems (§3.3), and cut it explicitly in `docs/OPEN-QUESTIONS.md`.
6. **The world is empty.** 1.6 km² of correctly-lit nothing. Density is content:
   a memorable thing every 40 m of road. Build the editor (§7.2) early enough
   that placement is cheap.
7. **Combat that is a damage race.** Symptom: the winning strategy is to hold
   attack. Cure: recovery frames, poise, enemy counters that punish the third
   swing, and the sim duel test in §13.2.
8. **NPCs that are furniture.** Symptom: they stand still and say one line. Cure:
   routines land in M8, not "later", and `IdleBot` proves they hold up for 72 h.
9. **A GC stutter every four seconds.** Cure: pooling from day one (§8.1.4);
   `perf.mjs` asserts zero major GCs.
10. **The save file grows without bound.** Cure: deltas, not snapshots (§12.1),
    with a size assertion in the test.
11. **Flag spaghetti.** 400 booleans, nobody knows which are live. Cure:
    `content.mjs` fails on any flag written and never read, or read and never
    written.
12. **Difficulty tuned by the developer who has played it 400 times.** Cure: bot
    win-rate curves per region (§13.2) plus one real human at M10.
13. **The phone build is an afterthought.** Cure: the touch path is tested in
    `play.mjs` from M2, not bolted on at M12.
14. **Everything is grey-brown.** Cure: the palette document (§10.1) and the 12
    reference framings — if two zones' screenshots are indistinguishable at
    thumbnail size, the art direction has failed.
15. **Claiming it is done.** The acceptance checklist (§16) is the only
    definition of done that exists.

---

## 18. Appendix — templates to start from

### 18.1 Fixed-step loop with interpolation

```js
// src/main.js
const TICK = 1000 / 60;                 // simulation is 60 Hz, always
let acc = 0, last = performance.now(), prev = null;

function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(now - last, 250);     // clamp: a background tab must not
  last = now;                           // simulate four minutes on return
  while (acc >= TICK) {
    prev = world.snapshotInto(prev);     // reuse the buffer; no allocation
    world.tick(TICK / 1000);
    acc -= TICK;
  }
  renderer.draw(world, prev, acc / TICK);  // alpha for interpolation
}
```

### 18.2 Capability gate — the first code that runs

```js
// src/core/caps.js
export async function detect() {
  const c = document.createElement('canvas');
  const caps = {
    webgpu: false, webgl2: false, audio: false, storage: false,
    workers: typeof Worker === 'function',
    pointerLock: 'requestPointerLock' in Element.prototype,
    touch: matchMedia('(pointer: coarse)').matches,
  };
  if (navigator.gpu) {
    try {                                 // an adapter can be null on Linux/FF
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      caps.webgpu = !!a; caps.adapter = a;
    } catch { /* fall through to WebGL2 */ }
  }
  caps.webgl2 = !!c.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  caps.audio = typeof (window.AudioContext || window.webkitAudioContext) === 'function';
  try { await navigator.storage?.estimate(); caps.storage = true; } catch { /* private mode */ }
  return caps;
}
```

Every one of these has a real failure path: no WebGL2 → a readable "your browser
cannot run this, here is why" page; no audio → play silently; no storage → run
with in-memory saves and warn once; no pointer lock → a click-to-steer fallback.

### 18.3 Shader compilation that cannot fail silently

```js
// src/render/webgl2/shader.js
export function compile(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join('\n');
    throw new Error(`${name} failed to compile:\n${log}\n\n${numbered}`);
  }
  return s;
}
```

### 18.4 The combat state machine, in the shape it should have

```js
// src/game/combat.js
export const S = { IDLE: 0, WINDUP: 1, ACTIVE: 2, RECOVER: 3, BLOCK: 4, PARRY: 5, STAGGER: 6 };

export function step(a /* actor */, intent, dt) {
  a.t--;
  switch (a.state) {
    case S.WINDUP:
      if (a.t <= 0) { enter(a, S.ACTIVE, a.weapon.active); a.sweepFrom = bladeTip(a); }
      break;
    case S.ACTIVE:
      sweepHitbox(a, a.sweepFrom, bladeTip(a));   // swept, never point-sampled
      if (a.t <= 0) enter(a, S.RECOVER, a.weapon.recover);
      break;
    case S.RECOVER:
      // The combo window is the ONLY early exit, and only into another attack.
      if (intent.attack && inComboWindow(a)) { a.combo++; return enter(a, S.WINDUP, a.weapon.windup * 0.8); }
      if (a.t <= 0) { a.combo = 0; enter(a, S.IDLE, 0); }
      break;
    case S.IDLE:
      if (intent.attack) enter(a, S.WINDUP, a.weapon.windup);
      else if (intent.block) enter(a, S.PARRY, 9);   // the parry window opens on press
      break;
    case S.PARRY:
      if (a.t <= 0) enter(a, S.BLOCK, Infinity);     // decays into a passive block
      break;
  }
}
// Note what is missing: no transition out of ACTIVE except time and stagger.
// That absence is the entire feel of the combat system. Do not add one.
```

### 18.5 NPC routine evaluation

```js
// src/game/ai.js — the routine layer, which is smaller than people expect
export function currentActivity(npc, clock) {
  const m = clock.minutesOfDay;
  for (const r of npc.routine) {                  // validated non-overlapping at content time
    const from = mins(r.from), to = mins(r.to);
    const inside = from < to ? (m >= from && m < to) : (m >= from || m < to); // wraps midnight
    if (inside) return r;
  }
  throw new Error(`${npc.id} has no activity at ${clock.hhmm} — content validation missed a gap`);
}
```

### 18.6 The dev overlay

Always-on in dev, `F3` in release: frame ms graph (with the stage breakdown),
tick ms, draw calls, triangles, instances, entities simulated, heap, GC count,
streaming queue depth, world clock, player position and zone, current AI state of
the nearest NPC, and the last 8 log lines. Half the debugging in a project like
this happens by looking at this overlay instead of adding a print statement.

---

## 19. The short version

If the full brief has scrolled out of your context, this is the irreducible core.

> Build **GRIMWARD**, a Gothic II–class open-world RPG in a browser tab: no level
> scaling, hand-placed world, learning points spent at trainers, three mutually
> exclusive guilds, NPCs on 24-hour routines who notice theft, chaptered
> escalation, and committed melee where a non-critical hit does a tenth of the
> damage. Vanilla ES modules, zero runtime dependencies, WebGPU with a WebGL2
> fallback, every asset generated in code, under 3 MB, 60 fps at 1080p.
> The simulation runs headlessly so bots can prove the game is completable.
> Five test layers: logic, simulation, real-browser input, performance, content
> validation. Milestones in order, vertical slice before world. Never claim
> anything you have not run — paste the command and its output, every time.

---

## 20. Sources for the reference numbers

- StrategyWiki — *Gothic II: Night of the Raven / Training*: <https://strategywiki.org/wiki/Gothic_II:_Night_of_the_Raven/Training>
- World of Players forum — damage formula threads: <https://forum.worldofplayers.de/forum/archive/index.php/t-539155.html>
- Steam Community — *Gothic 2 New Player Guide* (combo tiers, parry): <https://steamcommunity.com/sharedfiles/filedetails/?id=483421446>
- Steam Community — *Damage calculations*: <https://steamcommunity.com/sharedfiles/filedetails/?id=2707087393>
- Gothic Wiki — experience points: <https://gothic.wiki/w/Experience_points>
- Wikipedia — *Gothic II: Night of the Raven* (chapters, regions): <https://en.wikipedia.org/wiki/Gothic_II:_Night_of_the_Raven>
- web.dev — WebGPU in major browsers: <https://web.dev/blog/webgpu-supported-major-browsers>

Treat all six of the first as community documentation of a 2003 game: useful,
occasionally wrong, never authoritative. Label accordingly (§5).
