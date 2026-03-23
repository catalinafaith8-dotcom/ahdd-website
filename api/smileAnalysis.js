// api/smileAnalysis.js
// AI Smile Analysis — Agoura Hills Dental Designs

// ── TRIAGE PROMPT — inverted logic ──
// Uncertainty defaults to EMERGENCY, not cosmetic
const TRIAGE_PROMPT = `You are a dental safety screener. Look at this photo carefully.

You must decide: is it SAFE to give this person cosmetic smile recommendations?

It is NOT SAFE if you see ANY of the following:
- Any swelling anywhere in the face, jaw, or gums
- Any visible abscess, boil, bump, or pus on the gums
- Any large dark holes, severely decayed, or crumbling teeth
- Any broken tooth with jagged edges or missing large portions
- Any redness, inflammation, or signs of infection in the gum tissue
- Any sign of trauma, injury, or acute pain

If you see ANY of the above — even if you are not 100% sure — respond: {"safe": false}
If the photo shows ONLY healthy or mildly cosmetic issues (staining, minor crowding, slight gaps) — respond: {"safe": true}
If you cannot clearly see the teeth or mouth — respond: {"safe": true}

Respond with ONLY one of these two JSON objects. No explanation. No other text.`;

// ── STANDARD ANALYSIS ──
const SMILE_ANALYZE_PROMPT = `You are a dental smile analyst AI for Agoura Hills Dental Designs (Drs. David and Shawn Matian, (818) 706-6077).

Return ONLY valid JSON. No preamble, no markdown, no text outside the JSON.

FORMAT:
{"analysis": "2-3 sentences max. First sentence: specific observation naming tooth position and condition. Last sentence: what their smile could look like.", "treatments": [{"id": "treatment_id", "reason": "one short sentence"}]}

Valid treatment IDs: veneers, whitening, invisalign, bonding, implants, makeover, crowns, gum_contouring

RULES:
- MAX 60 WORDS in analysis. Hard limit.
- No flattery. Start clinical.
- 1-3 treatments only. Only what you actually see.
- Plain text only inside strings.

IF TEETH NOT VISIBLE:
{"analysis": "We couldn't see your teeth clearly. Try a straight-on smile with good lighting.", "treatments": []}`;

// ── DEEP DIVE ──
const SMILE_DEEPDIVE_PROMPT = `You are a dental concierge AI for Agoura Hills Dental Designs ((818) 706-6077).

Patient wants details on a specific treatment. Warm, specific, brief.

3 SHORT PARAGRAPHS — plain text, no JSON:
P1 — What it is and timeline. 2 sentences.
P2 — Why it fits their smile based on what you see. 2 sentences.
P3 — One vivid life moment that changes. End: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com for your free consultation."

MAX 80 WORDS. Use "could" and "may" — never guarantee.`;

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const body = await req.json();
    const { imageBase64, mediaType, treatmentLabel, mode } = body;

    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: 'Missing required fields.' }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Configuration error. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const imageContent = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    };

    // ── DEEP DIVE ──
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `Tell me more about: ${treatmentLabel}` },
      ], 400);
      const data = await res.json();
      const text = data?.content?.[0]?.text?.trim() || 'Please call (818) 706-6077 for details.';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ── TRIAGE — runs first, uncertainty = emergency ──
    let isSafe = true; // default to safe only if triage completely fails
    try {
      const triageRes = await callClaude(apiKey, TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Is it safe to give cosmetic smile recommendations? Reply with only the JSON as instructed.' },
      ], 20);
      const triageData = await triageRes.json();
      const triageRaw = (triageData?.content?.[0]?.text || '').trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const triage = JSON.parse(triageRaw);
      isSafe = triage.safe === true;
    } catch (e) {
      console.error('Triage error:', e.message);
      // triage failed to parse — default safe to continue to analysis
      isSafe = true;
    }

    // ── EMERGENCY PATH ──
    if (!isSafe) {
      return new Response(JSON.stringify({
        emergency: true,
        analysis: "Your photo shows signs that may need urgent attention. Please don't wait — call us today at (818) 706-6077. Same-day emergency appointments are available.",
        treatments: [],
      }), { status: 200, headers });
    }

    // ── STANDARD ANALYSIS ──
    const analysisRes = await callClaude(apiKey, SMILE_ANALYZE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Analyze this smile. Return ONLY valid JSON. No other text.' },
    ], 300);

    const analysisData = await analysisRes.json();
    if (analysisData.error) {
      console.error('Anthropic error:', JSON.stringify(analysisData.error));
      return new Response(JSON.stringify({ error: 'AI temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const rawText = (analysisData?.content?.[0]?.text || '').trim();
    if (!rawText) {
      return new Response(JSON.stringify({ error: 'No analysis generated. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);
      return new Response(JSON.stringify({
        emergency: false,
        analysis: parsed.analysis || '',
        treatments: parsed.treatments || [],
      }), { status: 200, headers });
    } catch (e) {
      console.error('Parse error:', e.message);
      return new Response(JSON.stringify({
        emergency: false,
        analysis: 'We had trouble reading your photo. Try a straight-on smile with good lighting, or call (818) 706-6077.',
        treatments: [],
      }), { status: 200, headers });
    }

  } catch (err) {
    console.error('Handler error:', err);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please call (818) 706-6077.' }), { status: 500, headers });
  }
}

async function callClaude(apiKey, systemPrompt, contentArray, maxTokens = 300) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: contentArray }],
    }),
  });
}
