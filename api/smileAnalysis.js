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

WHAT TO OBSERVE — cosmetic only. Be specific and confident:
- Alignment: crowding, overlapping, rotation, gaps, shifting
- Color: yellowing, staining, dullness — only if clearly visible
- Structure: chips, wear, uneven edges on front teeth
- Gums: health, evenness (positive callout if gums look good)
- Overall aesthetic potential

HONESTY: Only describe what you can clearly see in the photo.
- DO NOT invent staining if teeth look white
- DO NOT invent crowding if teeth look straight
- If the smile is mostly healthy → lead with that, then find the genuine opportunity

TONE MODEL — match this exact style:
GOOD headline: "You already have a strong, natural smile — this would elevate it into something perfectly aligned, brighter, and instantly noticeable in photos."
GOOD bullet: "Visible crowding and overlap in your lower front teeth creating shadowing"
GOOD bullet: "Yellowing and staining that's dulling the overall brightness of your smile"
GOOD bullet (positive): "Strong gum health and structure — an excellent foundation for a high-end cosmetic result"
GOOD ideal_result: "Imagine smiling in photos without thinking twice — no shadows, no crowding, just straight, bright teeth that look natural and effortless. Your smile looks cleaner, more balanced, and stands out immediately in conversations and pictures."
GOOD cta: "Book your free consultation and we'll show you a preview of exactly how your smile could look after treatment."

PLAN FORMAT — use exactly these label styles:
- First item label: "BEST OPTION — [Treatment Name]"  e.g. "BEST OPTION — Invisalign + Whitening"
- Second item label: "ALTERNATIVE — [Treatment Name]"  e.g. "ALTERNATIVE — Porcelain Veneers"
- detail: One confident sentence explaining what it does for THIS specific smile. Not generic.

VALID TREATMENT IDs — only what the photo clearly justifies:
"invisalign" → visible crowding or spacing
"whitening" → clear yellowing or staining
"veneers" → chips, wear, or shape issues on front teeth
"bonding" → small chip or gap on 1-3 teeth
"implants" → clearly missing tooth
"crowns" → visibly broken or heavily worn tooth
"makeover" → multiple cosmetic issues on healthy structure
"gum_contouring" → clearly uneven gumline

RETURN THIS EXACT JSON — no extra fields, no markdown, no backticks:
{
  "headline": "One sentence. Start with something genuinely positive about THIS smile. End with the transformation that's possible.",
  "bullets": [
    "Specific observation about what you see — confident, no minimizing words",
    "Second observation if present",
    "One positive callout — something that's already working well"
  ],
  "ideal_result": "2-3 sentences. Paint the specific emotional outcome. Real moments: photos, conversations, first impressions. Make them feel it.",
  "plan": [
    {"label": "BEST OPTION — Treatment Name", "treatment": "Treatment Name", "id": "treatment_id", "detail": "One sentence on what this does for their specific smile."},
    {"label": "ALTERNATIVE — Treatment Name", "treatment": "Treatment Name", "id": "treatment_id", "detail": "One sentence on why this is a valid alternative."}
  ],
  "cta": "1-2 sentences. Action-driven. Mention showing them a preview. No phone number — just the action.",
  "treatments": [
    {"id": "treatment_id", "label": "Display Name"}
  ],
  "urgency": "standard"
}

plan: 1-2 items only. Include only what the photo justifies.
treatments: same IDs as plan.
urgency: "standard" = cosmetic, "soon" = worth addressing, "priority" = needs attention.
bullets: 2-4 items — last one always positive.
Total word count across all fields: under 160 words.
NO website URLs. NO "confidence" as a word. NO "transform". NO "journey".

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
