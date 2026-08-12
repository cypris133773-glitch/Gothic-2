// Regions: the two places the game happens in.
//
// **Verath**, the island, is one seamless surface. You can walk from the
// harbour gate to the mouth of the Cleft without a loading screen, and that is
// the point — the whole difficulty curve is stated in geography, and geography
// you have to wait for is geography you stop believing in.
//
// **The Cleft valley**, past the pass, is a *separate world*. It gets a loading
// screen, and it gets one on purpose rather than as a concession: the pass is
// the one place in the design where the player is meant to feel that they have
// left. Everything they know is on the other side of it. The game this one is
// in the tradition of made exactly the same call at exactly the same place.
//
// A region is data: a size, a set of places, the roads between them, and how
// the noise behaves. Adding a third is this file plus a builder table entry in
// src/world/world.js.

export const VERATH_GATE_APRON = [0, 44];       // outside the land gate
export const VERATH_HARBOUR_APRON = [-40, -4];  // outside the harbour gate

/**
 * The island.
 *
 * `levels` is the height of each road at each point, in metres, and two things
 * about it are load-bearing, both found by the walkability test rather than by
 * looking at it.
 *
 * It is **written down, not inferred.** The first version worked out each
 * vertex's height from whichever place happened to be nearest — fine at the two
 * ends of a road and nonsense in the middle, where the tower road's mid-point
 * was nearest a farm at seven metres, so the lane dropped nineteen metres and
 * climbed back out at one in two.
 *
 * A road that ends at a place carries **a vertex on that place's rim, already
 * at the place's height**, and runs flat from there to the middle. Without it
 * the lane and the pad disagree about the same square metre for the last thirty
 * metres, the blend hands over between them within a couple of steps, and the
 * approach to the monastery has a hump the height of the disagreement.
 */
const VERATH = {
  name: 'verath',
  title: 'The island of Verath',
  size: 512,
  // How the noise is shaped: broad relief, hillocks, fine grain, and how far
  // down the coast falls at the edge of the playable area.
  relief: 34, hills: 5.5, detail: 0.55, floor: -14, edge: 26, edgeStart: 0.72,
  water: true,
  // What the ground is made of, and what grows out of it. These are albedos,
  // and they are the difference between two regions and one region with the
  // furniture moved: the valley is the same generator and does not look like
  // the same place.
  ground: {
    grass: [0.13, 0.18, 0.08], rock: [0.22, 0.21, 0.19],
    shore: [0.30, 0.28, 0.22], paved: [0.17, 0.163, 0.152],
  },
  flora: {
    treeChance: 0.62, trunk: [0.10, 0.07, 0.05],
    canopy: [0.09, 0.145, 0.06], canopySpread: [0.03, 0.045, 0.0],
    height: [4.5, 9.5], dead: false,
    tuft: [0.15, 0.25, 0.07],
  },
  places: {
    halden:     { at: [0, 0],      r: 46, w: 34, level: 1.2, kind: 'city' },
    farm_aldwin:{ at: [-58, 74],   r: 15, level: 3.0, kind: 'farm' },
    farm_bren:  { at: [26, 96],    r: 14, level: 4.5, kind: 'farm' },
    farm_sekk:  { at: [96, 52],    r: 14, level: 6.0, kind: 'farm' },
    farm_marrow:{ at: [-104, 22],  r: 14, level: 5.0, kind: 'farm' },
    farm_hulder:{ at: [64, -84],   r: 14, level: 7.0, kind: 'farm' },
    chapter:    { at: [-18, -118], r: 34, level: 12.0, kind: 'temple' },
    tower:      { at: [122, -104], r: 22, level: 15.0, kind: 'tower' },
    lighthouse: { at: [-142, -34], r: 13, level: 9.0, kind: 'light' },
    cleft:      { at: [168, 46],   r: 22, level: 12.0, kind: 'pass' },
  },
  roads: [
    { name: 'gate apron',  width: 6.0, points: [[0, 34], VERATH_GATE_APRON],                          levels: [1.2, 1.6] },
    { name: 'farm road',   width: 5.0, points: [VERATH_GATE_APRON, [-20, 58], [-58, 74]],             levels: [1.6, 2.2, 3.0] },
    { name: 'south fork',  width: 4.2, points: [[-20, 58], [26, 96]],                                 levels: [2.2, 4.5] },
    { name: 'east road',   width: 5.0, points: [VERATH_GATE_APRON, [54, 30], [78, 14], [96, 52]],     levels: [1.6, 3.5, 5.0, 6.0] },
    { name: 'cleft road',  width: 4.6, points: [[96, 52], [140, 50], [168, 46]],                      levels: [6.0, 9.0, 12.0] },
    { name: 'tower road',  width: 4.0, points: [[78, 14], [110, -46], [117.5, -82], [122, -104]],     levels: [5.0, 10.0, 15.0, 15.0] },
    { name: 'north lane',  width: 4.0, points: [[78, 14], [64, -84]],                                 levels: [5.0, 7.0] },
    { name: 'harbour way', width: 5.4, points: [[-26, 0], VERATH_HARBOUR_APRON],                      levels: [1.2, 1.5] },
    { name: 'temple road', width: 4.6, points: [VERATH_HARBOUR_APRON, [-36, -62], [-28, -86], [-18, -118]], levels: [1.5, 8.0, 12.0, 12.0] },
    { name: 'coast road',  width: 4.4, points: [VERATH_HARBOUR_APRON, [-88, -20], [-142, -34]],       levels: [1.5, 5.0, 9.0] },
    { name: 'west lane',   width: 4.0, points: [VERATH_HARBOUR_APRON, [-104, 22]],                    levels: [1.5, 5.0] },
  ],
  // Where a new game begins, where you come back to, and where you leave from.
  //
  // `returnAt` is *not* the same point as the exit. Arriving on top of the way
  // you came in means standing in it, which means being sent straight back —
  // the browser harness caught exactly that, crossing to the valley and
  // arriving home again inside half a second.
  arrive: [0, 26],
  returnAt: [146, 48],
  exits: [{ to: 'cleftvale', at: [168, 46], radius: 14, needs: 'quest:q_cleft:told' }],
};

/**
 * The Cleft valley: the ore, and everything that has gone wrong around it.
 *
 * Higher, harder and narrower than the island — a floor at forty metres with
 * ridges either side, one road down its length, and nothing on it that a
 * chapter-one character survives. There is no coast here and no sea level to
 * fall to, so the edge rises into rock instead of dropping into water, and a
 * player who walks to the boundary meets a mountain rather than a beach.
 */
const CLEFTVALE = {
  name: 'cleftvale',
  title: 'The Cleft valley',
  size: 448,
  relief: 40, hills: 6.0, detail: 0.7, floor: 8, edge: -34, edgeStart: 0.70,
  water: false,
  // Bare rock, ore-stained spoil, and a road worn into the dirt rather than
  // cobbled. Nothing here is green because nothing here has been left alone
  // long enough to be.
  ground: {
    grass: [0.072, 0.068, 0.062], rock: [0.100, 0.096, 0.092],
    shore: [0.085, 0.078, 0.070], paved: [0.082, 0.076, 0.068],
  },
  flora: {
    // Dead trunks and boulders. A third as many trees as the island, none of
    // them with anything on top, and the ones that are left are grey.
    treeChance: 0.22, trunk: [0.075, 0.065, 0.055],
    canopy: [0.068, 0.062, 0.052], canopySpread: [0.015, 0.015, 0.010],
    height: [3.5, 7.0], dead: true,
    tuft: [0.085, 0.078, 0.062],
  },
  // Levels sit near where the noise already puts the ground — around thirty
  // metres — rather than being carved down to the island's numbers. A pad that
  // is sixteen metres below its surroundings needs fifty of flank to reach
  // them, and the walkability test finds the road that was drawn across it.
  places: {
    gate:      { at: [0, 130],    r: 26, level: 24.0, kind: 'pass' },
    camp:      { at: [-16, 62],   r: 30, w: 24, level: 26.0, kind: 'camp' },
    pit_one:   { at: [-92, 6],    r: 20, level: 30.0, kind: 'mine' },
    pit_two:   { at: [74, -18],   r: 20, level: 32.0, kind: 'mine' },
    pit_three: { at: [-40, -96],  r: 18, level: 36.0, kind: 'mine' },
    keep:      { at: [96, -110],  r: 26, level: 42.0, kind: 'keep' },
    shrine:    { at: [-118, -74], r: 16, level: 36.0, kind: 'temple' },
  },
  roads: [
    { name: 'the pass',    width: 6.0, points: [[0, 130], [-8, 96], [-16, 62]],                   levels: [24.0, 25.0, 26.0] },
    { name: 'west drift',  width: 4.6, points: [[-16, 62], [-56, 34], [-92, 6]],                  levels: [26.0, 28.0, 30.0] },
    { name: 'east drift',  width: 4.6, points: [[-16, 62], [34, 26], [74, -18]],                  levels: [26.0, 29.0, 32.0] },
    { name: 'deep road',   width: 4.2, points: [[-16, 62], [-26, -6], [-40, -96]],                levels: [26.0, 31.0, 36.0] },
    { name: 'keep road',   width: 4.2, points: [[74, -18], [92, -66], [96, -88], [96, -110]],     levels: [32.0, 38.0, 42.0, 42.0] },
    { name: 'shrine path', width: 3.6, points: [[-92, 6], [-108, -34], [-118, -58], [-118, -74]], levels: [30.0, 33.0, 36.0, 36.0] },
  ],
  arrive: [-4, 104],
  returnAt: [-4, 104],
  exits: [{ to: 'verath', at: [0, 130], radius: 14 }],
};

export const REGIONS = { verath: VERATH, cleftvale: CLEFTVALE };
export const DEFAULT_REGION = 'verath';

export const region = (name) => REGIONS[name] || REGIONS[DEFAULT_REGION];
