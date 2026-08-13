#!/usr/bin/env node
/**
 * The build gate: render the game in a real browser and prove something was
 * drawn.
 *
 *   node tools/shot.mjs [--out=shots] [--time=13.5] [--size=800x450] [--seed=1]
 *
 * Why it works the way it does
 * ----------------------------
 * 1. **A PNG is not evidence.** A black rectangle is a perfectly valid PNG, and
 *    a silently-failed shader produces one every time. So the page reports pixel
 *    statistics from inside the frame (mean luminance, distinct colour count)
 *    and this tool asserts on those. The image is for humans; the numbers are
 *    for CI.
 * 2. **No dependencies.** It drives the Chromium already on the machine over the
 *    DevTools protocol (tools/cdp.mjs), so `npm ls --prod` stays empty and the
 *    test story does not start with a 300 MB install.
 * 3. **It serves over http://.** ES modules refuse to load from file://, so the
 *    dev server is started in-process on an ephemeral port and shut down after.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { connect, findPageTarget } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

const OUT = path.resolve(ROOT, String(opt('out', 'shots')));
// 800×450 by default, and that is a deliberate ceiling rather than a shrug.
// CI has no GPU: Chromium rasterises through SwiftShader, and above roughly
// this window size the first animation frame does not finish before headless
// Chromium dumps the page — the game renders perfectly, the harness just never
// sees it. Frame-time claims come from tools/perf.mjs on real hardware (§9.7);
// this gate answers a different question: was a lit frame produced at all.
const [W, H] = String(opt('size', '800x450')).split('x').map(Number);
const SEED = String(opt('seed', '1'));
const PORT_DEVTOOLS = 9335;

// --- find a browser ---------------------------------------------------------

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', '/usr/lib/chromium']
    .filter(Boolean);
  const candidates = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries.filter((n) => n.startsWith('chromium'))) {
      candidates.push(path.join(root, e, 'chrome-linux', 'chrome'));
      candidates.push(path.join(root, e, 'chrome-linux', 'headless_shell'));
    }
  }
  const found = candidates.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
  if (!found) {
    throw new Error(`No Chromium found. Set CHROME=/path/to/chrome. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

// --- serve ------------------------------------------------------------------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(ROOT, rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (process.env.SHOT_DEBUG) console.log(`[serve] ${err ? '404' : '200'} ${rel}`);
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// --- the canonical framings -------------------------------------------------
// M0 has one scene, so there is one framing. The list grows with the world and
// the committed reference images grow with it (§12 of the brief, pillar P12).

const LINEUP = !!opt('lineup');
const VISTA = !!opt('vista');
const SCENES = LINEUP
  ? [
      { name: 'models', time: 11 },
      // Three suits, close: the pieces are what this sheet is for, and at nine
      // across a pauldron is one pixel.
      { name: 'armour', time: 11, kits: 'watch,freeblade,ember' },
      { name: 'harness', time: 11, kits: 'knight' },
    ]
  : VISTA
  // Two framings from outside the walls. The first is the one that shows
  // whether distance holds up — terrain LOD, aerial perspective, and whether
  // the city reads as a place rather than a cluster of roofs. The second is the
  // gate itself, which is the single most important object on the island.
  ? [
      { name: 'vista', time: 11.0, extra: '&start=0,96&yaw=3.1416' },
      { name: 'gate', time: 10.5, extra: '&start=0,56&yaw=3.1416' },
      // The other world. Three framings, because the valley is half the game
      // and had none until it was built.
      { name: 'valley', time: 11.0, extra: '&region=cleftvale&start=-4,108&yaw=3.1416' },
      { name: 'camp', time: 9.0, extra: '&region=cleftvale&start=-16,88&yaw=3.1416' },
      { name: 'pit', time: 13.0, extra: '&region=cleftvale&start=-92,36&yaw=3.1416' },
      // The bandits at the lighthouse: the first framing in the game with men
      // in it who are not standing about waiting to be spoken to.
      { name: 'bandits', time: 15.0, extra: '&start=-116,-26&yaw=-1.82' },
    ]
  : opt('time')
  ? [{ name: 'custom', time: Number(opt('time')) }]
  : [
      { name: 'morning', time: 9 },
      { name: 'noon', time: 12.5 },
      { name: 'dusk', time: 18.4 },
      { name: 'night', time: 1 },
    ];

async function run() {
  const chrome = findChrome();
  const { server, port } = await serve();
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grimward-shot-'));

  // One browser for every framing, stepped through them over the DevTools
  // protocol. It used to be one launch per framing, and roughly one run in two
  // died on the third: a cold headless Chromium on a loaded machine starts,
  // loads nothing, and exits zero — which reads exactly like a broken renderer
  // and is not one. Launching once removes the failure mode instead of retrying
  // past it, and it is three times faster.
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--window-size=${W},${H}`, `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT_DEVTOOLS}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  const results = [];
  try {
    const target = await findPageTarget(PORT_DEVTOOLS);
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');

    for (const scene of SCENES) {
      process.stdout.write(`  ${scene.name} …\r`);
      // tier=medium on purpose: the gate photographs what a normal machine
      // sees, not what this GPU-less container would default itself to.
      const url = `http://127.0.0.1:${port}/?probe=1&seed=${SEED}&time=${scene.time}&renderScale=0.6&tier=medium${LINEUP ? `&lineup=${scene.kits || ''}` : ''}${scene.extra || ''}`;
      await page.send('Page.navigate', { url });
      const probe = await page.waitFor('window.GRIMWARD && window.GRIMWARD.probe',
        { timeout: 60000, what: `${scene.name} to render` });
      if (probe.error || !probe.drawCalls) throw new Error(`${scene.name}: the page reported ${JSON.stringify(probe)}`);

      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      const png = path.join(OUT, `${scene.name}.png`);
      fs.writeFileSync(png, Buffer.from(shot.data, 'base64'));
      results.push({ scene: scene.name, png, probe, image: decodePng(png) });
    }
    page.close();
  } catch (e) {
    const tail = stderr.split('\n').filter((l) => !/dbus|bluez|upower|Consistency/i.test(l)).slice(-6).join('\n');
    throw new Error(`${e.message}${tail ? `\n\nbrowser stderr:\n${tail}` : ''}`);
  } finally {
    child.kill('SIGKILL');
    server.close();
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
  report(results);
}

/**
 * Decode the screenshot and describe it, so the gate has an opinion about the
 * image a human will look at rather than only about what the page told us.
 * Node ships zlib, so this needs nothing else: PNG is chunks, one inflate, and
 * five filter types.
 */
function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  let pos = 8, width = 0, height = 0, depth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType})`);
      }
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  // Headless Chromium photographs the whole window, and the page's viewport is
  // shorter than that — the strip below it is black and belongs to the browser,
  // not to the game. Trimming the uniformly-black bottom rows is what lets the
  // image's statistics be compared with the page's own.
  let lastRow = height - 1;
  const rowIsBlack = (y) => {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * channels;
      if (out[i] > 6 || out[i + 1] > 6 || out[i + 2] > 6) return false;
    }
    return true;
  };
  while (lastRow > height * 0.5 && rowIsBlack(lastRow)) lastRow--;
  const usable = (lastRow + 1) * stride;

  let sum = 0, min = 255, max = 0;
  const seen = new Set();
  for (let i = 0; i < usable; i += channels) {
    const l = out[i] * 0.299 + out[i + 1] * 0.587 + out[i + 2] * 0.114;
    sum += l; if (l < min) min = l; if (l > max) max = l;
    seen.add(((out[i] >> 3) << 10) | ((out[i + 1] >> 3) << 5) | (out[i + 2] >> 3));
  }
  const n = usable / channels;
  return { width, height: lastRow + 1, meanLuma: +(sum / n).toFixed(2), minLuma: Math.round(min), maxLuma: Math.round(max), colors: seen.size };
}

function report(results) {
  const failures = [];
  for (const r of results) {
    const p = r.probe;
    const size = fs.existsSync(r.png) ? fs.statSync(r.png).size : 0;
    // The three assertions that a black screen cannot pass.
    if (!size) failures.push(`${r.scene}: no screenshot was written`);
    // Twelve buckets at 5 bits per channel is a low bar deliberately: M0 draws
    // four flat-shaded boxes, and the number that has to grow with the world is
    // this threshold, not the assertion. A black screen scores one.
    if (p.colors < 12) failures.push(`${r.scene}: only ${p.colors} distinct colours — the frame is flat`);
    // Contrast, relative to the frame's own exposure rather than an absolute
    // number of levels. The absolute version (a range of 20) failed the night
    // framing the moment the aerial perspective was tuned down: a mean
    // luminance of 12 with a range of 19 is a dark scene with legible
    // silhouettes in it, which is exactly what night is supposed to be. A black
    // frame still scores zero, and so does a flat grey one, which is what this
    // check is actually for.
    const contrast = (x) => x.maxLuma - x.minLuma >= Math.max(8, x.meanLuma * 0.55);
    if (!contrast(p)) failures.push(`${r.scene}: the page saw ${p.minLuma}–${p.maxLuma} around a mean of ${p.meanLuma} — nothing is lit`);
    if (p.drawCalls < 1) failures.push(`${r.scene}: nothing was drawn`);

    // The same three questions, asked of the decoded image rather than of the
    // page. An in-page probe that passes while the screenshot is black means
    // the compositor never got the frame, which is its own class of bug.
    const img = r.image;
    if (img.colors < 12) failures.push(`${r.scene}: the screenshot has only ${img.colors} distinct colours`);
    if (!contrast(img)) failures.push(`${r.scene}: the screenshot is flat (${img.minLuma}–${img.maxLuma} around ${img.meanLuma})`);
    if (Math.abs(img.meanLuma - p.meanLuma) > 40) {
      failures.push(`${r.scene}: page reported mean luma ${p.meanLuma}, the image is ${img.meanLuma}`);
    }

    console.log(
      `  ${r.scene.padEnd(8)} ${img.width}×${img.height} ${String(size).padStart(7)} B  `
      + `draws ${p.drawCalls} tris ${p.triangles}  `
      + `luma ${img.meanLuma} (${img.minLuma}–${img.maxLuma})  colours ${img.colors}  ${p.backend} ${p.clock}`
    );
  }
  if (failures.length) {
    console.log('\nFAILED:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`\n${results.length} framings rendered into ${path.relative(ROOT, OUT)}/\n`);
}

run().catch((e) => { console.error(`\n${e.message}\n`); process.exit(1); });
