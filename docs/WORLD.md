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
| **The lighthouse** | Bandits. Reachable at level three, survivable at level ten. |
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

## Men who fight back

A beast is five boxes and one decision every quarter second. A man is the *same
skeleton the player has*, wearing the same armour pieces, holding the same
weapons, running the same combat state machine — so everything you learn about
timing on a bandit transfers to a keep guard, because there is one fight system
and nobody has a private version of it.

The one thing a man does that a wolf does not is **block**. A wolf is a timing
puzzle you solve by spacing; a man is one you solve by making him commit. He
also holds the ground he was posted on, so a camp cannot be pulled apart one
man at a time from two hundred metres — which is the difference between an
occupation and a queue.

| Where | Who | What it costs you |
| --- | --- | --- |
| The lighthouse | Six bandits and two brigands | Level 3 dies in eight seconds; level 8 is a coin flip; level 10 wins with 60% health |
| The keep | Six keep guards and a picket of three | Chapter four, and everything you have |

Those numbers are measured, not asserted: the test suite runs the same spacing
bot the wood is measured with and pins the assertion at ten, because a test
pinned to a coin flip fails on Tuesdays.

## Trading

Traders, prices and purses have existed since the inventory landed, and there
was no screen — so buying anything in a browser was impossible. There is one
now, and it opens itself when a conversation offers to trade, because "he will
sell you things" and "here is what he has" are the same sentence.

Two rules it makes visible:

- **A trader who buys everything is a wallet with a face.** A smith takes metal
  and leather; a hunter takes pelts and tusks and nothing with a curse on it.
  What he will buy is filtered per man, so the economy has more than one person
  in it.
- **"You cannot afford that" belongs next to the thing**, not in a message
  after you press the key. Affordability is on the row.

His purse runs out too, and he restocks on a chapter boundary rather than on a
timer.

## The map

Drawn as SVG from the region's own `places` and `roads` — the same data the
heightfield carves the ground from — so it cannot disagree with the world it
describes. There is no map asset and no map authoring step: move a farm and the
map moves with it.

Places you have not been to are not on it. Standing *inside* a place's own pad
is what finds it; walking past at sixty metres is not. That is the one rule
that makes a map worth opening twice, and it is why what you have found is
world state that gets saved rather than a drawing option — an island that
un-discovers itself on reload is worse than no map.

**N** opens it.

## The day

Everybody in the city stood on the same square metre from the moment the world
was built, including at three in the morning. They have days now, and a routine
here is deliberately the cheap version of the idea:

- **A routine is a list of hours and places.** "At the anvil from six, in the
  tavern from half seven, home at eleven." They walk there, at walking pace, on
  foot, through the same collision as everything else.
- **It is a clock, not a script.** Where somebody should be is a function of the
  hour alone — no state machine, nothing for a save to store, and nobody a
  conversation can desynchronise.
- **It does not wrap.** A night shift is written twice, once at 22:30 and once
  at 00:00. A day you have to spell out completely is a day with no holes in
  it, and the version that wrapped silently walked the gate guard back to his
  post at one minute past midnight.

The nicest thing about it is a consequence nobody designed: the guard on the
*upper* gate is relieved at night, so there is a window when nobody is turning
strangers away — while the land gate, which is the city's only way in, is
manned at four in the morning. The upper gate is still shut, because a door in
this game is geometry rather than a man.

## Sound

There are no audio files in this project and there are not going to be: the
same rule that makes every texture a function makes every sound one. A footstep
is a filtered noise burst with an envelope; a blade on mail is two of them a few
milliseconds apart with a metallic partial over the top; a parry is a ringing
tone. All of it is a hundred lines of WebAudio and none of it is a download.

Three things shape it:

- **The simulation cannot hear itself.** Nothing in `src/game` or `src/world`
  imports the audio module. The world *emits named events* and the browser
  decides what they are worth, which is why the Node suite and the headless
  bots need no audio context and no stub for one.
- **A parry rings and a block thuds.** If those two sound alike the player
  cannot learn the timing by ear, and learning it by ear is most of what a
  second playthrough is.
- **Audio needs a gesture.** Every browser suspends a context created before
  the user has touched the page, so the graph is built on the first key. Until
  then the game is silent and says so once.

The wind bed is driven from the world's own clock and wind field — the same
quantity the grass is bending to — so the ambience cannot drift out of step
with what is on screen. **M** mutes.

## Thieving

Lockpicking, pickpocketing and sneaking were buyable and inert. What they buy
now rests on one idea:

**The risk is being seen, not failing.** A locked chest is not a roll you pass
or fail; it is a *time cost* spent standing still in somebody's front room —
two seconds for a simple lock, four for a good one, eight for a master's. Walk
away half way and you have lost the progress. A pocket is not a percentage
either: it is a range you must be inside, a direction he must not be facing,
and nobody else watching. Sneaking shortens how far people can see you and does
nothing else, which is enough.

So nothing here rolls dice against the player. Everything is geometry and a
clock, and the punishment for getting it wrong is a person turning round.

Nine chests, placed by hand where somebody would actually put one, and every
position is checked by a test that stands a player beside it and ticks — the
first draft had four of them inside a building's footprint, where the collision
resolver shoved the player away from the thing he was trying to open once per
tick, for ever. A chest you cannot stand next to is not a chest.

Hold **L** at a chest; **P** lifts a purse. Emptied chests and lifted purses
are both saved, because a chest that refills on reload is a chest nobody
bothers to remember.

## Bows

A bow is a *different verb* from a sword, and the reason to carry one is that
it changes where you want to be standing. Three rules, the same three as
everything else:

- **A draw is a commitment.** Nocking and loosing take frames, exactly like a
  swing, and being hit ends the draw.
- **Dexterity is a wall.** Under a bow's requirement you cannot hold it at all.
- **The skill buys the cone, not the damage.** A bow at 10% and a bow at 90%
  hit for the same number when they hit. What changes is how wide the spread
  is, so practice makes you *accurate* — and a novice's miss is a miss he can
  watch and learn from.

Measured hit rate against a standing wolf, aiming properly:

| bow skill | 12 m | 24 m | 40 m |
| --- | --- | --- | --- |
| 0% | 78% | 17% | 5% |
| 30% | 100% | 73% | 27% |
| 60% | 100% | 100% | 63% |
| 90% | 100% | 100% | 95% |

Arrows are spent, they drop (about half a metre over twenty-five, two over
fifty), and they are stopped by armour — which is exactly what armour is
against, and the one thing a rune does not have to care about.

The attack button uses the weapon in hand. There is no separate shoot key,
because that would mean a player holding a bow has an attack button that does
nothing.

## Magic

The Chapter's path, and it is built on the same three rules as everything else.

**A rune is an item.** You do not *know* fire bolt; you carry the rune for it,
it takes a slot in the pack, it can be sold, and losing it loses the spell.
That is what makes the Chapter feel like equipment rather than like a menu that
filled itself in.

**Mana is a wall, not a modifier.** Under a rune's mana requirement you cannot
cast it at all — not "you cast it weaker" — exactly as a sword's strength
requirement works (P3). The pool and the requirement are deliberately different
numbers: a novice with just enough mana to hold a rune can cast it about twice
before he is empty, and closing that gap is the whole of what raising mana buys.

**A bolt is a thing in the world.** It leaves the hand at the end of the
wind-up, takes time to arrive, can miss because the wolf moved, and can hit
something that walked into it. A spell that resolves instantly on a target is a
dice roll with a particle effect on it.

A cast is a commitment on the same footing as a swing: the mana goes at the
start, being hit ends the cast, and the mana does not come back. That is the
only thing that makes being interrupted matter, and it is why a caster learns
to stand behind something.

| Rune | Needs | Costs | What it does |
| --- | --- | --- | --- |
| Fire bolt | 10 mana | 8 | 46, ignoring armour |
| Closed wound | 15 | 20 | Heals 70, on yourself |
| Ice lance | 25 | 16 | 78, faster and thinner |
| Firestorm | 45 | 34 | 120, and it does not stop at the first thing |

Bolts are the one thing in the renderer that makes its own light — one float
per instance — because otherwise a fire bolt at dusk is a brown box travelling
at twenty-six metres a second. It does not light what is around it; that needs
a light list and a second pass, and is written down in `OPEN-QUESTIONS.md`
rather than pretended away.

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

## The end

The game finishes. Taking the keep tells you where a year of blackore went —
*down* — and walking into the deep pit finds who it went to. The last man is
spawned when you arrive rather than pre-placed, so the valley is not haunted by
a boss standing in a hole for forty hours before anybody has sent you.

He plays by the same rules as everything else: same skeleton, same combat state
machine, same parry window, same four frames of commitment. He is simply the
best of them — he blocks more than he swings, takes a very long time to break,
and hits hard enough that the fight is decided by whether you can make him
commit. A boss with private rules throws away everything the player spent forty
hours learning.

Measured with the same spacing bot as the wood and the lighthouse: level 10
dies in six seconds, level 17 wins with a quarter of his health, level 20 with
a third. The endgame is somewhere around seventeen.

Afterwards the island is still there. A finished game is a finished game, not a
closed one.

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
