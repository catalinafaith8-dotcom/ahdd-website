# Talk-to-a-human → callback handoff to GHL

Adds a warm, mobile-first escalation flow inside the existing chatbot.
When a patient asks to speak to a real person — either via the existing
"Talk to a human" quick pick or by typing intent in chat — the bot
collects name, phone, best time, and an optional reason, then fires a
server-side POST to a new GHL inbound webhook that kicks off a callback
workflow.

## What it does

**Trigger surface** (preserves all four existing quick picks and the
auto-greeting):

- The existing "Talk to a human" quick pick now starts a local
  state-machine instead of round-tripping to GPT.
- Free-text intent matching ("speak to someone", "callback please",
  "have someone call me", "human please", etc.) routes the same way.

**Collection flow** — one question at a time, conversational, with a
typing indicator paced 220–520 ms between bot messages:

1. Acknowledge — *"Of course — happy to connect you with a team member."*
2. First name (≥2 chars, trimmed, capitalized)
3. Phone — accepts `(818) 555-1234`, `818-555-1234`, `8185551234`,
   `+18185551234`, with E.164 normalization and rejection of obvious
   junk (all-same-digit, leading-0/1, wrong length)
4. Best time — inline quick-pick chips for Morning / Afternoon / Late
   afternoon / Anytime today / Specific time (free-text)
5. Reason for call — optional, with a **Skip this** chip
6. Confirm — *"Got it — someone from our team will call you at (818)
   555-1234 during afternoon. If anything comes up before then, you can
   reach us at (818) 706-6077. Talk soon."*

If the POST fails the bot doesn't fake success — it tells the patient
to call (818) 706-6077 directly.

**Mobile-first:** 44 px+ touch targets, chips wrap at 375 px, the
existing CSS handles keyboard-aware input docking.

## Files

| File | What it does |
| --- | --- |
| `api/callback.js` | **New.** Vercel serverless proxy. Validates the payload, normalizes the phone, and forwards to `GHL_CALLBACK_WEBHOOK_URL` (server-only). Returns 200/400/502/500. |
| `assets/ahdd-enhance.js` | **Modified (+395 lines).** Adds the state machine, intent matcher, phone helpers, inline quick-pick renderer, and capture-phase listeners that swallow chatbot send events while escalation is active. The existing nav, chatbot, and tech-page enhancements are untouched. |
| `.env.example` | **New.** Documents `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and the new `GHL_CALLBACK_WEBHOOK_URL`. |
| `docs/GHL-CALLBACK-WORKFLOW-SETUP.md` | **New.** Click-by-click GHL setup — custom fields, workflow build, inbound webhook trigger, internal email to `emailus@agourahillsdentaldesigns.com`, optional patient ack SMS. The cross-origin iframe in GHL's workflow editor blocks browser automation, so this part is a manual handoff. |
| `test/test-callback.mjs` | **New.** Boots a mock GHL listener and runs 15 cases through the proxy. |
| `test/test-chatbot-helpers.mjs` | **New.** 40 cases for the intent regex bank, phone normalize/reject/format. |

## Verification

```
$ node test/test-callback.mjs
[mock] listening on http://127.0.0.1:9931
  ✓ happy path returns 200 ok:true
  ✓ mock received exactly 1 forwarded POST
  ✓ firstName forwarded
  ✓ phone forwarded as E.164
  ✓ bestTimeToCall forwarded
  ✓ callback_requested tag preserved
  ✓ phone normalized from formatted 10-digit
  ✓ phone normalized from 11-digit with leading 1
  ✓ callback_requested tag auto-added when absent
  ✓ rejects missing firstName (400, no forward)
  ✓ rejects invalid phone (400, no forward)
  ✓ rejects missing bestTimeToCall (400, no forward)
  ✓ upstream 500 → handler returns 502
  ✓ missing env → 500, no outbound
  ✓ rejects GET with 405

All tests passed.

$ node test/test-chatbot-helpers.mjs
  (16 positive intent matches)
  (8 negatives — must NOT match)
  (7 phone normalizations)
  (8 phone rejections)
  ✓ prettyPhone formats E.164

All tests passed.
```

## Env-var requirements before merge

Set `GHL_CALLBACK_WEBHOOK_URL` in Vercel (Production, Preview, Development)
and locally in `~/Documents/ahdd-website/.env.local`. The value comes
from the GHL workflow's Inbound Webhook trigger — see
`docs/GHL-CALLBACK-WORKFLOW-SETUP.md` for the build steps.

Without that env var the `/api/callback` endpoint returns 500 and the
chatbot shows the call-us-directly fallback to the patient. No client
breakage; the rest of the chatbot is unaffected.

## Open questions

- Staff SMS destination number (Phase 2 — emailed alert only for now).
- Whether the GHL account has SMS sending configured for the optional
  patient ack — flagged in the setup doc; check Settings → Phone Numbers.
