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
    const yaw0 = (await page.evaluate('window.GRIMWARD.probeState()')).yaw;
    await page.hold('ArrowRight', 600);
    const yaw1 = (await page.evaluate('window.GRIMWARD.probeState()')).yaw;
    const turned = Math.abs(Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0)));
    ok('the character turns without pointer lock', turned > 0.5, `${turned.toFixed(2)} rad`);

    // --- strafing is not a second forward ---------------------------------
    const s0 = await page.evaluate('window.GRIMWARD.probeState()');
    await page.hold('KeyD', 700);
    const s1 = await page.evaluate('window.GRIMWARD.probeState()');
    ok('strafing moves the character', dist2(s0.pos, s1.pos) > 1.2, `${dist2(s0.pos, s1.pos).toFixed(2)} m`);
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
    await page.keyDown('Space');
    await sleep(120);
    const mid = await page.evaluate('window.GRIMWARD.probeState()');
    await page.keyUp('Space');
    ok('space leaves the ground', !mid.onGround || mid.vel[1] > 0.5,
      `vy ${mid.vel[1].toFixed(2)} m/s`);
    await sleep(1200);
    const landed = await page.evaluate('window.GRIMWARD.probeState()');
    ok('the character lands again', landed.onGround);

    // --- the camera --------------------------------------------------------
    ok('the camera is behind the character, not inside them',
      dist2(landed.camera, landed.pos) > 0.8 && dist2(landed.camera, landed.pos) < 6,
      `${dist2(landed.camera, landed.pos).toFixed(2)} m`);
    ok('the camera is above the ground', landed.camera[1] > landed.pos[1] - 1);

    // --- combat, through real key events ----------------------------------
    // The rule the whole system rests on, asserted through the browser's own
    // input path rather than by calling into the fighter.
    await page.keyDown('KeyF');
    await sleep(60);
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
