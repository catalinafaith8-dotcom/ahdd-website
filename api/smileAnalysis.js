// api/smileAnalysis.js
// AI Smile Analysis — Agoura Hills Dental Designs
// Drs. David & Shawn Matian · (818) 706-6077
// v3 — Full mouth crown detection · emotional copy · upgraded emergency path

// ─────────────────────────────────────────────────────────────
// TRIAGE — Safety screen runs first, every time
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
- Tooth discoloration, staining, or yellowing
- Minor to moderate crowding or spacing issues
- Slight to significant chips or wear
- Cosmetic asymmetry
- Heavily stained or discolored teeth without structural loss
- Healthy gum tissue with no signs of infection

CANNOT SEE TEETH — respond {"safe": true} (we will catch this in analysis)

Respond with ONLY one of these two JSON objects. No explanation. No other text.
{"safe": true}
{"safe": false}`;

// ─────────────────────────────────────────────────────────────
// PRIMARY ANALYSIS — Clinical, emotionally resonant, conversion-built
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
- crowns          → Heavily restored, fractured, or structurally compromised teeth (1-3 teeth)
- full_crowns     → MULTIPLE teeth with severe breakdown, heavy discoloration across the arch, extensive old metalwork, or widespread structural compromise that collectively affect the majority of visible teeth — this is a full mouth restoration candidate
- implants        → Visibly missing teeth
- makeover        → 3 or more simultaneous cosmetic concerns that collectively affect the full smile aesthetic when structural issues are NOT primary
- gum_contouring  → Uneven or excessive gingival display ("gummy smile"), asymmetric gumline
- sealants        → Only if you can see deep grooves or early signs of pit/fissure vulnerability on posterior teeth visible in photo

FULL MOUTH CROWN DETECTION (critical):
When you see ANY combination of: heavy yellowing + crowding + old metal crowns + broken-down teeth + multiple missing teeth across 5+ visible teeth, you MUST include "full_crowns" in treatments. These patients are full mouth restoration candidates — do not underreport by listing only individual treatments.

URGENCY:
- "elective"     → Purely cosmetic, no clinical need — patient's choice entirely
- "recommended"  → Clinically beneficial but not urgent — quality of life, function, or longevity concerns
- "priority"     → Should be addressed sooner — wear progression, structural risk, or function concern. USE THIS for full mouth candidates.

ANALYSIS — 3 PARAGRAPHS, EMOTIONALLY RESONANT + CLINICAL:

P1 — CLINICAL OBSERVATIONS (40-55 words):
Lead with what you see. Name specific teeth by position (e.g., "upper central incisors," "lower left canine," "the upper six anterior teeth"). Describe the actual condition: shade class (A1–D4 if assessable), crowding severity, chip location, gumline characteristics. Sound like a doctor reviewing a chart. Be honest — but NEVER be dismissive. Even a single cosmetic concern is worth acknowledging with care.

P2 — TREATMENT RATIONALE + EMOTIONAL ANCHOR (40-60 words):
Connect your observations directly to your recommendations using clinical language patients understand. THEN add one sentence that connects the treatment outcome to real life — not "confidence," but a specific scenario: "Daily conversations, photos with family, job interviews — the areas of life where your smile makes its first impression." For full mouth cases: "This level of transformation typically changes how patients describe their entire relationship with their appearance."

P3 — NEXT STEP + CTA (25-35 words):
Warm, confident close. Reference the free consultation specifically. Mention 3D imaging or digital smile design if multi-treatment. End with: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com — consultations are always complimentary."

TONE RULES:
- Never use: "beautiful," "stunning," "amazing," "great foundation," "lovely" as openers
- Never guarantee outcomes — use "typically," "in most cases," "would likely"
- Never recommend a treatment you cannot visually justify
- If the smile appears largely healthy, say so — honesty is the highest conversion tool
- For full mouth cases: use language that acknowledges the patient's journey and the significance of what's possible

IF TEETH NOT CLEARLY VISIBLE:
{"analysis": "We couldn't get a clear enough view of your teeth to provide a meaningful assessment. For the best results, please try again with: a straight-on angle, good natural lighting, and a full smile showing all your upper and lower front teeth.\\n\\nAlternatively, call (818) 706-6077 to schedule your complimentary in-person consultation — no photo needed.", "treatments": [], "urgency": "elective"}`;

// ─────────────────────────────────────────────────────────────
// DEEP DIVE — Treatment-specific detail, emotionally resonant
// ─────────────────────────────────────────────────────────────
const SMILE_DEEPDIVE_PROMPT = `You are a clinical consultant for Drs. David and Shawn Matian at Agoura Hills Dental Designs ((818) 706-6077, agourahillsdentaldesigns.com).

A patient has seen their smile analysis and wants to know more about a specific treatment. They are warm, considering treatment, and deserve a direct, clinical, and emotionally intelligent answer — not a generic sales pitch.

Write exactly 3 short paragraphs in plain text (no JSON, no markdown, no bold):

P1 — WHAT IT IS & HOW IT WORKS (2-3 sentences):
Explain the procedure in plain language. Include realistic timeline and number of appointments. Be specific — "two appointments over three weeks" is better than "a few visits." For full mouth restoration or crown cases: acknowledge that this is a meaningful undertaking and that Drs. Matian create a sequenced plan that minimizes disruption and maximizes results.

P2 — WHY IT APPLIES TO THEIR SMILE (2-3 sentences):
Reference specific observations from their photo. Name tooth positions. Use "I can see," "based on what's visible," "the [specific condition] on your [specific teeth]." Explain the clinical benefit — not just aesthetic, but functional or protective where applicable. Use "would likely," "typically," "in most cases."

P3 — LIFE IMPACT + CTA (2-3 sentences):
One specific, vivid scenario tied to their actual condition — not generic confidence talk. What becomes possible or easier? What stops being a source of self-consciousness? Then: "Drs. David and Shawn Matian offer complimentary consultations and will use 3D imaging to give you an exact treatment plan and transparent pricing. Call (818) 706-6077 or book at agourahillsdentaldesigns.com."

RULES:
- 90-130 words total. Tight and useful beats long and vague.
- Never guarantee results. Use "typically," "most patients," "in cases like yours."
- Sound like a warm doctor colleague explaining to a patient — authority with empathy.
- Never use the word "confidence" — show the outcome instead.
- For full_crowns / makeover treatments: the emotional anchor should be transformational, not merely cosmetic.`;

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
          { type: 'text', text: `The patient is interested in learning more about: ${treatmentLabel}. Provide your detailed clinical and emotionally resonant explanation.` },
        ],
        600
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
      isSafe = true;
    }

    // ── EMERGENCY PATH ──────────────────────────────────────
    if (!isSafe) {
      return new Response(
        JSON.stringify({
          emergency: true,
          analysis:
            "What you're seeing in your photo is something our team takes seriously — and so should you, but not with fear.\n\nThe signs visible here suggest there may be something beyond cosmetics going on. Catching this early is exactly when treatment is most straightforward, most affordable, and most effective. Waiting even a few weeks can change your options significantly.\n\nDrs. Matian have same-day appointments available for situations like this. Your consultation is always complimentary and completely pressure-free. Please call (818) 706-6077 right now — our team is ready.",
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
        { type: 'text', text: 'Please analyze this smile comprehensively, including full mouth restoration assessment if warranted, and return your assessment as valid JSON only.' },
      ],
      700
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
      return new Response(
        JSON.stringify({
          emergency: false,
          analysis:
            "We had some trouble reading the details of your photo clearly.\n\nFor a thorough assessment, please try again with a straight-on smile photo in good lighting — or skip the photo entirely and book your complimentary consultation with Drs. David and Shawn Matian.\n\nCall (818) 706-6077 or book at agourahillsdentaldesigns.com — we'll walk through everything in person.",
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
async function callClaude(apiKey, systemPrompt, contentArray, maxTokens = 700) {
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
