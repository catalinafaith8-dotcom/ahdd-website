// test/test-chatbot-helpers.mjs
// Lightweight check of the pure helpers inside assets/ahdd-enhance.js
// (escalation intent matcher, phone normalizer). Driven by extracting
// the constants/functions from the source so the test stays accurate
// even if the source moves.
//
//   node test/test-chatbot-helpers.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'assets', 'ahdd-enhance.js'), 'utf8');

// Pull the relevant section out — everything from `var ESC_PATTERNS` to
// the end of `prettyPhone`. Wrap in a function returning the helpers
// so we can run it under vm without needing a browser DOM.
const startMarker = '// Free-text patterns that mean';
const endMarker = 'function prettyPhone';
const start = src.indexOf(startMarker);
const endFn = src.indexOf(endMarker);
if (start < 0 || endFn < 0) {
  console.error('Could not locate helper functions in ahdd-enhance.js');
  process.exit(1);
}
// Capture through to the closing brace of prettyPhone — bracket-match
// from where the function body opens.
const bodyOpen = src.indexOf('{', endFn);
let depth = 0;
let i = bodyOpen;
for (; i < src.length; i++) {
  const c = src[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
}
const chunk = src.substring(start, i);

const wrapped = `
  ${chunk}
  this.ESC_PATTERNS = ESC_PATTERNS;
  this.looksLikeEscalation = looksLikeEscalation;
  this.normalizeUsPhone = normalizeUsPhone;
  this.prettyPhone = prettyPhone;
`;

const context = {};
vm.createContext(context);
vm.runInContext(wrapped, context, { filename: 'ahdd-enhance-extract.js' });

const { looksLikeEscalation, normalizeUsPhone, prettyPhone } = context;

let failures = 0;
function pass(name) { console.log(`  ✓ ${name}`); }
function fail(name, msg) { console.log(`  ✗ ${name} — ${msg}`); failures++; }

// ── Intent matcher: positive cases ───────────────────────────
const positives = [
  'Can I talk to a team member?',
  'I want to talk to a human',
  'speak to someone please',
  'talk to a real person',
  'can someone call me',
  'callback please',
  'call back please',
  'have a team member call me',
  'I want to talk to a real human',
  'wanna talk to someone',
  'human please',
  'just have someone call me',
  'Talk to a human',
  'speak with a representative',
  'speak to an agent',
  'chat with a live person',
];
positives.forEach((p) => {
  if (looksLikeEscalation(p)) pass(`matches: "${p}"`);
  else fail(`should match: "${p}"`, 'no pattern matched');
});

// ── Intent matcher: negative cases (should NOT match) ────────
const negatives = [
  'How much do veneers cost?',
  'Do you take Delta Dental?',
  'I want whitening',
  'Can I book an appointment?',
  'What is sedation dentistry?',
  'Are you open today?',
  'I love your office',
  'My tooth hurts',
];
negatives.forEach((n) => {
  if (!looksLikeEscalation(n)) pass(`does NOT match: "${n}"`);
  else fail(`should NOT match: "${n}"`, 'matched anyway');
});

// ── Phone normalization ──────────────────────────────────────
const phoneCases = [
  ['(818) 555-1234', '+18185551234'],
  ['818-555-1234', '+18185551234'],
  ['818.555.1234', '+18185551234'],
  ['8185551234', '+18185551234'],
  ['18185551234', '+18185551234'],
  ['+18185551234', '+18185551234'],
  ['1 (818) 555-1234', '+18185551234'],
];
phoneCases.forEach(([input, expected]) => {
  const got = normalizeUsPhone(input);
  if (got === expected) pass(`normalizeUsPhone("${input}") → ${expected}`);
  else fail(`normalizeUsPhone("${input}")`, `expected ${expected}, got ${got}`);
});

// ── Phone rejection ──────────────────────────────────────────
const rejects = [
  '555-12',          // too short
  '12345',           // too short
  '0000000000',      // all zeros
  '1111111111',      // all ones (repeating digit)
  '0181234567',      // starts with 0
  '1818555123',      // 10 digits but starts with 1 (invalid area code)
  '',                // empty
  null,              // null
];
rejects.forEach((r) => {
  const got = normalizeUsPhone(r);
  if (got === null) pass(`rejects: "${r}"`);
  else fail(`should reject "${r}"`, `got ${got}`);
});

// ── prettyPhone ──────────────────────────────────────────────
if (prettyPhone('+18185551234') === '(818) 555-1234') pass('prettyPhone formats E.164');
else fail('prettyPhone formats E.164', `got ${prettyPhone('+18185551234')}`);

console.log(failures === 0 ? `\nAll tests passed.` : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
