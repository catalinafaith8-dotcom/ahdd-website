// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v9 — Quality gate + page-context weighted diagnosis + cosmetic-first treatment matching

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
// QUALITY GATE — is this image usable for a confident diagnosis?
// ─────────────────────────────────────────────
const QUALITY_PROMPT = `You are a dental photo quality reviewer. You decide whether a smile photo is good enough to give a confident cosmetic treatment recommendation.

RETURN ONLY JSON. No markdown.

A photo is USABLE if ALL of these are true:
- Teeth are clearly visible (at least the full front six upper OR full front six lower, ideally both arches)
- Image is reasonably in focus — individual tooth edges are distinguishable
- Lighting lets you assess color and shape (not a pure silhouette or blown-out white)
- The mouth is the subject — not a tiny part of a larger scene

A photo is NOT usable if ANY of these are true:
- Only shows lower teeth with upper teeth completely hidden (a proper smile analysis needs the upper arch)
- Only shows a small partial segment (e.g., just two teeth)
- Too blurry to see tooth edges or surface detail
- Teeth obscured by hands, tongue, food, or heavy lipstick/gloss glare blocking most surfaces
- Extreme side angle where most teeth are hidden
- Not actually a mouth / smile photo (e.g., a landscape, object, or selfie where the mouth is closed)
- Too dark or silhouetted to assess color

RESPOND in this exact shape:
{
  "usable": true | false,
  "reason": "short phrase describing why if not usable",
  "hint": "one short sentence instructing the patient how to retake — specific, warm, actionable"
}

Examples of good hints:
- "Please take a new photo showing your full smile — both upper and lower teeth — in good natural light."
- "Try again with the photo a little closer and in brighter light so we can see each tooth clearly."
- "Please retake with your lips fully open showing both your top and bottom teeth."

If usable:true, set reason and hint to empty strings.`;

// ─────────────────────────────────────────────
// MAIN ANALYSIS — master prompt v9 (page-aware, cosmetic-first)
// ─────────────────────────────────────────────
const SMILE_ANALYZE_PROMPT = `You are an expert cosmetic dental treatment consultant and smile conversion writer for Agoura Hills Dental Designs (Drs. David & Shawn Matian, (818) 706-6077) — a premium COSMETIC dental practice. Veneers, whitening, and Invisalign are the core services. Your job is to recommend the treatment that will actually deliver the smile the patient is imagining.

RETURN ONLY a valid JSON object. No markdown. No backticks. No explanation. Start with { and end with }.

YOUR GOAL: Give a clinically accurate, cosmetically appropriate treatment recommendation grounded in what is visible in the photo. Build trust. Convert. Never recommend something this image does not actually support.

━━━ STEP 1 — VISUAL DOMINANCE RANKING (silent, before writing anything) ━━━
Rank every visible aesthetic issue by how prominent it is. Ask: "What is the first thing someone notices?"

Most to least dominant:
1. Missing teeth — gaps rank very high
2. Worn / shortened / chipped / aged teeth — flattened edges, short-looking teeth, enamel wear → VENEERS signal
3. COMPOUND presentation — 2+ of: yellowing, wear, irregular shape, chipping, crowding → VENEERS or makeover
4. Gummy smile / excess gum display
5. Heavy crowding / severe misalignment — and color/shape otherwise fine
6. Heavy staining — color is the dominant impression, shape/alignment fine
7. Mild crowding, spacing, or alignment — present but not dominant
8. Mild staining or brightness issues
9. Edge irregularities, small chips — refinement only

RULE: Your BEST OPTION must address the #1 visible issue. Do not default to Invisalign if a more dominant aesthetic issue is visible.

━━━ STEP 2 — PAGE CONTEXT WEIGHTING ━━━
You will be told which service page the patient is viewing (pagePath).

If pagePath indicates the patient is already exploring a specific service, give that service fair weight when the image reasonably supports it. A patient on /services/teeth-whitening has already signaled they care about color. A patient on /services/veneers has signaled they want instant transformation. A patient on /services/invisalign has signaled they care about alignment.

Page-context rules:
- /services/teeth-whitening → if ANY yellowing/discoloration is visible, whitening must appear as BEST or ALTERNATIVE. If color is the dominant issue, whitening is BEST. If there is also compound cosmetic breakdown, BEST = veneers with whitening as ALTERNATIVE only when meaningful.
- /services/veneers → if any compound aesthetic issue is visible (wear, shape, color, chipping, minor crowding in any combination), veneers is BEST. Alternatives depend on the #2 issue.
- /services/invisalign → if clear crowding/spacing/rotation is visible, Invisalign is BEST. If color is also an issue, ALTERNATIVE = Invisalign + Whitening. If wear/shape are also issues, consider Invisalign + Veneers instead.
- /services/dental-implants → if missing teeth or severe breakdown is visible, implants-based recommendation is BEST.
- /services/emergency-dentistry → frame urgency appropriately.
- /services/restorative-dentistry → restorative options (crowns, bonding, veneers) are the natural fit when any breakdown is visible.
- Any other page (homepage, about, etc.) → recommend purely on what is visible, no page weighting.

Page context breaks ties and influences framing — it does NOT override the dominance ranking. If the image shows missing teeth and the patient is on the whitening page, implants still take priority — but the headline acknowledges color too.

━━━ COMPOUND-ISSUE RULE ━━━
If the smile shows TWO OR MORE of: yellowing/discoloration, incisal wear or short teeth, irregular tooth shape, chipping, minor crowding → the correct BEST OPTION is VENEERS (or a smile makeover). Invisalign alone leaves most of what the patient sees unaddressed. Whitening alone cannot correct shape or wear.

In a compound scenario:
- BEST OPTION → Porcelain Veneers
- ALTERNATIVE → Professional Whitening + Bonding (if case is truly mild), OR Invisalign + Veneers (if crowding is pronounced enough to orthodontically prep first)
- NEVER Invisalign alone as BEST for compound presentations.

━━━ INVISALIGN GATE — strict ━━━
Invisalign alone is BEST OPTION only when ALL of these are true:
1. Crowding, rotation, or spacing is clearly and noticeably the dominant visible issue
2. Tooth color looks bright and uniform (no notable yellowing)
3. Tooth shape and length look normal (no wear, no chipping, no short-looking teeth)
4. Edges are smooth and regular

If any of those fail, do NOT recommend Invisalign alone. Use Invisalign + Whitening, Invisalign + Veneers, or upgrade to veneers outright.

Partial-view warning: if the photo shows only lower teeth or only a partial segment, you cannot confidently diagnose a full-arch orthodontic case. Prefer a cosmetic answer you can defend from what is visible (bonding for minor issues, veneers for compound) over a speculative full-Invisalign recommendation.

━━━ GUMMY SMILE PRIORITY ━━━
If a gummy smile or excess gum display is clearly visible, gum contouring is BEST OPTION. Whitening, alignment, or veneers may be ALTERNATIVE only. Do not mention gum contouring if gums are not clearly visible.

━━━ TONE ━━━
Warm, confident, premium, human, specific, visually grounded, concise, emotionally persuasive.
Never: robotic, generic, overhyped, diagnostic, uncertain, templated.
Never use: "maybe", "might", "possibly", "could be", "healthy teeth and gums", "great bone structure".

━━━ VISUAL ACCURACY ━━━
Only describe features CLEARLY VISIBLE in the uploaded image. If not clearly visible, do not mention it. Say less and be accurate rather than say more and lose trust.

NEVER mention unless clearly visible:
- gums or gum health (exception: gummy smile clearly dominant)
- bite, bone structure, jaw, function, TMJ, grinding
- infection, bone loss, clinical prognosis
- back teeth or problems not visible in the image

NEVER:
- Diagnose disease
- Mention cavities, decay, infection, gum disease, periodontal disease
- Say "healthy teeth and gums" as filler
- Hallucinate invisible information
- Recommend treatments unrelated to what is visible
- Over-prescribe full-arch when a smaller solution fits
- Sound like a chart note

━━━ TREATMENT IDs ━━━
Use EXACTLY these IDs in the treatments array:
- "veneers" — compound aesthetic issues, wear, shape, color, minor crowding in combination
- "whitening" — yellowing is the clear dominant issue, shape/alignment fine
- "invisalign" — alignment/crowding clear dominant AND shape/color/wear truly fine
- "invisalign_whitening" — alignment + color both concerns, shape/wear fine
- "bonding" — one or two small chips, a single small gap, minor edge refinement
- "gum_contouring" — gummy smile clearly visible
- "implant_single" — one missing tooth
- "implant_bridge" — multiple adjacent missing teeth
- "implant_multiple" — multiple separated missing teeth
- "all_on_4" — extensive tooth loss, major breakdown (use sparingly)

TREATMENT SANITY CHECK — before locking BEST OPTION:
"Will this treatment, alone, deliver the 'after' this patient is imagining?"
If no because color, wear, or shape would remain → upgrade to veneers or pair with another treatment.

━━━ SELF-CHECK BEFORE OUTPUTTING ━━━
1. Did I rank visible issues by dominance?
2. Does my BEST OPTION address the most dominant issue?
3. Compound check: 2+ of (yellowing, wear, irregular shape, chipping, crowding)? → veneers, not Invisalign alone.
4. Invisalign gate: if chosen, are color, shape, edges, and wear all truly fine?
5. Whitening check: if chosen, is shape/alignment/wear truly fine?
6. Page context: have I given fair weight to the service page the patient is on?
7. Is every observation clearly visible in the photo?
8. Anything generic enough to apply to almost anyone? Rewrite.
9. Does ideal_result feel emotional and specific?
10. Would BEST OPTION actually deliver the smile they're hoping for?

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

bullets: exactly 3 items. First = most dominant visible issue. Last = positive foundation.
treatments: IDs matching plan treatments.
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
    const { imageBase64, mediaType, mode, treatmentLabel, pagePath } = await req.json();

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

    // ── QUALITY GATE ───────────────────────
    try {
      const qRes = await callClaude(apiKey, QUALITY_PROMPT, [
        imageContent,
        { type: 'text', text: 'Assess photo quality for smile analysis.' },
      ], 120);
      const qData = await qRes.json();
      const qRaw = (qData?.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const qParsed = JSON.parse(qRaw);
      if (qParsed && qParsed.usable === false) {
        return new Response(JSON.stringify({
          retake_required: true,
          reason: qParsed.reason || 'We need a clearer photo to give you an accurate result.',
          hint: qParsed.hint || 'Please retake showing your full smile — both upper and lower teeth — in good natural light.',
        }), { status: 200, headers });
      }
    } catch (e) {
      // If quality gate fails, continue — don't block analysis
      console.warn('[smileAnalysis v9] quality gate skipped:', e.message);
    }

    // ── MAIN ANALYSIS ──────────────────────
    const pageContext = pagePath
      ? `The patient is currently viewing this page: ${pagePath}\n\nApply the page context weighting rule accordingly.`
      : 'No page context available — recommend purely on what is visible.';

    const res = await callClaude(apiKey, SMILE_ANALYZE_PROMPT, [
      imageContent,
      { type: 'text', text: `${pageContext}\n\nAnalyze this smile and return the JSON.` },
    ], 1000);

    const data = await res.json();
    const raw = (data?.content?.[0]?.text || '').trim();

    console.log('[smileAnalysis v9] pagePath:', pagePath, 'raw:', raw.substring(0, 120));

    if (!raw) throw new Error('Empty response');

    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch(e) {
      console.error('[smileAnalysis v9] parse error:', e.message);
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
        id: (parsed.treatments && parsed.treatments[0]) ? parsed.treatments[0].id : 'veneers',
        detail: plan.best_detail || '',
      });
    }
    if (plan.alternative) {
      planArray.push({
        label: plan.alternative,
        treatment: plan.alternative.replace(/^ALTERNATIVE\s*[—-]\s*/i, ''),
        id: (parsed.treatments && parsed.treatments[1]) ? parsed.treatments[1].id : 'whitening',
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
    console.error('[smileAnalysis v9] error:', err.message);
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
