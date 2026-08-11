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
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    }
  };

  try {
    const target = await findPageTarget(PORT_DEVTOOLS);
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');

    // --- boot -------------------------------------------------------------
    const t0 = Date.now();
    await page.waitFor("window.GRIMWARD && window.GRIMWARD.state === 'playing'",
      { what: 'the game to reach the playing state' });
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
