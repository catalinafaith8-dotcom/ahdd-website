/* api/callback.js
   AHDD chatbot "Talk to a human" handoff.
   Receives the callback request from the chatbot, validates the payload,
   and forwards it server-side to a GoHighLevel inbound webhook URL kept
   in env so it never ships in the client bundle.

   Env: GHL_CALLBACK_WEBHOOK_URL — the GHL workflow webhook trigger URL.

   Contract — request body:
     { firstName, phone, bestTimeToCall, reasonForCall,
       sourcePage, requestedAt, tags: [string] }

   Response:
     200 { ok: true }                 — accepted + forwarded
     400 { ok: false, error }         — bad payload
     502 { ok: false, error }         — GHL forward failed
     500 { ok: false, error }         — config missing / unexpected

   Note: per security rules we do NOT echo back any GHL response body or
   the webhook URL — only success/failure. */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    var body = req.body;
    // Vercel parses JSON bodies automatically when Content-Type is JSON,
    // but be defensive in case it arrives as a string.
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_e) { body = null; }
    }
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    var firstName = sanitize(body.firstName, 60);
    var phone = sanitizePhone(body.phone);
    var bestTimeToCall = sanitize(body.bestTimeToCall, 120);
    var reasonForCall = sanitize(body.reasonForCall, 600);
    var sourcePage = sanitize(body.sourcePage, 240);
    var requestedAt = sanitize(body.requestedAt, 40);
    var tags = Array.isArray(body.tags)
      ? body.tags.filter(function(t){ return typeof t === 'string'; }).slice(0, 8)
      : [];

    if (!firstName || !phone) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    if (!/^\+1\d{10}$/.test(phone)) {
      return res.status(400).json({ ok: false, error: 'Invalid phone' });
    }
    if (!bestTimeToCall) {
      return res.status(400).json({ ok: false, error: 'Missing bestTimeToCall' });
    }
    if (tags.indexOf('callback_requested') === -1) tags.push('callback_requested');

    var webhookUrl = process.env.GHL_CALLBACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('[callback] GHL_CALLBACK_WEBHOOK_URL not set');
      return res.status(500).json({ ok: false, error: 'Service not configured' });
    }

    var ghlPayload = {
      firstName: firstName,
      phone: phone,
      bestTimeToCall: bestTimeToCall,
      reasonForCall: reasonForCall || '',
      sourcePage: sourcePage || '',
      requestedAt: requestedAt || new Date().toISOString(),
      tags: tags
    };

    var fwd = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghlPayload)
    });

    if (!fwd.ok) {
      var status = fwd.status;
      var text = '';
      try { text = (await fwd.text()).slice(0, 400); } catch (_e) {}
      console.error('[callback] GHL forward failed', status, text);
      return res.status(502).json({ ok: false, error: 'Upstream error' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[callback] handler error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Unexpected error' });
  }
};

function sanitize(v, max) {
  if (v == null) return '';
  var s = String(v);
  // strip control chars
  s = s.replace(/[\x00-\x1F\x7F]/g, " ").trim();
  if (s.length > max) s = s.substring(0, max);
  return s;
}

function sanitizePhone(v) {
  if (v == null) return '';
  var s = String(v).trim();
  // accept already-E.164 or raw digits; coerce to E.164 +1XXXXXXXXXX
  var digits = s.replace(/\D+/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.substring(1);
  if (digits.length !== 10) return '';
  if (/^[01]/.test(digits)) return '';
  return '+1' + digits;
}
