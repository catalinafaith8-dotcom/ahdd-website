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

CRITICAL: Return ONLY valid JSON. No markdown. No backticks. No explanation before or after. Start your response with { and end with }.

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

VALID TREATMENT IDs — only include what you can clearly see:
- "whitening" → visible staining or yellowing
- "invisalign" → crowding, overlapping, gaps, or shifted teeth
- "veneers" → chips, worn edges, or permanent staining on front teeth
- "bonding" → small chip or gap on 1-3 teeth
- "crowns" → visibly broken down individual tooth
- "implants" → clearly missing tooth with visible gap
- "makeover" → multiple cosmetic issues on healthy teeth
- "gum_contouring" → uneven gumline

OUTPUT — return this exact JSON structure:

{
  "sections": {
    "first_impression": "2-3 warm sentences starting positive",
    "observations": "2-4 sentences describing only what you can see",
    "possibilities": "2-3 sentences on what this could mean, framed as possibilities",
    "treatment_options": "2-4 sentences on 1-3 conservative options that fit what you see",
    "biggest_impact": "2-3 sentences on the biggest improvement + one vivid specific moment",
    "important_note": "Only include if urgent signs visible — otherwise leave empty string",
    "next_step": "1-2 warm sentences. End with: Call (818) 706-6077 — first consultation is free."
  },
  "treatments": [
    {"id": "treatment_id", "label": "Display Name", "reason": "One sentence on what you see that justifies this"}
  ],
  "urgency": "standard"
}

urgency values: "standard" (healthy/cosmetic), "soon" (worth addressing), "priority" (needs attention)

Keep tone warm, honest, and reassuring. No URLs. No website addresses.`;

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

    console.log('[smileAnalysis] raw response start:', raw?.substring(0, 100));

    if (!raw) throw new Error('No response');

    let parsed;
    try {
      // Strip markdown fences Claude sometimes adds
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If parse fails, wrap the raw text as a single observation section
      // so the patient still sees something useful
      return new Response(JSON.stringify({
        emergency: false,
        sections: {
          first_impression: "Here's what I can see from your photo.",
          observations: raw.replace(/[{}"[\]]/g, '').substring(0, 400),
          next_step: "Give us a call at (818) 706-6077 — your first consultation is always free."
        },
        treatments: [],
        urgency: 'standard',
      }), { status: 200, headers });
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
