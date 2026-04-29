// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v13.1 — Whitening-first prioritization + veneers guardrail
//   v13 still recommended veneers as BEST for color+alignment cases.
//   Per practice direction: veneers are permanent and expensive — the
//   in-person exam decides whether they're appropriate, not a phone
//   photo. v13.1 changes:
//   - RECOMMEND prompt: rewrote prioritization. Color+alignment now
//     yields Whitening (BEST) + Invisalign (ALT). Veneers reserved
//     for cases with ≥2 structural findings (wear/chipping/shape).
//   - Code-level guardrail: even if AI picks veneers, the handler
//     verifies structural findings exist; if not, silently swaps
//     to Whitening + Invisalign / Whitening + Take-Home / etc.
//   - Pathology still runs as silent backend signal (v13 architecture
//     preserved). Patient experience stays cosmetic.
//   Same response shape as v13 — widget unchanged.

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
// HEALTH TRIAGE — pathology screen [v11]
// Catches periodontal disease, recession, decay, and other
// dental health concerns that are NOT cosmetic. Without this
// pass, pathology cases were routed through the cosmetic
// OBSERVE/RECOMMEND pipeline and rendered as mild "spacing"
// with a misleading "soon" urgency badge.
// ─────────────────────────────────────────────
const HEALTH_TRIAGE_PROMPT = `You are a dental health pathology screener. You assess whether a smile photo shows clear signs of disease that need professional evaluation BEFORE any cosmetic conversation.

Respond ONLY with JSON. No markdown. No backticks.

You must distinguish CLEAR pathology from cosmetic concerns. Be conservative — false positives kill legitimate cosmetic leads.

═══ HARD SIGNS — single indicator is sufficient ═══
Flag pathology=true if you can clearly see ANY ONE of:
- Frank gingival recession with visible exposed root surface (not just "long-looking teeth")
- "Black triangles" between teeth indicating papilla loss / interproximal bone loss
- Visible decay: dark cavitation, brown/black holes, clear shadow indicating caries
- A single tooth notably darker than its neighbors (suggests non-vital tooth)
- A tooth visibly displaced out of arch position in a way that suggests pathology (not orthodontic crowding)
- Visible abscess, fistula, or pus

═══ SOFT SIGNS — require TWO or more co-occurring ═══
For these, ONE indicator alone is NOT enough. You must see at least 2 together:
- Gum redness
- Visible swelling at the gumline
- Plaque or calculus accumulation at the gumline
- Generalized spacing in adult dentition

Examples:
- redness alone → NOT pathology (could be lighting, lipstick reflection, normal vascularity)
- redness + visible plaque buildup → pathology=true (gingivitis)
- redness + frank swelling → pathology=true (gingivitis)
- spacing alone → NOT pathology (could be orthodontic baseline)
- spacing + recession → pathology=true (periodontitis suggested)

═══ OUTPUT ═══
If pathology IS clearly visible per the rules above, return:
{
  "pathology": true,
  "category": "periodontal" | "decay" | "endodontic" | "mixed",
  "severity": "moderate" | "advanced",
  "primary_concern": "one short factual sentence describing what you see"
}

Otherwise (cosmetic concerns only, OR insufficient indicators):
{ "pathology": false }

Be honest and clinically conservative. When uncertain whether a soft sign is real or just photo artifact, return pathology:false. The cosmetic pipeline downstream will handle ambiguous cases appropriately.`;

// ─────────────────────────────────────────────
// PATHOLOGY MESSAGE — warm, direct, non-alarming [v11]
// ─────────────────────────────────────────────
const PATHOLOGY_PROMPT_BUILDER = (flag) => `You are a caring dentist at Agoura Hills Dental Designs. The patient's photo shows ${flag.category} concerns at ${flag.severity} severity. Specifically: ${flag.primary_concern}

Write 3 short paragraphs. Plain text only — no asterisks, no bold, no markdown, no headers.

Paragraph 1: Describe what you see in plain everyday language. Direct but warm. Do not say "you have disease." Describe what is visible (e.g., "your gums have pulled back from your teeth" rather than "you have periodontal disease").

Paragraph 2: Why this is worth getting evaluated soon — gently explain that what is visible can progress without care. Frame around protecting the smile and teeth that are there. Calm, never alarming.

Paragraph 3: The path forward — a comprehensive evaluation, not a sales pitch for a cosmetic treatment. End with exactly: Call (818) 706-6077 — same-week appointments available, your consultation is free.

Under 110 words total. No cosmetic talk. No mention of veneers, whitening, Invisalign, or aesthetics. This is a health conversation.`;

// ─────────────────────────────────────────────
// QUALITY GATE — is this image usable for a confident diagnosis?
// ─────────────────────────────────────────────
const QUALITY_PROMPT = `You are a dental photo quality reviewer. You decide whether a smile photo is good enough to give a responsible cosmetic treatment recommendation.

RETURN ONLY JSON. No markdown.

A photo is USABLE for full smile analysis only if ALL of these are true:
- BOTH the upper front teeth AND the lower front teeth are clearly visible (not just one arch)
- At least the six front teeth on whichever arch is visible are individually distinguishable
- Image is reasonably in focus — individual tooth edges are distinguishable
- Lighting lets you assess color and shape (not a pure silhouette, not blown-out white)
- The mouth is the subject — not a small part of a larger scene

A photo is NOT usable if ANY of these are true:
- Shows ONLY the lower teeth with upper arch hidden (this is critical — without upper teeth we cannot evaluate the smile)
- Shows ONLY the upper teeth with lower arch hidden
- Shows only a tiny segment (fewer than 4 teeth clearly visible)
- Too blurry to distinguish tooth edges or surface detail
- Teeth obscured by hands, tongue, food, or heavy lipstick/gloss glare
- Extreme side angle where most teeth are hidden
- Not actually a mouth / smile photo
- Too dark or silhouetted to assess color

RESPOND in this exact shape:
{
  "usable": true | false,
  "reason": "short phrase describing why if not usable (empty string if usable)",
  "hint": "one short sentence instructing the patient how to retake — specific, warm, actionable (empty string if usable)"
}

Examples of good hints:
- "Please retake your photo showing BOTH your upper and lower teeth together, with a natural smile, in good light."
- "Try again with the photo a little closer and in brighter light so we can see each tooth clearly."
- "Please retake with your lips open and teeth slightly apart so we can see your full smile."`;

// ─────────────────────────────────────────────
// OBSERVE PASS — pure visual description, no treatments
// ─────────────────────────────────────────────
const OBSERVE_PROMPT = `You are a dental photo observer. You describe ONLY what is clearly visible in the image.

RULES — read carefully:
- You do NOT recommend treatments. You do NOT mention any treatment name.
- You do NOT know what page the patient is viewing. Context is irrelevant.
- You list only findings you can literally point to in the pixels.
- For every finding, you must write one specific evidence sentence describing what you actually see.
- If you cannot write a specific evidence sentence, you MUST NOT include the finding.
- It is completely valid to return an empty findings array.
- Do NOT invent a missing tooth from a dark interdental space — a missing tooth means no crown is visible where one should be.
- Do NOT call a shadow "staining". Staining means visible brown/yellow/grey discoloration on the tooth surface.
- Do NOT call a tilt "crowding" unless teeth are visibly overlapping or rotated out of arch.
- Do NOT describe anything on a side of the arch you cannot see.

RETURN ONLY JSON. No markdown. No backticks. Start with { and end with }.

ALLOWED finding codes (use ONLY these):
- missing_tooth — a crown is absent where one should be; a clear gap in the arch
- crowding — teeth visibly overlapping, pushed out of arch alignment
- rotation — one or more teeth rotated around their own axis
- spacing — visible gap(s) between teeth that are both present
- yellowing — overall warm yellow hue across multiple teeth
- staining — localized brown/grey/yellow patches on tooth surfaces
- wear — shortened, flattened, or chipped incisal edges
- chipping — a specific chip on a specific tooth
- irregular_shape — one or more teeth noticeably asymmetric or misshapen
- gum_excess — excess gum tissue / gummy smile clearly visible
- short_teeth — teeth look unusually short relative to the gumline
- darkness — one specific tooth is notably darker than its neighbors
- edge_irregularity — uneven or jagged incisal edges

ALLOWED locations:
- upper_anterior | lower_anterior | upper_left | upper_right | lower_left | lower_right | generalized

OUTPUT SCHEMA:
{
  "visible_findings": [
    {
      "code": "one of the allowed codes above",
      "location": "one of the allowed locations above",
      "severity": "mild" | "moderate" | "severe",
      "evidence": "one sentence describing literally what you see that supports this finding"
    }
  ],
  "photo_adequacy": {
    "upper_arch_visible": true | false,
    "lower_arch_visible": true | false,
    "teeth_count_visible": approximate integer,
    "focus_adequate": true | false,
    "lighting_adequate": true | false,
    "notes": "one short sentence"
  }
}

Empty visible_findings is valid. Be precise and conservative.`;

// ─────────────────────────────────────────────
// RECOMMEND PASS — evidence-locked treatment matching
// ─────────────────────────────────────────────
const RECOMMEND_PROMPT = `You are a cosmetic dental treatment consultant and conversion writer for Agoura Hills Dental Designs (Drs. David & Shawn Matian, (818) 706-6077) — a premium COSMETIC dental practice.

You will receive:
1. A JSON object of VERIFIED visible findings from a photo (already observed separately).
2. The current service page the patient is viewing (pagePath) — OPTIONAL context.

RETURN ONLY a valid JSON object. No markdown. No backticks. Start with { and end with }.

━━━ IRON-CLAD RULES ━━━
1. You may ONLY recommend treatments that address findings present in visible_findings.
2. If visible_findings is empty → return the "inconclusive" response (schema below). Do not invent findings.
3. You may NEVER describe a finding that is not in visible_findings. If the AI observer did not list it, you cannot see it.
4. pagePath is a HINT about patient interest — it does NOT add findings. If pagePath suggests a treatment but no finding supports that treatment, you must NOT recommend it.
5. pagePath can be used to:
   (a) ORDER two already-valid recommendations so the page's service appears first when both fit
   (b) Adjust tone/language to acknowledge patient intent
   It cannot:
   (a) Add a treatment that no finding supports
   (b) Change the underlying clinical priority

━━━ TREATMENT MATCHING TABLE ━━━
Each treatment requires specific findings to be legitimate:

- "veneers" → requires ≥2 STRUCTURAL findings: wear, chipping, irregular_shape, edge_irregularity, short_teeth. Color (yellowing/staining) and alignment (crowding/spacing/rotation) DO NOT count toward this threshold — those are addressable with whitening + Invisalign respectively.
  Veneers restore color, shape, length, and symmetry in one treatment — ideal for compound aesthetic presentations.

- "whitening" → requires yellowing OR staining as a finding; AND no severe wear/chipping/shape issues
  Whitening only addresses color. It does not fix shape.

- "invisalign" → requires crowding OR rotation OR spacing (moderate or severe); AND no wear/chipping/irregular_shape
  If color/wear/shape are also findings, Invisalign ALONE is inadequate.

- "invisalign_whitening" → requires crowding/rotation/spacing AND yellowing/staining; AND no wear/shape issues

- "bonding" → requires ≤2 chipping/edge_irregularity findings; small localized repair only

- "gum_contouring" → requires gum_excess
  If gum_excess is present, it takes priority for BEST OPTION.

- "implant_single" → requires exactly 1 missing_tooth finding
- "implant_bridge" → requires missing_tooth findings in adjacent positions
- "implant_multiple" → requires multiple missing_tooth findings in separate areas
- "all_on_4" → requires extensive breakdown with multiple missing_tooth + severe wear (use sparingly)

━━━ PRIORITIZATION (when multiple valid treatments exist) ━━━

CORE PRINCIPLE: Recommend the LEAST INVASIVE path that addresses the visible findings. Veneers are a permanent, expensive procedure — only recommend them as BEST when conservative options can't address the actual findings. The practice's in-person exam is what determines whether veneers are appropriate; a phone photo is not enough to commit a patient to drilling down their natural teeth.

1. missing_tooth findings → implants win (patient cannot smile without addressing it)

2. gum_excess clearly visible → gum_contouring is BEST

3. Color + alignment combo (yellowing/staining AND crowding/rotation/spacing):
   → BEST: "Professional Whitening"
   → ALTERNATIVE: "Invisalign"
   → Rationale: address color first (low effort, fast result), straighten with clear aligners if patient wants alignment fixed too. The dentist will determine in-person whether veneers are warranted.

4. Color only (yellowing/staining, no alignment issues, no shape/wear):
   → BEST: "Professional Whitening"
   → ALTERNATIVE: "Take-Home Whitening Trays"

5. Alignment only (crowding/rotation/spacing, no color, no shape/wear):
   → BEST: "Invisalign"
   → ALTERNATIVE: "Professional Whitening" (mention it as a fast cosmetic boost)

6. Structural findings present (wear, chipping, irregular_shape, edge_irregularity, short_teeth):
   → BEST: "Bonding" (for small localized issues) OR "Porcelain Veneers" (for multiple structural findings affecting front teeth)
   → ALTERNATIVE: another conservative option (whitening, contouring)
   → Veneers are appropriate here because conservative options cannot reshape teeth.

7. Compound case (color + alignment + structural):
   → BEST: "Porcelain Veneers" only if structural issues affect 2+ front teeth visibly
   → Otherwise: BEST = "Professional Whitening", ALTERNATIVE = "Invisalign", and mention veneers as something to discuss at the in-person exam

VENEERS GUARDRAIL: Never recommend veneers as BEST when the only findings are color + alignment. Color and alignment are reversible/correctable conservatively. Veneers must be reserved for cases with visible STRUCTURAL findings (wear, chipping, shape).

After applying 1-7, if pagePath matches a valid treatment in your top 2, surface that one first.

━━━ TONE ━━━
Warm, confident, premium, specific, emotionally persuasive, visually grounded. Under 150 words total.
Never use: "maybe", "might", "possibly", "could be", "healthy teeth and gums", "great bone structure", "transform", "journey", "confidence".
No phone numbers in cta. No URLs anywhere.

━━━ OUTPUT SCHEMA (normal case) ━━━
{
  "headline": "One sentence. Start positive. Reference the most prominent finding and the improvement possible.",
  "bullets": [
    "Most dominant finding — one line, grounded in what the observer saw",
    "Second observation (if any) — one line",
    "One positive foundation point — only if supported by photo_adequacy or a finding"
  ],
  "plan": {
    "best_option": "BEST OPTION — Treatment Name",
    "best_detail": "One sentence explaining the benefit for THIS smile based on the findings.",
    "alternative": "ALTERNATIVE — Treatment Name",
    "alt_detail": "One sentence explaining why this alternative fits THIS smile."
  },
  "ideal_result": "Max 2 short sentences. Emotional, visual, specific.",
  "cta": "One short sentence. Easy, low-pressure invitation to book a free consultation.",
  "treatments": [
    {"id": "treatment_id_from_table", "label": "Display Name"}
  ],
  "urgency": "standard" | "soon" | "priority"
}

━━━ OUTPUT SCHEMA (visible_findings is empty or photo is inconclusive) ━━━
{
  "headline": "Your smile looks healthy on camera — an in-person consultation will show you what's possible.",
  "bullets": [
    "Nothing specific jumped out from this photo that requires cosmetic treatment",
    "A full evaluation in our office gives the most accurate picture"
  ],
  "plan": {
    "best_option": "BEST OPTION — Free In-Office Consultation",
    "best_detail": "We'll take proper clinical photos and walk through any enhancement you're considering.",
    "alternative": "",
    "alt_detail": ""
  },
  "ideal_result": "You'll leave with a clear, personalized picture of what would actually enhance your smile — no pressure, no guesswork.",
  "cta": "Book your free consultation — we'll show you exactly what's possible.",
  "treatments": [],
  "urgency": "standard"
}

━━━ SELF-CHECK ━━━
1. Did I add any finding not in visible_findings? → remove it
2. Did I recommend any treatment not supported by findings? → remove it
3. Did pagePath cause me to invent evidence? → revert
4. Does BEST OPTION actually address the most prominent finding?
5. Is every bullet grounded in a specific finding from the observer?
6. Total word count under 150?`;

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
      ], 150);
      const qData = await qRes.json();
      const qRaw = (qData?.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const qParsed = JSON.parse(qRaw);
      if (qParsed && qParsed.usable === false) {
        return new Response(JSON.stringify({
          retake_required: true,
          reason: qParsed.reason || 'We need a clearer photo to give you an accurate result.',
          hint: qParsed.hint || 'Please retake your photo showing both your upper and lower teeth together, with a natural smile, in good light.',
        }), { status: 200, headers });
      }
    } catch (e) {
      // If quality gate fails, continue — don't block analysis
      console.warn('[smileAnalysis v13] quality gate skipped:', e.message);
    }

    // ── PASS 1: OBSERVE (no treatment vocabulary, no page context) ──
    let findings = { visible_findings: [], photo_adequacy: {} };
    try {
      const obsRes = await callClaude(apiKey, OBSERVE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Describe what you can literally see in this smile photo.' },
      ], 700);
      const obsData = await obsRes.json();
      const obsRaw = (obsData?.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      findings = JSON.parse(obsRaw);
      console.log('[smileAnalysis v13] findings:', JSON.stringify(findings).substring(0, 400));
    } catch (e) {
      console.error('[smileAnalysis v13] observe pass error:', e.message);
      // If observation fails, return graceful fallback
      return new Response(JSON.stringify({
        emergency: false,
        headline: "Your smile looks healthy on camera — an in-person consultation will show you what's possible.",
        bullets: ['A proper in-office evaluation gives the most accurate picture.'],
        plan: [{ label: 'BEST OPTION — Free In-Office Consultation', treatment: 'Free In-Office Consultation', detail: 'We\'ll take proper clinical photos and walk through any enhancement you\'re considering.', id: 'consultation' }],
        ideal_result: 'You\'ll leave with a clear picture of what would actually enhance your smile.',
        cta: 'Book your free consultation — we\'ll show you exactly what\'s possible.',
        treatments: [],
        urgency: 'standard',
      }), { status: 200, headers });
    }

    // ── HEALTH TRIAGE — silent backend signal only [v13] ─────────
    // Runs after OBSERVE. Result is NEVER shown to the patient —
    // it's attached to the response as a private `_pathology_flag`
    // that the widget forwards to GHL via webhook customField.
    // The practice can use this during chart prep to flag a lead
    // for clinical review. Patient experience stays cosmetic.
    let healthFlag = null;
    try {
      const hRes = await callClaude(apiKey, HEALTH_TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Screen for visible dental pathology.' },
      ], 200);
      const hData = await hRes.json();
      const hRaw = (hData?.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      healthFlag = JSON.parse(hRaw);
      console.log('[smileAnalysis v13] health triage (backend-only):', JSON.stringify(healthFlag));
    } catch (e) {
      console.warn('[smileAnalysis v13] health triage skipped:', e.message);
      healthFlag = null;
    }

    // NOTE: missing_tooth is handled by the RECOMMEND_PROMPT itself
    // (see treatment matching table). No special bypass needed at
    // the handler level since pathology no longer blocks UX.

    // ── PASS 2: RECOMMEND (evidence-locked, pagePath for ordering only) ──
    const recommendInput = JSON.stringify({
      findings: findings,
      pagePath: pagePath || null,
    });

    const recRes = await callClaude(apiKey, RECOMMEND_PROMPT, [
      { type: 'text', text: `Verified observer findings and patient context:\n\n${recommendInput}\n\nProduce the recommendation JSON.` },
    ], 1000);

    const recData = await recRes.json();
    const recRaw = (recData?.content?.[0]?.text || '').trim();

    console.log('[smileAnalysis v13] pagePath:', pagePath, 'rec raw:', recRaw.substring(0, 200));

    if (!recRaw) throw new Error('Empty recommendation response');

    let parsed;
    try {
      const cleaned = recRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch(e) {
      console.error('[smileAnalysis v13] parse error:', e.message);
      return new Response(JSON.stringify({
        emergency: false,
        headline: "Your smile has real potential.",
        bullets: ["An in-office consultation will give you the clearest picture."],
        plan: [],
        ideal_result: "Come in for a free consultation — we'll walk you through everything in person.",
        cta: "Book your free consultation and we'll show you exactly what's possible.",
        treatments: [],
        urgency: 'standard',
      }), { status: 200, headers });
    }

    // ── VENEERS GUARDRAIL [v13.1] ──────────────────────────
    // Even with the prompt update, the AI sometimes still picks
    // veneers as BEST when the only findings are color + alignment.
    // Veneers are permanent and expensive — only the in-person exam
    // should commit a patient to that path. If we detect the AI
    // recommended veneers without supporting STRUCTURAL findings,
    // we silently swap to Whitening (BEST) + Invisalign (ALT).
    try {
      const findingCodes = (findings?.visible_findings || []).map(f => f.code || '');
      const STRUCTURAL = ['wear', 'chipping', 'irregular_shape', 'edge_irregularity', 'short_teeth'];
      const structuralCount = findingCodes.filter(c => STRUCTURAL.includes(c)).length;

      const hasColor = findingCodes.includes('yellowing') || findingCodes.includes('staining');
      const hasAlignment = findingCodes.includes('crowding') || findingCodes.includes('rotation') || findingCodes.includes('spacing');

      const bestRaw = ((parsed.plan && parsed.plan.best_option) || '').toLowerCase();
      const bestIsVeneers = bestRaw.includes('veneer');

      // Trigger swap: AI picked veneers but findings don't support it
      if (bestIsVeneers && structuralCount < 2) {
        console.log('[smileAnalysis v13.1] veneers guardrail tripped — swapping to whitening/invisalign');

        if (hasColor && hasAlignment) {
          // Color + alignment → whitening best, invisalign alt
          parsed.plan = {
            best_option: 'BEST OPTION — Professional Whitening',
            best_detail: 'A professional whitening treatment can dramatically brighten the visible discoloration in just one or two visits, addressing the color concern as the first step.',
            alternative: 'ALTERNATIVE — Invisalign',
            alt_detail: 'Clear aligners gently and discreetly correct alignment over time. Many patients combine the two for a complete refresh — your in-office consultation will confirm the right path for you.',
          };
          parsed.treatments = [
            { id: 'whitening', label: 'Professional Whitening' },
            { id: 'invisalign', label: 'Invisalign' },
          ];
        } else if (hasColor) {
          // Color only → whitening best, take-home alt
          parsed.plan = {
            best_option: 'BEST OPTION — Professional Whitening',
            best_detail: 'In-office whitening delivers the most dramatic results in a single visit, addressing the visible discoloration directly.',
            alternative: 'ALTERNATIVE — Take-Home Whitening Trays',
            alt_detail: 'Custom trays let you whiten gradually at home over a few weeks for the same end result with more flexibility.',
          };
          parsed.treatments = [
            { id: 'whitening', label: 'Professional Whitening' },
            { id: 'whitening_takehome', label: 'Take-Home Whitening Trays' },
          ];
        } else if (hasAlignment) {
          // Alignment only → invisalign best
          parsed.plan = {
            best_option: 'BEST OPTION — Invisalign',
            best_detail: 'Clear aligners discreetly correct the alignment over time without metal brackets, producing a straighter, more even smile.',
            alternative: 'ALTERNATIVE — Professional Whitening',
            alt_detail: 'A whitening treatment can be a complementary cosmetic boost during or after orthodontic treatment.',
          };
          parsed.treatments = [
            { id: 'invisalign', label: 'Invisalign' },
            { id: 'whitening', label: 'Professional Whitening' },
          ];
        }
        // If no clear findings at all, leave parsed as-is (rare edge case)
      }
    } catch (e) {
      console.warn('[smileAnalysis v13.1] guardrail error:', e.message);
    }

    // Normalise plan field — handle nested format from RECOMMEND pass
    const plan = parsed.plan || {};
    const planArray = [];
    if (plan.best_option) {
      planArray.push({
        label: plan.best_option,
        treatment: plan.best_option.replace(/^BEST OPTION\s*[—-]\s*/i, ''),
        id: (parsed.treatments && parsed.treatments[0]) ? parsed.treatments[0].id : 'consultation',
        detail: plan.best_detail || '',
      });
    }
    if (plan.alternative) {
      planArray.push({
        label: plan.alternative,
        treatment: plan.alternative.replace(/^ALTERNATIVE\s*[—-]\s*/i, ''),
        id: (parsed.treatments && parsed.treatments[1]) ? parsed.treatments[1].id : '',
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
      // ─── BACKEND SIGNALS (not rendered to patient) ───
      // Widget forwards these to GHL via webhook customField
      // so the practice can flag leads for clinical review.
      _findings: findings,
      _pathology_flag: healthFlag,
    }), { status: 200, headers });

  } catch (err) {
    console.error('[smileAnalysis v13] error:', err.message);
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
