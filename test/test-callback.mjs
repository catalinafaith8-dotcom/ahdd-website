// test/test-callback.mjs
// End-to-end test of api/callback.js — boots a mock GHL webhook listener,
// points the handler at it, and asserts the proxied payload + error paths.
//
//   node test/test-callback.mjs
//
// Exits 0 on success, 1 on failure. Prints per-case status.

import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const port = 9931;
let received = [];

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      received.push({ url: req.url, body: JSON.parse(body), headers: req.headers });
    } catch (e) {
      received.push({ url: req.url, raw: body, parseError: e.message });
    }
    if (req.url === '/fail') {
      res.statusCode = 500;
      return res.end('upstream broken');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
});

await new Promise((r) => mock.listen(port, r));
console.log(`[mock] listening on http://127.0.0.1:${port}`);

let failures = 0;
function pass(name) { console.log(`  ✓ ${name}`); }
function fail(name, msg) { console.log(`  ✗ ${name} — ${msg}`); failures++; }

function fakeReqRes(method, body) {
  const req = { method, body };
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  return { req, res };
}

async function invokeHandler(handler, method, body) {
  const { req, res } = fakeReqRes(method, body);
  await handler(req, res);
  return res;
}

const happyPayload = {
  firstName: 'Sarah',
  phone: '+18185551234',
  bestTimeToCall: 'Afternoon',
  reasonForCall: 'Veneers question',
  sourcePage: '/veneers',
  requestedAt: new Date().toISOString(),
  tags: ['callback_requested'],
};

// ── Test 1: happy path ─────────────────────────────────────────
process.env.GHL_CALLBACK_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
delete require.cache[require.resolve('../api/callback.js')];
const handler = require('../api/callback.js');

received = [];
let res = await invokeHandler(handler, 'POST', happyPayload);
if (res.statusCode === 200 && res.body && res.body.ok === true) pass('happy path returns 200 ok:true');
else fail('happy path returns 200 ok:true', `got ${res.statusCode} ${JSON.stringify(res.body)}`);

if (received.length === 1 && received[0].url === '/hook') pass('mock received exactly 1 forwarded POST');
else fail('mock received exactly 1 forwarded POST', `got ${received.length}: ${JSON.stringify(received)}`);

const fwd = received[0] && received[0].body;
if (fwd && fwd.firstName === 'Sarah') pass('firstName forwarded');
else fail('firstName forwarded', JSON.stringify(fwd));

if (fwd && fwd.phone === '+18185551234') pass('phone forwarded as E.164');
else fail('phone forwarded as E.164', JSON.stringify(fwd?.phone));

if (fwd && fwd.bestTimeToCall === 'Afternoon') pass('bestTimeToCall forwarded');
else fail('bestTimeToCall forwarded', JSON.stringify(fwd?.bestTimeToCall));

if (fwd && Array.isArray(fwd.tags) && fwd.tags.includes('callback_requested')) pass('callback_requested tag preserved');
else fail('callback_requested tag preserved', JSON.stringify(fwd?.tags));

// ── Test 2: phone normalization (10-digit + raw 11-digit) ─────
received = [];
res = await invokeHandler(handler, 'POST', { ...happyPayload, phone: '(818) 555-1234' });
if (res.statusCode === 200 && received[0]?.body?.phone === '+18185551234') pass('phone normalized from formatted 10-digit');
else fail('phone normalized from formatted 10-digit', JSON.stringify(received[0]?.body?.phone));

received = [];
res = await invokeHandler(handler, 'POST', { ...happyPayload, phone: '1-818-555-1234' });
if (res.statusCode === 200 && received[0]?.body?.phone === '+18185551234') pass('phone normalized from 11-digit with leading 1');
else fail('phone normalized from 11-digit with leading 1', JSON.stringify(received[0]?.body?.phone));

// ── Test 3: tag auto-injection if missing ─────────────────────
received = [];
res = await invokeHandler(handler, 'POST', { ...happyPayload, tags: [] });
if (received[0]?.body?.tags?.includes('callback_requested')) pass('callback_requested tag auto-added when absent');
else fail('callback_requested tag auto-added when absent', JSON.stringify(received[0]?.body?.tags));

// ── Test 4: rejects missing firstName ─────────────────────────
received = [];
res = await invokeHandler(handler, 'POST', { ...happyPayload, firstName: '' });
if (res.statusCode === 400 && received.length === 0) pass('rejects missing firstName (400, no forward)');
else fail('rejects missing firstName (400, no forward)', `status=${res.statusCode} received=${received.length}`);

// ── Test 5: rejects invalid phone ─────────────────────────────
received = [];
res = await invokeHandler(handler, 'POST', { ...happyPayload, phone: '555-12' });
if (res.statusCode === 400 && received.length === 0) pass('rejects invalid phone (400, no forward)');
else fail('rejects invalid phone (400, no forward)', `status=${res.statusCode} received=${received.length}`);

// ── Test 6: rejects missing bestTimeToCall ────────────────────
received = [];
res = await invokeHandler(handler, 'POST', { ...happyPayload, bestTimeToCall: '' });
if (res.statusCode === 400 && received.length === 0) pass('rejects missing bestTimeToCall (400, no forward)');
else fail('rejects missing bestTimeToCall (400, no forward)', `status=${res.statusCode} received=${received.length}`);

// ── Test 7: handles upstream 500 ──────────────────────────────
process.env.GHL_CALLBACK_WEBHOOK_URL = `http://127.0.0.1:${port}/fail`;
delete require.cache[require.resolve('../api/callback.js')];
const handler2 = require('../api/callback.js');
received = [];
res = await invokeHandler(handler2, 'POST', happyPayload);
if (res.statusCode === 502) pass('upstream 500 → handler returns 502');
else fail('upstream 500 → handler returns 502', `got ${res.statusCode}`);

// ── Test 8: handles missing env ───────────────────────────────
delete process.env.GHL_CALLBACK_WEBHOOK_URL;
delete require.cache[require.resolve('../api/callback.js')];
const handler3 = require('../api/callback.js');
received = [];
res = await invokeHandler(handler3, 'POST', happyPayload);
if (res.statusCode === 500 && received.length === 0) pass('missing env → 500, no outbound');
else fail('missing env → 500, no outbound', `status=${res.statusCode} received=${received.length}`);

// ── Test 9: rejects GET ───────────────────────────────────────
res = await invokeHandler(handler3, 'GET', null);
if (res.statusCode === 405) pass('rejects GET with 405');
else fail('rejects GET with 405', `got ${res.statusCode}`);

mock.close();
console.log(failures === 0 ? `\nAll tests passed.` : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
