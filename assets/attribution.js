/*
 * AHDD attribution capture — Google Ads ready
 * ----------------------------------------------------------------------------
 * What it does, in order, on every page load:
 *   1. Reads gclid + utm_* from the URL query string.
 *   2. Persists them in a first-party cookie (default 90 days) AND localStorage.
 *      First-touch wins by default — once a visitor lands with a gclid we keep
 *      that gclid for the rest of the window. Override with ?gclid_overwrite=1.
 *   3. Exposes window.AHDD_ATTRIBUTION = { gclid, utm_source, ... } for any
 *      other script (forms, chatbot, smile-analysis) to read synchronously.
 *   4. For each <form> on the page: injects hidden inputs named gclid +
 *      utm_source/_medium/_campaign/_term/_content and prefills them.
 *   5. For each <iframe> whose src is a GHL form
 *      (api.leadconnectorhq.com/widget/form/...): rewrites the src to append
 *      ?field[gclid]=... &field[utm_source]=... so GHL prefills its hidden
 *      custom fields. Requires those fields to exist in the GHL form.
 *   6. Listens for postMessage events from GHL form iframes. When GHL emits a
 *      "form-submitted" event (their form_embed.js dispatches this), we
 *      dataLayer.push({event:'lead_form_submit', form_id, value, currency}).
 *   7. Provides AHDD_TRACK.submit({form_id, value}) for non-GHL forms (the
 *      api/callback.js path, smile-analysis path) to call from their own
 *      success handler.
 *
 * Drift-proofing — GTM container ID + conversion value live in
 * tools/site-config.json; this script reads them off the window globals
 * (AHDD_TRACKING_*) that seo-apply.py injects into <head>.
 *
 * Cookie format: URI-encoded JSON. Read with AHDD_TRACK.getAttribution().
 *
 * Safe to load with `defer` — none of the work blocks DOMContentLoaded.
 */
(function () {
  'use strict';

  // ── Config (injected into window by seo-apply.py) ───────────────────────
  var COOKIE = (window.AHDD_TRACKING_COOKIE_NAME) || 'ahdd_attribution';
  var COOKIE_DAYS = parseInt(window.AHDD_TRACKING_COOKIE_DAYS, 10) || 90;
  var LEAD_VALUE = parseFloat(window.AHDD_TRACKING_LEAD_VALUE) || 50;
  var CURRENCY = window.AHDD_TRACKING_CURRENCY || 'USD';

  var ATTRIB_KEYS = [
    'gclid',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content'
  ];

  // ── Cookie helpers ──────────────────────────────────────────────────────
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie =
      name +
      '=' +
      encodeURIComponent(value) +
      ';expires=' +
      d.toUTCString() +
      ';path=/;SameSite=Lax';
  }
  function getCookie(name) {
    var m = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ── Query string parser ─────────────────────────────────────────────────
  function parseQuery() {
    var out = {};
    try {
      var sp = new URLSearchParams(window.location.search);
      ATTRIB_KEYS.forEach(function (k) {
        var v = sp.get(k);
        if (v) out[k] = v;
      });
      // gbraid / wbraid (iOS/Safari Google Ads cookieless click IDs)
      ['gbraid', 'wbraid'].forEach(function (k) {
        var v = sp.get(k);
        if (v) out[k] = v;
      });
    } catch (e) {
      // URLSearchParams not supported (old IE) — bail cleanly
    }
    return out;
  }

  // ── Attribution resolver ────────────────────────────────────────────────
  // Strategy: first-touch wins. New gclid only overwrites the stored one if
  // (a) there isn't one already, or (b) ?gclid_overwrite=1 is present.
  function resolveAttribution() {
    var fromUrl = parseQuery();
    var stored = {};
    try {
      var raw = getCookie(COOKIE);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {
      stored = {};
    }

    var allowOverwrite =
      new URLSearchParams(window.location.search).get('gclid_overwrite') === '1';

    var merged = {};
    ATTRIB_KEYS.concat(['gbraid', 'wbraid']).forEach(function (k) {
      // Take stored first (first-touch), then fall back to URL.
      // If allowOverwrite OR no stored value, take URL.
      if (stored[k] && !allowOverwrite) {
        merged[k] = stored[k];
      } else if (fromUrl[k]) {
        merged[k] = fromUrl[k];
      } else if (stored[k]) {
        merged[k] = stored[k];
      }
    });

    // Add first-touch timestamp + landing page once
    if (!stored._first_touch_at) {
      merged._first_touch_at = new Date().toISOString();
      merged._landing_page = window.location.pathname;
    } else {
      merged._first_touch_at = stored._first_touch_at;
      merged._landing_page = stored._landing_page || window.location.pathname;
    }

    // Only persist if we have at least one paid signal OR we already had one
    var hasAnyValue = ATTRIB_KEYS.concat(['gbraid', 'wbraid']).some(function (k) {
      return !!merged[k];
    });
    if (hasAnyValue) {
      try {
        setCookie(COOKIE, JSON.stringify(merged), COOKIE_DAYS);
        try { window.localStorage.setItem(COOKIE, JSON.stringify(merged)); } catch (e) {}
      } catch (e) {}
    }

    return merged;
  }

  var ATTR = resolveAttribution();
  window.AHDD_ATTRIBUTION = ATTR;

  // ── DOM helpers ─────────────────────────────────────────────────────────
  function ensureHidden(form, name, value) {
    if (!value) return;
    var existing = form.querySelector('input[name="' + name + '"]');
    if (existing) {
      if (!existing.value) existing.value = value;
      return;
    }
    var inp = document.createElement('input');
    inp.type = 'hidden';
    inp.name = name;
    inp.value = value;
    form.appendChild(inp);
  }

  function populateAllForms() {
    document.querySelectorAll('form').forEach(function (f) {
      ATTRIB_KEYS.concat(['gbraid', 'wbraid']).forEach(function (k) {
        if (ATTR[k]) ensureHidden(f, k, ATTR[k]);
      });
    });
  }

  // ── GHL iframe prefill ──────────────────────────────────────────────────
  // Rewrite src so GHL's hosted form renders with prefilled custom fields.
  // GHL convention: ?field[fieldKey]=value
  function patchGhlIframes() {
    document
      .querySelectorAll('iframe[src*="leadconnectorhq.com/widget/form/"]')
      .forEach(function (iframe) {
        var src = iframe.getAttribute('src') || '';
        var hasQuery = src.indexOf('?') !== -1;
        var sep = hasQuery ? '&' : '?';
        var parts = [];
        ATTRIB_KEYS.concat(['gbraid', 'wbraid']).forEach(function (k) {
          if (ATTR[k] && src.indexOf('field[' + k + ']=') === -1) {
            parts.push(
              'field[' + k + ']=' + encodeURIComponent(ATTR[k])
            );
          }
        });
        if (parts.length) {
          iframe.setAttribute('src', src + sep + parts.join('&'));
        }
      });
  }

  // ── GHL form_embed.js postMessage listener ─────────────────────────────
  // form_embed.js fires postMessage({event:'form-submit'|'form-submitted', formId, ...})
  // from the GHL iframe origin. We push lead_form_submit to dataLayer.
  function listenGhlSubmits() {
    window.addEventListener('message', function (e) {
      try {
        var data = e.data || {};
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (_) { return; }
        }
        var t = (data.event || data.type || '').toString().toLowerCase();
        // GHL fires both 'form-submit' and 'form-submitted' depending on version.
        if (t === 'form-submit' || t === 'form-submitted' || t === 'submitted') {
          var formId =
            data.formId ||
            data.form_id ||
            (data.payload && data.payload.formId) ||
            'ghl-unknown';
          pushLeadConversion(formId, 'ghl');
        }
      } catch (_) {}
    }, false);
  }

  // ── dataLayer push ──────────────────────────────────────────────────────
  function pushLeadConversion(formId, source) {
    window.dataLayer = window.dataLayer || [];
    var payload = {
      event: 'lead_form_submit',
      form_id: String(formId || 'unknown'),
      form_source: source || 'custom', // 'ghl' | 'custom' | 'smile-analysis' | 'callback'
      value: LEAD_VALUE,
      currency: CURRENCY,
      gclid: ATTR.gclid || '',
      utm_source: ATTR.utm_source || '',
      utm_medium: ATTR.utm_medium || '',
      utm_campaign: ATTR.utm_campaign || ''
    };
    window.dataLayer.push(payload);
    // Diagnostic log — invisible in prod console but visible in GTM Preview.
    try { console.debug('[AHDD] lead_form_submit', payload); } catch (_) {}
  }

  // ── Public API ──────────────────────────────────────────────────────────
  window.AHDD_TRACK = {
    getAttribution: function () { return ATTR; },
    // Call from custom form success handlers (api/callback.js client, smile-analysis, etc.)
    submit: function (opts) {
      opts = opts || {};
      pushLeadConversion(opts.form_id || 'custom', opts.form_source || 'custom');
    },
    // Build a payload to merge into your fetch() body so the server can forward to GHL
    payload: function () {
      var out = {};
      ATTRIB_KEYS.concat(['gbraid', 'wbraid']).forEach(function (k) {
        if (ATTR[k]) out[k] = ATTR[k];
      });
      if (ATTR._first_touch_at) out.first_touch_at = ATTR._first_touch_at;
      if (ATTR._landing_page) out.landing_page = ATTR._landing_page;
      return out;
    }
  };

  // ── Boot ────────────────────────────────────────────────────────────────
  function boot() {
    populateAllForms();
    patchGhlIframes();
    listenGhlSubmits();

    // Re-run prefill if forms get injected dynamically (e.g. modals, chatbot)
    var mo = new MutationObserver(function () {
      populateAllForms();
      patchGhlIframes();
    });
    mo.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
