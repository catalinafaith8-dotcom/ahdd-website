// api/smileAnalysis.js
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v7 — Master prompt · Mobile-first · Conversion-focused

export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────
// TRIAGE — safety screen only
// ─────────────────────────────────────────────
const TRIAGE_PROMPT = `You are a dental image safety screener.

Respond ONLY with JSON. Mark unsafe ONLY if clearly visible:
- Large broken tooth with missing structure
- Obvious facial swelling
- Active bleeding or trauma
- Visible infection-like bump near tooth root

If unsure → {"safe": true}
If teeth not visible → {"safe": true}

{"safe": true} or {"safe": false}`;

// ─────────────────────────────────────────────
// MAIN ANALYSIS — master prompt
// ─────────────────────────────────────────────
const SMILE_ANALYZE_PROMPT = `You are an expert cosmetic dentist AND high-converting aesthetic consultant at Agoura Hills Dental Designs (Drs. David & Shawn Matian, (818) 706-6077).

Your goal: build trust, create desire for improvement, make treatment feel obvious and easy, drive the user to book.

CRITICAL: Return ONLY valid JSON. No markdown. No backticks. Start with { end with }.

TONE RULES:
- Speak like a friendly, confident expert — warm and direct
- Positive-first, then gently highlight opportunities
- NO minimizing words: "minor," "slight," "a bit," "somewhat"
- NO uncertainty words: "could," "might," "may," "possibly," "perhaps"
- NO clinical jargon: no "incisors," "canines," "occlusal," "gingival," "anterior"
- NO mentioning AI, analysis tools, or uncertainty
- Make it feel written specifically for this person

WHAT TO OBSERVE — cosmetic only:
- Alignment and crowding of visible teeth
- Spacing and gaps
- Color and brightness
- Shape symmetry and worn edges
- Overall smile aesthetics

ONLY include what you can clearly see. Do NOT invent findings.
- Visible crowding → mention it confidently
- Visible staining → mention it
- Teeth look good → say so, still find one aspirational opportunity

VALID TREATMENT IDs — only what the photo justifies:
"invisalign" → crowding or spacing visible
"whitening" → clear staining or dullness
"veneers" → chips, wear, or shape issues on front teeth
"bonding" → small gap or chip on 1-3 teeth
"implants" → missing tooth with visible gap
"crowns" → visibly broken or worn-down tooth
"makeover" → multiple cosmetic issues on healthy structure
"gum_contouring" → clearly uneven gumline

RETURN THIS EXACT JSON:
{
  "headline": "One confident, aspirational sentence. Start positive. End with the transformation.",
  "bullets": [
    "One-line observation — specific, confident, no minimizing",
    "One-line observation",
    "One-line positive — something already working"
  ],
  "ideal_result": "2-3 short sentences. Paint the emotional outcome. Specific moments: photos, laughing, first impressions. No generic statements.",
  "plan": [
    {"label": "Best option", "treatment": "Treatment Name", "id": "treatment_id", "detail": "One sentence — what it does for THIS smile."},
    {"label": "Optional refinement", "treatment": "Treatment Name", "id": "treatment_id", "detail": "One sentence."}
  ],
  "cta": "1-2 lines. Action-driven. Benefit-focused. End: Call (818) 706-6077 — your consultation is free.",
  "treatments": [
    {"id": "treatment_id", "label": "Display Name"}
  ],
  "urgency": "standard"
}

plan array: include 1-2 items only. Only include what the photo justifies.
treatments array: same IDs as plan, used for deep-dive chips.
urgency: "standard" = cosmetic only, "soon" = worth addressing, "priority" = needs attention.

TOTAL LENGTH: Keep all text fields under 150 words combined. Short. Scannable. Mobile-first.
NO website URLs anywhere. Patient is already on our site.`;

// ─────────────────────────────────────────────
// DEEP DIVE — per-treatment detail
// ─────────────────────────────────────────────
const SMILE_DEEPDIVE_PROMPT = `You are a cosmetic dentist at Agoura Hills Dental Designs explaining a treatment.

Write 3 short paragraphs. Plain text only — absolutely no asterisks, bold, markdown, or headers.

Paragraph 1: What the treatment involves. Plain language. Specific realistic timeline.
Paragraph 2: Why it fits what you see in their photo. Reference their actual smile specifically.
Paragraph 3: One specific real moment that changes for them. End with: Call (818) 706-6077 — your consultation is always free.

Rules: Under 120 words total. No jargon. No hype. No markdown formatting of any kind.`;

// ─────────────────────────────────────────────
// EMERGENCY — urgent but calm
// ─────────────────────────────────────────────
const EMERGENCY_PROMPT = `You are a caring dentist. This photo shows something needing prompt attention.

Write 3 short paragraphs. Plain text only — no asterisks, no bold, no markdown.

Paragraph 1: What you see, in plain everyday language.
Paragraph 2: Why it is worth getting checked soon. Calm, not alarming.
Paragraph 3: The good news — catching this early makes it simpler. End: Call (818) 706-6077 — same-day appointments available, consultation is free.

Under 100 words. Warm and human.`;

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
      return new Response(JSON.stringify({ error: 'Missing image data. Please try again.' }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Service unavailable. Call (818) 706-6077.' }), { status: 500, headers });
    }

    const imageContent = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    };

    // ── DEEP DIVE ──────────────────────────
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `Explain this treatment for this patient: ${treatmentLabel}` },
      ], 500);
      const data = await res.json();
      const text = (data?.content?.[0]?.text || '').trim() || 'Call (818) 706-6077 for details.';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ── TRIAGE ─────────────────────────────
    let isSafe = true;
    try {
      const triageRes = await callClaude(apiKey, TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Assess this image.' },
      ], 30);
      const triageData = await triageRes.json();
      const raw = (triageData?.content?.[0]?.text || '').trim().replace(/```(?:json)?/g, '').trim();
      isSafe = JSON.parse(raw).safe === true;
    } catch {
      isSafe = true;
    }

    // ── EMERGENCY ──────────────────────────
    if (!isSafe) {
      const res = await callClaude(apiKey, EMERGENCY_PROMPT, [
        imageContent,
        { type: 'text', text: 'Write the urgent message.' },
      ], 400);
      const data = await res.json();
      const text = (data?.content?.[0]?.text || '').trim();
      return new Response(JSON.stringify({
        emergency: true,
        urgency: 'priority',
        analysis: text,
        treatments: [],
      }), { status: 200, headers });
    }

    // ── MAIN ANALYSIS ──────────────────────
    const res = await callClaude(apiKey, SMILE_ANALYZE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Analyze this smile and return the JSON.' },
    ], 900);

    const data = await res.json();
    const raw = (data?.content?.[0]?.text || '').trim();

    console.log('[smileAnalysis v7] raw:', raw.substring(0, 120));

    if (!raw) throw new Error('Empty response');

    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch(e) {
      console.error('[smileAnalysis v7] parse error:', e.message);
      return new Response(JSON.stringify({
        emergency: false,
        headline: "Your smile has real potential.",
        bullets: ["We weren't able to read all the details from this photo."],
        ideal_result: "For a full assessment, come in for a free consultation — we'll walk you through everything in person.",
        plan: [],
        cta: "Call (818) 706-6077 — your consultation is always free.",
        treatments: [],
        urgency: 'standard',
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({
      emergency: false,
      headline: parsed.headline || '',
      bullets: parsed.bullets || [],
      ideal_result: parsed.ideal_result || '',
      plan: parsed.plan || [],
      cta: parsed.cta || 'Call (818) 706-6077 — your consultation is always free.',
      treatments: parsed.treatments || [],
      urgency: parsed.urgency || 'standard',
    }), { status: 200, headers });

  } catch (err) {
    console.error('[smileAnalysis v7] error:', err.message);
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
