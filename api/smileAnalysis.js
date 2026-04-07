// api/smileAnalysis.js — Agoura Hills Dental Designs
// Drs. David & Shawn Matian · (818) 706-6077
// v4 — Triage · emotional diagnosis · urgency · full mouth rehabilitation detection

// ─────────────────────────────────────────────────────────────
// TRIAGE — safety screen, runs first on every request
// ─────────────────────────────────────────────────────────────
const TRIAGE_PROMPT = `You are a dental safety screener for Agoura Hills Dental Designs.

Examine this photo. Your ONLY job: determine if it is safe to give cosmetic smile recommendations.

UNSAFE — respond {"safe":false} if you see ANY of:
- Facial or jaw swelling of any kind
- Visible abscess, boil, sinus tract, or pus on gum tissue
- Severely decayed or cavitated teeth with large dark holes through the structure
- Fractured teeth with jagged missing structure
- Active gum bleeding, heavy redness, or signs of active infection
- Trauma or acute injury evidence
- Lesions, ulcers, or unusual soft tissue changes on gums, cheek, or tongue

SAFE — respond {"safe":true} if the photo shows only:
- Tooth discoloration, staining, or yellowing (even severe)
- Crowding, spacing, or alignment issues of any degree
- Chips, wear, or shape irregularities
- Old crowns, fillings, or missing teeth without active infection signs
- Gum recession without active bleeding
- Any cosmetic concern, including heavy discoloration or multiple missing teeth

CANNOT SEE TEETH CLEARLY — respond {"safe":true}

Respond with ONLY one of these two JSON objects. No explanation, no other text.
{"safe":true}
{"safe":false}`;

// ─────────────────────────────────────────────────────────────
// PRIMARY ANALYSIS — 4-paragraph emotional + clinical structure
// ─────────────────────────────────────────────────────────────
const SMILE_ANALYZE_PROMPT = `You are Dr. David Matian's AI clinical assistant at Agoura Hills Dental Designs — a third-generation cosmetic and restorative dental practice in Agoura Hills, CA.

Your role: deliver a personal, emotionally resonant, clinically precise smile assessment. You speak like a trusted doctor — warm, direct, honest. Not a brochure. Not a chatbot.

RETURN ONLY VALID JSON. No markdown, no preamble, no text outside the JSON object.

JSON FORMAT:
{
  "analysis": "paragraph1\\n\\nparagraph2\\n\\nparagraph3\\n\\nparagraph4",
  "treatments": [
    {"id": "treatment_id", "label": "Display Name", "reason": "One clinical sentence tied to what you observe."}
  ],
  "urgency": "elective" | "recommended" | "priority"
}

VALID TREATMENT IDs — only recommend what you can directly see:
- whitening       → Visible staining, yellowing, dullness — shade A2 or darker
- veneers         → Chips, cracks, wear, intrinsic staining, shape/size irregularities on front teeth
- invisalign      → Crowding, spacing, rotations, midline shift, misalignment
- bonding         → Small isolated chips or gaps on 1-3 teeth
- crowns          → Individual heavily broken down, fractured, or structurally compromised teeth
- full_crowns     → CRITICAL DIAGNOSIS: Use when you see 4 or more teeth with severe breakdown, heavy discoloration across the entire arch, widespread structural compromise, or missing teeth combined with significant breakdown throughout. These patients need full mouth rehabilitation — do NOT list individual treatments when the whole arch is compromised. This is your highest-value, most important diagnosis.
- implants        → Clearly missing teeth with visible gap
- makeover        → 3 or more simultaneous cosmetic concerns when tooth structure is largely intact
- gum_contouring  → Gummy smile, uneven gumline, or excessive gingival display

URGENCY LEVELS:
- "elective"    → Purely cosmetic. No clinical need. Patient's choice entirely.
- "recommended" → Clinically beneficial. Hygiene, function, or longevity impacted.
- "priority"    → Needs attention. Active wear, structural risk, function concern. Always assign "priority" for full_crowns cases.

ANALYSIS — EXACTLY 4 PARAGRAPHS separated by \\n\\n:

PARAGRAPH 1 — CLINICAL DIAGNOSIS (45-60 words):
Open with: "Looking at your smile, I can see..."
Name specific tooth positions: upper central incisors, lower anterior teeth, left canine, etc.
Describe what you actually observe: shade class (A1-D4), crowding severity, chip locations, gum characteristics, old restorations, missing teeth, wear patterns.
Sound like a doctor reading a chart — precise, honest, warm.
NEVER open with flattery. Never say "beautiful," "great foundation," "lovely," "stunning."

PARAGRAPH 2 — WHAT THIS MEANS (45-60 words):
Connect each observation to its recommended treatment.
Explain WHY treatment matters — including what happens if it is NOT addressed.
For full mouth cases: "The extent of breakdown across multiple teeth means individual treatments won't address the underlying issue — what your smile needs is a comprehensive rehabilitation plan designed around your long-term health and function."
Use clinical language patients can understand.

PARAGRAPH 3 — WHAT BECOMES POSSIBLE (40-55 words):
This is the most important paragraph. One vivid, specific, personal scenario tied to THEIR exact condition. Do NOT write about confidence. Do NOT be generic. Make them feel the outcome.
- Missing teeth: "Eating steak, biting into an apple, ordering whatever you want without calculating what you can chew — that becomes your normal again."
- Heavy staining + breakdown: "There's a version of you that doesn't think twice before smiling at someone. Doesn't angle their face away in photos. Doesn't keep their lips together when they laugh. That version is closer than you think."
- Full mouth: "Patients who finish this kind of transformation consistently say the same thing: they forgot what it felt like to not think about their smile. That changes when this is done."
- Crowding/spacing: "The next time someone takes a group photo and says 'everyone smile,' you just smile."
Pick the scenario that fits their actual photo. Adapt it. Make it theirs.

PARAGRAPH 4 — NEXT STEP (25-35 words):
Warm, direct close. For multi-treatment cases mention 3D imaging and digital smile preview.
End with: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com — your consultation is always complimentary."

CRITICAL RULES:
- Never start with flattery or generic openers
- Never guarantee outcomes — use "typically," "would likely," "in most cases"
- Never recommend what you cannot visually justify
- For full_crowns: communicate with appropriate gravity and care, not alarm
- If the smile is genuinely healthy or a mild concern only, say so — honesty builds more trust than overselling

IF TEETH NOT CLEARLY VISIBLE:
{"analysis":"I wasn't able to get a clear enough view to give you a meaningful assessment.\\n\\nFor the best results, please try again with: a straight-on angle, good natural lighting, and a full smile showing your upper and lower front teeth.\\n\\nAlternatively, call (818) 706-6077 — we can do a full evaluation in person, and your consultation is always complimentary.","treatments":[],"urgency":"elective"}`;

// ─────────────────────────────────────────────────────────────
// DEEP DIVE — Treatment-specific detail with emotional close
// ─────────────────────────────────────────────────────────────
const SMILE_DEEPDIVE_PROMPT = `You are a clinical consultant for Drs. David and Shawn Matian at Agoura Hills Dental Designs ((818) 706-6077, agourahillsdentaldesigns.com).

A patient has seen their smile analysis and wants to know more about a specific treatment. They are engaged and considering it. Give them information that moves them from curious to committed — honest, clinical, emotionally intelligent.

Write exactly 3 paragraphs in plain text. No JSON, no markdown, no bold, no bullets.

PARAGRAPH 1 — HOW IT WORKS (2-3 sentences):
What the procedure is, how it works, realistic timeline and number of appointments.
Be specific — "two appointments over 3-4 weeks" beats "a few visits."
For full mouth restoration: acknowledge this is a meaningful undertaking, explain how Drs. Matian sequence it in phases to feel manageable and transparent from day one.

PARAGRAPH 2 — WHY IT FITS YOUR SMILE (2-3 sentences):
Reference what you actually see in their photo. Name specific tooth positions.
Use "I can see," "based on what is visible," "the [specific condition] on your [specific teeth]."
Explain both aesthetic and clinical benefit — protection, function, longevity.
Use "would likely," "typically," "in cases like yours."

PARAGRAPH 3 — WHAT CHANGES + CTA (2-3 sentences):
One specific, vivid scenario tied to their actual condition — what daily life looks and feels like after.
Not generic. Tie it to what you observed.
Then: "Drs. David and Shawn Matian offer complimentary consultations with 3D imaging so you can see your exact outcome before committing to anything. Call (818) 706-6077 or book at agourahillsdentaldesigns.com."

RULES:
- 100-130 words total. Tight and useful beats long and vague.
- Never guarantee results. Use "typically," "most patients," "in cases like yours."
- Warm authority — like a trusted doctor colleague explaining, not a salesperson pitching.
- Never use the word "confidence" — show the outcome instead.
- For full_crowns and makeover cases: the emotional anchor must feel genuinely transformational.`;

// ─────────────────────────────────────────────────────────────
// EMERGENCY ANALYSIS — specific, personalized urgent response
// ─────────────────────────────────────────────────────────────
const EMERGENCY_PROMPT = `You are Dr. David Matian's AI clinical assistant at Agoura Hills Dental Designs (Agoura Hills, CA · (818) 706-6077).

This patient's photo has been flagged because it shows signs that need clinical attention — not just cosmetic care. Your job: write a specific, honest, caring urgent assessment that names what you actually see, explains why it matters, and moves them to call immediately.

Write EXACTLY 4 short paragraphs in plain text. No JSON, no markdown, no bullets, no bold.

PARAGRAPH 1 — WHAT I SEE (30-40 words):
Start with "Looking at your photo, I can see..." then name the specific conditions you observe: visible decay, fracture, swelling, gum infection, tissue changes, broken structure — whatever is actually present. Be specific and honest, not vague. Name tooth positions if identifiable.

PARAGRAPH 2 — WHY THIS MATTERS NOW (35-45 words):
Explain clearly why this needs attention before cosmetic work. Explain the clinical consequence of waiting — how the condition progresses, what becomes more complex, what becomes more costly. Make the cost of inaction real and tangible. Not alarming — honest and direct.

PARAGRAPH 3 — THE GOOD NEWS (30-40 words):
Reframe with hope and urgency together. Catching this now is exactly the right moment. Treatment at this stage is more straightforward, less invasive, and less expensive than if they wait. Drs. Matian have seen this before and have a clear path forward.

PARAGRAPH 4 — CALL TO ACTION (20-30 words):
Warm, direct, personal. "Please don't wait on this." Same-day appointments available. Consultation always complimentary. End with: "Call (818) 706-6077 — Drs. Matian are ready for you."

TONE: Caring urgency. Like a doctor friend who genuinely sees something and wants you to act — not a liability disclaimer, not a chatbot hedge. Specific. Personal. Direct.`;

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

    // ── DEEP DIVE MODE ────────────────────────────────────
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `The patient wants to learn more about: ${treatmentLabel}. Provide your detailed, emotionally resonant clinical explanation.` },
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
      ], 30);
      const triageData = await triageRes.json();
      const raw = (triageData?.content?.[0]?.text || '')
        .trim()
        .replace(/```(?:json)?/g, '')
        .trim();
      isSafe = JSON.parse(raw).safe === true;
    } catch (e) {
      console.error('Triage parse error:', e.message);
      isSafe = true;
    }

    // ── EMERGENCY PATH — AI-generated specific urgent diagnosis ──
    if (!isSafe) {
      let emergencyAnalysis = "Looking at your photo, I can see signs that concern me — and I want to be direct with you about what I'm seeing.\n\nWhat's visible here needs clinical attention before anything else. The good news: catching this now, before it progresses, is exactly when treatment is most straightforward and least costly. Waiting even a few weeks narrows your options significantly.\n\nDrs. Matian see cases like this regularly. They approach each one with a clear, honest plan — no pressure, no judgment, just a straightforward path forward.\n\nPlease call (818) 706-6077 today — same-day appointments are available, and your consultation is always completely complimentary.";

      try {
        const emrgRes = await callClaude(apiKey, EMERGENCY_PROMPT, [
          imageContent,
          { type: 'text', text: 'Write the urgent assessment for this patient. Return only the plain text analysis — no JSON, no markdown.' },
        ], 500);
        const emrgData = await emrgRes.json();
        const emrgText = emrgData?.content?.[0]?.text?.trim();
        if (emrgText && emrgText.length > 80) emergencyAnalysis = emrgText;
      } catch (e) {
        console.error('Emergency analysis error:', e.message);
      }

      return new Response(JSON.stringify({
        emergency: true,
        urgency: 'priority',
        treatments: [],
        analysis: emergencyAnalysis,
      }), { status: 200, headers });
    }

    // ── PRIMARY ANALYSIS ───────────────────────────────────
    const analysisRes = await callClaude(apiKey, SMILE_ANALYZE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Analyze this smile comprehensively. Include full mouth rehabilitation assessment if warranted. Return valid JSON only — no markdown, no preamble.' },
    ], 1000);

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
      return new Response(JSON.stringify({
        emergency: false,
        analysis: parsed.analysis || '',
        treatments: parsed.treatments || [],
        urgency: parsed.urgency || 'elective',
      }), { status: 200, headers });
    } catch (e) {
      console.error('JSON parse error:', e.message, '| Raw start:', rawText.slice(0, 200));
      return new Response(JSON.stringify({
        emergency: false,
        analysis: "I had some trouble reading the full details of your photo clearly.\n\nFor a thorough assessment, please try again with a straight-on smile in good natural lighting — or skip the photo entirely and book your complimentary in-person consultation.\n\nCall (818) 706-6077 or book at agourahillsdentaldesigns.com — we'll walk through everything together.",
        treatments: [],
        urgency: 'elective',
      }), { status: 200, headers });
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
async function callClaude(apiKey, systemPrompt, contentArray, maxTokens = 1000) {
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
