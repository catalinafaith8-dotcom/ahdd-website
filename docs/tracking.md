# Google Ads Tracking — Architecture & Setup

**Single source of truth:** `tools/site-config.json` → block `tracking`.

Edit it, run `npm run seo:apply`, every page picks up the change. Same drift-proof pattern as canonical/og:url.

---

## What runs on every page

Every HTML page in `pages` of `site-config.json` gets three managed blocks injected at the top of `<head>`:

1. `AHDD:TRACK:GTM-HEAD` — Google Tag Manager container loader.
2. `AHDD:TRACK:ATTR-CFG` — `window.AHDD_TRACKING_*` globals (cookie name, lead value, currency, conversion ID + label).
3. `AHDD:TRACK:ATTR-SCRIPT` — `<script src="/assets/attribution.js" defer>`.

And one block right after `<body>`:

4. `AHDD:TRACK:GTM-BODY` — GTM `<noscript>` iframe fallback.

The blocks are bounded by HTML comments — `tools/seo_lib.py` replaces them in place, so re-runs are idempotent. Any earlier hand-inserted GTM snippet on a page is detected by a stray-regex and removed so we own the only copy.

---

## What `/assets/attribution.js` does

On every page load, in order:

1. Reads `gclid`, `gbraid`, `wbraid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` from the URL query string.
2. **First-touch persistence** — saves them to a first-party cookie `ahdd_attribution` (90 days) AND `localStorage`. A new `gclid` only overwrites the stored one if `?gclid_overwrite=1` is in the URL. Rationale: a visitor's first paid click should keep credit even if they come back via direct/organic later.
3. Exposes `window.AHDD_ATTRIBUTION = { gclid, utm_source, ... }` so other scripts can read attribution synchronously.
4. For every `<form>` on the page: injects hidden inputs (`gclid`, `utm_source`, …) prefilled with the captured values.
5. For every GHL form iframe (`<iframe src="*leadconnectorhq.com/widget/form/*">`): rewrites the `src` to append `?field[gclid]=…&field[utm_source]=…` so GHL's hosted form prefills its hidden custom-field components.
6. Listens for `postMessage` events from GHL form iframes (`form-submit` / `form-submitted`) → fires `dataLayer.push({event: 'lead_form_submit', form_id, value: 50, currency: 'USD', gclid, utm_source, …})`.
7. Exposes `window.AHDD_TRACK.submit({form_id, form_source})` for non-GHL forms (chatbot callback, smile-analysis) to fire the same `lead_form_submit` event from their own success handlers.
8. Exposes `window.AHDD_TRACK.payload()` returning a flat object of attribution fields the client code merges into its outbound fetch body so `api/callback.js` and the GHL webhook receive attribution.

---

## Forms & flows

| Form / Source | Type | How attribution rides | Where dataLayer fires |
|---|---|---|---|
| **Implants promo callback** (`dental-implants-promo.html`) | GHL iframe (`1XVpca4TACbzFyt8s9Cb`) | `attribution.js` rewrites iframe src with `?field[gclid]=…` | `postMessage` listener in `attribution.js` |
| **Chatbot callback** (every page) | Custom JS → POST `/api/callback` → GHL inbound webhook | `assets/ahdd-enhance.js` calls `AHDD_TRACK.payload()` and merges into fetch body | `submitCallback()` calls `AHDD_TRACK.submit()` on success |
| **Smile analysis gate** (every service page) | Custom JS → POST direct to GHL webhook | `smile-analysis-widget.html` merges `AHDD_TRACK.payload()` into payload | `.finally()` calls `AHDD_TRACK.submit()` |
| **Booking iframe** (`schedule.jarvisanalytics.com`) | Third-party scheduler iframe | Not captured client-side. Must come from offline-conversion import (see §5) | N/A (offline conversion only) |

---

## GHL setup — fields + workflow mapping

### 1. Create custom fields on the **Contact** object

Settings → Custom Fields → Add Field (one per row below). All are **Single-Line Text**, group "Marketing Attribution":

| Field name | Field key (lowercase, snake_case) |
|---|---|
| GCLID | `gclid` |
| GBRAID | `gbraid` |
| WBRAID | `wbraid` |
| UTM Source | `utm_source` |
| UTM Medium | `utm_medium` |
| UTM Campaign | `utm_campaign` |
| UTM Term | `utm_term` |
| UTM Content | `utm_content` |
| First Touch At | `first_touch_at` |
| Landing Page | `landing_page` |

**Important:** the field key must match the JSON key exactly. GHL builds the field key from the name automatically — check that it lower-cases and underscores correctly. If GHL generates `g_c_l_i_d` instead of `gclid`, edit the field and override.

### 2. Add the same fields to the "Implants Promo Callback" form (id `1XVpca4TACbzFyt8s9Cb`)

Open the form in GHL form builder → drag each custom field above onto the form → set type to **Hidden Field** → save. This is what allows `?field[gclid]=…` URL prefill to actually populate.

### 3. Update every "Create / Update Contact" workflow action

For each of these workflows, open the Create/Update Contact action and map the payload keys onto the matching contact custom fields:

- **Callback Request Handoff** (chatbot callback) — already deployed
- **Smile Analysis** — already deployed
- **Implants Promo Callback** — NEW (build alongside the form above)

Mapping (left = inbound payload key, right = contact custom field):

```
{{inboundWebhookData.gclid}}            →  Contact > GCLID
{{inboundWebhookData.gbraid}}           →  Contact > GBRAID
{{inboundWebhookData.wbraid}}           →  Contact > WBRAID
{{inboundWebhookData.utm_source}}       →  Contact > UTM Source
{{inboundWebhookData.utm_medium}}       →  Contact > UTM Medium
{{inboundWebhookData.utm_campaign}}     →  Contact > UTM Campaign
{{inboundWebhookData.utm_term}}         →  Contact > UTM Term
{{inboundWebhookData.utm_content}}      →  Contact > UTM Content
{{inboundWebhookData.first_touch_at}}   →  Contact > First Touch At
{{inboundWebhookData.landing_page}}     →  Contact > Landing Page
```

Save the workflow.

### 4. Add "paid_traffic" tag automation

In each Create Contact action, add a conditional tag:

> If `{{inboundWebhookData.gclid}}` is not empty → add tag `paid_traffic`.

`api/callback.js` already does this on the server side for the chatbot path. The other workflows need to do it in the GHL UI.

---

## Google Ads — conversion actions

Create THREE conversion actions in Google Ads UI (Tools → Conversions → New conversion action):

### 1. Form submit (website conversion)
- Source: Website
- Category: **Submit lead form**
- Value: Use the same value for each — **$50**
- Count: **One**
- Click-through conversion window: **30 days**
- Attribution: **Data-driven** (or last click if not enough data yet)
- After creating: copy the **Conversion ID** (`AW-…`) and **Conversion label** strings. Paste them into `tools/site-config.json` under `googleAdsConversionId` and `googleAdsConversionLabel`, then re-run `npm run seo:apply`.
- In GTM: New Tag → **Google Ads Conversion Tracking** → fill in ID + label → trigger: **Custom Event** = `lead_form_submit`. Save. Submit & publish the container.

### 2. Phone call (calls from ads)
- Source: **Calls from ads**
- Setup: enable Google forwarding number (free). Settings → Account settings → Call reporting → On.
- Replace `(818) 706-6077` on ad copy with the Google forwarding number Google generates. Counts as a conversion when call lasts ≥ 60 seconds.

### 3. Booked appointment (import — offline conversion)
- Source: **Import → Conversions from clicks**
- Category: Other
- Value: **Different** (recommend $300 — reflects estimated lifetime value of a booked implant consult)
- Count: One
- Click-through window: 90 days
- Fed from GHL via daily CSV upload (or Zapier → Google Ads API) when an appointment is actually booked. See §5 below.

---

## Offline-conversion sync — booked appointments

Goal: tell Google Ads when a paid click *actually* led to a booked appointment, so Smart Bidding can optimize against revenue, not form fills.

### Phase 1 — manual CSV (week 1–4)

1. In GHL, create a workflow:
   - **Trigger:** "Appointment Booked" or tag added "consultation_booked".
   - **Action:** HTTP Request → POST to a Zapier webhook (or Make.com, or a Google Sheets row-append via a Google Apps Script).
   - **Payload:** `{ "gclid": "{{contact.gclid}}", "conversion_time": "{{appointment.startTime}}", "conversion_name": "Booked appointment", "conversion_value": "300", "currency": "USD" }`.
2. Once a week, export the sheet to CSV in the Google Ads template format and upload via Tools → Conversions → Uploads.

### Phase 2 — direct API (after ad spend > $3K/mo)

Switch to Google Ads API offline-conversion endpoint. Requires OAuth + a service account. Defer until volume justifies the engineering cost.

---

## Test plan

Before the ad campaign launches:

1. **Live URL with test GCLID:**
   `https://agourahillsdentaldesigns.com/implants?gclid=TEST_GCLID_2026&utm_source=google&utm_medium=cpc&utm_campaign=qa-test`
2. Open Chrome DevTools → Application → Cookies → confirm `ahdd_attribution` cookie set with JSON containing `gclid:"TEST_GCLID_2026"`.
3. Open DevTools → Application → Frames → the GHL form iframe → confirm `src` includes `&field[gclid]=TEST_GCLID_2026`.
4. Submit the form (use throwaway `qa-ads-track-<timestamp>@example.com`).
5. In GHL → Contacts → find the new contact → verify GCLID custom field = `TEST_GCLID_2026` and UTM fields populated.
6. In GTM Preview Mode → confirm a `lead_form_submit` event fired.
7. In Google Ads → Conversions → the "Form submit" action's Diagnostics tab → within 24h should show "Recording conversions".
8. (Phase 2) Add the "consultation_booked" tag to the test contact in GHL → verify the offline-conversion webhook fires → verify the CSV gets the row.

---

## Launch timeline

| Day | Task | Owner |
|---|---|---|
| 0 | Merge `feature/google-ads-tracking-foundation` to main, deploy via Vercel | dev |
| 0 | Purge Cloudflare cache (`agourahillsdentaldesigns.com/*`) | dev |
| 1 | Create GHL custom fields + add to Implants Promo Callback form | Catalina (GHL UI) |
| 1 | Update 3 workflows' Create Contact actions | Catalina (GHL UI) |
| 1 | Create 3 Google Ads conversion actions | Catalina (Google Ads UI) |
| 1 | Enable Google forwarding number on the Google Ads account | Catalina (Google Ads UI) |
| 1 | Wire Form-submit conversion tag in GTM, publish container | Catalina (GTM UI) |
| 2 | Run full test plan above with TEST_GCLID_2026 | both |
| 3–4 | Soak: confirm no real submissions break, attribution flows end-to-end | both |
| 5 | Launch Manual CPC campaign — Single ad group, single ad, 5–10 keywords, $50/day budget cap | Catalina |
| 5+15 conv. | Switch bid strategy to Maximize Conversions, then Target CPA when you have a baseline | Catalina |

**Total: 5–7 business days from PR merge to ad launch.** Per the audit.
