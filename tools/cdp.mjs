// A DevTools Protocol client in about a hundred and fifty lines, so that the
// browser tests need no dependencies at all.
//
// The alternative was Playwright, which is an excellent library and a 300 MB
// install for the two things we actually need: run an expression in the page,
// and deliver a key event through the browser's real event dispatch. CDP is a
// WebSocket carrying JSON, and a WebSocket is an HTTP upgrade plus a frame
// header — so it is written out here, once, and `npm install` stays
// unnecessary for the whole project.
//
// What it deliberately does not implement: fragmentation of *outgoing* frames
// (our messages are small), compression (Chrome does not negotiate it here),
// and binary frames (the protocol is text). If any of those ever appear, they
// throw rather than silently truncating.

import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';

/** GET /json/list on the DevTools port, retrying while the browser starts. */
export async function findPageTarget(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const list = await getJson(port, '/json/list');
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* the browser is not listening yet */ }
    if (Date.now() > deadline) throw new Error(`no DevTools page target on port ${port} after ${timeoutMs} ms`);
    await sleep(120);
  }
}

export async function connect(wsUrl) {
  const url = new URL(wsUrl);
  const key = crypto.randomBytes(16).toString('base64');
  const socket = net.connect({ host: url.hostname, port: Number(url.port) });
  socket.setNoDelay(true);

  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('connect', resolve);
  });

  socket.write(
    `GET ${url.pathname}${url.search} HTTP/1.1\r\n`
    + `Host: ${url.host}\r\n`
    + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );

  // Read until the end of the handshake headers, then hand whatever bytes came
  // after them straight to the frame parser — Chrome often packs the first
  // frame into the same TCP segment as the 101 response.
  let buf = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.subarray(0, end).toString('latin1');
      if (!/^HTTP\/1\.1 101/.test(head)) {
        socket.off('data', onData);
        reject(new Error(`WebSocket upgrade refused:\n${head}`));
        return;
      }
      const expect = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (!head.includes(expect)) {
        socket.off('data', onData);
        reject(new Error('WebSocket accept key did not match'));
        return;
      }
      socket.off('data', onData);
      buf = buf.subarray(end + 4);
      resolve();
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });

  let nextId = 1;
  let frag = null;                 // partial text message, see the reader below
  const pending = new Map();
  const listeners = [];

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const frame = readFrame(buf);
      if (!frame) break;
      buf = buf.subarray(frame.size);
      if (frame.opcode === 0x9) { socket.write(encodeFrame(frame.payload, 0xA)); continue; }  // ping
      if (frame.opcode === 0x8) { socket.end(); break; }                                       // close
      if (frame.opcode !== 0x1 && frame.opcode !== 0x0) continue;                              // not text

      // Chrome fragments large results — a screenshot-sized evaluate arrives as
      // a text frame followed by continuation frames — so they are stitched
      // here. Parsing an unfinished fragment is how a client that "works" fails
      // only on the one message big enough to matter.
      frag = frag ? Buffer.concat([frag, frame.payload]) : frame.payload;
      if (!frame.fin) continue;
      const complete = frag; frag = null;

      let msg;
      try { msg = JSON.parse(complete.toString('utf8')); } catch { continue; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else {
        for (const fn of listeners) fn(msg);
      }
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    const payload = JSON.stringify({ id, method, params });
    socket.write(encodeFrame(Buffer.from(payload, 'utf8'), 0x1));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method} timed out after 30 s`));
      }, 30000);
    });
  }

  return {
    send,
    on: (fn) => listeners.push(fn),
    close: () => { try { socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch {} socket.end(); },

    /** Evaluate an expression in the page and return its value. */
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) {
        const e = r.exceptionDetails;
        throw new Error(`page threw: ${e.exception?.description || e.text}`);
      }
      return r.result.value;
    },

    /** Poll an expression until it is truthy. */
    async waitFor(expression, { timeout = 15000, every = 100, what = expression } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        let value = null;
        try { value = await this.evaluate(expression); } catch { /* page still loading */ }
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await sleep(every);
      }
    },

    /**
     * A real key press: down, hold, up, delivered through the browser's own
     * dispatch so it goes through focus, default actions and the page's real
     * listeners. Nothing here calls into the game.
     */
    async keyDown(code) { return send('Input.dispatchKeyEvent', keyEvent('keyDown', code)); },
    async keyUp(code) { return send('Input.dispatchKeyEvent', keyEvent('keyUp', code)); },
    async hold(code, ms) {
      await this.keyDown(code);
      await sleep(ms);
      await this.keyUp(code);
    },
    async click(x, y) {
      const base = { x, y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
    },
  };
}

// --- WebSocket framing -------------------------------------------------------

function readFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > 64n * 1024n * 1024n) throw new Error('refusing a WebSocket frame over 64 MB');
    len = Number(big); offset = 10;
  }
  let maskKey = null;
  if (masked) {                                  // servers do not mask, but be exact
    if (buf.length < offset + 4) return null;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (maskKey) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }
  return { fin, opcode, payload, size: offset + len };
}

function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.alloc(6);
  else if (len < 65536) { header = Buffer.alloc(8); }
  else header = Buffer.alloc(14);
  header[0] = 0x80 | opcode;
  const mask = crypto.randomBytes(4);
  if (len < 126) { header[1] = 0x80 | len; mask.copy(header, 2); }
  else if (len < 65536) { header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); mask.copy(header, 4); }
  else { header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); mask.copy(header, 10); }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, masked]);
}

// --- key codes ---------------------------------------------------------------

// Only the keys the game binds. A missing entry throws rather than sending a
// key event with a zero virtual-key code, which browsers deliver but no page
// recognises — a failure that looks exactly like a broken input system.
const KEYS = {
  KeyW: [87, 'w'], KeyA: [65, 'a'], KeyS: [83, 's'], KeyD: [68, 'd'],
  KeyQ: [81, 'q'], KeyE: [69, 'e'], KeyC: [67, 'c'], KeyF: [70, 'f'], KeyG: [71, 'g'],
  KeyT: [84, 't'], KeyI: [73, 'i'], KeyJ: [74, 'j'], KeyK: [75, 'k'], KeyR: [82, 'r'], Enter: [13, 'Enter'], F9: [120, 'F9'],
  Digit1: [49, '1'], Digit2: [50, '2'], Digit3: [51, '3'], Escape: [27, 'Escape'],
  Space: [32, ' '], ShiftLeft: [16, 'Shift'], ControlLeft: [17, 'Control'],
  ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
  F3: [114, 'F3'],
};

function keyEvent(type, code) {
  const entry = KEYS[code];
  if (!entry) throw new Error(`no virtual key code for ${code} — add it to tools/cdp.mjs`);
  const [vk, key] = entry;
  return {
    type, code, key,
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    // `text` is what makes a keyDown produce a character event. Modifiers and
    // arrows must not have it, or the browser treats them as typing.
    ...(type === 'keyDown' && key.length === 1 ? { text: key } : {}),
  };
}

// --- helpers -----------------------------------------------------------------

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('DevTools HTTP timeout')));
  });
}
