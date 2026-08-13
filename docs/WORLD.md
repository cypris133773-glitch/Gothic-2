# The island of Verath

The map, and why it is shaped like this.

## What this is modelled on, and what it is not

The 2003 German RPG this project is in the tradition of built its island out of
a small number of places connected by roads you actually walk, with a walled
port city at the centre of everything. Its *structure* is the thing worth
copying, and structure is not protected: a walled harbour city split into
districts with a guarded gate to the wealthy quarter, a handful of farms feeding
it, a monastery of fire priests above a lake, a necromancer's tower on a
plateau, a lighthouse held by people you should not meet at night, and a pass
east into an ore valley that the game's second half is about.

What is **not** copied, ever: that island's terrain, its place names, its
characters, its quest text, or any of its assets. Verath's coastline comes out
of our own generator, and every name below is ours (`docs/GLOSSARY.md`).

## The shape of it

Everything is within about six hundred metres of the city gate, and every
region is reachable on foot from every other without a loading screen or a
scripted unlock (pillar P2). Difficulty is geography: the further from the road,
the worse the thing that lives there.

```
                    N
        ┌──────────────────────────┐
        │   Ember Chapter (lake)   │   monastery on a shelf above water
        │            ▲             │
   the  │            │ road        │
  coast │   ┌────────┴────────┐    │
   ───► │   │     HALDEN      │◄───┼── harbour, the only way on or off
        │   │  walled, 4 qtr  │    │
        │   └───┬────────┬────┘    │
        │       │        │         │
        │  farms│        │road     │
        │   ▼   │        ▼         │
        │  Vale │    Ossric's      │   tower on a plateau, south-east
        │       │     tower        │
        │       ▼                  │
        │   the Cleft ────────────►│   pass east into the ore valley
        └──────────────────────────┘
              lighthouse, west headland
```

## The city

Four quarters behind one wall, which is the single most important piece of
level design on the island: it is where every conversation, every trainer and
every faction lives.

| Quarter | What is in it | Who may enter |
| --- | --- | --- |
| **Harbour** | Docks, warehouses, the tavern, the fence | Anyone |
| **Lower** | Market square, the smithy, the well, most homes | Anyone |
| **Barracks** | The Watch's hall, the training yard, the armoury | The Watch, and anyone with business |
| **Upper** | The governor's hall, the alchemist, the moneyed | Sworn members, master craftsmen, and nobody else |

The upper gate is a *door in the world*, not a cutscene: two guards, a
conversation, and four different ways past them — an errand for a citizen who
matters, a guild oath, a bribe, or the wall itself if you have the acrobatics
and the nerve. That is the shape of the original's best early quest and it is
worth having.

Concretely (`CITY` in `src/world/world.js`): one curtain wall on a 26 × 34 m
ellipse, nine metres high, with the land gate due south and the harbour gate due
west; a second wall inside it, five metres high, around the upper quarter, with
one gate facing the market square. The market square is at `0, 14`; the smithy
faces it from the south; the player starts on the street between the gate and
the square, which is the first thing anybody sees of the game.

## Outside the walls

| Place | Why it exists |
| --- | --- |
| **Five farms** — Aldwin, Bren, Sekk, Marrow, Hulder | The economy, the first quests, and somewhere to be sent |
| **The Ember Chapter** | The only path to magic; a hill, a lake, and a locked door |
| **Ossric's tower** | The plot. He knows what the dragons are for. |
| **The lighthouse** | Bandits. Reachable at level three, survivable at level eight. |
| **The Cleft** | The ore valley. Enterable from the first hour; lethal until the third chapter. |

## The roads

Roads are the difficulty curve made visible. The generator carves them into the
terrain rather than painting them on it (`PLACES` and `ROADS` in
`src/world/terrain.js`), so a road *is* the flat ground, and walking off it is a
decision you can feel in the slope under your feet.

Every inland road leaves by the land gate and every coastal road by the harbour
gate. That is the whole reason the wall is worth building: if there were four
ways out of the city, being refused at one of them would mean nothing.

| Road | From | To |
| --- | --- | --- |
| gate apron / farm road | the land gate | Aldwin, forking to Bren |
| east road | the land gate | Sekk, by way of the eastern downs |
| cleft road | Sekk | the mouth of the Cleft |
| tower road | the east road | Ossric's tower |
| north lane | the east road | Hulder |
| harbour way | the harbour gate | the western fork |
| temple road | the western fork | the Ember Chapter |
| coast road | the western fork | the lighthouse |
| west lane | the western fork | Marrow |

Three rules keep them walkable, and all three exist because a test found them
broken (`the roads are walkable end to end`, `tools/test.js`):

1. **Heights are written down, not inferred.** Working out a vertex's height
   from the nearest landmark is fine at the ends of a road and nonsense in the
   middle.
2. **A road that ends at a place has a vertex on that place's rim**, already at
   the place's height. Otherwise the lane and the pad disagree about the last
   thirty metres and leave a hump between them.
3. **A cut gets a shoulder three times its depth.** A shelf that needs more
   flank than the island can give it is too high for the island, and the fix is
   to lower the shelf — which is why the monastery stands at twelve metres and
   the tower at fifteen rather than the twenty-two and twenty-six they were
   first drawn at. The height they lost is in the bell tower and the spines
   instead, where it actually shows.

Nothing on the island exceeds twenty degrees on a road, on any seed.

## The other side of the pass

Verath is one seamless surface: you can walk from the harbour gate to the mouth
of the Cleft without a pause, and that is the point — the difficulty curve is
stated in geography, and geography you have to wait for is geography you stop
believing in.

**The Cleft valley is a different world.** Its own heightfield, its own
buildings, its own inhabitants, and the only loading screen in the game. That
is a design decision rather than a concession: the pass is the one place the
player is meant to feel they have left everything behind, and the game this one
is in the tradition of made the same call at the same place.

| In the valley | What it is |
| --- | --- |
| **The camp** | A palisade, a longhouse and four tents. The only safe ground. |
| **Three ore pits** | Terraced holes with headframes and spoil heaps. The economy. |
| **The keep** | Whoever is taking the ore is behind that wall. |
| **The shrine** | Nine standing stones and a cold fire. Somebody still comes here. |

Four people live in it, and there are four for a reason: the valley is meant to
read as *emptied* rather than populated. Brant runs what is left of a camp that
held eighty. Hask still cuts a pit nobody pays him for. Ulla keeps a fire that
has not been lit in a year. One man walks the gap in the palisade. Every one of
them will tell you where the rest went.

Three things to do there, and each follows the same rule the crates on the farm
road follow — a place in the world, reached on foot:

- **Where the ore goes.** Told at the camp, counted at a pit, closed at the camp.
- **The nine stones.** Blackore from all three pits, and the ore is *cut* by
  standing at each pit rather than bought from anyone.
- **The keep.** A real door with a real box in it, opened by knowing what is
  behind it and having been sent.

It looks different because it *is* different: each region carries its own
ground palette and its own flora, so the valley is bare rock and dead trunks
where the island is grass and canopies. Everything past the pass also hits
about twice as hard and takes about twice as much — the chapter-three wall
stated as arithmetic rather than as a locked door. You can walk in at level two
and you will not walk out.

Crossing carries the man and leaves the world: his purse, his oath, his level,
what he is carrying, what he knows, what he has been asked to do, the day and
the hour. Creatures are deliberately not on that list — the valley repopulates,
and the island you come back to has moved on.

## What each order asks of you

Joining is not the content; being used is. Each order sends you to the same
three places for different reasons, which is the cheapest way to make one map
into three games — and the reason picking a guild has to close two doors to
mean anything.

| Order | What it wants | Where the middle is |
| --- | --- | --- |
| **The Watch** | Who moved the ore count off the quay | A porter in the harbour |
| **The Ember Chapter** | A witness who is not a priest | The shrine, past the pass |
| **The Freeblades** | Not *who*, but how much, and where it is stacked | A miner counting loads |

A member of one order cannot be given another's errand, and the test suite
checks all nine combinations rather than the three that were written.

## Chapters

Four, and each one rewrites the map rather than adding to a list.

1. **The gate is shut.** Nobody knows you. The city will not let you into the
   upper quarter, the Cleft kills you, and the whole game is the Vale and the
   lower city.
2. **The orders arrive.** The Watch is reinforced, the Chapter opens its doors,
   the Freeblades start hiring. You take an oath and two doors close for ever.
3. **The road east opens.** The Cleft becomes survivable; the ore convoys start;
   the bandits at the lighthouse become an organised problem.
4. **What the ore is for.** The tower's answer, and the last road.
