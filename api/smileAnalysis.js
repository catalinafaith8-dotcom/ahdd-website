// api/smileAnalysis.js
// Agoura Hills Dental Designs
// Clean v5 — Humanized AI · Non-repetitive · Safe · Conversion-focused

export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────
// TRIAGE — conservative urgency detection
// ─────────────────────────────────────────────
const TRIAGE_PROMPT = `You are a dental image safety screener.

Determine if the image shows CLEAR signs of a potentially urgent issue.

Respond ONLY with JSON:

{"safe": true}
or
{"safe": false}

Mark unsafe ONLY if clearly visible:
- large broken tooth with missing structure
- obvious swelling
- visible infection-like area (bump, severe discoloration near root)
- active bleeding
- trauma

If unsure → return {"safe": true}
If image unclear → return {"safe": true}

Do not over-flag urgency.`;

// ─────────────────────────────────────────────
// PRIMARY ANALYSIS — natural, non-repetitive
// ─────────────────────────────────────────────
const SMILE_ANALYZE_PROMPT = `You are an experienced, highly ethical cosmetic dentist at Agoura Hills Dental Designs.

Analyze the patient's smile and generate a personalized, natural, and patient-friendly response.

CORE RULES:
- This is NOT a diagnosis
- Only describe what is visible
- Do not assume hidden conditions
- Use uncertainty language when needed
- Avoid aggressive or unnecessary treatments
- Prioritize conservative options first

LANGUAGE:
- No dental jargon
- No technical terms
- Speak like a real dentist talking to a patient
- Keep it simple and clear

ORIGINALITY:
- Every response must feel unique
- Do not reuse phrasing or structure
- Vary wording naturally
- Reference specific visible details

URGENCY:
- If clear damage (broken tooth, swelling) → recommend prompt evaluation
- If unclear → recommend timely evaluation
- If none → no urgency

OUTPUT JSON:

{
  "sections": {
    "first_impression": "",
    "observations": "",
    "possibilities": "",
    "treatment_options": "",
    "biggest_impact": "",
    "important_note": "",
    "next_step": ""
  },
  "treatments": [],
  "urgency": "standard" | "soon" | "priority"
}

Keep tone warm, honest, and reassuring.`;

// ─────────────────────────────────────────────
// EMERGENCY RESPONSE — human, calm, direct
// ─────────────────────────────────────────────
const EMERGENCY_PROMPT = `You are a caring dentist reviewing a photo that may show something needing prompt attention.

Write a short, natural response:

- Explain what you see in simple terms
- Explain why it should be checked soon
- Stay calm and reassuring
- No clinical jargon
- No diagnosis

End with:
Call (818) 706-6077 to schedule an evaluation.

No URLs.`;

// ─────────────────────────────────────────────
// DEEP DIVE — simple treatment explanation
// ─────────────────────────────────────────────
const SMILE_DEEPDIVE_PROMPT = `You are a dentist explaining a treatment to a patient.

Write 3 short paragraphs:
1. What the treatment involves
2. Why it fits their smile
3. A real-life moment + invitation to visit

Rules:
- No jargon
- No hype
- Keep it natural

End with:
Call (818) 706-6077 to schedule a consultation.`;

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────
export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const { imageBase64, mediaType, mode, treatmentLabel } = await req.json();

    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: 'Missing image data' }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Service unavailable. Call (818) 706-6077.' }), { status: 500, headers });
    }

    const imageContent = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    };

    // ── DEEP DIVE ─────────────────────────────
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `Explain this treatment: ${treatmentLabel}` },
      ], 500);

      const data = await res.json();
      const text = data?.content?.[0]?.text?.trim() || 'Call (818) 706-6077 for details.';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ── TRIAGE ─────────────────────────────
    let isSafe = true;
    try {
      const triageRes = await callClaude(apiKey, TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Assess urgency.' },
      ], 50);

      const triageData = await triageRes.json();
      const raw = (triageData?.content?.[0]?.text || '').trim();
      isSafe = JSON.parse(raw).safe === true;
    } catch {
      isSafe = true;
    }

    // ── EMERGENCY PATH ─────────────────────
    if (!isSafe) {
      const res = await callClaude(apiKey, EMERGENCY_PROMPT, [
        imageContent,
        { type: 'text', text: 'Write urgent message.' },
      ], 400);

      const data = await res.json();
      const text = data?.content?.[0]?.text?.trim();

      return new Response(JSON.stringify({
        emergency: true,
        urgency: 'priority',
        analysis: text,
        treatments: [],
      }), { status: 200, headers });
    }

    // ── MAIN ANALYSIS ─────────────────────
    const res = await callClaude(apiKey, SMILE_ANALYZE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Analyze this smile.' },
    ], 900);

    const data = await res.json();
    const raw = data?.content?.[0]?.text?.trim();

    if (!raw) throw new Error('No response');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Parse error');
    }

    return new Response(JSON.stringify({
      emergency: false,
      sections: parsed.sections || {},
      treatments: parsed.treatments || [],
      urgency: parsed.urgency || 'standard',
    }), { status: 200, headers });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({
      error: 'Something went wrong. Call (818) 706-6077.',
    }), { status: 500, headers });
  }
}

// ─────────────────────────────────────────────
// CLAUDE HELPER
// ─────────────────────────────────────────────
async function callClaude(apiKey, systemPrompt, contentArray, maxTokens = 800) {
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
