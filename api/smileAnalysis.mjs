// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v13.6.1 — Missing-tooth SHORT-CIRCUIT (decisive routing) + audit fixes
//   v13.5 ran detector but still trusted OBSERVE/RECOMMEND for the
//   final answer. Result: detector saw missing tooth, OBSERVE missed it,
//   RECOMMEND returned generic "consult" fallback. Patient saw
//   "Your smile looks healthy" on a photo with an obvious missing tooth.
//
//   v13.6 strategy: when dedicated detector confirms missing tooth,
//   SHORT-CIRCUIT to a hard-coded implant/bridge response. Don't trust
//   OBSERVE/RECOMMEND for missing-tooth cases at all — they are not
//   reliable for this finding category.
//
//   v13.6.1 audit fixes:
//   - Treatment ID corrected: "bridge" → "implant_bridge" to match
//     existing GHL tags and RECOMMEND treatment vocabulary
//   - Detector prompt stronger: "False positives acceptable, false
//     negatives are not" instead of "When uncertain, FLAG IT"
//
//   Detector prompt is aggressive: false positives are far less costly
//   than false negatives for missing-tooth detection (lost implant/
//   bridge case = $3-5K loss vs. minor friction on a diastema case).
//
//   v13 features preserved: silent pathology, whitening-first,
//   loosened quality gate, gum_excess filter.
//   Same response shape — widget unchanged.

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
const QUALITY_PROMPT = `You are a dental photo quality reviewer. Your ONLY job is to reject photos that are SO unusable that no analysis is possible. You are NOT a clinical photo reviewer — patients are sending casual smartphone selfies, not orthodontic records.

RETURN ONLY JSON. No markdown.

═══ CRITICAL RULE ═══
DEFAULT TO usable=true. The OBSERVE pass downstream is fine working with partial visibility — it will simply return fewer findings if it can't see everything. False rejections destroy patient trust and conversion. ONLY reject in the cases listed below.

═══ ONLY REJECT (usable=false) IF ═══
1. Photo does not show a mouth at all (e.g., it's a ceiling, food, a pet, a closed-mouth selfie with NO teeth visible)
2. Photo is so blurry that teeth are unrecognizable as teeth (motion blur, completely out of focus)
3. Photo is so dark you cannot tell teeth from gums (pure silhouette / black frame)
4. Mouth is closed with no teeth visible at all

═══ ALWAYS ACCEPT (usable=true) IF ═══
- ANY teeth are visible, even partial — even if just upper OR just lower
- The smile is at any angle (slight tilt, side angle, head turned)
- Lighting is imperfect but teeth are still distinguishable
- The photo is a casual selfie, not a clinical photo
- Lips are partially covering the teeth but some teeth are still showing
- The image quality is "phone-grade" rather than "studio-grade"

When in doubt: usable=true. The cost of letting a borderline photo through is minor — the cost of rejecting a valid one is a lost lead.

═══ OUTPUT ═══
{
  "usable": true | false,
  "reason": "short phrase describing why if not usable (empty string if usable)",
  "hint": "one short sentence instructing the patient how to retake — specific, warm, actionable (empty string if usable)"
}

Default response: { "usable": true, "reason": "", "hint": "" }

Examples of when to REJECT (these are rare):
- An image of a wall or ceiling → usable: false, hint: "It looks like the photo didn't capture your smile — please try again with your mouth in the frame."
- A completely black image → usable: false, hint: "The photo came out too dark to see your teeth — please retake in better light."
- A pet or food photo → usable: false, hint: "We can only analyze photos of a smile — please upload a photo of your teeth."

Default to usable: true for everything else.`;

// ─────────────────────────────────────────────
// MISSING TOOTH DETECTOR — dedicated single-purpose pass [v13.5]
// OBSERVE alone keeps misclassifying obvious missing teeth as
// "spacing." A dedicated, narrow vision pass with one question
// is dramatically more accurate. Run BEFORE OBSERVE; result is
// merged into findings if positive.
// ─────────────────────────────────────────────
const MISSING_TOOTH_PROMPT = `You are a dental imaging specialist. Your ONLY job: determine if there is a MISSING TOOTH in this smile photo.

A missing tooth = a tooth that should be in the dental arch is ABSENT. There is empty space where a tooth should be. Adjacent teeth are present and flank the gap.

═══ DECISIVE DETECTION RULES ═══

You MUST flag missing_tooth_present=true if you see ANY of:
1. A clearly visible empty space in the upper or lower arch where a tooth is absent
2. A gap that is approximately the width of a normal tooth (or wider) between two present teeth
3. The tongue, palate, opposite arch, or inside-of-mouth darkness visible THROUGH a gap in the dental arch
4. A dramatic interruption in the smile line caused by an obvious missing tooth

═══ DO NOT BE OVERLY CAUTIOUS ═══

The biggest failure mode is missing an obvious missing tooth and calling it "spacing." This costs the practice high-value implant cases. Patients with visible missing teeth deserve correct identification.

When you see what LOOKS like a missing tooth, flag it. **When uncertain, classify as missing_tooth_present = true. False positives are acceptable — false negatives are not.**

Only return false if:
- The smile clearly has all teeth present and the only "gaps" are small (<2mm) interdental contacts
- It's obviously a young patient with primary teeth
- There is no gap visible at all in the visible portion of the arch

═══ OUTPUT ═══

RETURN ONLY JSON. No markdown:
{
  "missing_tooth_present": true | false,
  "confidence": "high" | "medium" | "low",
  "count": integer,
  "location": "upper_anterior" | "upper_left" | "upper_right" | "lower_anterior" | "lower_left" | "lower_right" | null,
  "evidence": "specific sentence describing exactly what you see — which area is empty and why this is a missing tooth, not spacing"
}

confidence rubric:
- "high" — the gap is unmistakable and tooth-width or wider
- "medium" — there is a visible gap that probably is missing tooth (treat as positive)
- "low" — uncertain whether gap is missing tooth or wide spacing (still flag as positive if any doubt)

If no missing tooth: { "missing_tooth_present": false, "confidence": "high", "count": 0, "location": null, "evidence": "" }`;

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

═══ MISSING TOOTH — be HONEST, not overly cautious ═══
A missing_tooth IS present when:
- You see a clear GAP in the arch where a crown is absent
- Adjacent teeth flank a visible empty space
- The dark space between teeth is wider than a normal interdental contact
- A tooth that should be there clearly is not

Do NOT skip a missing tooth because you're worried about being wrong.
If you can see a gap in the arch where a tooth visibly is not present,
flag it as missing_tooth. Patients with missing teeth deserve correct
assessment — missing this finding is far more harmful than a rare
false positive on dark shadows.

Only AVOID flagging missing_tooth if the dark space is clearly just a
narrow interdental shadow between two teeth that ARE both present and
touching at the gumline.

═══ GUM EXCESS — strict quantitative criteria ═══
A gum_excess finding (gummy smile) requires you to clearly see:
- A visibly LARGE band of pink gum tissue (≥3mm equivalent) showing
  above the upper front teeth when the patient is smiling normally
- The gums dominate the smile visually, drawing the eye more than the teeth
- The teeth themselves look short relative to how much gum shows

Do NOT flag gum_excess if:
- You only see a normal thin gum margin at the top of the teeth (this is
  anatomical baseline, EVERY mouth shows some gum margin)
- The smile shows a healthy tooth-to-gum ratio (teeth dominate visually)
- You're inferring "gummy smile" from minor gum visibility — the gum
  band must be visually dramatic to qualify
- The lip line crosses near the gum margin — that's a normal smile

When in doubt, do NOT flag gum_excess. Healthy gum margins are not
pathology and not a cosmetic concern.

═══ OTHER ANTI-HALLUCINATION RULES ═══
- Do NOT call a shadow "staining". Staining means visible brown/yellow/grey discoloration on the tooth surface.
- Do NOT call a tilt "crowding" unless teeth are visibly overlapping or rotated out of arch.
- Do NOT describe anything on a side of the arch you cannot see.

RETURN ONLY JSON. No markdown. No backticks. Start with { and end with }.

ALLOWED finding codes (use ONLY these):
- missing_tooth — a clear gap in the arch where a tooth crown is absent. Flag this whenever you can identify an empty space where a tooth should be, flanked by present teeth on either side. Do NOT skip this — patients deserve to have missing teeth identified.
- crowding — teeth visibly overlapping, pushed out of arch alignment
- rotation — one or more teeth rotated around their own axis
- spacing — visible gap(s) between teeth that are both present (NOT a missing tooth)
- yellowing — overall warm yellow hue across multiple teeth
- staining — localized brown/grey/yellow patches on tooth surfaces
- wear — shortened, flattened, or chipped incisal edges
- chipping — a specific chip on a specific tooth
- irregular_shape — one or more teeth noticeably asymmetric or misshapen
- gum_excess — DRAMATIC excess gum tissue ("gummy smile"): ≥3mm band of pink gum above the upper teeth that visually dominates the smile. Normal thin gum margins are NOT gum_excess.
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

    // ── QUALITY GATE [v13.2] ───────────────────────
    // Only honor AI rejections that match the hard-reject categories.
    // The AI vision model has a strong bias toward rejecting casual
    // selfies that ARE usable; we filter those false positives here.
    try {
      const qRes = await callClaude(apiKey, QUALITY_PROMPT, [
        imageContent,
        { type: 'text', text: 'Assess photo quality for smile analysis.' },
      ], 150);
      const qData = await qRes.json();
      const qRaw = (qData?.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const qParsed = JSON.parse(qRaw);
      if (qParsed && qParsed.usable === false) {
        // Hard-reject whitelist: only honor rejections for these reasons.
        // Patterns that trigger legitimate rejections — anything else
        // (e.g. "only lower teeth visible", "side angle", "lips covering")
        // is a false positive and we let the analysis continue.
        const reason = (qParsed.reason || '').toLowerCase();
        const hint = (qParsed.hint || '').toLowerCase();
        const combined = reason + ' ' + hint;
        const HARD_REJECT_KEYWORDS = [
          'not a mouth', 'not a smile', 'no teeth visible', 'mouth is closed',
          'completely closed', 'no mouth', 'wall', 'ceiling', 'food', 'pet',
          'too dark', 'pure black', 'silhouette', 'pitch black',
          'unrecognizable', 'extremely blurry', 'completely out of focus',
          'motion blur',
        ];
        const isHardReject = HARD_REJECT_KEYWORDS.some(kw => combined.includes(kw));

        if (isHardReject) {
          console.log('[smileAnalysis v13.2] quality gate rejected (hard):', reason);
          return new Response(JSON.stringify({
            retake_required: true,
            reason: qParsed.reason || 'We need a clearer photo to give you an accurate result.',
            hint: qParsed.hint || 'Please retake your photo showing your smile clearly.',
          }), { status: 200, headers });
        } else {
          console.log('[smileAnalysis v13.2] quality gate rejection IGNORED (false positive):', reason);
          // Fall through to analysis
        }
      }
    } catch (e) {
      // If quality gate fails, continue — don't block analysis
      console.warn('[smileAnalysis v13.2] quality gate skipped:', e.message);
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

    // ── DEDICATED MISSING-TOOTH DETECTION [v13.6] ─────────
    // OBSERVE keeps misclassifying obvious missing teeth (as spacing
    // or by returning empty findings entirely). v13.6 strategy:
    // - Run dedicated detector
    // - If it confirms missing tooth (high or medium confidence),
    //   SHORT-CIRCUIT to a hard-coded implant/bridge response.
    //   Don't trust OBSERVE → RECOMMEND for missing tooth cases at all.
    // - OBSERVE/RECOMMEND only run for non-missing-tooth cases.
    let missingToothResult = null;
    try {
      const mtRes = await callClaude(apiKey, MISSING_TOOTH_PROMPT, [
        imageContent,
        { type: 'text', text: 'Is there a missing tooth in this photo?' },
      ], 250);
      const mtData = await mtRes.json();
      const mtRaw = (mtData?.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      missingToothResult = JSON.parse(mtRaw);
      console.log('[smileAnalysis v13.6.1] missing-tooth detector:', JSON.stringify(missingToothResult));
    } catch (e) {
      console.warn('[smileAnalysis v13.6.1] missing-tooth detector skipped:', e.message);
      missingToothResult = null;
    }

    // SHORT-CIRCUIT: detector confirmed missing tooth → return implant/bridge
    // recommendation directly. This bypasses OBSERVE/RECOMMEND entirely
    // because those passes have proven unreliable on missing-tooth cases.
    if (missingToothResult?.missing_tooth_present === true) {
      console.log('[smileAnalysis v13.6.1] SHORT-CIRCUIT: missing tooth detected, returning implant/bridge response');

      const evidence = missingToothResult.evidence
        || 'A visible gap in the dental arch where a tooth is absent.';
      const count = missingToothResult.count || 1;
      const isMultiple = count > 1;

      // Inject missing_tooth into findings so GHL signals capture it
      const findingsWithMissing = {
        visible_findings: [{
          code: 'missing_tooth',
          location: missingToothResult.location || 'upper_anterior',
          severity: 'moderate',
          evidence: evidence,
        }],
        photo_adequacy: findings?.photo_adequacy || {},
      };

      return new Response(JSON.stringify({
        emergency: false,
        headline: isMultiple
          ? "There appear to be visible gaps where teeth are missing — replacing them can transform your smile."
          : "There appears to be a visible gap where a tooth is missing — replacing it can make a major difference in your smile.",
        bullets: [
          evidence,
          'Replacing a missing tooth restores function as well as appearance — chewing, speaking, and smile balance.',
          'An in-person exam will determine the best path forward and confirm everything visible in this photo.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Dental Implant',
            treatment: 'Dental Implant',
            id: 'implant_single',
            detail: 'A dental implant replaces the missing tooth with a natural-looking, fully functional result that does not rely on neighboring teeth.',
          },
          {
            label: 'ALTERNATIVE — Dental Bridge',
            treatment: 'Dental Bridge',
            id: 'implant_bridge',
            detail: 'A bridge can also close the space by anchoring a replacement tooth to the neighboring teeth.',
          },
        ],
        ideal_result: 'Restore the missing tooth so the smile looks complete, balanced, and confident again.',
        cta: "Book your free consultation and we'll walk you through implant and bridge options.",
        treatments: [
          { id: 'implant_single', label: 'Dental Implant' },
          { id: 'implant_bridge', label: 'Dental Bridge' },
        ],
        urgency: 'priority',
        // Backend signals
        _findings: findingsWithMissing,
        _pathology_flag: null,
        _missing_tooth_detector: missingToothResult,
      }), { status: 200, headers });
    }

    // ── FINDINGS GUARDRAILS [v13.4] ─────────────────────────
    // The OBSERVE pass has high false-positive rates on certain
    // findings when the photo doesn't clearly show them. We filter
    // those out here at the code level rather than trying to fight
    // the AI through prompts alone.
    if (findings && Array.isArray(findings.visible_findings)) {
      const before = findings.visible_findings.length;

      // Drop mild gum_excess findings — these are almost always
      // false positives. Real gum_excess (gummy smile) is dramatic
      // and the AI will mark it as moderate or severe.
      findings.visible_findings = findings.visible_findings.filter(f => {
        if (f.code === 'gum_excess' && f.severity === 'mild') {
          console.log('[smileAnalysis v13.4] dropped mild gum_excess (false-positive filter)');
          return false;
        }
        return true;
      });

      // If gum_excess is the ONLY finding, drop it. Real gummy
      // smiles co-occur with at least one other finding (short_teeth,
      // edge_irregularity, etc.) and a smile with literally nothing
      // else wrong wouldn't trigger a cosmetic consultation anyway.
      const gumExcessOnly = findings.visible_findings.length === 1
        && findings.visible_findings[0].code === 'gum_excess';
      if (gumExcessOnly) {
        console.log('[smileAnalysis v13.4] dropped solo gum_excess (likely false positive)');
        findings.visible_findings = [];
      }

      const after = findings.visible_findings.length;
      if (after !== before) {
        console.log('[smileAnalysis v13.4] findings filtered: ' + before + ' -> ' + after);
      }
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
