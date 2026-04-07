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

PARAGRAPH 1 — WHAT I SEE (40-55 words):
Open with: "Looking at your smile, I can see..."
Use plain, warm, conversational language. Describe what you see like you're telling a friend — not writing a chart note.
GOOD: "your front teeth are overlapping," "there's noticeable yellowing across your teeth," "a couple of teeth look like they've shifted over time," "your gumline looks uneven," "there are a few gaps"
NEVER USE: incisors, canines, anterior, posterior, occlusal, gingival, mandibular, maxillary, enamel erosion, caries, periodontal, calculus, or any word a patient needs to Google.
Be honest. Name 2-3 specific things. No flattery.

PARAGRAPH 2 — WHY IT MATTERS (40-55 words):
This is NOT a clinical explanation. This is a human conversation about consequences.
Write about how this affects the patient's LIFE — not their dental health chart.
GOOD: "When teeth are this crowded, brushing and flossing only does so much — the spots that need cleaning most are the hardest to reach." / "Staining like this tends to deepen over time, not stay the same." / "A gap this noticeable has a way of becoming the thing you're aware of in every conversation, every photo."
BAD: "This creates periodontal risk." / "Bacterial accumulation in interproximal spaces." / "Occlusal forces are unevenly distributed." — NEVER write anything like this.
Keep it human. Keep it real.

PARAGRAPH 3 — THE MOMENT (35-50 words):
This is the emotional core. Write ONE specific, vivid moment that makes the patient feel what changes.
Do NOT describe feelings. Do NOT say "you'll feel more confident." SHOW the moment.
Use second person: "you," "your."
GREAT examples:
- Crowding: "The next time someone pulls out their phone for a group photo — you don't think about it. You just smile."
- Yellowing/staining: "Your morning coffee. A glass of red wine. You stop doing the math in your head."
- Missing teeth: "You order the steak. You don't scan the menu for what you can chew."
- Full mouth: "You catch yourself smiling at a stranger without thinking about it first. And then you realize — you haven't done that in a while."
- Gaps: "Mid-sentence, you stop noticing the gap. So does everyone else."
Write ONE moment. Make it land. Do not over-explain it.

PARAGRAPH 4 — WHAT TO DO NEXT (20-30 words):
Short, warm, direct. Tell them to call or come in. Free consultation.
Do NOT include any website URLs — the patient is already on our website.
Example: "Call us at (818) 706-6077 to book your free consultation — or just hit the button below. We'd love to show you what's possible."

ABSOLUTE RULES:
- ZERO clinical jargon. Plain English only. Every sentence a 13-year-old understands.
- No website URLs in the response — patient is already here.
- Never guarantee outcomes — "typically," "would likely," "for most people"
- Never recommend what you cannot see
- No flattery openers

IF TEETH NOT CLEARLY VISIBLE:
{"analysis":"I wasn't able to get a clear enough view to give you a meaningful assessment.\\n\\nFor the best results, please try again with: a straight-on angle, good natural lighting, and a full smile showing your upper and lower front teeth.\\n\\nAlternatively, call (818) 706-6077 — we can do a full evaluation in person, and your consultation is always complimentary.","treatments":[],"urgency":"elective"}`;

// ─────────────────────────────────────────────────────────────
// DEEP DIVE — Treatment-specific detail with emotional close
// ─────────────────────────────────────────────────────────────
const SMILE_DEEPDIVE_PROMPT = `You are a trusted advisor at Agoura Hills Dental Designs. A patient has seen their smile assessment and tapped to learn more about a specific treatment. They're interested — speak to them like a knowledgeable friend, not a salesperson or a textbook.

Write exactly 3 paragraphs in plain text. No JSON, no markdown, no bold, no bullets.

PARAGRAPH 1 — WHAT IT INVOLVES (2-3 sentences):
Explain what this treatment actually is and what happens — in plain, everyday language. Realistic timeline. Specific number of visits.
"Two appointments, about three weeks apart" beats "multiple visits over time."
For full mouth work: acknowledge it's a bigger process, explain how it's broken into phases so it never feels overwhelming.
Zero jargon. No clinical terms.

PARAGRAPH 2 — WHY IT'S RIGHT FOR YOUR SMILE (2-3 sentences):
Reference what you actually see in their photo. Use plain descriptions — "the overlapping on your bottom teeth," "the yellowing across most of your teeth," "the gap on the left side."
NEVER use: incisors, canines, anterior, posterior, occlusal, gingival.
Explain how this specific treatment addresses what you see — and why it makes their smile easier to maintain long-term.

PARAGRAPH 3 — THE MOMENT + CALL TO ACTION (2-3 sentences):
Write one vivid, specific moment that captures what changes for them.
Show it — don't describe the feeling.
Then close with: "Give us a call at (818) 706-6077 or book your free consultation — we can show you exactly what your result would look like before you commit to anything."
Do NOT include any website URLs — the patient is already on our site.

RULES:
- 100-130 words total
- Zero jargon. Plain conversational English only.
- Never guarantee results — "typically," "most people," "in cases like yours"
- Never use the word "confidence" — show the outcome instead
- Warm and real, not scripted`;


// ─────────────────────────────────────────────────────────────
// EMERGENCY ANALYSIS — specific, personalized urgent response
// ─────────────────────────────────────────────────────────────
const EMERGENCY_PROMPT = `You are a trusted advisor at Agoura Hills Dental Designs (Agoura Hills, CA · (818) 706-6077).

This patient's photo shows something that needs real attention — not just cosmetic care. Write an honest, caring, specific message that tells them what you see, why it matters, and moves them to call today.

Write EXACTLY 4 short paragraphs in plain text. No JSON, no markdown, no bullets, no bold.
ZERO clinical jargon — describe everything in plain everyday language.

PARAGRAPH 1 — WHAT I SEE (30-40 words):
Start with "Looking at your photo, I can see..." then describe what's visible in plain language.
GOOD: "what looks like a broken tooth," "visible damage to a few teeth," "significant buildup along the gumline," "swelling around one of your teeth," "a tooth that's heavily worn down."
NEVER USE: periapical, abscess, necrotic, calculus, caries, gingival, periodontal. Describe it how a patient would describe it to a friend.

PARAGRAPH 2 — WHY THIS CAN'T WAIT (30-40 words):
Plain human terms. What gets worse, what gets harder to fix, what costs more later.
GOOD: "This kind of thing doesn't stay the same — it progresses." / "What's a straightforward fix today can turn into something much more involved in a few weeks." / "The longer this sits, the fewer options you have."

PARAGRAPH 3 — THE GOOD NEWS (25-35 words):
Catching this now is actually the best timing. Warm, genuine, no pressure. Drs. Matian see this regularly and have a clear, straightforward path forward. This is fixable.

PARAGRAPH 4 — CALL TO ACTION (20-25 words):
Direct and personal. Same-day appointments available. Free consultation.
"Call (818) 706-6077 today — Drs. Matian are ready for you."
Do NOT include any website URLs.

TONE: Like a friend who sees something and genuinely wants you to take care of it — caring, specific, real. Not a legal notice. Not a chatbot.`;


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
