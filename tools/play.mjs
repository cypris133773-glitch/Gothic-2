#!/usr/bin/env node
/**
 * Layer 3: the game, in a real browser, driven by real input.
 *
 *   node tools/play.mjs [--headed] [--keep]
 *
 * Three rules, and they are the whole value of this file:
 *
 * 1. **Nothing here calls into the game to make something happen.** Every
 *    action is a key event dispatched through the browser's own input pipeline,
 *    so it goes through focus, event dispatch and the page's real listeners. A
 *    harness that calls `world.tick()` proves the simulation works; only this
 *    proves the *game* works.
 * 2. **Nothing here measures input state.** `input.sample()` is drained by the
 *    running loop every frame, so reading it back proves nothing. Every
 *    assertion reads simulation state — position, velocity, camera, ticks.
 * 3. **No dependencies.** tools/cdp.mjs speaks the DevTools protocol directly.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { connect, findPageTarget, sleep } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const PORT_DEVTOOLS = 9333;

// --- tiny static server (ES modules refuse to load from file://) -------------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(ROOT, rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries.filter((n) => n.startsWith('chromium'))) {
      candidates.push(path.join(root, e, 'chrome-linux', 'chrome'));
    }
  }
  const found = candidates.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
  if (!found) throw new Error('No Chromium found. Set CHROME=/path/to/chrome.');
  return found;
}

// --- assertions --------------------------------------------------------------

let passed = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}  ${detail}`); }
}

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

async function main() {
  const chrome = findChrome();
  const { server, port } = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grimward-play-'));

  const child = spawn(chrome, [
    has('headed') ? '--headless=false' : '--headless=new',
    '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=800,600',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT_DEVTOOLS}`,
    // The game is served over http and rendered at half scale so a software
    // rasteriser can keep a real frame rate; the test is about input and
    // simulation, and frame time is measured by tools/perf.mjs on real hardware.
    `http://127.0.0.1:${port}/?seed=1&renderScale=0.4`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  const cleanup = async () => {
    child.kill('SIGKILL');
    server.close();
    // The browser is still flushing its profile when it dies, so a delete
    // straight after the kill loses a race with it and throws ENOTEMPTY on a
    // run where every actual check passed. Wait for the exit, then retry.
    await new Promise((r) => (child.exitCode === null ? child.once('exit', r) : r()));
    if (!has('keep')) {
      // A profile the browser is still flushing is not a test result. Retry,
      // and if it still will not go, leave it in the temp directory rather than
      // failing a run in which every check passed.
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
      } catch (e) {
        console.log(`  (left ${profile} behind: ${e.code})`);
      }
    }
  };

  try {
    const target = await findPageTarget(PORT_DEVTOOLS);
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');

    // --- boot -------------------------------------------------------------
    const t0 = Date.now();
    // Thirty seconds, not fifteen. Two regions of shaders and a 512 m island
    // on a software rasteriser is a slow boot on a loaded machine, and a
    // timeout that fires while the game is healthily compiling reads exactly
    // like a broken game.
    await page.waitFor("window.GRIMWARD && window.GRIMWARD.state === 'playing'",
      { what: 'the game to reach the playing state', timeout: 30000 });
    ok('the game boots', true, `${Date.now() - t0} ms to playing`);

    const err = await page.evaluate('window.GRIMWARD.error || null');
    ok('boot raised no error', !err, err || '');

    // --- the title screen ---------------------------------------------------
    // The harness starts a game the way a player does, because a menu nothing
    // ever presses is a menu that breaks without anybody noticing.
    const titled = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the game opens on a title screen', titled.title);
    ok('and does not simulate behind it',
      await page.evaluate('(() => { const a = window.GRIMWARD.world.ticks; return new Promise((r) => setTimeout(() => r(window.GRIMWARD.world.ticks === a), 400)); })()'));

    await page.keyDown('Digit1'); await page.keyUp('Digit1');
    await sleep(250);
    const begun = await page.evaluate('window.GRIMWARD.probeState()');
    ok('1 begins the game', !begun.title);
    ok('and the world starts running',
      await page.evaluate('(() => { const a = window.GRIMWARD.world.ticks; return new Promise((r) => setTimeout(() => r(window.GRIMWARD.world.ticks > a), 400)); })()'));

    await page.waitFor('window.GRIMWARD.frames > 20', { what: 'twenty rendered frames' });
    const first = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the renderer is drawing the world', first.drawCalls > 5 && first.triangles > 1000,
      `${first.drawCalls} draws, ${first.triangles} triangles`);
    ok('the simulation is ticking', first.ticks > 20, `${first.ticks} ticks`);

    // --- walking ----------------------------------------------------------
    const before = await page.evaluate('window.GRIMWARD.probeState()');
    await page.hold('KeyW', 1000);
    const after = await page.evaluate('window.GRIMWARD.probeState()');
    const walked = dist2(before.pos, after.pos);
    ok('holding W walks the character forward', walked > 2.5, `${walked.toFixed(2)} m in one second`);
    ok('the character is on the ground while walking', after.onGround);

    await sleep(400);
    const stopped = await page.evaluate('window.GRIMWARD.probeState()');
    ok('releasing W stops the character', stopped.speed < 0.2, `${stopped.speed.toFixed(2)} m/s`);

    // --- turning ----------------------------------------------------------
    // Arrow keys, not the mouse: pointer lock can be refused, and a game whose
    // camera only works under pointer lock is a game that does not work in an
    // iframe, a kiosk, or half of Safari.
    //
    // And the assertion is about *direction*, not magnitude. `Math.abs(yaw1 -
    // yaw0) > 0.5` was the check here for months: it proves a turn happened and
    // says nothing about whether it went where it was asked, so the right arrow
    // turned the camera left the whole time and every run was green. The ground
    // truth is the camera's own right vector — the same one `lookAt` builds.
    const t0turn = await page.evaluate('window.GRIMWARD.probeState()');
    await page.hold('ArrowRight', 600);
    const t1turn = await page.evaluate('window.GRIMWARD.probeState()');
    const turned = Math.abs(Math.atan2(Math.sin(t1turn.yaw - t0turn.yaw), Math.cos(t1turn.yaw - t0turn.yaw)));
    ok('the character turns without pointer lock', turned > 0.5, `${turned.toFixed(2)} rad`);
    // How far the new facing leans towards where the screen's right was.
    const leaned = Math.sin(t1turn.yaw) * t0turn.camRight[0] + Math.cos(t1turn.yaw) * t0turn.camRight[2];
    ok('and the right arrow turns him to the right of the screen', leaned > 0.2,
      `${leaned.toFixed(2)} towards screen right`);

    // --- strafing is not a second forward ---------------------------------
    const s0 = await page.evaluate('window.GRIMWARD.probeState()');
    await page.hold('KeyD', 700);
    const s1 = await page.evaluate('window.GRIMWARD.probeState()');
    ok('strafing moves the character', dist2(s0.pos, s1.pos) > 1.2, `${dist2(s0.pos, s1.pos).toFixed(2)} m`);
    // Same rule as the turn: which way, not how far.
    const stepped = ((s1.pos[0] - s0.pos[0]) * s0.camRight[0] + (s1.pos[2] - s0.pos[2]) * s0.camRight[2])
      / (dist2(s0.pos, s1.pos) || 1);
    ok('and D steps to the right of the screen', stepped > 0.85,
      `${stepped.toFixed(2)} of the step went right`);
    ok('strafing does not turn the character',
      Math.abs(Math.atan2(Math.sin(s1.yaw - s0.yaw), Math.cos(s1.yaw - s0.yaw))) < 0.05);

    // --- sneaking ----------------------------------------------------------
    await page.keyDown('ControlLeft');
    await page.keyDown('KeyW');
    await sleep(700);
    const sneak = await page.evaluate('window.GRIMWARD.probeState()');
    await page.keyUp('KeyW');
    await page.keyUp('ControlLeft');
    ok('sneaking is recognised', sneak.sneaking);
    ok('sneaking is slower than running', sneak.speed > 0.3 && sneak.speed < 2.0,
      `${sneak.speed.toFixed(2)} m/s`);

    // --- jumping -----------------------------------------------------------
    //
    // Polled rather than sampled once. A jump is about six hundred milliseconds
    // of flight and the probe used to look at a fixed 120 ms, which lands in
    // the air on a healthy machine and on the ground on a loaded one — the
    // check failed roughly one run in five reporting "vy 0.00", which reads
    // exactly like a broken jump and never was one. Hold the key, watch for the
    // feet leaving the floor, and give up only if they never do.
    let airborne = null;
    await page.keyDown('Space');
    try {
      airborne = await page.waitFor(
        '(() => { const s = window.GRIMWARD.probeState(); return (!s.onGround || s.vel[1] > 0.5) ? s : null; })()',
        { what: 'the character to leave the ground', timeout: 3000, every: 30 },
      );
    } catch { airborne = await page.evaluate('window.GRIMWARD.probeState()'); }
    await page.keyUp('Space');
    ok('space leaves the ground', !airborne.onGround || airborne.vel[1] > 0.5,
      `vy ${airborne.vel[1].toFixed(2)} m/s`);
    const landed = await page.waitFor(
      '(() => { const s = window.GRIMWARD.probeState(); return s.onGround ? s : null; })()',
      { what: 'the character to land', timeout: 4000, every: 40 },
    );
    ok('the character lands again', landed.onGround);

    // --- the camera --------------------------------------------------------
    ok('the camera is behind the character, not inside them',
      dist2(landed.camera, landed.pos) > 0.8 && dist2(landed.camera, landed.pos) < 6,
      `${dist2(landed.camera, landed.pos).toFixed(2)} m`);
    ok('the camera is above the ground', landed.camera[1] > landed.pos[1] - 1);

    // --- combat, through real key events ----------------------------------
    // The rule the whole system rests on, asserted through the browser's own
    // input path rather than by calling into the fighter.
    //
    // The wait is not padding. This check runs immediately after the jump test,
    // and a character who is still in the air or still settling has an unstable
    // combat state — so "F starts a swing" failed about one run in five, always
    // reporting state 0, which reads exactly like a broken attack key and was
    // not one. Wait for a body that is on the ground and idle first.
    await page.waitFor(
      '(() => { const s = window.GRIMWARD.probeState(); return s.onGround && s.combat.state === 0; })()',
      { what: 'the character to settle before swinging', timeout: 4000 },
    );
    // Four hundred milliseconds, not one hundred and twenty. The renderer runs
    // at about ten frames a second on a software rasteriser and input is
    // sampled once per rendered frame, so a 120 ms hold is *one frame* and
    // sometimes zero. The check failed about one run in five reporting state 0,
    // which reads exactly like a broken attack key and is a broken stopwatch.
    await page.keyDown('KeyF');
    await sleep(400);
    const swinging = await page.evaluate('window.GRIMWARD.probeState().combat');
    await page.keyUp('KeyF');
    ok('F starts a swing', swinging.state === 1 || swinging.state === 2 || swinging.state === 3,
      `state ${swinging.state}, ${swinging.swings} swings`);

    // Try to cancel it with everything a panicking player would press.
    await page.keyDown('KeyF');
    await sleep(30);
    await page.keyDown('KeyG');          // block
    await page.keyDown('Space');         // jump
    const cancel = await page.evaluate('window.GRIMWARD.probeState().combat');
    await page.keyUp('KeyG'); await page.keyUp('Space'); await page.keyUp('KeyF');
    ok('a swing cannot be cancelled by blocking or jumping',
      cancel.state !== 0 && cancel.state !== 4 && cancel.state !== 5,
      `state ${cancel.state}`);

    await sleep(900);
    const settled = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the swing ends on its own', settled.combat.state === 0 || settled.combat.state === 3,
      `state ${settled.combat.state}, ${settled.combat.swings} swings total`);
    ok('there are beasts in the world', settled.beasts.length > 0,
      `${settled.beasts.length}: ${settled.beasts.slice(0, 3).map((b) => `${b.kind} at ${b.dist} m`).join(', ')}`);

    // --- a conversation, through real key events ---------------------------
    // Walk to the smith and talk to him. Everything here goes through the same
    // key path a player uses; nothing calls world.talk().
    const smith = await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      const n = w.people.find((p) => p.id === 'npc3');
      return n ? [n.pos[0], n.pos[2]] : null;
    })()`);
    ok('the smith is in the world', !!smith, smith ? `at ${smith.map((v) => v.toFixed(1))}` : '');

    // Put the player in front of him, then use only keys from here on.
    await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      const n = w.people.find((p) => p.id === 'npc3');
      w.player.pos[0] = n.pos[0]; w.player.pos[2] = n.pos[2] - 1.5; w.player.yaw = 0;
    })()`);
    await sleep(120);
    await page.keyDown('KeyE'); await page.keyUp('KeyE');
    await sleep(150);
    const talking = await page.evaluate('window.GRIMWARD.probeState()');
    ok('E opens a conversation', talking.talking, `${talking.options.length} things to say`);

    await page.keyDown('Digit1'); await page.keyUp('Digit1');
    await sleep(150);
    const said = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a chosen line is answered', !!said.reply, said.reply ? said.reply.slice(0, 48) + '…' : '');
    ok('and it changed the world', said.flags.includes('met:harl'));

    // Take the job, so there is something for the quest log to have in it.
    await page.keyDown('Digit1'); await page.keyUp('Digit1');
    await sleep(150);
    const took = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a second line takes the job', took.flags.includes('quest:q_ore:told'),
      took.reply ? took.reply.slice(0, 44) + '…' : 'no reply');

    await page.keyDown('Escape'); await page.keyUp('Escape');
    await sleep(120);
    const closed = await page.evaluate('window.GRIMWARD.probeState()');
    ok('Escape ends the conversation', !closed.talking);

    // --- the character's book, through real key events ----------------------
    await page.keyDown('KeyJ'); await page.keyUp('KeyJ');
    await sleep(150);
    const logOpen = await page.evaluate('window.GRIMWARD.probeState()');
    ok('J opens the quest log', logOpen.book === 'log', `tab ${logOpen.book}`);
    ok('and the ore job is in it', logOpen.quests.some((q) => q.startsWith('q_ore:')),
      logOpen.quests.join(', ') || 'empty');

    await page.keyDown('KeyI'); await page.keyUp('KeyI');
    await sleep(150);
    const packOpen = await page.evaluate('window.GRIMWARD.probeState()');
    ok('I switches to the pack', packOpen.book === 'pack', `tab ${packOpen.book}`);
    ok('and it lists what he is carrying', packOpen.items.length >= 3, packOpen.items.join(' '));

    // Number keys act on the pack: the first row is the branch he is holding,
    // so pressing it puts the weapon away. Real keys, real inventory.
    const armedBefore = packOpen.weapon;
    await page.keyDown('Digit1'); await page.keyUp('Digit1');
    await sleep(150);
    const acted = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a number key acts on the pack', acted.weapon !== armedBefore || acted.armour !== packOpen.armour,
      `weapon ${armedBefore} → ${acted.weapon}, armour ${packOpen.armour} → ${acted.armour}`);

    await page.keyDown('KeyC'); await page.keyUp('KeyC');
    await sleep(150);
    const sheetOpen = await page.evaluate('window.GRIMWARD.probeState()');
    ok('C switches to the character sheet', sheetOpen.book === 'sheet', `tab ${sheetOpen.book}`);
    ok('and it knows which chapter this is', sheetOpen.chapter === 1, `chapter ${sheetOpen.chapter}`);

    await page.keyDown('Escape'); await page.keyUp('Escape');
    await sleep(120);
    const bookShut = await page.evaluate('window.GRIMWARD.probeState()');
    ok('Escape closes the book', !bookShut.book);

    // The gate of the upper quarter is shut, and it is shut with geometry.
    ok('the upper gate starts closed', bookShut.doors.upper === false);

    // --- the shop -----------------------------------------------------------
    // Trading was reachable from a conversation and had no screen at all, so
    // buying anything in a browser was impossible. This is the real path: open
    // it the way dialogue does, then press a number.
    await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      w.character.gold = 500;
      w.openTrader = 'harl_smith';
    })()`);
    await sleep(200);
    const shopping = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a shop opens', !!shopping.shop, shopping.shop ? shopping.shop.id : 'none');
    ok('with something on the rack', shopping.shop.stock.length > 0,
      `${shopping.shop.stock.length} lines`);
    ok('and the screen is up', await page.evaluate('!document.getElementById("shop").hidden'));

    // Buy the first line he can *afford*, not the first line: a five-hundred
    // coin purse and a seven-hundred-and-eighty coin crossbow is a correct
    // refusal, and a test that reads it as a failure is testing the wrong
    // thing.
    const purseBefore = shopping.shop.purse;
    const slot = shopping.shop.stock.findIndex((it) => it.afford);
    ok('he has something in the purse\'s reach', slot >= 0,
      shopping.shop.stock.map((it) => `${it.name} ${it.price}g`).join(', '));
    const onRack = shopping.shop.stock[slot];
    await page.keyDown(`Digit${slot + 1}`); await page.keyUp(`Digit${slot + 1}`);
    await sleep(200);
    const bought = await page.evaluate('window.GRIMWARD.probeState()');
    ok('1 buys the first thing on it', bought.shop.purse === purseBefore - onRack.price,
      `${purseBefore} → ${bought.shop.purse} for ${onRack.name} at ${onRack.price}`);
    ok('and it is in the pack', bought.items.some((i) => i.startsWith(onRack.id)),
      bought.items.join(' '));

    await page.keyDown('Escape'); await page.keyUp('Escape');
    await sleep(150);
    ok('Escape closes the shop', !(await page.evaluate('window.GRIMWARD.probeState()')).shop);
    ok('no error from trading', !(await page.evaluate('window.GRIMWARD.error || null')));

    // --- the map ------------------------------------------------------------
    await page.keyDown('KeyN'); await page.keyUp('KeyN');
    await sleep(200);
    const mapped = await page.evaluate('window.GRIMWARD.probeState()');
    ok('N opens the map', mapped.book === 'map', `tab ${mapped.book}`);
    ok('and the city is on it', mapped.seen.includes('halden'), mapped.seen.join(', '));
    ok('drawn from the world rather than from an image',
      await page.evaluate('!!document.querySelector("#book-body svg.map .map-road")'));
    ok('with him on it',
      await page.evaluate('!!document.querySelector("#book-body svg.map .map-you")'));
    await page.keyDown('Escape'); await page.keyUp('Escape');
    await sleep(120);

    // --- sound, which needs a gesture ----------------------------------------
    // Every browser suspends an AudioContext made before the user has touched
    // the page, so the graph is built on the first key. By now the run has
    // pressed several dozen, so it should be up.
    const audio = await page.evaluate('window.GRIMWARD.probeState().sound');
    ok('sound starts on the first gesture', audio.on, JSON.stringify(audio));
    ok('and is not muted to begin with', !audio.muted);
    await page.keyDown('KeyM'); await page.keyUp('KeyM');
    await sleep(150);
    const muted = await page.evaluate('window.GRIMWARD.probeState().sound');
    ok('M mutes it', muted.muted);
    await page.keyDown('KeyM'); await page.keyUp('KeyM');
    await sleep(150);
    ok('and unmutes it', !(await page.evaluate('window.GRIMWARD.probeState().sound')).muted);

    // --- a lock, held open with a real key ----------------------------------
    // Put the man beside the smithy's chest and give him what he needs. The
    // lock itself is opened by holding L, which is the point: it is a time cost
    // in the open rather than a dice roll.
    await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      const c = w.chests.find((x) => x.id === 'chest_smithy');
      w.flags.add('skill:lockpick'); w.give('lockpick');
      w.player.pos[0] = c.pos[0] + 1.3; w.player.pos[2] = c.pos[2];
      w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
    })()`);
    await sleep(200);
    const atChest = await page.evaluate('window.GRIMWARD.probeState()');
    ok('there is a chest here', atChest.chest && atChest.chest.id === 'chest_smithy',
      atChest.chest ? atChest.chest.id : 'none');
    ok('and it is locked', atChest.chest.lock === 'simple' && !atChest.chest.open);

    const goldBefore = atChest.gold;
    await page.hold('KeyL', 2600);
    await sleep(300);
    const opened = await page.evaluate('window.GRIMWARD.probeState()');
    ok('holding L opens it', opened.chest.open, `picked ${Math.round(opened.chest.picked)}`);
    ok('and takes what is in it', opened.gold > goldBefore, `${goldBefore} → ${opened.gold} coin`);
    ok('no error from picking a lock', !(await page.evaluate('window.GRIMWARD.error || null')));

    // --- a bow, through the same attack key ---------------------------------
    // The attack button uses the weapon in hand. A separate shoot key would
    // mean a player holding a bow has an attack button that does nothing.
    await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      w.character.dex = 45; w.reloadout();
      w.give('hunters_bow'); w.give('arrow', 10); w.equip('hunters_bow');
    })()`);
    await sleep(150);
    const armed = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a bow is in hand', armed.bow && armed.bow.cls === 'bow', armed.bow ? armed.bow.name : 'none');
    ok('with arrows', armed.bow.have === 10, `${armed.bow.have}`);

    // Held, not tapped. The intent is sampled once per rendered frame, so a
    // key that goes down and up inside one frame was never held at all — which
    // is true of a real keyboard too and is why this is a hold.
    await page.keyDown('KeyF');
    await sleep(400);
    const drawing = await page.evaluate('window.GRIMWARD.probeState()');
    await page.keyUp('KeyF');
    ok('F draws the bow', drawing.bow.drawing > 0, `${drawing.bow.drawing} frames left`);
    ok('and it does not swing a sword instead', drawing.combat.state === 0,
      `combat state ${drawing.combat.state}`);

    await sleep(900);
    const loosed = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the arrow is spent at the loose', loosed.bow.have === 9, `${loosed.bow.have} left`);
    ok('no error from shooting', !(await page.evaluate('window.GRIMWARD.error || null')));

    // Put the sword back so the rest of the run is unchanged.
    await page.evaluate(`window.GRIMWARD.world.equip('branch')`);

    // --- the end ------------------------------------------------------------
    // Finish the game the short way — the fight itself is measured in the logic
    // suite — and check that the screen appears, says the right thing, and then
    // gets out of the way. A finished game is a finished game, not a closed one.
    await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      w.finished = true;
    })()`);
    await sleep(400);
    ok('the ending appears', await page.evaluate('!document.getElementById("ended").hidden'));
    ok('and says who finished it',
      await page.evaluate('/level \\d/.test(document.getElementById("ended-body").textContent)'),
      await page.evaluate('document.getElementById("ended-body").textContent.slice(-60)'));
    await page.keyDown('Escape'); await page.keyUp('Escape');
    await sleep(250);
    ok('and one key puts it away', await page.evaluate('document.getElementById("ended").hidden'));
    ok('the island is still there',
      await page.evaluate('(() => { const a = window.GRIMWARD.world.ticks; return new Promise((r) => setTimeout(() => r(window.GRIMWARD.world.ticks > a), 400)); })()'));
    await page.evaluate('window.GRIMWARD.world.finished = false');

    // --- dying, and the screen that says so ---------------------------------
    await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      w.player.fighter.hp = 0;
      w.player.fighter.state = 7;
    })()`);
    await sleep(300);
    const died = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the world notices a death', died.dead, `dead ${died.dead}`);
    ok('and the screen says so',
      await page.evaluate('!document.getElementById("died").hidden'));

    // W does nothing to a corpse.
    const restingAt = died.pos;
    await page.hold('KeyW', 600);
    await sleep(200);
    const still = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a corpse does not walk', dist2(restingAt, still.pos) < 0.5,
      `${dist2(restingAt, still.pos).toFixed(2)} m`);

    await page.keyDown('Enter'); await page.keyUp('Enter');
    await sleep(300);
    const woke = await page.evaluate('window.GRIMWARD.probeState()');
    ok('Enter wakes him up', !woke.dead);
    ok('somewhere else', dist2(restingAt, woke.pos) > 5,
      `${dist2(restingAt, woke.pos).toFixed(0)} m away`);
    ok('and the screen went away',
      await page.evaluate('document.getElementById("died").hidden'));
    ok('no error from dying', !(await page.evaluate('window.GRIMWARD.error || null')));

    // --- magic, through real key events -------------------------------------
    // Give the man a rune and the mana to hold it, then throw it with R. The
    // grant is a world call because there is no shop in this test; everything
    // after it is keys.
    await page.evaluate(`(() => {
      const w = window.GRIMWARD.world;
      w.character.mana = 40; w.reloadout(); w.give('rune_fire_bolt');
    })()`);
    await page.keyDown('KeyK'); await page.keyUp('KeyK');
    await sleep(150);
    const runes = await page.evaluate('window.GRIMWARD.probeState()');
    ok('K opens the runes', runes.book === 'runes', `tab ${runes.book}`);
    ok('and the rune is in it', runes.spells.includes('fire_bolt'), runes.spells.join(', ') || 'none');
    ok('with a full pool', runes.mana === runes.manaMax && runes.manaMax === 40,
      `${runes.mana}/${runes.manaMax}`);

    await page.keyDown('Escape'); await page.keyUp('Escape');
    await sleep(120);
    await page.keyDown('KeyR'); await page.keyUp('KeyR');
    await sleep(120);
    const casting = await page.evaluate('window.GRIMWARD.probeState()');
    ok('R starts a cast', casting.casting === 'fire_bolt', String(casting.casting));
    ok('and the mana went at the start of it', casting.mana === 32, `${casting.mana}`);

    // Wind-up plus recovery is 52 ticks — about 0.9 s — and the first version
    // of this check looked after 0.4 and reported a stuck cast.
    await sleep(1100);
    const flown = await page.evaluate('window.GRIMWARD.probeState()');
    ok('and the cast finishes on its own', !flown.casting, String(flown.casting));
    ok('no error from casting', !(await page.evaluate('window.GRIMWARD.error || null')));

    // --- crossing the pass, with the one loading screen in the game ---------
    const onIsland = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the game starts on the island', onIsland.region === 'verath', onIsland.regionTitle);

    const crossed = await page.evaluate('window.GRIMWARD.crossTo("cleftvale")');
    ok('the pass leads somewhere', crossed === true, String(crossed));
    await sleep(400);
    const inValley = await page.evaluate('window.GRIMWARD.probeState()');
    ok('and it is a different world', inValley.region === 'cleftvale', inValley.regionTitle);
    ok('the loading screen put itself away',
      await page.evaluate('document.getElementById("loading").hidden'));
    ok('the renderer is drawing the valley', inValley.drawCalls > 0,
      `${inValley.drawCalls} draws, ${inValley.triangles} triangles`);
    ok('the man came with us', inValley.gold === onIsland.gold && inValley.level === onIsland.level,
      `${inValley.gold} gold, level ${inValley.level}`);
    ok('and crossing raised no error', !(await page.evaluate('window.GRIMWARD.error || null')));

    await page.evaluate('window.GRIMWARD.crossTo("verath")');
    await sleep(400);
    const home = await page.evaluate('window.GRIMWARD.probeState()');
    ok('and there is a way home', home.region === 'verath', home.regionTitle);

    // --- saving, through the real game -------------------------------------
    const beforeSave = await page.evaluate('window.GRIMWARD.probeState()');
    await page.evaluate('window.GRIMWARD.save("test")');
    await sleep(250);
    await page.hold('KeyW', 700);            // walk somewhere else
    await sleep(200);
    const moved = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the player moved after saving',
      dist2(beforeSave.pos, moved.pos) > 1.5, `${dist2(beforeSave.pos, moved.pos).toFixed(2)} m`);

    const loaded = await page.evaluate('window.GRIMWARD.load("test")');
    await sleep(250);
    const reloaded = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a save can be loaded back', loaded === true);
    ok('loading puts the player back where they were',
      dist2(beforeSave.pos, reloaded.pos) < 0.4, `${dist2(beforeSave.pos, reloaded.pos).toFixed(2)} m away`);
    ok('and keeps what the character knew', reloaded.flags.includes('met:harl'));

    // --- the world keeps time ---------------------------------------------
    ok('the clock is running', /^\d\d:\d\d$/.test(landed.clock), landed.clock);

    // --- the phone ----------------------------------------------------------
    //
    // Driven the same way as everything else in this file: real touch events
    // through the browser's own dispatch, and every assertion read off the
    // simulation. A touch layer tested by reading back its own state object
    // would prove only that the object exists.
    await page.enableTouch();

    // Where the thumbs go, measured rather than assumed. A headless window is
    // not the size it was asked for — `--window-size=800,600` gives a viewport
    // of 800×408 — and a check that hard-codes a point outside it reports a
    // broken control scheme that is in fact perfectly healthy.
    const [vw, vh] = await page.evaluate('[innerWidth, innerHeight]');
    const STICK = [Math.round(vw * 0.18), Math.round(vh * 0.80)];   // in the move zone
    const LOOK = [Math.round(vw * 0.75), Math.round(vh * 0.40)];    // clear of every button

    const centreOf = (sel) => page.evaluate(
      `(() => { const e = document.querySelector(${JSON.stringify(sel)});`
      + ' if (!e || e.hidden) return null; const r = e.getBoundingClientRect();'
      + ' return [r.left + r.width / 2, r.top + r.height / 2]; })()');
    const tapOn = async (sel, ms = 60) => {
      const c = await centreOf(sel);
      if (!c) throw new Error(`nothing to tap at ${sel}`);
      // A control that has fallen off the bottom of the screen is a real bug,
      // and it must not read as an inert one: a touch dispatched outside the
      // viewport lands on nothing and looks exactly like a dead listener.
      if (c[0] < 0 || c[1] < 0 || c[0] > vw || c[1] > vh) {
        throw new Error(`${sel} is off the screen at ${c} (viewport ${vw}×${vh})`);
      }
      await page.touchStart(c[0], c[1]);
      await sleep(ms);
      await page.touchEnd();
      await sleep(200);
      return c;
    };

    ok('the touch controls are not there until somebody touches the glass',
      await page.evaluate('document.getElementById("touch") === null'));

    // One tap on the right-hand side of the screen — which is what a player's
    // first contact with this game actually is.
    await page.tap(LOOK[0], LOOK[1]);
    await sleep(250);
    const litUp = await page.evaluate('window.GRIMWARD.probeState()');
    ok('a finger brings them up', !!(litUp.touch && litUp.touch.on));
    ok('and the page knows it is being held',
      await page.evaluate('document.body.classList.contains("touch")'));

    // The stick, pushed all the way forward from a stood start — in the same
    // place and the same direction the keyboard walked a moment ago.
    const stood = await page.evaluate('window.GRIMWARD.probeState()');
    await page.touchStart(STICK[0], STICK[1]);
    await page.touchMove(STICK[0], STICK[1] - 64);      // 64 px up: full deflection
    await sleep(700);
    const atRun = await page.evaluate('window.GRIMWARD.probeState()');
    await sleep(300);
    await page.touchEnd();
    await sleep(200);
    const ranTo = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the stick reads a full push', atRun.touch.mag > 0.95,
      `mag ${atRun.touch.mag}, stick ${atRun.touch.stick}`);
    ok('and the man walks where the thumb points',
      dist2(stood.pos, ranTo.pos) > 1.0, `${dist2(stood.pos, ranTo.pos).toFixed(2)} m`);
    ok('letting go stops him', ranTo.touch.mag === 0, `mag ${ranTo.touch.mag}`);

    // Half a stick walks. It is the one thing a thumb says that a key cannot,
    // so it gets an assertion of its own.
    await page.touchStart(STICK[0], STICK[1]);
    await page.touchMove(STICK[0], STICK[1] - 32);      // 32 px up: a little over a third
    await sleep(700);
    const atWalk = await page.evaluate('window.GRIMWARD.probeState()');
    await page.touchEnd();
    await sleep(200);
    ok('half a stick is a walk and a whole one is a run',
      atWalk.speed > 0.2 && atWalk.speed < atRun.speed * 0.92,
      `${atWalk.speed.toFixed(2)} m/s against ${atRun.speed.toFixed(2)}`);

    // Dragging the right of the screen turns him, the way the mouse does.
    const facingAt = await page.evaluate('window.GRIMWARD.probeState()');
    const drag = await page.swipe(LOOK, [LOOK[0] + 120, LOOK[1]], { steps: 8, hold: 30 });
    await drag.release();
    await sleep(250);
    const dragged = await page.evaluate('window.GRIMWARD.probeState()');
    const dyaw = Math.abs(((dragged.yaw - facingAt.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    ok('dragging the right of the screen turns him', dyaw > 0.15, `${dyaw.toFixed(2)} rad`);
    const thumbLean = Math.sin(dragged.yaw) * facingAt.camRight[0] + Math.cos(dragged.yaw) * facingAt.camRight[2];
    ok('and a thumb dragged right turns him right', thumbLean > 0.1,
      `${thumbLean.toFixed(2)} towards screen right`);

    // A button is a key. Holding "Hit" has to start a swing through the same
    // path F does, because that is the whole design of the touch layer.
    const swingsBefore = (await page.evaluate('window.GRIMWARD.probeState()')).combat.swings;
    const hit = await centreOf('#touch .thands .tbtn');
    await page.touchStart(hit[0], hit[1]);
    await sleep(500);
    await page.touchEnd();
    await sleep(250);
    const swung = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the Hit button swings the sword', swung.combat.swings > swingsBefore,
      `${swingsBefore} → ${swung.combat.swings}`);

    // Everything used less than once a minute is behind the ☰, and it opens
    // the same screens the letter keys do.
    await tapOn('#touch .tmenu');
    ok('the ☰ opens the rest of the controls',
      await page.evaluate('!document.querySelector("#touch .tdrawer").hidden'));
    await tapOn('#touch .tdrawer .tbtn[data-code="KeyN"]');
    const toMap = await page.evaluate('window.GRIMWARD.probeState()');
    ok('and one of them is the map', toMap.book === 'map', String(toMap.book));
    ok('a panel stands the thumb controls down',
      await page.evaluate('document.getElementById("touch").hidden'));

    // The tabs, the rows and the close cross. Everything the number keys act on
    // has to be reachable by a finger, or half the game is unplayable on a
    // phone while looking perfectly healthy on a desk.
    await tapOn('#book-tabs button[data-tab="pack"]');
    const inPack = await page.evaluate('window.GRIMWARD.probeState()');
    ok('tapping a tab switches it', inPack.book === 'pack', String(inPack.book));

    const heldWeapon = inPack.weapon;
    await tapOn('#book-body li.on[data-act]');
    const stripped = await page.evaluate('window.GRIMWARD.probeState()');
    ok('tapping a row does what its number would',
      stripped.weapon !== heldWeapon, `${heldWeapon} → ${stripped.weapon}`);

    await tapOn('#book .x');
    const boxShut = await page.evaluate('window.GRIMWARD.probeState()');
    ok('and the cross closes the panel', boxShut.book === null, String(boxShut.book));
    ok('which gives the thumb controls back',
      await page.evaluate('!document.getElementById("touch").hidden'));

    // --- nothing broke on the way -----------------------------------------
    const finalErr = await page.evaluate('window.GRIMWARD.error || null');
    ok('no error after a minute of play', !finalErr, finalErr || '');

    page.close();
  } finally {
    await cleanup();
  }

  if (failures.length) {
    console.log(`\n${passed} passed, ${failures.length} FAILED\n`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    if (stderr) console.log(`\nbrowser stderr (tail):\n${stderr.split('\n').filter((l) => !/dbus|bluez|upower|Consistency/i.test(l)).slice(-8).join('\n')}`);
    process.exit(1);
  }
  console.log(`\n${passed} browser checks passed\n`);
}

main().catch((e) => { console.error(`\n${e.stack || e.message}\n`); process.exit(1); });
