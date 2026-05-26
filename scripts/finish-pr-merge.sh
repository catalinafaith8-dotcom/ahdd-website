#!/bin/bash
# finish-pr-merge.sh — picks up where recover-pr-merge.sh left off.
# State on entry: branch reset to origin/main, callback files restored,
# scripts/ directory has all three local scripts already.
# Steps remaining: rebuild merged enhance.js, commit, test, force-push.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ Rebuilding merged assets/ahdd-enhance.js"
python3 scripts/merge-enhance.py

echo "→ Staging files"
git add \
  assets/ahdd-enhance.js \
  api/callback.js \
  .env.example \
  docs/GHL-CALLBACK-WORKFLOW-SETUP.md \
  docs/PR-BODY.md \
  test/test-callback.mjs \
  test/test-chatbot-helpers.mjs \
  scripts/merge-enhance.py \
  scripts/resolve-pr-merge.sh \
  scripts/recover-pr-merge.sh \
  scripts/finish-pr-merge.sh

echo "→ Committing"
git commit -m "feat(chatbot): add Talk-to-a-human callback handoff to GHL

Adds a warm, mobile-first escalation flow inside the existing chatbot
that collects name, phone, best time, and an optional reason, then fires
a server-side POST to a new GHL inbound webhook URL.

Trigger surface (preserves all four existing quick picks and auto-greeting):
- 'Talk to a human' quick pick (intercepted locally — no LLM round-trip)
- Free-text intent regexes ('talk to a person', 'call me back', etc.)

Collection steps: first name → E.164-validated phone → time quick picks
(Morning/Afternoon/Late afternoon/Anytime/Specific time → free-text) →
optional reason with a Skip chip → confirm + close.

UX: conversational, one prompt at a time, 220-520ms typing indicator,
44px+ touch targets, fits 375px viewports. On submit-fail the bot tells
the patient to call (818) 706-6077 directly.

Architecture:
- api/callback.js — Vercel serverless proxy to the GHL inbound webhook.
  Server-only env GHL_CALLBACK_WEBHOOK_URL is never sent to the client.
- assets/ahdd-enhance.js — escalation state machine, intent matcher,
  phone helpers, inline quick-pick renderer, capture-phase listeners
  that swallow chatbot send events while escalation is active. Merged
  with main's latest SERVICES array (Dental Bonding, Root Canals,
  Wisdom Teeth Removal, All-on-4) and the nav dropdown enhancements.
- docs/GHL-CALLBACK-WORKFLOW-SETUP.md — manual setup for the GHL side
  (custom fields, workflow build, internal email to
  emailus@agourahillsdentaldesigns.com, optional patient ack SMS).
  Cross-origin iframe in GHL's workflow editor blocks browser automation.

Tests:
- test/test-callback.mjs — 15 cases against a mock GHL listener
  (happy path, phone normalization, validation errors, upstream 5xx,
  missing env, method allowlist)
- test/test-chatbot-helpers.mjs — 40 cases (16 positive intents,
  8 negatives, 7 phone normalizations, 8 rejections, formatter)

Env vars (new): GHL_CALLBACK_WEBHOOK_URL — server-only, set in Vercel
and local .env.local. See docs/GHL-CALLBACK-WORKFLOW-SETUP.md."

echo
echo "→ Running tests"
node test/test-callback.mjs
echo
node test/test-chatbot-helpers.mjs

echo
echo "→ Force-pushing to origin"
git push --force-with-lease origin feature/chatbot-callback-handoff

echo
echo "Done — PR should now show clean and mergeable."
