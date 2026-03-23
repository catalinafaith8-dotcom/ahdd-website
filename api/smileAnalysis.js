// api/smileAnalysis.js
// AI Smile Analysis — Agoura Hills Dental Designs

// ── STEP 1: Emergency triage — runs FIRST on every image ──
const TRIAGE_PROMPT = `You are a dental emergency triage AI. Your ONLY job is to look at this photo and answer ONE question: does it show signs of a dental emergency?

EMERGENCY SIGNS — if you see ANY of these, answer YES:
- Abscess (swelling, pus, boil on gum, swollen jaw or cheek)
- Severe visible decay (large black/brown holes, crumbling tooth structure)
- Broken or fractured tooth with exposed pulp/nerve
- Visible infection or swelling anywhere in the mouth
- Knocked-out or severely displaced tooth
- Laceration or trauma to gum tissue

Respond with ONLY one of these two JSON objects. Nothing else. No explanation.

If emergency signs are present:
{"emergency": true}

If no emergency signs:
{"emergency": false}`;

// ── STEP 2: Standard analysis — only runs if no emergency ──
const SMILE_ANALYZE_PROMPT = `You are a dental smile analyst AI for Agoura Hills Dental Designs (Drs. David and Shawn Matian, (818) 706-6077).

Return ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

JSON FORMAT:
{"analysis": "2-3 sentences. First: one specific observation naming tooth position and condition. Last: what their smile could look like after treatment.", "treatments": [{"id": "treatment_id", "reason": "one short sentence"}]}

Valid treatment IDs: veneers, whitening, invisalign, bonding, implants, makeover, crowns, gum_contouring

RULES:
- MAX 60 WORDS in analysis. Hard limit.
- No flattery. No "great smile". Start with a clinical observation.
- 1-3 treatments only. Only recommend what you actually see.
- Plain text only inside strings.

IF TEETH NOT CLEARLY VISIBLE:
{"analysis": "We couldn't see your teeth clearly. Try a straight-on smile with good lighting — no sign-up needed.", "treatments": []}`;

// ── STEP 3: Deep dive on a specific treatment ──
const SMILE_DEEPDIVE_PROMPT = `You are a dental concierge AI for Agoura Hills Dental Designs ((818) 706-6077).

Patient wants to know more about a specific treatment. Be warm, specific, brief.

WRITE 3 SHORT PARAGRAPHS — plain text only, no JSON:
P1 — What the treatment is and how long it takes. 2 sentences max.
P2 — Why it fits THIS person's smile based on what you see in their photo. 2 sentences max.
P3 — One vivid moment that changes when this is fixed. End with: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com for your free consultation."

MAX 80 WORDS TOTAL. Use "could" and "may" — never guarantee outcomes.`;

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
      return new Response(JSON.stringify({ error: 'Missing required fields: imageBase64, mediaType' }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API configuration error. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const imageContent = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    };

    // ── DEEP DIVE MODE ──
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `I want to know more about: ${treatmentLabel}. What would this do for my smile?` },
      ]);
      if (!res.ok) return new Response(JSON.stringify({ error: 'AI temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
      const data = await res.json();
      const text = data?.content?.[0]?.text?.trim() || '';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ── TRIAGE FIRST ──
    const triageRes = await callClaude(apiKey, TRIAGE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Does this photo show signs of a dental emergency? Respond ONLY with the JSON as instructed.' },
    ], 50);

    if (triageRes.ok) {
      const triageData = await triageRes.json();
      const triageRaw = triageData?.content?.[0]?.text?.trim() || '';
      try {
        const triage = JSON.parse(triageRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
        if (triage.emergency === true) {
          return new Response(JSON.stringify({
            emergency: true,
            analysis: "Your photo shows signs that may need urgent attention. Please don't wait — call us today at (818) 706-6077. Same-day emergency appointments are available.",
            treatments: [],
          }), { status: 200, headers });
        }
      } catch (e) {
        // triage parse failed — fall through to standard analysis
        console.error('Triage parse error:', e.message, '| raw:', triageRaw);
      }
    }

    // ── STANDARD ANALYSIS ──
    const analysisRes = await callClaude(apiKey, SMILE_ANALYZE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Analyze this smile photo. Return ONLY valid JSON as instructed. No other text.' },
    ]);

    if (!analysisRes.ok) {
      const errText = await analysisRes.text();
      console.error('Analysis API error:', analysisRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI analysis temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const analysisData = await analysisRes.json();

    if (analysisData.error) {
      console.error('Anthropic error:', JSON.stringify(analysisData.error));
      return new Response(JSON.stringify({ error: 'AI analysis temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const rawText = analysisData?.content?.[0]?.text?.trim() || '';
    if (!rawText) {
      return new Response(JSON.stringify({ error: 'No analysis generated. Please try again or call (818) 706-6077.' }), { status: 500, headers });
    }

    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);
      return new Response(JSON.stringify({
        emergency: false,
        analysis: parsed.analysis || '',
        treatments: parsed.treatments || [],
      }), { status: 200, headers });
    } catch (parseErr) {
      console.error('Analysis JSON parse error:', parseErr.message, '| raw:', rawText.substring(0, 200));
      return new Response(JSON.stringify({
        emergency: false,
        analysis: 'We had trouble reading your photo. Try a straight-on smile with good lighting, or call us at (818) 706-6077.',
        treatments: [],
      }), { status: 200, headers });
    }

  } catch (error) {
    console.error('Smile analysis error:', error);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again or call (818) 706-6077.' }), { status: 500, headers });
  }
}

async function callClaude(apiKey, systemPrompt, contentArray, maxTokens = 600) {
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
