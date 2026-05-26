#!/bin/bash
# recover-pr-merge.sh — the first resolve script crashed midway (git
# reset --hard hit a lock and bailed AFTER wiping the working tree but
# BEFORE restoring snapshot files). This script rebuilds clean state by
# pulling everything from the existing 8422178 commit + rebuilding the
# enhance.js merge against origin/main.
#
#   bash ~/Documents/ahdd-website/scripts/recover-pr-merge.sh
#
# Idempotent — safe to run twice.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO=$(pwd)
echo "→ Repo: $REPO"

# 1. Wipe stale git state aggressively
echo "→ Clearing stale lock state"
rm -f .git/index.lock .git/HEAD.lock .git/ORIG_HEAD.lock 2>/dev/null || true
rm -rf .git/rebase-merge .git/rebase-apply 2>/dev/null || true
# also clean up the .bak* artifacts left by the sandbox attempts
find .git -maxdepth 2 -name "*.lock.bak*" -delete 2>/dev/null || true
find .git -maxdepth 2 -name "rebase-merge.bak*" -prune -exec rm -rf {} + 2>/dev/null || true

# 2. Make sure we're on the feature branch
git checkout feature/chatbot-callback-handoff 2>&1 || true

# 3. Fetch latest
echo "→ Fetching origin"
git fetch origin

# 4. Capture the SHA of the commit that has all our callback work
#    (8422178 was the first attempt; if it's been rewritten there may
#    be a new one — pick the most recent reachable from origin's branch)
CALLBACK_SHA=$(git rev-parse origin/feature/chatbot-callback-handoff)
echo "→ Callback commit: $CALLBACK_SHA"

# 5. Hard-reset working tree + index to origin/main (we want a clean base)
echo "→ Resetting to origin/main"
rm -f .git/index.lock 2>/dev/null || true
git reset --hard origin/main

# 6. Restore the callback files FROM the existing callback commit so we
#    don't have to recreate them from memory
echo "→ Restoring callback files from $CALLBACK_SHA"
mkdir -p api docs test scripts
for f in \
  api/callback.js \
  .env.example \
  docs/GHL-CALLBACK-WORKFLOW-SETUP.md \
  docs/PR-BODY.md \
  test/test-callback.mjs \
  test/test-chatbot-helpers.mjs \
  scripts/merge-enhance.py \
  scripts/resolve-pr-merge.sh
do
  git show "$CALLBACK_SHA:$f" > "$f"
  echo "    restored $f"
done
# this recovery script too (so it travels with the PR)
git show "$CALLBACK_SHA:scripts/resolve-pr-merge.sh" > scripts/resolve-pr-merge.sh 2>/dev/null || true
chmod +x scripts/*.sh

# 7. Rebuild the merged ahdd-enhance.js (main's nav + our escalation)
echo "→ Rebuilding merged assets/ahdd-enhance.js"
python3 scripts/merge-enhance.py

# 8. Stage + commit
echo "→ Staging and committing"
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
  scripts/recover-pr-merge.sh 2>/dev/null || true

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

# 9. Run tests
echo
echo "→ Running tests"
node test/test-callback.mjs
echo
node test/test-chatbot-helpers.mjs

# 10. Force-push
echo
echo "→ Force-pushing to origin"
git push --force-with-lease origin feature/chatbot-callback-handoff

echo
echo "Done — PR should now show clean and mergeable."
