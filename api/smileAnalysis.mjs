// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v12 — Dual-mode architecture (cosmetic preview + clinical triage)
//   Mode A: cosmetic_preview — top-funnel lead capture, positive tone,
//             no pathology language, ungated by health flags
//   Mode B: clinical_triage  — full safety pipeline (existing behavior)
//   Pass 0:  TRIAGE — frank emergency screen
//   Pass 0b: HEALTH — pathology screen (TIGHTENED — 2+ indicators
//             required for soft signs; missing-tooth bypasses pathology
//             gate so replacement cases convert)
//   Pass 1:  OBSERVE — pure visual findings, no treatment vocabulary
//   Pass 2:  RECOMMEND — map verified findings to treatments
//   Missing-tooth override: enforces implant + bridge as the answer,
//   regardless of what RECOMMEND returns. Prevents the AI from
//   defaulting to whitening/Invisalign when a tooth is missing.

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

Be honest and clinically conservative. When uncertain whether a soft sign is real or just photo artifact, return pathology:false. The cosmetic and clinical pipelines downstream will handle ambiguous cases appropriately.`;

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

- "veneers" → requires ≥2 of: yellowing, staining, wear, short_teeth, chipping, irregular_shape, edge_irregularity, crowding (mild), spacing (mild)
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
1. missing_tooth findings → implants win (patient cannot smile without addressing it)
2. gum_excess clearly visible → gum_contouring is BEST
3. Compound aesthetic (≥2 of yellowing/wear/shape/chipping/crowding) → veneers
4. Moderate+ crowding/rotation + otherwise-clean teeth → invisalign
5. Color only → whitening
6. Small localized chips only → bonding

After applying 1-6, if pagePath matches a valid treatment in your top 2, surface that one first.

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
// COSMETIC RECOMMEND — top-funnel lead capture mode [v12]
// Positive, visually grounded, no pathology language.
// Used by /smile-preview entry point for ungated lead capture.
// ─────────────────────────────────────────────
const COSMETIC_RECOMMEND_PROMPT = `You are a cosmetic smile consultant.

You will receive VERIFIED visible findings from a smile photo.

RETURN ONLY JSON. No markdown. No backticks.

━━━ RULES ━━━
1. You may ONLY reference findings in visible_findings.
2. You do NOT diagnose or mention disease.
3. You do NOT create urgency.
4. You focus on how the smile could look more balanced, even, or refined.
5. Be positive, specific, and visually grounded.

━━━ OUTPUT ━━━
{
  "headline": "Positive sentence about how the smile could be improved",
  "insights": [
    "Observation 1 based on visible finding",
    "Observation 2 based on visible finding"
  ],
  "improvements": [
    "What could be improved visually (aligned with findings)",
    "Another improvement angle"
  ],
  "options": [
    {"id": "treatment_id", "label": "Treatment Name"}
  ],
  "cta": "Short curiosity-driven line inviting next step"
}

━━━ TREATMENT RULES ━━━
- spacing/crowding → Invisalign
- yellowing/staining → Whitening
- shape/wear/chipping → Bonding or Veneers
- missing_tooth → Tooth Replacement (implant or bridge)

If missing_tooth is in the findings:
- ALWAYS include BOTH in options:
  - {"id": "implant_single", "label": "Dental Implant"}
  - {"id": "bridge", "label": "Dental Bridge"}

━━━ TONE ━━━
- No "needs attention"
- No "problem"
- No "disease"
- No "urgency"
- Speak like a high-end cosmetic consult
- Use language like "there appears to be" instead of "may be"

Max 120 words across all fields.`;

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
    const {
      imageBase64,
      mediaType,
      mode = 'clinical_triage',
      treatmentLabel,
      pagePath,
    } = await req.json();

    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({
        error: 'Missing image data. Please try again.',
      }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'Service unavailable. Call (818) 706-6077.',
      }), { status: 500, headers });
    }

    const imageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: imageBase64,
      },
    };

    // ─────────────────────────────────────
    // DEEP DIVE — explain a specific treatment
    // ─────────────────────────────────────
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `Explain this treatment for this patient: ${treatmentLabel}` },
      ], 500);
      const data = await res.json();
      const text = (data?.content?.[0]?.text || '').trim()
        || 'Call (818) 706-6077 for details.';
      return new Response(JSON.stringify({ analysis: text }), {
        status: 200,
        headers,
      });
    }

    // ─────────────────────────────────────
    // QUALITY GATE — runs in both modes
    // ─────────────────────────────────────
    const qualityResult = await assessPhotoQuality(apiKey, imageContent);
    if (qualityResult?.usable === false) {
      return new Response(JSON.stringify({
        retake_required: true,
        reason: qualityResult.reason || 'We need a clearer photo to give you an accurate result.',
        hint: qualityResult.hint || 'Please retake your photo showing both your upper and lower teeth together, with a natural smile, in good light.',
      }), { status: 200, headers });
    }

    // ─────────────────────────────────────
    // OBSERVE — evidence-first, no treatment vocabulary
    // ─────────────────────────────────────
    const findings = await observeSmile(apiKey, imageContent);
    const visibleFindings = Array.isArray(findings?.visible_findings)
      ? findings.visible_findings
      : [];
    const hasMissingTooth = visibleFindings.some(f => f.code === 'missing_tooth');

    // ═══════════════════════════════════════════════════════
    // MODE A: COSMETIC PREVIEW
    // Top-funnel lead capture. No emergency language. No
    // pathology gating. Returns positive cosmetic options.
    // ═══════════════════════════════════════════════════════
    if (mode === 'cosmetic_preview') {
      const cosmeticInput = JSON.stringify({
        findings,
        pagePath: pagePath || null,
      });

      const cosmeticRes = await callClaude(apiKey, COSMETIC_RECOMMEND_PROMPT, [
        {
          type: 'text',
          text: `Verified visible findings:\n\n${cosmeticInput}\n\nProduce the cosmetic preview JSON.`,
        },
      ], 700);

      const cosmeticData = await cosmeticRes.json();
      const raw = (cosmeticData?.content?.[0]?.text || '').trim();
      let parsed = safeJsonParse(raw) || buildFallbackCosmeticPreview();
      parsed = enforceTreatmentRules(parsed, findings);

      return new Response(JSON.stringify({
        mode: 'cosmetic_preview',
        emergency: false,
        clinical_priority: hasMissingTooth ? 'tooth_replacement' : 'cosmetic',
        headline: parsed.headline || '',
        insights: parsed.insights || [],
        improvements: parsed.improvements || [],
        options: parsed.options || parsed.treatments || [],
        cta: parsed.cta || 'See what your personalized smile options could look like.',
        treatments: parsed.treatments || parsed.options || [],
        urgency: hasMissingTooth ? 'priority' : 'standard',
        _findings: findings,
      }), { status: 200, headers });
    }

    // ═══════════════════════════════════════════════════════
    // MODE B: CLINICAL TRIAGE (default)
    // Full safety pipeline + evidence-locked treatment matching
    // ═══════════════════════════════════════════════════════

    // Pass 0: Emergency screen
    const triage = await assessEmergencySafety(apiKey, imageContent);
    if (triage?.safe === false) {
      const res = await callClaude(apiKey, EMERGENCY_PROMPT, [
        imageContent,
        { type: 'text', text: 'Write the urgent message.' },
      ], 400);
      const data = await res.json();
      const text = (data?.content?.[0]?.text || '').trim()
        || 'Your photo shows something that should be checked promptly. Call (818) 706-6077 — same-day appointments available, consultation is free.';
      return new Response(JSON.stringify({
        mode: 'clinical_triage',
        emergency: true,
        clinical_priority: 'emergency',
        urgency: 'priority',
        analysis: text,
        treatments: [],
        _findings: findings,
      }), { status: 200, headers });
    }

    // Pass 0b: Health pathology screen
    // CRITICAL: missing-tooth bypasses pathology gate — replacement
    // cases must continue to the recommendation pipeline so we don't
    // lose implant/bridge leads behind generic "see us in person" copy.
    const healthFlag = await assessHealthPathology(apiKey, imageContent);

    if (healthFlag?.pathology === true && !hasMissingTooth) {
      const res = await callClaude(apiKey, PATHOLOGY_PROMPT_BUILDER(healthFlag), [
        imageContent,
        { type: 'text', text: 'Write the patient message.' },
      ], 400);
      const data = await res.json();
      const text = (data?.content?.[0]?.text || '').trim()
        || 'Your photo shows something we should look at in person. Call (818) 706-6077 — same-week appointments available, your consultation is free.';
      return new Response(JSON.stringify({
        mode: 'clinical_triage',
        emergency: false,
        clinical_priority: 'health_first',
        urgency: 'priority',
        analysis: text,
        treatments: [],
        _pathology: healthFlag,
        _findings: findings,
      }), { status: 200, headers });
    }

    // Pass 2: Evidence-locked recommendation
    const recommendInput = JSON.stringify({
      findings,
      pagePath: pagePath || null,
      healthFlag: healthFlag || null,
    });

    const recRes = await callClaude(apiKey, RECOMMEND_PROMPT, [
      {
        type: 'text',
        text: `Verified observer findings and patient context:\n\n${recommendInput}\n\nProduce the recommendation JSON.`,
      },
    ], 1000);

    const recData = await recRes.json();
    const recRaw = (recData?.content?.[0]?.text || '').trim();
    let parsed = safeJsonParse(recRaw) || buildFallbackClinicalRecommendation();
    parsed = enforceTreatmentRules(parsed, findings);

    const planArray = normalizePlan(parsed);

    return new Response(JSON.stringify({
      mode: 'clinical_triage',
      emergency: false,
      clinical_priority: hasMissingTooth ? 'tooth_replacement' : 'cosmetic',
      headline: parsed.headline || '',
      bullets: parsed.bullets || [],
      plan: planArray,
      ideal_result: parsed.ideal_result || '',
      cta: parsed.cta || "Book your free consultation and we'll show you exactly what's possible.",
      treatments: parsed.treatments || [],
      urgency: hasMissingTooth ? 'priority' : (parsed.urgency || 'standard'),
      _pathology: healthFlag || null,
      _findings: findings,
    }), { status: 200, headers });

  } catch (err) {
    console.error('[smileAnalysis v12] handler error:', err.message);
    return new Response(JSON.stringify({
      error: 'Something went wrong. Call (818) 706-6077.',
    }), { status: 500, headers });
  }
}

// ─────────────────────────────────────────────
// HELPERS [v12]
// ─────────────────────────────────────────────

async function assessPhotoQuality(apiKey, imageContent) {
  try {
    const qRes = await callClaude(apiKey, QUALITY_PROMPT, [
      imageContent,
      { type: 'text', text: 'Assess photo quality for smile analysis.' },
    ], 150);
    const qData = await qRes.json();
    const raw = (qData?.content?.[0]?.text || '').trim();
    return safeJsonParse(raw);
  } catch (e) {
    console.warn('[smileAnalysis v12] quality gate skipped:', e.message);
    return { usable: true };
  }
}

async function observeSmile(apiKey, imageContent) {
  try {
    const obsRes = await callClaude(apiKey, OBSERVE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Describe what you can literally see in this smile photo.' },
    ], 700);
    const obsData = await obsRes.json();
    const raw = (obsData?.content?.[0]?.text || '').trim();
    const parsed = safeJsonParse(raw);
    if (!parsed) throw new Error('Invalid observe JSON');
    return parsed;
  } catch (e) {
    console.error('[smileAnalysis v12] observe pass error:', e.message);
    return {
      visible_findings: [],
      photo_adequacy: { notes: 'Observation could not be completed reliably.' },
    };
  }
}

async function assessEmergencySafety(apiKey, imageContent) {
  try {
    const triageRes = await callClaude(apiKey, TRIAGE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Assess this image.' },
    ], 30);
    const triageData = await triageRes.json();
    const raw = (triageData?.content?.[0]?.text || '').trim();
    const parsed = safeJsonParse(raw);
    return parsed || { safe: true };
  } catch {
    return { safe: true };
  }
}

async function assessHealthPathology(apiKey, imageContent) {
  try {
    const hRes = await callClaude(apiKey, HEALTH_TRIAGE_PROMPT, [
      imageContent,
      { type: 'text', text: 'Screen for visible dental pathology.' },
    ], 200);
    const hData = await hRes.json();
    const raw = (hData?.content?.[0]?.text || '').trim();
    return safeJsonParse(raw);
  } catch (e) {
    console.warn('[smileAnalysis v12] health triage skipped:', e.message);
    return null;
  }
}

function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function hasFinding(findings, code) {
  return Array.isArray(findings?.visible_findings)
    && findings.visible_findings.some(f => f.code === code);
}

function normalizePlan(parsed) {
  if (Array.isArray(parsed.plan)) return parsed.plan;
  const plan = parsed.plan || {};
  const planArray = [];
  if (plan.best_option) {
    planArray.push({
      label: plan.best_option,
      treatment: plan.best_option.replace(/^BEST OPTION\s*[—-]\s*/i, ''),
      id: parsed.treatments?.[0]?.id || '',
      detail: plan.best_detail || '',
    });
  }
  if (plan.alternative) {
    planArray.push({
      label: plan.alternative,
      treatment: plan.alternative.replace(/^ALTERNATIVE\s*[—-]\s*/i, ''),
      id: parsed.treatments?.[1]?.id || '',
      detail: plan.alt_detail || '',
    });
  }
  return planArray;
}

// Missing-tooth override: when a missing tooth is in the verified
// findings, force implant + bridge as the recommendation. Prevents
// the AI from defaulting to whitening/Invisalign when the actual
// problem is a gap. Applies to both cosmetic_preview and clinical
// modes — both should agree on the answer.
function enforceTreatmentRules(parsed, findings) {
  const hasMissingTooth = hasFinding(findings, 'missing_tooth');
  if (!parsed || typeof parsed !== 'object') parsed = {};
  if (!hasMissingTooth) return parsed;

  parsed.headline = parsed.headline
    || 'There appears to be a visible space where a tooth is missing, and replacing it could make a major difference in your smile.';

  parsed.bullets = [
    'There appears to be a visible gap where a tooth is missing',
    'Replacing the tooth is usually the first step before cosmetic refinements',
    'An in-person exam can confirm whether an implant or bridge is the better fit',
  ];

  parsed.plan = {
    best_option: 'BEST OPTION — Dental Implant',
    best_detail: 'A dental implant can replace the missing tooth with a natural-looking result that does not rely on neighboring teeth.',
    alternative: 'ALTERNATIVE — Dental Bridge',
    alt_detail: 'A bridge can also close the space by using the neighboring teeth for support.',
  };

  parsed.ideal_result = 'The goal is to restore the missing tooth so the smile looks complete, natural, and balanced again.';
  parsed.cta = "Book your free consultation and we'll walk you through implant and bridge options.";

  parsed.treatments = [
    { id: 'implant_single', label: 'Dental Implant' },
    { id: 'bridge', label: 'Dental Bridge' },
  ];
  parsed.options = parsed.treatments;
  parsed.urgency = 'priority';

  // Cosmetic-mode-specific fields (insights/improvements)
  if (!parsed.insights || !parsed.insights.length) {
    parsed.insights = [
      'A visible space is the first thing the eye notices in a smile',
      'Restoring it can dramatically rebalance the entire smile line',
    ];
  }
  if (!parsed.improvements || !parsed.improvements.length) {
    parsed.improvements = [
      'A complete, even smile line',
      'Restored confidence when speaking and smiling',
    ];
  }

  return parsed;
}

function buildFallbackCosmeticPreview() {
  return {
    headline: 'Your smile has real potential, and an in-person consultation can show what would enhance it most.',
    insights: [
      'A photo can highlight visible cosmetic opportunities',
      'A full evaluation gives the most accurate treatment options',
    ],
    improvements: [
      'A more balanced smile appearance',
      'A clearer plan based on professional photos and an exam',
    ],
    options: [
      { id: 'consultation', label: 'Free Cosmetic Consultation' },
    ],
    treatments: [
      { id: 'consultation', label: 'Free Cosmetic Consultation' },
    ],
    cta: 'See what your personalized smile options could look like.',
  };
}

function buildFallbackClinicalRecommendation() {
  return {
    headline: "Your smile looks healthy on camera — an in-person consultation will show you what's possible.",
    bullets: [
      'Nothing specific jumped out from this photo that requires cosmetic treatment',
      'A full evaluation in our office gives the most accurate picture',
    ],
    plan: {
      best_option: 'BEST OPTION — Free In-Office Consultation',
      best_detail: "We'll take proper clinical photos and walk through any enhancement you're considering.",
      alternative: '',
      alt_detail: '',
    },
    ideal_result: "You'll leave with a clear, personalized picture of what would actually enhance your smile — no pressure, no guesswork.",
    cta: "Book your free consultation — we'll show you exactly what's possible.",
    treatments: [],
    urgency: 'standard',
  };
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
