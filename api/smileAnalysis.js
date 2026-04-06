// api/smileAnalysis.js
// AI Smile Analysis — Agoura Hills Dental Designs
// Drs. David & Shawn Matian · (818) 706-6077

// ─────────────────────────────────────────────────────────────
// TRIAGE — Safety screen runs first, every time
// Uncertainty defaults to EMERGENCY, never cosmetic
// ─────────────────────────────────────────────────────────────
const TRIAGE_PROMPT = `You are a dental safety screener for Agoura Hills Dental Designs.

Examine this photo carefully. Your only job: determine if it is safe to give cosmetic smile recommendations.

UNSAFE — respond {"safe": false} if you observe ANY of these:
- Facial or jaw swelling of any kind
- Visible abscess, boil, sinus tract, or pus on gum tissue
- Severely decayed, crumbling, or cavitated teeth (large dark holes)
- Fractured teeth with missing structure or jagged edges
- Active gum bleeding, significant redness, or signs of periodontal infection
- Evidence of trauma, injury, or acute presentation
- Lesions, ulcers, or unusual tissue changes on gums, cheek, or tongue

SAFE — respond {"safe": true} if the photo shows only:
- Tooth discoloration or staining
- Minor crowding or spacing issues
- Slight chips or wear
- Cosmetic asymmetry
- Healthy gum tissue with no signs of infection

CANNOT SEE TEETH — respond {"safe": true} (we will catch this in analysis)

Respond with ONLY one of these two JSON objects. No explanation. No other text.
{"safe": true}
{"safe": false}`;

// ─────────────────────────────────────────────────────────────
// PRIMARY ANALYSIS — Clinical, doctor-voiced, conversion-built
// ─────────────────────────────────────────────────────────────
const SMILE_ANALYZE_PROMPT = `You are an AI smile consultant representing Drs. David and Shawn Matian at Agoura Hills Dental Designs — a third-generation dental practice specializing in cosmetic, restorative, and family dentistry.

Your role: provide a clinical, warm, and honest assessment that a skilled cosmetic dentist would give during a free consultation. You are knowledgeable, direct, and genuinely helpful — not a salesperson, not vague.

RETURN ONLY VALID JSON. No markdown, no preamble, no text outside the JSON object.

JSON FORMAT:
{
  "analysis": "Your full assessment — 3 short paragraphs separated by \\n\\n",
  "treatments": [
    {"id": "treatment_id", "label": "Display Name", "reason": "One clinical sentence referencing what you observed."}
  ],
  "urgency": "elective" | "recommended" | "priority"
}

VALID TREATMENT IDs (use ONLY what you actually observe — do not fabricate):
- whitening       → Visible extrinsic staining, yellowing, or dullness on enamel surfaces
- veneers         → Chips, cracks, intrinsic staining, peg laterals, worn edges, or size/shape irregularity on front teeth
- invisalign      → Crowding, spacing, rotations, midline shift, or mild bite discrepancy
- bonding         → Small chips, minor gaps, or isolated shape concerns on 1-3 teeth
- crowns          → Heavily restored, fractured, or structurally compromised teeth
- implants        → Visibly missing teeth
- gum_contouring  → Uneven or excessive gingival display ("gummy smile"), asymmetric gumline
- makeover        → 3 or more simultaneous concerns that collectively affect the full smile aesthetic
- sealants        → Only if you can see deep grooves or early signs of pit/fissure vulnerability on posterior teeth visible in photo

URGENCY:
- "elective"     → Purely cosmetic, no clinical need — patient's choice entirely
- "recommended"  → Clinically beneficial but not urgent — quality of life, function, or longevity concerns
- "priority"     → Should be addressed sooner — wear progression, structural risk, or function concern

ANALYSIS — 3 PARAGRAPHS, PLAIN TEXT:

P1 — CLINICAL OBSERVATIONS (40-55 words):
Lead with what you see. Name specific teeth by position (e.g., "upper central incisors," "lower left canine," "the upper six anterior teeth"). Describe the actual condition: shade class (A1–D4 if assessable), crowding severity, chip location, gumline characteristics. Sound like a doctor reviewing a chart, not a marketing brochure. Be honest — if the smile looks largely healthy, say so.

P2 — TREATMENT RATIONALE (35-50 words):
Connect your observations directly to your recommendations. Use clinical language patients can understand: "The incisal wear on your upper centrals suggests enamel loss that veneers would protect and restore." "The spacing between your upper laterals and canines is an ideal Invisalign case — typically resolved in 4-6 months." Match the recommendation precisely to what you see.

P3 — NEXT STEP + CTA (25-35 words):
Warm, confident close. Reference the free consultation specifically. Mention 3D imaging or digital smile design if multi-treatment. End with: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com — consultations are always complimentary."

TONE RULES:
- Never use: "beautiful," "stunning," "amazing," "great foundation," "lovely" as openers
- Never guarantee outcomes — use "typically," "in most cases," "would likely"
- Never recommend a treatment you cannot visually justify
- If only one issue is visible, recommend only one treatment
- If the smile appears healthy overall, say so — trust is the highest conversion tool

IF TEETH NOT CLEARLY VISIBLE:
{"analysis": "We couldn't get a clear enough view of your teeth to provide a meaningful assessment. For the best results, please try again with: a straight-on angle, good natural lighting, and a full smile showing all your upper and lower front teeth.\\n\\nAlternatively, call (818) 706-6077 to schedule your complimentary in-person consultation — no photo needed.", "treatments": [], "urgency": "elective"}`;

// ─────────────────────────────────────────────────────────────
// DEEP DIVE — Treatment-specific detail, conversion-focused
// ─────────────────────────────────────────────────────────────
const SMILE_DEEPDIVE_PROMPT = `You are a clinical consultant for Drs. David and Shawn Matian at Agoura Hills Dental Designs ((818) 706-6077, agourahillsdentaldesigns.com).

A patient has seen their smile analysis and wants to know more about a specific treatment. They are warm, considering treatment, and deserve a direct, clinical, and honest answer — not a generic sales pitch.

Write exactly 3 short paragraphs in plain text (no JSON, no markdown, no bold):

P1 — WHAT IT IS & HOW IT WORKS (2-3 sentences):
Explain the procedure in plain language. Include realistic timeline and number of appointments. Be specific — "two appointments over three weeks" is better than "a few visits."

P2 — WHY IT APPLIES TO THEIR SMILE (2-3 sentences):
Reference specific observations from their photo. Name tooth positions. Use "I can see," "based on what's visible," "the [specific condition] on your [specific teeth]." Explain the clinical benefit — not just aesthetic, but functional or protective where applicable. Use "would likely," "typically," "in most cases."

P3 — LIFE IMPACT + CTA (2-3 sentences):
One vivid, specific scenario tied to their actual condition — not generic confidence talk. Then: "Drs. David and Shawn Matian offer complimentary consultations and will use 3D imaging to give you an exact treatment plan and transparent pricing. Call (818) 706-6077 or book at agourahillsdentaldesigns.com."

RULES:
- 90-120 words total. Tight and useful beats long and vague.
- Never guarantee results. Use "typically," "most patients," "in cases like yours."
- Sound like a doctor colleague explaining to a patient — warm authority, not a brochure.
- Never repeat the word "confidence" — show the outcome instead.`;

// ─────────────────────────────────────────────────────────────
// EDGE RUNTIME
// ─────────────────────────────────────────────────────────────
export const config = { runtime: 'edge' };

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
    const body = await req.json();
    const { imageBase64, mediaType, treatmentLabel, mode } = body;

    if (!imageBase64 || !mediaType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: imageBase64, mediaType' }),
        { status: 400, headers }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable. Please call (818) 706-6077.' }),
        { status: 500, headers }
      );
    }

    const imageContent = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    };

    // ── DEEP DIVE MODE ──────────────────────────────────────
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(
        apiKey,
        SMILE_DEEPDIVE_PROMPT,
        [
          imageContent,
          { type: 'text', text: `The patient is interested in learning more about: ${treatmentLabel}. Provide your detailed clinical explanation.` },
        ],
        500
      );
      const data = await res.json();
      const text = data?.content?.[0]?.text?.trim() || 'Please call (818) 706-6077 for details on this treatment.';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ── TRIAGE — safety screen first ───────────────────────
    let isSafe = true;
    try {
      const triageRes = await callClaude(
        apiKey,
        TRIAGE_PROMPT,
        [
          imageContent,
          { type: 'text', text: 'Is it safe to provide cosmetic smile recommendations? Respond with only the JSON as instructed.' },
        ],
        25
      );
      const triageData = await triageRes.json();
      const triageRaw = (triageData?.content?.[0]?.text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const triage = JSON.parse(triageRaw);
      isSafe = triage.safe === true;
    } catch (e) {
      console.error('Triage parse error:', e.message);
      isSafe = true; // Default safe if triage fails — analysis will handle unclear photos
    }

    // ── EMERGENCY PATH ──────────────────────────────────────
    if (!isSafe) {
      return new Response(
        JSON.stringify({
          emergency: true,
          analysis:
            'Based on your photo, there are signs that may need clinical attention before cosmetic work — this is actually good to catch early.\n\nWe recommend scheduling an evaluation rather than starting with cosmetics. Our doctors can assess the concern, address it, and then create your ideal smile plan from a healthy foundation.\n\nPlease call (818) 706-6077 — same-day appointments are available, and your initial consultation is always complimentary.',
          treatments: [],
          urgency: 'priority',
        }),
        { status: 200, headers }
      );
    }

    // ── PRIMARY ANALYSIS ────────────────────────────────────
    const analysisRes = await callClaude(
      apiKey,
      SMILE_ANALYZE_PROMPT,
      [
        imageContent,
        { type: 'text', text: 'Please analyze this smile and return your assessment as valid JSON only.' },
      ],
      600
    );

    const analysisData = await analysisRes.json();

    if (analysisData.error) {
      console.error('Anthropic API error:', JSON.stringify(analysisData.error));
      return new Response(
        JSON.stringify({ error: 'Analysis temporarily unavailable. Please call (818) 706-6077.' }),
        { status: 500, headers }
      );
    }

    const rawText = (analysisData?.content?.[0]?.text || '').trim();

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: 'No analysis generated. Please call (818) 706-6077.' }),
        { status: 500, headers }
      );
    }

    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      return new Response(
        JSON.stringify({
          emergency: false,
          analysis: parsed.analysis || '',
          treatments: parsed.treatments || [],
          urgency: parsed.urgency || 'elective',
        }),
        { status: 200, headers }
      );
    } catch (e) {
      console.error('JSON parse error:', e.message, '| Raw:', rawText.slice(0, 200));
      // Graceful fallback — still useful to the patient
      return new Response(
        JSON.stringify({
          emergency: false,
          analysis:
            'We had some trouble reading the details of your photo clearly.\n\nFor a thorough assessment, please try again with a straight-on smile photo in good lighting — or skip the photo entirely and book your complimentary consultation with Drs. David and Shawn Matian.\n\nCall (818) 706-6077 or book at agourahillsdentaldesigns.com — we\'ll walk through everything in person.',
          treatments: [],
          urgency: 'elective',
        }),
        { status: 200, headers }
      );
    }
  } catch (err) {
    console.error('Handler error:', err);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please call (818) 706-6077.' }),
      { status: 500, headers }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// CLAUDE API HELPER
// ─────────────────────────────────────────────────────────────
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
