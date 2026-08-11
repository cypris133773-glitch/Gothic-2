#!/usr/bin/env node
/**
 * Layer 4: the frame-time probe. The only source of a frame-time claim.
 *
 *   node tools/perf.mjs [--seconds=20] [--size=1280x720] [--scale=1]
 *                       [--baseline] [--compare]
 *
 * It walks the character on a fixed route with real key events for a fixed
 * duration on a fixed seed, then reports p50/p95/p99 of the frame interval,
 * plus draw calls, triangles and heap. `--baseline` writes perf-baseline.json;
 * `--compare` fails when p95 regresses by more than 8%.
 *
 * **What these numbers are and are not.** On a machine with no GPU — CI, and
 * the container this was written in — Chromium rasterises through SwiftShader
 * on the CPU. The numbers are then a *regression signal*, comparable only to
 * other numbers from the same kind of machine. They are not a claim about
 * anyone's frame rate. The budgets in §9.7 of the brief are hardware budgets
 * and are met or missed on hardware; this tool records which environment it ran
 * in so the two can never be quietly conflated.
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
const opt = (n, d = null) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return d;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const SECONDS = Number(opt('seconds', 20));
const [W, H] = String(opt('size', '1024x600')).split('x').map(Number);
const SCALE = Number(opt('scale', 0.5));
const BASELINE = path.join(ROOT, 'perf-baseline.json');
const PORT_DEVTOOLS = 9334;

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

/**
 * The route. A fixed sequence of held keys, so every run walks the same ground
 * past the same trees — a probe that wanders somewhere different each time
 * measures the landscape, not the code.
 */
const ROUTE = [
  ['KeyW', 0.30], ['ArrowRight', 0.12], ['KeyW', 0.25],
  ['ArrowLeft', 0.10], ['KeyW', 0.15], ['KeyD', 0.08],
];

async function main() {
  const chrome = findChrome();
  const { server, port } = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grimward-perf-'));
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--window-size=${W},${H}`, `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT_DEVTOOLS}`,
    `http://127.0.0.1:${port}/?seed=1&renderScale=${SCALE}&time=10`,
  ], { stdio: 'ignore' });

  let result;
  try {
    const target = await findPageTarget(PORT_DEVTOOLS);
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await page.waitFor("window.GRIMWARD && window.GRIMWARD.state === 'playing'", { what: 'the game' });

    // Warm up before measuring: shader compilation, buffer uploads and the
    // first few frames of any renderer are not what anyone plays.
    await sleep(2500);
    await page.evaluate('window.GRIMWARD.frames');
    const warm = await page.evaluate('window.GRIMWARD.probeState()');

    const started = Date.now();
    for (let i = 0; Date.now() - started < SECONDS * 1000; i++) {
      const [key, share] = ROUTE[i % ROUTE.length];
      await page.hold(key, Math.max(80, share * SECONDS * 1000 / ROUTE.length));
    }

    const end = await page.evaluate('window.GRIMWARD.probeState()');
    const heap = await page.evaluate('performance.memory ? performance.memory.usedJSHeapSize : null');
    const gpu = await page.evaluate('window.GRIMWARD.caps.gpu || "unknown"');
    const frames = end.frames - warm.frames;

    result = {
      when: new Date().toISOString(),
      environment: {
        gpu, platform: `${os.platform()} ${os.arch()}`, cores: os.cpus().length,
        // The single most important field in this file. A p95 from SwiftShader
        // and a p95 from a discrete GPU are different units.
        software_rasteriser: /swiftshader|llvmpipe|software/i.test(String(gpu)),
      },
      settings: { seconds: SECONDS, window: `${W}x${H}`, renderScale: SCALE, seed: 1 },
      frame: end.frame,
      fps: +(frames / SECONDS).toFixed(1),
      drawCalls: end.drawCalls,
      triangles: end.triangles,
      resolution: `${end.width}x${end.height}`,
      heapMB: heap ? +(heap / 1048576).toFixed(1) : null,
    };
    page.close();
  } finally {
    child.kill('SIGKILL');
    server.close();
    await sleep(200);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }

  const f = result.frame;
  console.log(`\n  ${result.resolution}  ${result.drawCalls} draws  ${result.triangles} tris`);
  console.log(`  frame  p50 ${f.p50.toFixed(1)} ms   p95 ${f.p95.toFixed(1)} ms   p99 ${f.p99.toFixed(1)} ms   (${result.fps} fps)`);
  console.log(`  heap   ${result.heapMB ?? '—'} MB`);
  console.log(`  gpu    ${result.environment.gpu}${result.environment.software_rasteriser ? '  ← software rasteriser: a regression signal, not a frame-rate claim' : ''}`);

  if (opt('baseline')) {
    fs.writeFileSync(BASELINE, JSON.stringify(result, null, 2) + '\n');
    console.log(`\n  wrote ${path.relative(ROOT, BASELINE)}\n`);
    return;
  }

  if (opt('compare')) {
    if (!fs.existsSync(BASELINE)) {
      console.log('\n  no baseline to compare against — run with --baseline first\n');
      return;
    }
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    if (base.environment.software_rasteriser !== result.environment.software_rasteriser) {
      console.log('\n  baseline was recorded on a different class of machine; not comparing\n');
      return;
    }
    const delta = (result.frame.p95 - base.frame.p95) / base.frame.p95;
    console.log(`\n  p95 ${(delta * 100).toFixed(1)}% vs baseline (${base.frame.p95.toFixed(1)} ms, ${base.when.slice(0, 10)})`);
    if (delta > 0.08) {
      console.log('\n  FAILED: frame time regressed by more than 8%\n');
      process.exit(1);
    }
    console.log('');
  }
}

main().catch((e) => { console.error(`\n${e.stack || e.message}\n`); process.exit(1); });
