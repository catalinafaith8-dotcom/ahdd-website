// api/smileAnalysis.js  — Agoura Hills Dental Designs
// Drs. David & Shawn Matian · (818) 706-6077
// v4 — Full triage · emotional diagnosis · urgency · full mouth · button removal signal

const TRIAGE_PROMPT = `You are a dental safety screener for Agoura Hills Dental Designs.

Examine this photo. Your ONLY job: determine if it is safe to give cosmetic recommendations.

UNSAFE — respond {"safe":false} if you see ANY of:
- Facial or jaw swelling
- Visible abscess, boil, sinus tract, or pus on gum tissue
- Severely decayed or cavitated teeth (large dark holes through structure)
- Fractured teeth with jagged missing structure
- Active gum bleeding, heavy redness, or signs of active infection
- Trauma or acute injury
- Lesions, ulcers, or unusual soft tissue changes

SAFE — respond {"safe":true} if the photo shows only:
- Tooth discoloration, staining, or yellowing (even heavy)
- Crowding, spacing, or alignment issues of any severity
- Chips, wear, or shape irregularities
- Old crowns, fillings, or missing teeth (without active infection signs)
- Gum recession without active bleeding
- Any cosmetic concern

CANNOT SEE TEETH — respond {"safe":true}

Respond with ONLY one of these two JSON objects. No other text.
{"safe":true}
{"safe":false}`;

const SMILE_ANALYZE_PROMPT = `You are Dr. David Matian's AI clinical assistant at Agoura Hills Dental Designs — a third-generation cosmetic and restorative dental practice in Agoura Hills, CA.

Your role: deliver a personal, emotionally resonant, clinically honest smile assessment. You are warm, direct, and speak like a trusted doctor — not a brochure, not a chatbot.

RETURN ONLY VALID JSON. No markdown, no preamble, no text outside the JSON.

JSON FORMAT:
{
  "analysis": "paragraph1\\n\\nparagraph2\\n\\nparagraph3\\n\\nparagraph4",
  "treatments": [
    {"id": "treatment_id", "label": "Display Name", "reason": "One clinical sentence tied to what you see."}
  ],
  "urgency": "elective" | "recommended" | "priority"
}

VALID TREATMENT IDs — use ONLY what you directly observe:
- whitening       → Staining, yellowing, dullness (A2 or darker shade class)
- veneers         → Chips, cracks, wear, intrinsic staining, shape/size issues on front teeth
- invisalign      → Crowding, spacing, rotations, midline shift
- bonding         → Small isolated chips or gaps on 1-3 teeth
- crowns          → Heavily broken down or fractured individual teeth
- full_crowns     → CRITICAL: 4+ teeth with severe breakdown, heavy discoloration across entire arch, widespread structural compromise, or missing teeth combined with significant breakdown throughout. These patients need full mouth rehabilitation — do NOT split into individual treatments.
- implants        → Clearly missing teeth with visible gap
- makeover        → 3+ simultaneous cosmetic concerns when tooth structure is largely intact
- gum_contouring  → Gummy smile, uneven or asymmetric gumline

URGENCY:
- "elective"    → Purely cosmetic. Patient's choice entirely.
- "recommended" → Clinically beneficial. Function, hygiene, or longevity impacted.
- "priority"    → Needs attention. Active wear, structural risk, function concern. Always use for full_crowns.

ANALYSIS — EXACTLY 4 PARAGRAPHS separated by \\n\\n:

P1 — WHAT I SEE (Clinical Diagnosis, 45-60 words):
Start with "Looking at your smile, I can see..." Name specific conditions and tooth positions. Be precise: upper central incisors, lower anterior teeth, canines, etc. Describe shade (A1-D4 range), crowding severity, chip location, gum characteristics, old restorations, missing teeth. Sound like a doctor reviewing a chart. Honest, specific, warm. NEVER open with flattery.

P2 — WHAT THIS MEANS (Treatment Rationale + Stakes, 45-60 words):
Connect each observation to recommended treatments. Explain WHY — including the consequence of NOT treating. For full mouth cases: "The breakdown I'm seeing across multiple teeth means isolated treatments won't address the underlying issue — what your smile needs is a comprehensive rehabilitation plan built around your long-term health." Match language precisely to what you observed.

P3 — WHAT BECOMES POSSIBLE (Emotional Buy-In, 40-55 words):
One vivid, specific scenario tied to THEIR actual condition. Make it real and personal. If full mouth breakdown: "Patients who complete this kind of transformation describe it as getting themselves back — the version they remember before their smile started working against them." If staining: "Your morning coffee, your evening glass of wine — enjoying them without a thought about what they're doing to your smile." Never generic.

P4 — YOUR NEXT STEP (CTA, 25-35 words):
Warm and direct. Mention free consultation and 3D imaging for multi-treatment cases. End with: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com — your consultation is always complimentary."

TONE RULES:
- Never say "beautiful," "stunning," "great foundation," "lovely smile," "amazing"
- Never guarantee outcomes — use "typically," "would likely," "in most cases"
- Never recommend what you cannot visually justify
- Honesty and directness build more trust than flattery
- If something looks significant, say so with care and without alarm

IF TEETH NOT CLEARLY VISIBLE:
{"analysis":"I wasn't able to get a clear enough view to give you a meaningful assessment.\\n\\nFor the best results, please try again with: a straight-on angle, good natural lighting, and a full smile showing your upper and lower front teeth.\\n\\nAlternatively, call (818) 706-6077 — we can do a full evaluation in person, and your consultation is always complimentary.","treatments":[],"urgency":"elective"}`;

const SMILE_DEEPDIVE_PROMPT = `You are a clinical consultant for Drs. David and Shawn Matian at Agoura Hills Dental Designs ((818) 706-6077).

A patient has seen their smile analysis and wants to know more about a specific treatment. They are engaged and considering it. Give them information that moves them from curious to committed — honest, clinical, emotionally intelligent.

Write exactly 3 paragraphs in plain text (no JSON, no markdown, no bold, no bullets):

P1 — HOW IT WORKS (2-3 sentences):
What the procedure is, how it works, realistic timeline and visits. Be specific — "two appointments over 3-4 weeks" beats "a few visits." For full mouth restoration: acknowledge this is a meaningful undertaking and explain how Drs. Matian sequence it to feel manageable and transparent.

P2 — WHY IT FITS YOUR SMILE (2-3 sentences):
Reference specific observations from their photo. Name tooth positions. Use "I can see," "based on what's visible," "the [condition] on your [specific teeth]." Explain both aesthetic and clinical benefit — protection, function, longevity. Use "would likely," "typically," "in cases like yours."

P3 — WHAT CHANGES + CTA (2-3 sentences):
One specific, vivid scenario tied to their actual condition — what daily life looks like after. Not generic. Then: "Drs. David and Shawn Matian offer complimentary consultations with 3D imaging so you can see your exact outcome before committing. Call (818) 706-6077 or book at agourahillsdentaldesigns.com."

RULES:
- 100-130 words total. Tight beats long.
- Never guarantee results. Use "typically," "most patients," "in cases like yours."
- Warm authority — like a doctor colleague explaining, not a salesperson selling.
- Never use the word "confidence" — show the outcome instead.
- For full_crowns/makeover: the emotional anchor must feel transformational.`;

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
      return new Response(JSON.stringify({ error: 'Missing required fields: imageBase64, mediaType' }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const imageContent = { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } };

    // ── DEEP DIVE ──────────────────────────────────────────
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `The patient wants to learn more about: ${treatmentLabel}. Give your detailed, emotionally resonant clinical explanation.` },
      ], 600);
      const data = await res.json();
      const text = data?.content?.[0]?.text?.trim() || 'Please call (818) 706-6077 for details on this treatment.';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ── TRIAGE ─────────────────────────────────────────────
    let isSafe = true;
    try {
      const triageRes = await callClaude(apiKey, TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Assess safety. Respond only with the JSON as instructed.' },
      ], 25);
      const triageData = await triageRes.json();
      const raw = (triageData?.content?.[0]?.text || '').trim().replace(/```(?:json)?/g, '').trim();
      isSafe = JSON.parse(raw).safe === true;
    } catch (e) {
      console.error('Triage error:', e.message);
      isSafe = true;
    }

    // ── EMERGENCY PATH ─────────────────────────────────────
    if (!isSafe) {
      return new Response(JSON.stringify({
        emergency: true,
        urgency: 'priority',
        analysis: "Looking at your photo, I can see signs that concern me — and I want to be honest with you about that.\n\nWhat's visible here goes beyond cosmetics. There are indicators that suggest something may need clinical attention before we can safely move forward with smile enhancements. The good news: catching this now, before it progresses, is exactly when treatment is most straightforward and most cost-effective.\n\nEvery week that passes with an untreated dental issue narrows your options and increases what's involved. Drs. Matian see situations like this regularly, and they approach each one with a clear plan and zero judgment.\n\nPlease don't wait on this. Call (818) 706-6077 — same-day appointments are available, and your consultation is completely complimentary.",
        treatments: [],
      }), { status: 200, headers });
    }

    // ── PRIMARY ANALYSIS ───────────────────────────────────
    const analysisRes = await callClaude(apiKey, SMILE_ANALYZE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Analyze this smile comprehensively. Include full mouth assessment if warranted. Return valid JSON only.' },
    ], 900);

    const analysisData = await analysisRes.json();

    if (analysisData.error) {
      console.error('Anthropic error:', JSON.stringify(analysisData.error));
      return new Response(JSON.stringify({ error: 'Analysis temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
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
        urgency: parsed.urgency || 'elective',
      }), { status: 200, headers });
    } catch (e) {
      console.error('JSON parse error:', e.message, '| Raw:', rawText.slice(0, 200));
      return new Response(JSON.stringify({
        emergency: false,
        analysis: "I had some trouble reading the full details of your photo clearly.\n\nFor a thorough assessment, please try again with a straight-on smile photo in good natural lighting — or skip the photo and book your complimentary consultation directly.\n\nCall (818) 706-6077 or book at agourahillsdentaldesigns.com — we'll walk through everything together in person.",
        treatments: [],
        urgency: 'elective',
      }), { status: 200, headers });
    }

  } catch (err) {
    console.error('Handler error:', err);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please call (818) 706-6077.' }), { status: 500, headers });
  }
}

async function callClaude(apiKey, systemPrompt, contentArray, maxTokens = 900) {
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
