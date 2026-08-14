// Boot, capability gate, and the loop.
//
// The loop is fixed-step at 60 Hz with rendering decoupled from it, and it is
// written that way now rather than converted later because every gameplay
// system built against a variable timestep has to be re-tuned when it changes —
// combat frame counts most of all, and those are what this game is about.

import { detect, initialTier, refusalReason } from './core/caps.js';
import { createDevice } from './render/device.js';
import { createInput, idleIntent } from './core/input.js';
import { createWorld, travel } from './world/world.js';
import { createOverlay, FrameTimer, log } from './core/log.js';
import { STATE_NAME } from './game/combat.js';
import { cameraRight } from './game/camera.js';
import { createStorage } from './core/save.js';
import { SKILLS, xpToNext, lpForAttribute } from './game/character.js';
import { CHAPTERS } from './game/chapters.js';
import { SPELLS } from './game/magic.js';
import { createSound } from './audio/sound.js';
import { ITEMS } from './data/items.js';

const TICK_MS = 1000 / 60;          // the simulation is 60 Hz, always
const MAX_CATCHUP_MS = 250;         // a backgrounded tab must not simulate four minutes on return

const params = new URLSearchParams(location.search);
const off = new Set((params.get('off') || '').split(',').filter(Boolean));

// Frames to render before the build gate reads the buffer, and the scale it
// renders them at. Both are small on purpose: see the note at the probe below.
const PROBE_FRAME = Number(params.get('probe')) || 3;
const renderScale = Number(params.get('renderScale')) || 0;

async function boot() {
  const canvas = document.getElementById('view');
  const gate = document.getElementById('gate');
  const caps = await detect();
  const tier = params.get('tier') || initialTier(caps);

  const why = refusalReason(caps);
  if (why) {
    document.getElementById('gate-why').textContent = why;
    gate.hidden = false;
    window.GRIMWARD = { state: 'refused', caps, why };
    return;
  }

  // Quality tiers, and the first thing they buy or spend is the shadow pass:
  // it doubles the geometry submitted per frame, which is nothing on a GPU and
  // the difference between 30 fps and 14 on a software rasteriser. `?off=shadows`
  // switches it off anywhere, which is also how you bisect a lighting bug.
  // A hand-held screen is held at arm's length and its GPU is fed by a battery.
  // Both of those are decided here rather than by the tier, because a phone is
  // not a weak desktop: it wants the textures and it cannot afford the pixels.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const device = await createDevice(canvas, caps, {
    // The shadow pass doubles the geometry submitted per frame. That is nothing
    // on a desk and it is the whole battery on a phone, so a coarse pointer
    // gives it up unless `?tier=` says otherwise on purpose.
    shadows: !off.has('shadows') && tier !== 'low' && (!coarse || params.has('tier')),
    shadowSize: tier === 'high' ? 2048 : 1024,
    textures: !off.has('textures') && tier !== 'low',
  });
  let world = createWorld({
    seed: Number(params.get('seed')) || 1,
    hour: params.has('time') ? Number(params.get('time')) : 9,
    props: params.has('props') ? Number(params.get('props')) : undefined,
    region: params.get('region') || undefined,
    lineup: params.has('lineup')
      ? (params.get('lineup') ? params.get('lineup').split(',').filter(Boolean) : true)
      : false,
    clutter: params.has('clutter')
      ? Number(params.get('clutter'))
      : ({ low: 0, medium: 1100, high: 2600, ultra: 4000 })[tier] ?? 1100,
    start: params.has('start') ? params.get('start').split(',').map(Number) : undefined,
    yaw: params.has('yaw') ? Number(params.get('yaw')) : undefined,
  });
  // Terrain streaming: rebuild the meshes when the player crosses into a new
  // chunk, and never otherwise. It is a single synchronous rebuild for now,
  // which is a real hitch of a few milliseconds on a boundary — the budgeted,
  // worker-decoded version is §9.7's job and is written down in
  // docs/OPEN-QUESTIONS.md rather than pretended away.
  let terrainCell = world.terrainCell();
  let terrainMs = 0;
  const rebuildTerrain = () => {
    const built = world.chunks();
    terrainMs = built.ms;
    device.setTerrain(built);
  };
  rebuildTerrain();

  // --- crossing the pass ------------------------------------------------------
  //
  // The island streams; you can walk from the harbour to the mouth of the Cleft
  // without a pause. The valley on the other side is a *different world* — its
  // own heightfield, its own buildings, its own inhabitants — and building one
  // is a real half-second of work, so it gets the one loading screen in the
  // game. That is a design decision rather than a concession: the pass is the
  // place the player is meant to feel they have left everything behind.
  let lastQuestCount = 0;
  const loadEl = document.getElementById('loading');
  const whereEl = document.getElementById('loading-where');
  const noteEl = document.getElementById('loading-note');
  let travelling = false;

  async function crossTo(to) {
    if (travelling) return false;
    travelling = true;
    whereEl.textContent = to === 'cleftvale' ? 'The Cleft valley' : 'The island of Verath';
    noteEl.textContent = to === 'cleftvale'
      ? 'Past the barricade the road belongs to whatever has been eating the ore convoys.'
      : 'The road home.';
    loadEl.hidden = false;
    // Two frames of the screen actually on the glass before the main thread
    // disappears into world generation. Without them the browser coalesces the
    // paint with the one after the build and the screen never shows.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t0 = performance.now();
    const result = travel(world, to, { props: world.props.length });
    if (!result.ok) {
      log(`could not travel: ${result.why}`);
      loadEl.hidden = true; travelling = false;
      return false;
    }
    world = result.world;
    api.world = world;
    rebuildTerrain();
    terrainCell = world.terrainCell();
    lastQuestCount = world.quests.size;
    log(`${result.title} — built in ${Math.round(performance.now() - t0)} ms`);
    loadEl.hidden = true;
    travelling = false;
    renderBook();
    return true;
  }

  // --- sound ------------------------------------------------------------------
  //
  // Created now, started on the first gesture, because every browser suspends
  // an AudioContext made before the user has touched the page. Until then the
  // game is silent and says so once — the same rule the capability gate applies
  // to everything else.
  const sound = createSound({ off: off.has('sound') });
  if (!sound.enabled && sound.reason) log(sound.reason);
  const wake = () => {
    if (sound.start()) {
      log('sound on — M to mute');
      removeEventListener('keydown', wake);
      removeEventListener('pointerdown', wake);
    }
  };
  addEventListener('keydown', wake);
  addEventListener('pointerdown', wake);

  const input = createInput(canvas);
  const overlay = createOverlay(document.getElementById('overlay'));
  const timer = new FrameTimer();

  log(`backend ${device.backend}, tier ${tier}, gpu ${caps.gpu || 'unknown'}`);

  const api = {
    state: 'playing', caps, tier, world, device, input,
    // Exposed so the browser harness can cross the pass without walking there,
    // and so a bug report can say "load the valley and look at this".
    crossTo,
    frames: 0,
    // What the browser-side tests read. Everything here is simulation state,
    // never input state: the loop drains input every tick, so reading it back
    // proves nothing about whether the character actually moved.
    probeState: () => ({
      pos: [...world.player.pos], vel: [...world.player.vel],
      yaw: world.player.yaw, speed: world.player.speed,
      onGround: world.player.onGround, sneaking: world.player.sneaking,
      camera: [...world.camera.pos], camDist: world.camera.dist,
      // The camera's own right, the same vector the renderer builds in
      // `lookAt`. The browser checks steer by it, so "turned right" means
      // right *on the screen* rather than right in some other frame.
      camRight: cameraRight(world.camera),
      combat: {
        state: world.player.fighter.state, t: world.player.fighter.t,
        hp: world.player.fighter.hp, swings: world.player.fighter.swings,
        hits: world.player.fighter.hits, combo: world.player.fighter.combo,
      },
      xp: world.player.xp, level: world.player.level,
      talking: world.dialogue.isOpen,
      options: world.dialogue.active ? world.dialogue.active.options.map((o) => o.id) : [],
      reply: world.dialogue.active ? world.dialogue.active.reply : null,
      gold: world.character.gold, lp: world.character.lp,
      skills: { ...world.character.skills }, guild: world.character.guild,
      flags: [...world.flags],
      trainer: world.openTrainer ? world.openTrainer.skill : null,
      chapter: world.chapter,
      region: world.region, regionTitle: world.regionTitle,
      pendingTravel: world.pendingTravel,
      dead: world.dead, deadFor: world.deadFor,
      finished: world.finished,
      sound: { on: sound.enabled, muted: sound.muted },
      touch: input.touch
        ? { on: input.touch.active, mag: +input.touch.mag.toFixed(3), stick: [+input.touch.x.toFixed(3), +input.touch.z.toFixed(3)] }
        : null,
      title: atTitle,
      quests: world.questLog().map((q) => `${q.id}:${q.stage}`),
      items: world.items().map((i) => `${i.id}×${i.n}${i.equipped ? '*' : ''}`),
      weapon: world.inventory.weapon, armour: world.inventory.armour,
      book: tab,
      shop: world.shop(),
      seen: [...world.seen],
      mana: world.caster.mana, manaMax: world.caster.max,
      bow: world.bow(),
      chest: (() => {
        const c = world.nearestChest();
        return c ? { id: c.id, lock: c.lock, open: c.open, emptied: c.emptied, picked: c.picked } : null;
      })(),
      watchers: world.watchers().length,
      casting: world.caster.casting, bolts: world.bolts.length,
      spells: world.spells().map((sp) => `${sp.id}${sp.ok ? '' : '!'}`),
      selectedSpell,
      doors: { upper: world.doorOpen('upper') },
      beasts: world.beasts.map((b) => ({ kind: b.kind, hp: b.hp, state: b.state,
        dist: +Math.hypot(b.pos[0] - world.player.pos[0], b.pos[2] - world.player.pos[2]).toFixed(2) })),
      clock: world.clock.hhmm, ticks: world.ticks, frames: api.frames,
      frame: timer.percentiles(),
      ...device.stats,
    }),
  };
  window.GRIMWARD = api;

  // --- saving ---------------------------------------------------------------
  // F5 saves, F9 loads, and the world autosaves whenever a quest moves. A save
  // is a few kilobytes because it stores what changed rather than the world.
  const storage = createStorage(caps);
  if (storage.inMemory) log('storage unavailable — saves last only for this session');

  async function save(slot = 'auto') {
    try {
      const data = world.snapshot();
      await storage.put(slot, data);
      log(`saved (${slot}, ${JSON.stringify(data).length} bytes)`);
      return true;
    } catch (e) { log(`save failed: ${e.message}`); return false; }
  }

  async function load(slot = 'auto') {
    try {
      const data = await storage.get(slot);
      if (!data) { log(`no save in ${slot}`); return false; }
      // A save says which world it is in, and restoring into the wrong one is
      // refused rather than fudged. Cross first if it names the other region.
      const region = data.region || 'verath';
      if (region !== world.region) await crossTo(region);
      world.restore(data);
      rebuildTerrain();
      log(`loaded ${slot}`);
      return true;
    } catch (e) {
      // A corrupt or foreign save is a message, never a broken game (§12.1).
      log(`could not load ${slot}: ${e.message}`);
      return false;
    }
  }
  api.save = save; api.load = load;

  // --- conversations ---------------------------------------------------------
  // --- the title screen ---------------------------------------------------------
  //
  // Shown over a world that is already rendering, because the world *is* the
  // art and there is nothing to load. It is also where the audio context gets
  // its gesture, so the game is never silently confusing on the first key.
  //
  // `?menu=0` skips it, which is how every harness in this repo starts a game
  // without knowing the menu exists.
  const titleEl = document.getElementById('title');
  const menuEl = document.getElementById('title-menu');
  // `?menu=0` skips it and `?menu=1` forces it, which is how the render gate
  // photographs a menu that a probe run would otherwise never show.
  let atTitle = params.get('menu') === '1'
    || (params.get('menu') !== '0' && !params.has('probe') && !params.has('lineup'));

  async function renderTitle() {
    // Shown *first*, filled in second. Listing the save slots opens IndexedDB,
    // which can take a few hundred milliseconds — and the render gate captures
    // its frame long before that, so an await before the reveal photographs an
    // empty screen and reports the menu as missing.
    titleEl.hidden = !atTitle;
    if (!atTitle) return;
    const slots = await storage.list().catch(() => []);
    if (!atTitle) return;               // begun while we were asking
    const rows = [
      ['1', 'Begin', true],
      ['2', 'Continue where you left off', slots.includes('auto')],
      ['3', 'Load your last manual save', slots.includes('manual')],
    ];
    menuEl.replaceChildren(...rows.map(([key, label, on2]) => {
      const li = document.createElement('li');
      if (!on2) li.className = 'off';
      else li.dataset.act = key;      // and a finger can press it too
      const b = document.createElement('b');
      b.textContent = key;
      li.append(b, document.createTextNode(label));
      return li;
    }));
  }

  /** What the three title rows do, whether they were pressed or tapped. */
  function titleChoice(n) {
    if (n === '1') { leaveTitle(); return; }
    if (n === '2') { load('auto').then(leaveTitle); return; }
    if (n === '3') { load('manual').then(leaveTitle); }
  }

  function leaveTitle() {
    atTitle = false;
    titleEl.hidden = true;
    // The clock only starts once somebody is playing, so a title screen left
    // open all afternoon does not put the player down at dusk.
    lastFrame = performance.now();
  }

  // --- death ------------------------------------------------------------------
  const diedEl = document.getElementById('died');
  const diedWhere = document.getElementById('died-where');
  function renderDied() {
    if (!world.dead) { diedEl.hidden = true; return; }
    diedEl.hidden = false;
    const [hx, hz] = world.safeHaven();
    const near = Object.entries(world.places)
      .map(([name, p]) => ({ name, d: Math.hypot(p.at[0] - hx, p.at[1] - hz) }))
      .sort((a, b) => a.d - b.d)[0];
    diedWhere.textContent = `You would wake near ${near ? near.name.replace(/_/g, ' ') : 'the road'}.`;
  }

  // --- the shop -----------------------------------------------------------------
  const shopEl = document.getElementById('shop');
  const shopWho = document.getElementById('shop-who');
  const shopStock = document.getElementById('shop-stock');
  const shopMine = document.getElementById('shop-mine');
  /** What the number keys buy and sell right now. */
  let buying = [], selling = [];

  function renderShop() {
    const s = world.shop();
    if (!s) { shopEl.hidden = true; buying = []; selling = []; return; }
    shopEl.hidden = false;
    shopWho.textContent = `${s.id.replace(/_/g, ' ')}  ·  you have ${s.purse} coin  ·  he has ${s.gold}`;

    buying = s.stock.slice(0, 9);
    selling = s.mine.slice(0, 9);

    const row = (i, name, note, off, side, idx) => {
      const li = document.createElement('li');
      if (off) li.className = 'off';
      // Tapping a row is the same act as pressing its number, and it is the
      // only way to buy anything on a phone.
      if (side) li.dataset[side] = String(idx);
      const k = document.createElement('span'); k.className = 'k'; k.textContent = i;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = name;
      const m2 = document.createElement('span'); m2.className = 'm'; m2.textContent = note;
      li.append(k, n, m2);
      return li;
    };
    const empty = (text) => {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = text;
      return li;
    };

    shopStock.replaceChildren(...(buying.length
      ? buying.map((it, i) => row(`${i + 1}`, `${it.name}${it.n > 1 ? ` ×${it.n}` : ''}`, `${it.price}g`, !it.afford, 'buy', i))
      : [empty('His rack is bare.')]));
    shopMine.replaceChildren(...(selling.length
      ? selling.map((it, i) => row(`⇧${i + 1}`, `${it.name}${it.n > 1 ? ` ×${it.n}` : ''}`, `${it.price}g`, !it.wanted, 'sell', i))
      : [empty('Nothing here he deals in.')]));
  }

  // --- the end ------------------------------------------------------------------
  const endedEl = document.getElementById('ended');
  const endedBody = document.getElementById('ended-body');
  let endShown = false;
  function renderEnded() {
    if (!world.finished || endShown) { endedEl.hidden = true; return; }
    endedEl.hidden = false;
    const c = world.character;
    const order = { watch: 'the Watch', ember: 'the Ember Chapter', freeblade: 'the Freeblades' }[c.guild];
    endedBody.textContent =
      `A year of blackore went down that pit and none of it came back up as anything. `
      + `It does not any more.\n\n`
      + `${c.name}, level ${c.level}${order ? `, sworn to ${order}` : ', sworn to nobody'}, `
      + `${world.seen.size} places found, on day ${world.clock.day}.`;
  }

  const talkEl = document.getElementById('talk');
  const whoEl = document.getElementById('talk-who');
  const replyEl = document.getElementById('talk-reply');
  const optionsEl = document.getElementById('talk-options');

  function renderTalk() {
    const active = world.dialogue.active;
    if (!active) { talkEl.hidden = true; return; }
    talkEl.hidden = false;
    const trainer = world.openTrainer;
    whoEl.textContent = (active.npc.kitName || active.npc.kit?.name || active.npc.id)
      + (trainer ? `  ·  teaching ${trainer.skill}` : '');
    replyEl.textContent = active.reply || '';
    optionsEl.replaceChildren(...active.options.map((o, i) => {
      const li = document.createElement('li');
      li.dataset.say = String(i);
      const b = document.createElement('b');
      b.textContent = `${i + 1}.`;
      li.append(b, document.createTextNode(o.text));
      return li;
    }));
  }

  // --- the character's book: sheet, pack and quest log ------------------------
  //
  // Three screens behind one panel, because they are read together: "can I
  // afford that sword yet" is a question about the pack and the sheet at the
  // same time, and a player who has to close one to check the other stops
  // checking. Number keys act on the highlighted list, which is the whole of
  // the interaction — no drag, no pointer, nothing that needs a mouse.
  const bookEl = document.getElementById('book');
  const bodyEl = document.getElementById('book-body');
  const hintEl = document.getElementById('book-hint');
  const tabsEl = document.getElementById('book-tabs');
  let tab = null;                     // null = closed
  let selectedSpell = null;           // which rune R throws

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  /** A numbered row: key, name, and a right-hand note. */
  const row = (i, name, note, cls = '') => {
    const li = el('li', cls);
    // A numbered row is an action, and an action must be reachable by a finger
    // as well as by its number. The index is the row's number minus one, which
    // is exactly what `actions` is keyed by — the two lists are built together
    // in every tab, so they cannot get out of step.
    if (i != null) li.dataset.act = String(Number(i) - 1);
    li.append(el('span', 'k', i != null ? String(i) : ''), el('span', 'n', name), el('span', 'm', note || ''));
    return li;
  };

  /** What the number keys act on right now, so the handler stays dumb. */
  let actions = [];

  /**
   * The line at the foot of the book.
   *
   * It says how to work the screen, so it has to say something different when
   * there is no keyboard: "Esc closes" is a lie on a phone and "C/I/J switch"
   * is nonsense. One helper rather than five duplicated ternaries, and the
   * touch wording is written beside the key wording so the two cannot describe
   * different screens.
   */
  const setHint = (what, keys, tap) => {
    const onTouch = document.body.classList.contains('touch');
    hintEl.textContent = [what, onTouch ? tap : keys].filter(Boolean).join('  ·  ');
  };

  function renderSheet() {
    const c = world.character;
    const f = world.player.fighter;
    const out = [];
    out.push(el('h3', null, 'The man'));
    const dl = el('dl');
    const put = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
    put('Name', c.name);
    put('Order', c.guild ? ({ watch: 'The Watch', ember: 'The Ember Chapter', freeblade: 'The Freeblades' })[c.guild] : 'sworn to nobody');
    put('Chapter', `${world.chapter} — ${CHAPTERS[world.chapter].title}`);
    put('Level', `${c.level}   (${xpToNext(c)} xp to the next)`);
    put('Learning points', String(c.lp));
    put('Gold', String(c.gold));
    out.push(dl);

    out.push(el('h3', null, 'Attributes  —  press the number to raise one'));
    actions = [];
    const ul = el('ul');
    for (const [i, attr] of ['str', 'dex', 'mana'].entries()) {
      const cost = lpForAttribute(c[attr]);
      const label = { str: 'Strength', dex: 'Dexterity', mana: 'Mana' }[attr];
      const can = c.lp >= cost;
      ul.append(row(i + 1, `${label}  ${c[attr]}`, `${cost} LP`, can ? 'on' : 'off'));
      actions.push({ do: () => world.raise(attr, 1) });
    }
    out.push(ul);

    out.push(el('h3', null, 'Skills'));
    const su = el('ul');
    for (const [key, def] of Object.entries(SKILLS)) {
      if (def.kind === 'percent') {
        const v = c.skills[key] || 0;
        if (!v && key !== 'oneHanded') continue;      // only what he has touched
        su.append(row(null, def.label, `${v}%`, v ? 'on' : 'off'));
      } else if (c.flags.has(`skill:${key}`) || world.flags.has(`skill:${key}`)) {
        su.append(row(null, def.label, 'known', 'on'));
      }
    }
    out.push(su);

    out.push(el('h3', null, 'In hand'));
    const hl = el('dl');
    hl.append(el('dt', null, 'Weapon'), el('dd', null, world.inventory.weapon ? ITEMS[world.inventory.weapon].name : 'empty hands'));
    hl.append(el('dt', null, 'Armour'), el('dd', null, world.inventory.armour ? ITEMS[world.inventory.armour].name : 'nothing'));
    hl.append(el('dt', null, 'Health'), el('dd', null, `${f.hp} / ${c.maxHp}`));
    out.push(hl);

    setHint('Raise an attribute', '1–3 to raise · C/I/J switch · Esc closes', 'Tap one to raise it');
    bodyEl.replaceChildren(...out);
  }

  function renderPack() {
    const items = world.items();
    actions = [];
    const out = [];
    if (!items.length) out.push(el('p', 'empty', 'You are carrying nothing at all.'));
    let n = 0;
    for (const kind of ['weapon', 'armour', 'potion', 'trophy', 'misc']) {
      const group = items.filter((it) => it.kind === kind);
      if (!group.length) continue;
      out.push(el('h3', null, { weapon: 'Weapons', armour: 'Armour', potion: 'Draughts', trophy: 'Trophies', misc: 'Other' }[kind]));
      const ul = el('ul');
      for (const it of group) {
        n++;
        const req = it.str ? `needs ${it.str} str` : it.dex ? `needs ${it.dex} dex` : '';
        const note = [it.n > 1 ? `×${it.n}` : '', it.equipped ? 'in hand' : '', req,
          it.value ? `${it.value}g` : ''].filter(Boolean).join('  ');
        ul.append(row(n <= 9 ? n : null, it.name, note, it.equipped ? 'on' : ''));
        if (n <= 9) {
          actions.push({
            do: () => (kind === 'potion' ? world.drink(it.id)
              : it.equipped ? world.unequip(kind === 'weapon' ? 'weapon' : 'armour')
                : world.equip(it.id)),
          });
        }
      }
      out.push(ul);
    }
    setHint('Equip, unequip or drink', '1–9 · C/I/J switch · Esc closes', 'Tap a line');
    bodyEl.replaceChildren(...out);
  }

  function renderRunes() {
    const list = world.spells();
    actions = [];
    const out = [];
    if (!list.length) {
      out.push(el('p', 'empty', 'You are carrying no runes. The Chapter sells them, and only to its own.'));
    } else {
      out.push(el('h3', null, 'Runes  —  press the number to make it the one R throws'));
      const ul = el('ul');
      for (const [i, sp] of list.entries()) {
        if (!selectedSpell) selectedSpell = sp.id;
        const note = sp.ok ? `${sp.cost} mana` : sp.why;
        const cls = sp.id === selectedSpell ? 'on' : (sp.ok ? '' : 'off');
        ul.append(row(i + 1, `${sp.name}${sp.id === selectedSpell ? '  ◄' : ''}`, note, cls));
        actions.push({ do: () => { selectedSpell = sp.id; return { ok: true }; } });
      }
      out.push(ul);
    }
    const dl = el('dl');
    dl.append(el('dt', null, 'Mana'), el('dd', null,
      `${Math.floor(world.caster.mana)} / ${world.caster.max}`));
    dl.append(el('dt', null, 'Casting'), el('dd', null,
      world.caster.casting ? SPELLS[world.caster.casting].short : '—'));
    out.push(el('h3', null, 'The pool'), dl);
    setHint('Choose the rune you throw', '1–9 · R throws it · C/I/J/K switch · Esc closes', 'Tap a rune, then Cast a rune under ☰');
    bodyEl.replaceChildren(...out);
  }

  /**
   * The map.
   *
   * Drawn as SVG from the region's own `places` and `roads` — the same data the
   * heightfield carves the ground from — so it can never disagree with the
   * world it describes. There is no separate map asset and there is no map
   * authoring step: move a farm and the map moves.
   *
   * Places you have not been to are not on it. That is the one rule that makes
   * a map worth opening twice, and it is why `seen` is world state rather than
   * a drawing option.
   */
  function renderMap() {
    actions = [];
    const T = world.terrain;
    const size = T.size / 2;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const span = 200;                     // metres shown either side of the origin
    svg.setAttribute('viewBox', `${-span} ${-span} ${span * 2} ${span * 2}`);
    svg.setAttribute('class', 'map');

    const node = (kind, attrs) => {
      const n = document.createElementNS(NS, kind);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      return n;
    };

    // The sea, or the valley floor: one rounded rectangle under everything.
    svg.append(node('rect', {
      x: -span, y: -span, width: span * 2, height: span * 2,
      rx: 14, class: T.water ? 'map-sea' : 'map-rock',
    }));
    svg.append(node('circle', { cx: 0, cy: 0, r: size * 0.74, class: 'map-land' }));

    // Roads first, so places sit on top of them.
    for (const road of T.roads) {
      const d = road.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
      svg.append(node('path', { d, class: 'map-road' }));
    }

    // Places, but only the ones he has actually stood near.
    for (const [name, p] of Object.entries(T.places)) {
      if (!world.seen.has(name)) continue;
      svg.append(node('circle', { cx: p.at[0], cy: p.at[1], r: Math.max(5, p.r * 0.32), class: `map-place map-${p.kind}` }));
      const label = node('text', { x: p.at[0], y: p.at[1] - Math.max(9, p.r * 0.32 + 5), class: 'map-label' });
      label.textContent = name.replace(/_/g, ' ');
      svg.append(label);
    }

    // Him. A wedge rather than a dot, because which way you are facing is half
    // of what a map is for.
    const px = world.player.pos[0], pz = world.player.pos[2];
    const yaw = world.player.yaw;
    const tip = [px + Math.sin(yaw) * 13, pz + Math.cos(yaw) * 13];
    const l = [px + Math.sin(yaw + 2.5) * 8, pz + Math.cos(yaw + 2.5) * 8];
    const r2 = [px + Math.sin(yaw - 2.5) * 8, pz + Math.cos(yaw - 2.5) * 8];
    svg.append(node('path', {
      d: `M${tip[0]} ${tip[1]} L${l[0]} ${l[1]} L${px} ${pz} L${r2[0]} ${r2[1]} Z`,
      class: 'map-you',
    }));

    const out = [el('h3', null, `${world.regionTitle}  —  ${world.seen.size} places found`)];
    out.push(svg);
    const dl = el('dl');
    dl.append(el('dt', null, 'You are at'), el('dd', null, `${px.toFixed(0)}, ${pz.toFixed(0)}`));
    dl.append(el('dt', null, 'Day'), el('dd', null, `${world.clock.day}, ${world.clock.hhmm}`));
    out.push(dl);
    setHint('Places appear once you have been near them', 'C/I/J/K/N switch · Esc closes', null);
    bodyEl.replaceChildren(...out);
  }

  function renderLog() {
    const rows = world.questLog();
    actions = [];
    const out = [];
    if (!rows.length) out.push(el('p', 'empty', 'Nobody has asked you for anything yet.'));
    const open = rows.filter((r) => !r.finished);
    const shut = rows.filter((r) => r.finished);
    if (open.length) {
      out.push(el('h3', null, 'What is being asked of you'));
      const ul = el('ul');
      for (const r of open) {
        ul.append(row(null, r.title, `${r.step}/${r.steps}`));
        const p2 = el('p', 'q', r.text);
        ul.append(p2);
      }
      out.push(ul);
    }
    if (shut.length) {
      out.push(el('h3', null, 'Finished, one way or another'));
      const ul = el('ul');
      for (const r of shut) ul.append(row(null, r.title, r.stage, 'done'));
      out.push(ul);
    }
    setHint(null, 'C/I/J switch · Esc closes', null);
    bodyEl.replaceChildren(...out);
  }

  function renderBook() {
    if (!tab) { bookEl.hidden = true; actions = []; return; }
    bookEl.hidden = false;
    for (const b of tabsEl.querySelectorAll('button')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    ({ sheet: renderSheet, pack: renderPack, log: renderLog, runes: renderRunes, map: renderMap })[tab]();
  }
  const openBook = (which) => { tab = tab === which ? null : which; renderBook(); };
  api.book = { open: openBook, get tab() { return tab; }, render: renderBook };

  addEventListener('keydown', (e) => {
    if (e.code === 'F3') { overlay.toggle(); return; }

    // The title takes the keyboard before anything else does.
    if (atTitle) {
      const m = /^Digit([1-3])$/.exec(e.code);
      if (m) titleChoice(m[1]);
      return;
    }

    // The ending takes one key and then gets out of the way. A finished game is
    // a finished game, not a closed one: the island is still there.
    if (world.finished && !endShown) { endShown = true; endedEl.hidden = true; return; }

    // Death takes the keyboard. Nothing else is offered because nothing else
    // is available: you load, or you wake up somewhere else and poorer.
    if (world.dead) {
      if (e.code === 'F9') { e.preventDefault(); load('manual').then(renderDied); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { world.revive(); renderDied(); return; }
      return;
    }

    // The book takes the number keys while it is up, and a conversation takes
    // them back — you cannot equip a sword mid-sentence, which is deliberate.
    if (tab && !world.dialogue.isOpen) {
      if (e.code === 'Escape') { tab = null; renderBook(); return; }
      if (e.code === 'KeyC') { openBook('sheet'); return; }
      if (e.code === 'KeyI') { openBook('pack'); return; }
      if (e.code === 'KeyJ') { openBook('log'); return; }
      if (e.code === 'KeyK') { openBook('runes'); return; }
      if (e.code === 'KeyN') { openBook('map'); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && actions[n - 1]) {
        const r = actions[n - 1].do();
        if (r && r.why && !r.ok) log(r.why);
        renderBook();
      }
      return;
    }

    // The shop takes the keyboard while it is open, including from the
    // conversation that opened it.
    if (world.openTrader) {
      if (e.code === 'Escape') { world.openTrader = null; renderShop(); renderTalk(); return; }
      // Read from `e.code`, not `e.key`. Shift+1 is "!" on most layouts and
      // "1" on almost none, so a shop keyed off `e.key` sells nothing to
      // anybody outside the country its author lives in.
      const m2 = /^Digit([1-9])$/.exec(e.code);
      if (m2) {
        const n = Number(m2[1]);
        const it = e.shiftKey ? selling[n - 1] : buying[n - 1];
        if (it) {
          const r = e.shiftKey ? world.sell(it.id) : world.buy(it.id);
          if (!r.ok) log(r.why);
        }
        renderShop();
      }
      return;
    }

    if (world.dialogue.isOpen) {
      if (e.code === 'Escape') { world.dialogue.close(); renderTalk(); return; }
      if (e.code === 'KeyT') { const r = world.train(); log(r.ok ? `learned: ${r.value ?? 'yes'}` : r.why); renderTalk(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) { world.dialogue.say(n - 1); renderTalk(); renderShop(); }
      return;
    }
    // E opens a conversation with whoever is in front of you. Nothing happens
    // if there is nobody there, which is the correct amount of feedback for a
    // key pressed at an empty street.
    if (e.code === 'KeyE') { if (world.talk()) renderTalk(); }
    // R casts whatever rune is selected. Selection lives on the spell tab, so
    // the key is a trigger and never a menu: a fight is not the place to pick.
    if (e.code === 'KeyR') {
      const list = world.spells();
      const pick = list.find((sp) => sp.id === selectedSpell) || list[0];
      if (!pick) { log('you are carrying no runes'); return; }
      const r = world.cast(pick.id);
      if (!r.ok) log(r.why);
      return;
    }
    if (e.code === 'KeyC') { openBook('sheet'); return; }
    if (e.code === 'KeyI') { openBook('pack'); return; }
    if (e.code === 'KeyJ') { openBook('log'); return; }
    if (e.code === 'KeyK') { openBook('runes'); return; }
    if (e.code === 'KeyN') { openBook('map'); return; }
    if (e.code === 'KeyM') { log(sound.toggle() ? 'muted' : 'sound on'); return; }
    if (e.code === 'F5') { e.preventDefault(); save('manual'); }
    if (e.code === 'F9') { e.preventDefault(); load('manual'); }
  });

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { tab = b.dataset.tab; renderBook(); }
  });

  // --- the same game, with a finger --------------------------------------------
  //
  // Everything above answers to a key, and a phone has none. So every list the
  // number keys act on also answers to a tap — routed into the same functions
  // rather than into a copy of them, which is the only way the two input paths
  // cannot drift apart. (The movement and combat controls need no code here at
  // all: src/core/touch.js presses the keys.)
  const clicked = (e, sel) => e.target.closest(sel);

  menuEl.addEventListener('click', (e) => {
    const li = clicked(e, 'li[data-act]');
    if (li && atTitle) titleChoice(li.dataset.act);
  });

  document.getElementById('died-options').addEventListener('click', (e) => {
    const li = clicked(e, 'li[data-act]');
    if (!li || !world.dead) return;
    if (li.dataset.act === 'load') load('manual').then(renderDied);
    else { world.revive(); renderDied(); }
  });

  endedEl.addEventListener('click', () => {
    if (!endShown) { endShown = true; endedEl.hidden = true; }
  });

  optionsEl.addEventListener('click', (e) => {
    const li = clicked(e, 'li[data-say]');
    if (!li || !world.dialogue.isOpen) return;
    world.dialogue.say(Number(li.dataset.say));
    renderTalk(); renderShop();
  });

  shopEl.addEventListener('click', (e) => {
    const li = clicked(e, 'li[data-buy], li[data-sell]');
    if (!li) return;
    const isBuy = li.dataset.buy != null;
    const it = isBuy ? buying[Number(li.dataset.buy)] : selling[Number(li.dataset.sell)];
    if (!it) return;
    const r = isBuy ? world.buy(it.id) : world.sell(it.id);
    if (!r.ok) log(r.why);
    renderShop();
  });

  bodyEl.addEventListener('click', (e) => {
    const li = clicked(e, 'li[data-act]');
    const a = li && actions[Number(li.dataset.act)];
    if (!a) return;
    const r = a.do();
    if (r && r.why && !r.ok) log(r.why);
    renderBook();
  });

  // The close crosses, because Esc is not a key a phone has.
  for (const b of document.querySelectorAll('.x')) {
    b.addEventListener('click', () => {
      if (b.dataset.close === 'talk') { world.dialogue.close(); renderTalk(); renderShop(); }
      if (b.dataset.close === 'shop') { world.openTrader = null; renderShop(); renderTalk(); }
      if (b.dataset.close === 'book') { tab = null; renderBook(); }
    });
  }

  // `?touch=1` shows the overlay on a desk machine, which is how it gets
  // photographed and how it gets tested without a phone in the room.
  if (params.get('touch') === '1' && input.touch) input.touch.activate();

  const sizeFor = () => {
    // The cap, not the tier, is where a phone pays. A modern handset reports a
    // device ratio of 3; drawing at it would shade nine fragments for every
    // point on a screen nobody holds closer than forty centimetres.
    const cap = coarse ? 1.4 : 2;
    const floor = coarse ? 1 : 0.8;
    const scale = renderScale
      || (tier === 'low' ? floor : Math.min(devicePixelRatio || 1, cap));
    return [Math.round(innerWidth * scale), Math.round(innerHeight * scale)];
  };

  // The character sheet parks the camera in front of the row instead of behind
  // the player. It is a preview, so it is allowed to be a fixed framing; every
  // other camera in the game is the spring arm.
  const lineupCam = params.has('lineup');
  const frameLineup = () => {
    const c = world.camera;
    const ground = world.people[0].pos[1];
    // Framed to the row, so a sheet of three suits is a close-up of three
    // suits and a sheet of nine is not nine specks.
    // A long lens rather than a wide one: 40° and stand further back. A wide
    // lens close in barrels the outer figures and makes a nine-suit sheet look
    // like a fisheye photo of a police line-up.
    const n = world.people.length;
    c.pos[0] = 0.12; c.pos[1] = ground + 1.05; c.pos[2] = -(2.2 + n * 0.72);
    c.target[0] = 0; c.target[1] = ground + 0.95; c.target[2] = 0;
    c.fov = 40;
  };

  /**
   * The sheet gets its own key light. The world's sun is where the clock says
   * it is, and at every hour that matters it is behind a row of characters
   * facing the camera — which is correct for the world and useless for looking
   * at armour. A three-quarter key from over the camera's shoulder is what a
   * character sheet is for.
   */
  const lightLineup = (sc) => {
    const d = [-0.42, 0.66, -0.62];
    const len = Math.hypot(d[0], d[1], d[2]);
    sc.sunDir[0] = d[0] / len; sc.sunDir[1] = d[1] / len; sc.sunDir[2] = d[2] / len;
  };

  // The render gate (tools/shot.mjs) reads this, and it runs *before* the
  // animation loop rather than inside it, on purpose. Headless Chromium dumps
  // the page when its virtual-time budget expires, and requestAnimationFrame is
  // throttled until the compositor has produced a surface — so a probe that
  // waits for an animation frame reports "nothing rendered" on a slow machine
  // while the game is perfectly healthy. Drawing and reading back synchronously
  // needs no compositor at all, so the gate stops being a coin flip.
  if (params.has('probe')) {
    const scale = renderScale || 0.5;
    device.resize(Math.round(innerWidth * scale), Math.round(innerHeight * scale));
    // `?cast=` throws a rune on the way through, which is the only way to
    // photograph something that lives for a second and a half. It grants the
    // rune and the mana too — a framing is a framing, not a playthrough.
    if (params.has('cast')) {
      world.character.mana = 60;
      world.reloadout();
      world.give(`rune_${params.get('cast')}`);
      world.cast(params.get('cast'));
    }
    for (let i = 0; i < PROBE_FRAME; i++) {
      world.tick(TICK_MS / 1000, idleIntent());
      if (lineupCam) frameLineup();
      const sc = world.scene();
      if (lineupCam) lightLineup(sc);
      device.draw(sc);
    }
    api.probe = {
      ...device.stats, frames: PROBE_FRAME, backend: device.backend,
      tier, clock: world.clock.hhmm, ...device.readPixelStats(),
    };
    // Both channels on purpose: the title survives --dump-dom for a one-shot
    // launch, and the object is what the CDP-driven gate reads when it is
    // stepping one browser through every framing.
    document.title = `PROBE ${JSON.stringify(api.probe)}`;
  }

  let last = performance.now();
  let lastFrame = last;
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(now - last, MAX_CATCHUP_MS);
    last = now;
    timer.push(dt);

    // Input is sampled once per rendered frame and applied to every simulation
    // tick inside it. Sampling per tick would read the same mouse delta twice
    // whenever a frame ran long, and turn twice as far for it.
    const intent = off.has('input') ? idleIntent() : input.sample(dt / 1000);

    // The world is drawn behind the title screen and *not* stepped: a menu left
    // open all afternoon must not put the player down at dusk with a day gone.
    acc += atTitle ? 0 : dt;
    let ticks = 0;
    while (acc >= TICK_MS && ticks < 8) {   // a hard cap: never spiral
      world.tick(TICK_MS / 1000, intent);
      acc -= TICK_MS;
      ticks++;
    }

    // Autosave when the quest log moves — a region change and a chapter change
    // will join it once those exist (§5.3).
    if (world.quests.size !== lastQuestCount) { lastQuestCount = world.quests.size; save('auto'); }
    // Redraw only when the screen and the world disagree. The first version
    // compared `world.dead === !diedEl.hidden`, which is true exactly when they
    // *already* agree — so the death screen never appeared.
    if (diedEl.hidden !== !world.dead) renderDied();
    // The shop reconciles the same way. Anything that sets `openTrader` — a
    // conversation, a debug call, a future vendor that opens on approach — gets
    // a screen, rather than only the one path that remembered to ask for one.
    if (shopEl.hidden !== !world.openTrader) renderShop();
    if (world.finished && !endShown && endedEl.hidden) renderEnded();

    // A panel owns the screen: the stick and the buttons stand down under it,
    // so a thumb reaching for a conversation line does not walk into a wall on
    // the way. Reconciled every frame rather than at every call site, for the
    // same reason the death screen is — one place that can be wrong beats nine
    // that can each be forgotten.
    if (input.touch) {
      input.touch.setPanel(!!(atTitle || tab || world.openTrader || world.dialogue.isOpen
        || world.dead || (world.finished && !endShown)));
    }

    // Standing in an exit takes you through it. There is no prompt: the
    // barricade at the mouth of the pass is visible from a hundred metres and
    // walking into it is the whole of the interaction.
    if (world.pendingTravel && !travelling) { crossTo(world.pendingTravel); return; }

    const cell = world.terrainCell();
    if (cell !== terrainCell) { terrainCell = cell; rebuildTerrain(); }

    // The ambience is driven from the world's own clock and wind, so the bed
    // under everything is the same quantity the grass is bending to rather than
    // a separate loop that drifts out of step with it.
    if (api.frames % 20 === 0) {
      const hour = world.clock.minutes / 60;
      const night = hour < 6 || hour > 20 ? 1 : 0;
      sound.setAmbience({ night, gust: 0.5 + 0.5 * Math.sin(world.ticks / 260) });
    }

    if (lineupCam) frameLineup();
    const [w, h] = sizeFor();
    device.resize(w, h);
    const sc = world.scene();
    if (lineupCam) lightLineup(sc);
    device.draw(sc);

    api.frames++;
    if (api.frames % 10 === 0) {
      const p = timer.percentiles();
      const s = device.stats;
      const pl = world.player;
      overlay.render({
        frame: `${p.p50.toFixed(1)} ms  p95 ${p.p95.toFixed(1)}  p99 ${p.p99.toFixed(1)}`,
        backend: `${device.backend} · ${tier}${input.locked ? ' · locked' : ''}`,
        draws: `${s.drawCalls}  tris ${s.triangles}`,
        res: `${s.width}×${s.height}`,
        pos: `${pl.pos[0].toFixed(1)} ${pl.pos[1].toFixed(1)} ${pl.pos[2].toFixed(1)}  ${pl.speed.toFixed(1)} m/s`,
        state: `${pl.onGround ? 'ground' : 'air'}${pl.sneaking ? ' · sneaking' : ''}  cam ${world.camera.dist.toFixed(1)} m`,
        fight: `${STATE_NAME[pl.fighter.state]}${pl.fighter.t ? ` ${pl.fighter.t}` : ''}`
          + `  hp ${pl.fighter.hp}/${pl.fighter.maxHp}  combo ${pl.fighter.combo}`,
        hunt: `${world.beasts.filter((b) => b.state !== 7).length} alive  xp ${pl.xp}  level ${pl.level}`,
        theft: (() => {
          const c = world.nearestChest();
          if (!c) return world.watchers().length ? `${world.watchers().length} can see you` : '';
          if (c.emptied) return 'an empty chest';
          if (c.open || !c.lock) return 'L to open';
          const need = ({ simple: 110, good: 260, master: 460 })[c.lock];
          return `${c.lock} lock — hold L  ${Math.round((c.picked / need) * 100)}%`;
        })(),
        bow: world.bow()
          ? `${world.bow().name}  ${world.bow().have} ${world.bow().ammo}s`
            + `${world.bow().drawing ? `  drawing ${world.bow().drawing}` : ''}`
          : '',
        mana: `${Math.floor(world.caster.mana)}/${world.caster.max} mana`
          + `${world.caster.casting ? `  casting ${SPELLS[world.caster.casting].short}` : ''}`
          + `${world.bolts.length ? `  ${world.bolts.length} in flight` : ''}`,
        sheet: `${world.character.gold} gold  ${world.character.lp} LP  1H ${world.character.skills.oneHanded}%`
          + `${world.character.guild ? `  ${world.character.guild}` : ''}`,
        near: world.dialogue.isOpen ? 'talking' : (world.speaker() ? 'E to talk' : ''),
        clock: `day ${world.clock.day} ${world.clock.hhmm}${world.clock.isNight ? ' (night)' : ''}`,
        terrain: `cell ${terrainCell}  rebuilt in ${terrainMs} ms`,
        where: `${world.regionTitle}  ·  chapter ${world.chapter}`,
        seed: String(world.seed),
      });
    }
  }
  // Called here, at the end of boot, and not beside `window.GRIMWARD = api`.
  // `renderTitle` is async, so a `let atTitle` it cannot see yet throws a
  // ReferenceError *into a promise nobody is awaiting* — no boot error, no
  // title, and a screenshot that simply shows the city. Async functions swallow
  // their own temporal dead zone, which is a good reason to call them late.
  api.leaveTitle = leaveTitle;
  renderTitle();
  renderShop();
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  // A boot failure must be legible on screen, not only in a console nobody has
  // open. This is the path that catches a shader that failed to compile.
  document.getElementById('gate-why').textContent = String((err && err.message) || err);
  document.getElementById('gate').hidden = false;
  window.GRIMWARD = { state: 'error', error: String((err && err.stack) || err) };
  console.error(err);
});
