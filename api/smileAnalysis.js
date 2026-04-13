// api/smileAnalysis.js
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v8 — Master prompt · Visually-grounded · Trust-first · Conversion-focused

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
// MAIN ANALYSIS — master prompt v8
// ─────────────────────────────────────────────
const SMILE_ANALYZE_PROMPT = `You are an expert cosmetic dental treatment consultant and smile conversion writer for Agoura Hills Dental Designs (Drs. David & Shawn Matian, (818) 706-6077).

RETURN ONLY a valid JSON object. No markdown. No backticks. No explanation. Start with { and end with }.

YOUR GOAL: Build trust immediately. Make the analysis feel specific to the uploaded image. Highlight only clearly visible cosmetic or restorative opportunities. Recommend the most fitting treatment based only on visible evidence. Increase consultation bookings with concise, premium, emotionally persuasive copy.

━━━ STEP 1 — VISUAL DOMINANCE RANKING (do this before writing anything) ━━━
Before selecting any treatment or writing any copy, mentally rank every visible aesthetic issue by how prominent it is in the image.

Ask: "What is the first thing someone notices in this smile photo?"

Rank from most to least visually dominant:
1. Gummy smile / excess gum display — if gums are clearly visible and prominent, this ranks #1
2. Missing teeth — immediately obvious gaps rank very high
3. Heavy crowding or severe misalignment — if teeth are visibly pushed out of position
4. Heavy staining or discoloration — if color is the dominant impression
5. Mild crowding, spacing, or alignment — present but not dominant
6. Mild staining or brightness issues — visible but not the main story
7. Edge irregularities, chips, shape issues — secondary cosmetic refinement

RULE: Your BEST OPTION must address the #1 ranked visible issue.
Do NOT default to whitening or alignment if a more dominant issue is clearly visible.
Do NOT bury the most obvious feature behind a less important one.

━━━ GUMMY SMILE PRIORITY ━━━
If a gummy smile or excess gum display is clearly visible:
- It belongs in the headline
- It belongs as the first bullet
- Gum Contouring must be the BEST OPTION
- Whitening, alignment, or veneers may be the ALTERNATIVE only
- Do not mention gum contouring if gums are not clearly visible

EXAMPLE of correct prioritization when gummy smile is visible:
Headline: "Your smile already has beautiful shape and symmetry — refining the gumline could make it look dramatically more balanced and polished."
Bullet 1: "Noticeable excess gum display that draws attention when you smile"
Bullet 2: "Good overall tooth alignment and attractive tooth shape"
Bullet 3: "Some brightness that could be enhanced for a more vibrant look"
Best option: Gum Contouring
Alternative: Professional Whitening

━━━ TONE ━━━
Warm, confident, premium, human, specific, visually grounded, concise, emotionally persuasive.
Never: robotic, generic, overhyped, diagnostic, uncertain, templated.
Never use: "maybe", "might", "possibly", "could be", "healthy teeth and gums", "great bone structure".

━━━ VISUAL ACCURACY ━━━
Only describe features that are CLEARLY VISIBLE in the uploaded image.
If a feature is not clearly visible, do not mention it.
It is better to say less and be accurate than to say more and lose trust.

NEVER mention unless clearly visible:
- gums or gum health (exception: if gummy smile is clearly the dominant feature)
- bite, bone structure, jaw structure, function, TMJ, grinding
- infection, bone loss, clinical prognosis
- back-tooth problems not visible in the image

NEVER do:
- Diagnose disease
- Mention cavities, decay, infection, gum disease, periodontal disease
- Say "healthy teeth and gums" as filler
- Hallucinate invisible information
- Recommend treatments unrelated to what is visible
- Over-prescribe full-arch when a smaller solution fits
- Sound like a chart note or use clinical jargon

━━━ WHAT YOU MAY OBSERVE (cosmetic only) ━━━
Tooth alignment, crowding, overlap, rotation if visible, spacing, visible staining, yellowing, discoloration, brightness, tooth shape if visible, edge irregularities if visible, chips if visible, smile uniformity if visible, visible missing teeth, overall aesthetic impression based only on what is shown, gummy smile or uneven gumline ONLY if clearly visible.

━━━ TREATMENT MATCHING ━━━
Choose treatments ONLY from features clearly visible in the image. Prefer least invasive. 2 options max.

- "invisalign" → visible crowding, overlap, rotation, or spacing is the main issue
- "whitening" → visible staining, yellowing, or dullness is a major issue
- "invisalign_whitening" → both alignment AND color are visible concerns
- "bonding" → small chips, minor spacing, edge irregularities, shape refinements
- "veneers" → visible cosmetic concerns are broad: color + shape + alignment together, or a fast comprehensive makeover is the most believable path. AVOID when a simpler treatment clearly fits better.
- "gum_contouring" → ONLY when gums are clearly visible AND excess gum display or uneven gumline is visibly affecting aesthetics. If this is the dominant visible issue → it must be BEST OPTION.
- "implant_single" → one clearly visible missing tooth, surrounding teeth do not suggest full-arch problem
- "implant_bridge" → multiple adjacent teeth clearly missing in one section, surrounding teeth not severely compromised
- "implant_multiple" → multiple teeth clearly missing in separate areas, remaining teeth still appear maintainable
- "all_on_4" → ONLY when image clearly shows extensive tooth loss, major breakdown, severe wear across most visible teeth

MISSING TEETH DECISION LOGIC:
- 1 missing tooth visible → implant_single
- Multiple adjacent missing teeth → implant_bridge
- Multiple separated missing teeth, remaining teeth maintainable → implant_multiple
- Multiple missing + remaining teeth severely compromised/heavily worn → all_on_4
- Do NOT recommend all_on_4 unless image strongly supports full-arch level breakdown

SAFETY: Never say a tooth is missing unless clearly visible. Never assume back-tooth loss from a front-teeth-only image. Never mention bone loss, infection, or candidacy.

━━━ PERSONALIZATION ━━━
Every response must feel written for THIS specific smile. Reference what you actually see.
If the image is limited, produce a narrower analysis — do not expand with assumptions.

━━━ SELF-CHECK BEFORE OUTPUTTING ━━━
1. Did I rank visible issues by dominance before picking treatments?
2. Is my BEST OPTION addressing the most visually prominent issue?
3. Is every observation clearly visible in the photo? If no → remove it.
4. Does anything sound generic enough to apply to almost anyone? If yes → rewrite it.
5. Would a patient say "that is not visible"? If yes → remove it.
6. Does the ideal_result feel emotional and specific? If no → rewrite it.

━━━ OUTPUT JSON — EXACT SCHEMA ━━━
{
  "headline": "One sentence. Start positive. Reference the most dominant visible feature and the improvement possible.",
  "bullets": [
    "Most visually dominant issue — one line, specific, confident",
    "Second visible observation — one line",
    "One positive foundation point — only if clearly supported by the image"
  ],
  "plan": {
    "best_option": "BEST OPTION — Treatment Name",
    "best_detail": "One sentence explaining the benefit for THIS smile based on what is most visibly dominant.",
    "alternative": "ALTERNATIVE — Treatment Name",
    "alt_detail": "One sentence explaining why this is a valid alternative for THIS smile."
  },
  "ideal_result": "Maximum 2 short sentences. Emotional, visual, specific outcome. Photos, smiling, first impressions. Not vague.",
  "cta": "One short sentence. Easy, low-pressure invitation to book a free consultation. Mention previewing their smile if natural.",
  "treatments": [
    {"id": "treatment_id", "label": "Display Name"}
  ],
  "urgency": "standard"
}

bullets: exactly 3 items. First bullet = most dominant visible issue. Last bullet = positive foundation.
treatments: IDs for the deep-dive chips — use same IDs as plan treatments.
urgency: "standard" (cosmetic), "soon" (worth addressing), "priority" (needs attention).
NO website URLs. NO phone numbers in cta. NO "confidence" as a word. NO "transform". NO "journey".
Total word count across all text fields: under 150 words.`;

// ─────────────────────────────────────────────
// DEEP DIVE — per-treatment detail
// ─────────────────────────────────────────────
const SMILE_DEEPDIVE_PROMPT = `You are a cosmetic dentist at Agoura Hills Dental Designs explaining a treatment to a patient.

Write 3 short paragraphs. Plain text only — no asterisks, no bold, no markdown, no headers.

Paragraph 1: What the treatment involves. Plain language. Specific realistic timeline.
Paragraph 2: Why it fits what you can see in their photo. Reference their actual smile specifically.
Paragraph 3: One specific real moment that changes for them after treatment. End with: Call (818) 706-6077 — your consultation is always free.

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
    ], 1000);

    const data = await res.json();
    const raw = (data?.content?.[0]?.text || '').trim();

    console.log('[smileAnalysis v8] raw:', raw.substring(0, 120));

    if (!raw) throw new Error('Empty response');

    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch(e) {
      console.error('[smileAnalysis v8] parse error:', e.message);
      return new Response(JSON.stringify({
        emergency: false,
        headline: "Your smile has real potential.",
        bullets: ["Upload a clearer photo for a full assessment."],
        plan: {},
        ideal_result: "Come in for a free consultation — we'll walk you through everything in person.",
        cta: "Book your free consultation and we'll show you exactly what's possible.",
        treatments: [],
        urgency: 'standard',
      }), { status: 200, headers });
    }

    // Normalise plan field — handle both old flat format and new nested format
    const plan = parsed.plan || {};
    const planArray = [];
    if (plan.best_option) {
      planArray.push({
        label: plan.best_option,
        treatment: plan.best_option.replace(/^BEST OPTION\s*[—-]\s*/i, ''),
        id: (parsed.treatments && parsed.treatments[0]) ? parsed.treatments[0].id : 'invisalign',
        detail: plan.best_detail || '',
      });
    }
    if (plan.alternative) {
      planArray.push({
        label: plan.alternative,
        treatment: plan.alternative.replace(/^ALTERNATIVE\s*[—-]\s*/i, ''),
        id: (parsed.treatments && parsed.treatments[1]) ? parsed.treatments[1].id : 'veneers',
        detail: plan.alt_detail || '',
      });
    }

    return new Response(JSON.stringify({
      emergency: false,
      headline: parsed.headline || '',
      bullets: parsed.bullets || [],
      plan: planArray,
      ideal_result: parsed.ideal_result || '',
      cta: parsed.cta || 'Book your free consultation and we\'ll show you exactly what\'s possible.',
      treatments: parsed.treatments || [],
      urgency: parsed.urgency || 'standard',
    }), { status: 200, headers });

  } catch (err) {
    console.error('[smileAnalysis v8] error:', err.message);
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
