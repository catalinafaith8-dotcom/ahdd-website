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
const SMILE_ANALYZE_PROMPT = `You are an experienced cosmetic dentist at Agoura Hills Dental Designs (Drs. David & Shawn Matian, (818) 706-6077).

CRITICAL: Return ONLY valid JSON. No markdown. No backticks. Start with { and end with }.

━━━ BANNED WORDS AND PHRASES — using any of these FAILS the response ━━━
- "lovely" / "beautiful" / "gorgeous" / "stunning" / "amazing" as openers
- "great potential" / "wonderful foundation" / "natural beauty"
- "gives your smile character" / "adds character" — never dismiss a real concern this way
- "confidence" — never use this word ever
- Any website URL

━━━ HONESTY — only describe what is CLEARLY visible ━━━
- Crowding visible? → mention it directly and honestly, not as a charming quirk
- Staining clearly visible? → mention it. If NOT clearly visible → do NOT mention whitening
- Healthy smile with minor crowding? → say it's healthy, name the crowding, suggest Invisalign
- Do NOT invent findings. Do NOT pad with suggestions that aren't justified.

━━━ OPENER RULE ━━━
first_impression must start with ONE genuine, specific observation — not praise.
GOOD: "Your teeth look healthy and well-structured — the main thing I notice is some crowding on the bottom row."
GOOD: "Overall your smile is in good shape. There's some overlapping toward the front that's worth looking at."
BAD: "You have a lovely natural smile..." / "Your teeth are beautifully shaped..." — NEVER.

━━━ VALID TREATMENT IDs ━━━
Only include what is clearly visible:
- "invisalign" → crowding, overlapping, shifted teeth
- "whitening" → obvious yellowing or staining — NOT mild natural variation
- "veneers" → visible chips or worn edges on front teeth
- "bonding" → small chip or gap on 1-3 teeth
- "crowns" → visibly broken or heavily worn tooth
- "implants" → clearly missing tooth
- "makeover" → 3+ issues on healthy structure
- "gum_contouring" → clearly uneven gumline

━━━ OUTPUT JSON ━━━
{
  "sections": {
    "first_impression": "1-2 sentences. Honest specific opener. What's good AND what you notice.",
    "observations": "2-3 sentences. What you see clearly. Soft language: it looks like, I can see.",
    "treatment_options": "2-3 sentences. Only treatments justified by what you see. Excited tone.",
    "biggest_impact": "2-3 short punchy sentences. One vivid moment. Present tense. Second person. No 'confidence'.",
    "next_step": "1 sentence. Warm. End: Call (818) 706-6077 — first consultation is free."
  },
  "treatments": [
    {"id": "treatment_id", "label": "Display Name", "reason": "What you see that justifies this."}
  ],
  "urgency": "standard"
}

urgency: "standard" = healthy/cosmetic, "soon" = worth addressing, "priority" = needs attention
Tone: direct, warm, exciting — like a friend who happens to be a great dentist.`;

const SMILE_DEEPDIVE_PROMPT = `You are a dentist explaining a treatment to a patient at Agoura Hills Dental Designs.

Write 3 short paragraphs. Plain text only — no asterisks, no bold, no markdown, no headers, no bullet points.

Paragraph 1: What the treatment involves. Plain language. Specific timeline.
Paragraph 2: Why it fits what you see in their photo. Reference their actual smile specifically.
Paragraph 3: One real moment that changes for them after treatment. End with: Call (818) 706-6077 to book your free consultation.

Rules:
- No jargon, no hype, no asterisks, no bold formatting of any kind
- Keep it under 120 words total
- Make it feel personal and real`;

// ─────────────────────────────────────────────
// EMERGENCY RESPONSE — human, calm, direct
// ─────────────────────────────────────────────
const EMERGENCY_PROMPT = `You are a caring dentist reviewing a photo that may show something needing prompt attention.

Write 3 short paragraphs. Plain text only — no asterisks, no bold, no markdown.

Paragraph 1: What you can see, in plain everyday language. No clinical terms.
Paragraph 2: Why it's worth getting checked soon. Calm, not alarming.
Paragraph 3: The good news — catching this early makes it simpler. End with: Call (818) 706-6077 — same-day appointments available, consultation is free.

Keep it under 100 words. Warm and human.`;

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
