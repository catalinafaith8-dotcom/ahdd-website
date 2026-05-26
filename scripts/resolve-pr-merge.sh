#!/bin/bash
# resolve-pr-merge.sh — rebases feature/chatbot-callback-handoff onto the
# latest origin/main so the PR can merge cleanly.
#
# Why this exists: main moved 46 commits while the feature branch was being
# built, and assets/ahdd-enhance.js was touched on both sides (main updated
# the SERVICES nav array; this branch added the chatbot escalation flow).
# Plus assets/ahdd-enhance.js was modified by a linter, slightly. Rather than
# wrestling with git rebase --continue conflict editing, we:
#
#   1. Snapshot all files this PR contributes
#   2. Hard-reset the branch to origin/main
#   3. Re-apply the merged ahdd-enhance.js (built by scripts/merge-enhance.py
#      — main's nav updates + this branch's escalation flow)
#   4. Drop the snapshot's new files in place
#   5. One clean commit, force-push.
#
# The local-only commit 6d4e483 "Fix live site bugs" is intentionally NOT
# carried over — if those bug fixes are still needed against current main,
# open a separate PR. They were tangential to the callback work.
#
# Run from anywhere:
#   bash ~/Documents/ahdd-website/scripts/resolve-pr-merge.sh

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REPO=$(pwd)
echo "→ Repo: $REPO"
echo

# Sanity check: must be on the feature branch
CUR_BRANCH=$(git branch --show-current)
if [ "$CUR_BRANCH" != "feature/chatbot-callback-handoff" ]; then
  echo "Not on feature/chatbot-callback-handoff — currently on '$CUR_BRANCH'."
  echo "Run: git checkout feature/chatbot-callback-handoff"
  exit 1
fi

# 1. Clean any stale git lock state from prior sandbox attempts
echo "→ Cleaning stale git locks"
rm -f .git/index.lock .git/HEAD.lock .git/ORIG_HEAD.lock 2>/dev/null || true
rm -rf .git/rebase-merge .git/rebase-apply 2>/dev/null || true

# 2. Snapshot the working tree's callback files BEFORE the reset
SNAPSHOT=$(mktemp -d)
echo "→ Snapshotting callback files to $SNAPSHOT"
mkdir -p \
  "$SNAPSHOT/assets" "$SNAPSHOT/api" "$SNAPSHOT/docs" \
  "$SNAPSHOT/test" "$SNAPSHOT/scripts"
cp assets/ahdd-enhance.js "$SNAPSHOT/assets/"
cp api/callback.js "$SNAPSHOT/api/"
cp .env.example "$SNAPSHOT/"
cp docs/GHL-CALLBACK-WORKFLOW-SETUP.md "$SNAPSHOT/docs/"
cp docs/PR-BODY.md "$SNAPSHOT/docs/"
cp test/test-callback.mjs "$SNAPSHOT/test/"
cp test/test-chatbot-helpers.mjs "$SNAPSHOT/test/"
cp scripts/merge-enhance.py "$SNAPSHOT/scripts/"
cp scripts/resolve-pr-merge.sh "$SNAPSHOT/scripts/"

# 3. Fetch latest origin/main
echo "→ Fetching origin"
git fetch origin

# 4. Hard-reset the feature branch to origin/main
echo "→ Resetting feature branch to origin/main"
git reset --hard origin/main

# 5. Re-build the merged assets/ahdd-enhance.js from origin/main + our
#    escalation block. This produces the same content we had locally but
#    based on the latest main, so there's no conflict to resolve.
echo "→ Rebuilding merged assets/ahdd-enhance.js"
cp "$SNAPSHOT/scripts/merge-enhance.py" scripts/  # ensure we have the script
mkdir -p scripts
python3 scripts/merge-enhance.py

# 6. Drop the new files back in place
echo "→ Restoring callback files"
mkdir -p api docs test scripts
cp "$SNAPSHOT/api/callback.js" api/
cp "$SNAPSHOT/.env.example" .env.example
cp "$SNAPSHOT/docs/GHL-CALLBACK-WORKFLOW-SETUP.md" docs/
cp "$SNAPSHOT/docs/PR-BODY.md" docs/
cp "$SNAPSHOT/test/test-callback.mjs" test/
cp "$SNAPSHOT/test/test-chatbot-helpers.mjs" test/
cp "$SNAPSHOT/scripts/merge-enhance.py" scripts/
cp "$SNAPSHOT/scripts/resolve-pr-merge.sh" scripts/

# 7. Stage + commit
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
  scripts/resolve-pr-merge.sh

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

# 8. Run tests once for confidence
echo "→ Running tests"
node test/test-callback.mjs
echo
node test/test-chatbot-helpers.mjs

# 9. Force-push to update the PR
echo
echo "→ Force-pushing to origin"
git push --force-with-lease origin feature/chatbot-callback-handoff

echo
echo "Done. PR should now show a clean fast-forwardable merge."
echo "Snapshot kept at $SNAPSHOT (you can delete it: rm -rf $SNAPSHOT)"
