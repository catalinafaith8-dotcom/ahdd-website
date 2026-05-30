# Smile analysis: blue glass upload card + mobile tuning

## What changed

**1. Upload card → iOS-style blue glass (glassmorphism)**
- Layered blue-tinted gradient (`rgba(59,130,246,.10) → rgba(0,113,227,.06) → rgba(255,255,255,.18)`)
- `backdrop-filter: blur(20px) saturate(180%)` (+ `-webkit-` prefix for Safari)
- 1px low-alpha white border, 22px radius, soft layered shadow (`0 8px 32px rgba(31,38,135,.15)`)
- Top-edge inner highlight via `::before` radial gradient — gives the card a refracted "glass" sheen
- Hover, drag, and has-file states all retuned to layer on top of the glass aesthetic
- Upload icon container upgraded: 52×52 rounded square, white-on-white gradient, lifted shadow, micro-scale on hover
- `@supports not (backdrop-filter)` fallback → solid `rgba(240,247,255,1)` for older browsers
- Mobile blur dial-down (`blur(14px)` ≤ 560px) to protect FPS on older iPhones

**2. Mobile alignment**
- Hero `h1`: `text-wrap: balance`, refined `clamp()` breakpoints at 560px / 380px so the headline wraps cleanly
- Hero `p`: `text-wrap: pretty`
- `.sai-grid` `min-height: 620px` removed on mobile (was forcing dead space below content)
- New micro-breakpoint at 480px and 380px: tighter gutters (`.sai-wrap 14–18px`), card padding tuned, trust-pill sizing
- Analyze button: `min-height: 46–48px` on small viewports (≥44px tap target)
- Card border-radius scaled (28 → 24 → 22px) by viewport

## Files touched (9)

| File | Change |
|------|--------|
| `smile-analysis.html` | Full mobile tuning + glass upload card |
| `smile-analysis-widget.html` | Glass upload card |
| `veneers.html` | Embedded widget glass upload card |
| `teeth-whitening.html` | Embedded widget glass upload card |
| `sedation-dentistry.html` | Embedded widget glass upload card |
| `restorative-dentistry.html` | Embedded widget glass upload card |
| `invisalign.html` | Embedded widget glass upload card |
| `emergency-dentistry.html` | Embedded widget glass upload card |
| `dental-implants.html` | Embedded widget glass upload card |

## Preservation

Originals are preserved as commented-out CSS blocks immediately above each replaced rule (search `ORIGINAL preserved` in any of the files). Rollback = uncomment + delete new.

## Verification

Screenshots taken via headless Chromium at:
- iPhone 13 mini (375×812 @ 3x)
- iPhone 11 (414×896 @ 2x)
- Desktop (1280×900)

Layout metrics confirmed post-change:
- No horizontal scroll at any tested viewport
- `.sai-grid` collapses to single column ≤ 1020px
- `.sai-card` width at 375px → 347px (24px outer gutter)
- Hero `h1` font-size scales 24px (≤380) → 26–32px (≤560) → 30–46px (clamp on desktop)

## After deploy

**Purge Cloudflare cache** on the affected URLs:
- `/smile-analysis`
- `/smile-analysis-widget`
- `/veneers`, `/teeth-whitening`, `/sedation-dentistry`, `/restorative-dentistry`, `/invisalign`, `/emergency-dentistry`, `/dental-implants`

Without a purge, returning visitors will see the old upload card until their browser cache expires.

## Assumptions

- The orchestrator brief referenced "What you'll get", "100% Free", "Try It Now", and "Step 1 of 3 — Tell Us About You" — these strings do not exist in the current `smile-analysis.html`. Treated as a stale description; actioned the real visible issues instead.
- `text-wrap: balance/pretty` has good support in Safari 17.4+, Chrome 114+, Firefox 121+. Older browsers degrade silently.
- Backdrop-filter has the `@supports` fallback; older Android Chrome and Firefox ESR will see the solid pale-blue card.
