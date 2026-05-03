// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v14 — Clean separation: AI observes, code routes, templates speak
//
//   Architectural rewrite. v13.x grew to 910 lines of layered overrides
//   because the AI was making business decisions ("recommend Invisalign
//   for spacing"). Every override added complexity but didn't fix the
//   underlying problem.
//
//   v14 enforces strict layer separation:
//     LAYER 1 — AI vision: classify findings ONLY (code, location,
//               severity, confidence, evidence). No treatment vocabulary.
//     LAYER 2 — Code router: deterministic mapping from findings to
//               treatment scenario. Pure JS, no LLM.
//     LAYER 3 — Templates: fixed patient-facing copy per scenario,
//               parameterized by findings. No AI prose generation
//               for the recommendation.
//
//   Result: predictable, testable, debuggable. A finding cannot
//   "reason itself" into the wrong recommendation because the AI
//   never sees treatment names.
//
//   Preserved from v13.x:
//     - Quality gate (loosened, hard-reject keyword whitelist)
//     - True emergency triage (broken tooth, blood, swelling)
//     - Pathology as silent backend signal for GHL (never patient UI)
//     - Image compression at widget layer (4.5MB Vercel limit)
//     - Same response shape — widgets unchanged
//
//   Removed from v13.x:
//     - RECOMMEND prompt (AI generated treatment names)
//     - COSMETIC_RECOMMEND_PROMPT (never used in production)
//     - Multiple competing override blocks (veneers guardrail,
//       gum_excess filter, missing-tooth short-circuit, structural
//       heuristic) — all replaced by one deterministic router
//     - Inline buildFallback functions

export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════
// LAYER 1 — AI VISION PROMPTS (classify only, no treatment talk)
// ═══════════════════════════════════════════════════════════════

const TRIAGE_PROMPT = `You are a dental image safety screener.

Respond ONLY with JSON. Mark unsafe ONLY if clearly visible:
- Broken/fractured tooth showing dentin or pulp
- Visible bleeding or active swelling
- Trauma (split lip with tooth damage, displaced tooth)
- Deep cavity with visible decay structure

If unsafe: { "safe": false, "concern": "<short clinical phrase>" }
If smile photo with no urgent issue: { "safe": true }
If not a mouth photo: { "safe": true }

Default: { "safe": true }`;

const QUALITY_PROMPT = `You are a photo quality reviewer for casual smartphone smile selfies.

RETURN ONLY JSON.

DEFAULT TO usable=true. Only reject for these hard cases:
1. Photo is not a mouth at all (wall, ceiling, food, pet)
2. Photo is so blurry teeth are unrecognizable as teeth
3. Photo is pitch black / pure silhouette
4. Mouth is completely closed with NO teeth visible

Everything else: usable=true. Lighting, angle, partial visibility, lip
coverage — all acceptable. The downstream system handles partial info.

Output:
{ "usable": true | false, "reason": "<short>", "hint": "<actionable retake instruction>" }

Default: { "usable": true, "reason": "", "hint": "" }`;

const HEALTH_TRIAGE_PROMPT = `You are screening a casual phone-photo smile for clearly visible dental pathology.

This is NOT a clinical photo. Pink gum color, slight swelling appearance,
yellowing teeth, mild plaque film — these are normal phone-photo artifacts.
DO NOT flag them.

Only flag pathology=true for unmistakable signs:
- Frank tooth decay (visible cavitation, brown/black hole on tooth surface)
- Severe gingival recession with VISIBLY EXPOSED yellow root surface
- One tooth dramatically darker than ALL neighbors (non-vital)
- Visible abscess, fistula, or pus
- Tooth visibly displaced from arch in pathologic way

Output if pathology found:
{ "pathology": true, "category": "decay" | "endodontic" | "periodontal" | "abscess",
  "severity": "moderate" | "advanced", "primary_concern": "<short factual sentence>" }

Otherwise: { "pathology": false }

When in doubt, return pathology:false.`;

const OBSERVE_PROMPT = `You are a dental photo classifier. Your ONLY job is to identify visible findings and report them with confidence scores.

YOU DO NOT:
- Recommend any treatment
- Use any treatment vocabulary (no "Invisalign", "veneers", "implant", "whitening", "bonding")
- Suggest what should be done about findings
- Try to be helpful beyond classifying what is visible

YOU ONLY:
- Look at the image
- Identify findings from the allowed code list below
- Score your confidence
- Provide one specific evidence sentence per finding

═══ ALLOWED FINDING CODES ═══

missing_tooth — A tooth-width or wider gap in the dental arch where no
  crown is present. The teeth flanking the gap are present. The dark
  space behind the gap may show tongue, opposite arch, or mouth interior.
  RULE: A gap of approximately tooth-width or wider counts as missing_tooth
  even if you cannot be 100% certain whether it's spacing or absence.
  False positives are acceptable; false negatives are not.

spacing — Narrow gap between two teeth that are clearly both present with
  full crowns visible. NOT a missing tooth. Use only when both flanking
  teeth are unambiguously complete.

crowding — Teeth visibly overlapping or pushed out of arch alignment

rotation — One or more teeth visibly rotated around their own axis

yellowing — Overall warm yellow hue across multiple teeth

staining — Localized brown/grey/yellow patches on specific tooth surfaces

wear — Shortened, flattened, or worn-down incisal edges

chipping — Specific visible chip on a specific tooth

irregular_shape — Tooth visibly asymmetric or misshapen

short_teeth — Teeth appear unusually short relative to gum line

darkness — One specific tooth notably darker than its neighbors

edge_irregularity — Uneven or jagged incisal edges

gum_excess — DRAMATIC excess gum tissue: a band of gum visible above
  the upper teeth that visually dominates the smile and makes the teeth
  look short. Normal thin gum margins are NOT gum_excess. Do not flag
  unless it is unmistakable.

═══ DECISION RULES FOR AMBIGUOUS GAPS ═══

If you see a gap in the upper or lower anterior arch:
- Is it roughly tooth-width or wider? --> missing_tooth
- Is it narrow with two clearly complete teeth on either side? --> spacing
- Uncertain? --> missing_tooth (false positives are acceptable)

═══ CONFIDENCE SCORING ═══

For each finding, score confidence:
- "high"   --> unmistakable, you would bet money on it
- "medium" --> clearly visible but some ambiguity
- "low"    --> suggestive but uncertain (still report it, downstream may filter)

═══ LOCATION CODES ═══

upper_anterior — front upper teeth (incisors, canines)
upper_left, upper_right — back upper teeth on respective side
lower_anterior — front lower teeth
lower_left, lower_right — back lower teeth
generalized — finding affects most teeth

═══ OUTPUT (RETURN ONLY JSON) ═══

{
  "visible_findings": [
    {
      "code": "<from allowed list>",
      "location": "<from location codes>",
      "severity": "mild" | "moderate" | "severe",
      "confidence": "high" | "medium" | "low",
      "evidence": "<one specific sentence describing what you see in pixels>"
    }
  ],
  "photo_adequacy": {
    "view": "front" | "side" | "partial",
    "lighting": "good" | "acceptable" | "poor",
    "notes": "<optional short note>"
  }
}

Empty visible_findings array is valid. Be precise. If you cannot write
a specific evidence sentence pointing to actual pixels, do NOT include
the finding.`;

const EMERGENCY_PROMPT = `You are a caring dentist. This photo shows something needing prompt attention.

Write 3 short paragraphs. Plain text only — no asterisks, no bold, no markdown.

Paragraph 1: What you see, in plain everyday language.
Paragraph 2: Why it is worth getting checked soon. Calm, not alarming.
Paragraph 3: The good news — catching this early makes it simpler. End: Call (818) 706-6077 — same-day appointments available, consultation is free.

Under 100 words. Warm and human.`;

const SMILE_DEEPDIVE_PROMPT = `You are a caring dentist at Agoura Hills Dental Designs explaining a specific treatment option for a patient who just had their photo analyzed. Speak directly TO the patient — warm, conversational, never clinical.

Plain text only — no markdown, no asterisks, no bullets. Two short paragraphs.
Paragraph 1: What this treatment is and why it could be a good fit for them based on their photo.
Paragraph 2: What the experience looks like — process, time, comfort, result. End with: Call (818) 706-6077 to book your free consultation.

Under 130 words. Warm, real, never salesy.`;

// ═══════════════════════════════════════════════════════════════
// LAYER 2 — DETERMINISTIC TREATMENT ROUTER
// Pure JS. No LLM. Maps findings -> scenario key.
// ═══════════════════════════════════════════════════════════════

const STRUCTURAL = new Set(['wear', 'chipping', 'irregular_shape', 'edge_irregularity', 'short_teeth']);
const COLOR      = new Set(['yellowing', 'staining', 'darkness']);
const ALIGNMENT  = new Set(['crowding', 'rotation', 'spacing']);

/**
 * Route findings to a treatment scenario key.
 * Priority order is deliberate — earlier rules win.
 *
 * Returns one of:
 *   missing_tooth         — implant + bridge
 *   gum_excess            — gum contouring
 *   structural_compound   — veneers + bonding (multiple structural findings)
 *   color_alignment       — whitening + Invisalign
 *   color_only            — whitening + take-home trays
 *   alignment_only        — Invisalign + whitening
 *   structural_minor      — bonding + whitening
 *   inconclusive          — free consultation (no clear findings)
 */
function routeScenario(findings) {
  const codes = (findings.visible_findings || []).map(f => f.code);
  const codeSet = new Set(codes);
  const has = (c) => codeSet.has(c);
  const countIn = (set) => codes.filter(c => set.has(c)).length;

  // P1: Missing tooth — highest-value, deterministic. Patient cannot
  // smile without addressing it; no other scenario takes precedence.
  if (has('missing_tooth')) return 'missing_tooth';

  // P2: True gummy smile (only fires when AI flagged DRAMATIC gum excess
  // per the strict prompt definition; mild/solo cases are filtered earlier)
  if (has('gum_excess')) return 'gum_excess';

  // P3: Multiple structural findings -> veneers territory.
  // Veneers require structural justification (not just color/alignment).
  const structuralCount = countIn(STRUCTURAL);
  if (structuralCount >= 2) return 'structural_compound';

  const hasColor     = countIn(COLOR) >= 1;
  const hasAlignment = countIn(ALIGNMENT) >= 1;

  // P4: Color + alignment -> whitening (best) + Invisalign (alt)
  if (hasColor && hasAlignment) return 'color_alignment';

  // P5: Color only
  if (hasColor) return 'color_only';

  // P6: Alignment only
  if (hasAlignment) return 'alignment_only';

  // P7: Single structural finding -> bonding territory
  if (structuralCount === 1) return 'structural_minor';

  // Fallback: nothing visible warranted treatment
  return 'inconclusive';
}

// ═══════════════════════════════════════════════════════════════
// LAYER 3 — RESPONSE TEMPLATES
// Fixed patient-facing copy per scenario. No AI prose generation.
// ═══════════════════════════════════════════════════════════════

function buildResponse(scenario, findings, healthFlag) {
  const visible = findings.visible_findings || [];
  const evidenceFor = (code) => {
    const f = visible.find(x => x.code === code);
    return (f && f.evidence) || '';
  };

  const baseSignals = {
    emergency: false,
    _findings: findings,
    _pathology_flag: healthFlag,
    _scenario: scenario,
  };

  switch (scenario) {

    case 'missing_tooth': {
      const ev = evidenceFor('missing_tooth')
        || 'A visible gap is present in the dental arch where a tooth is absent.';
      return {
        ...baseSignals,
        headline: "There's a visible gap in your smile that can be fully restored.",
        bullets: [
          ev,
          'Replacing a missing tooth restores function as well as appearance.',
          'An in-person exam will determine whether an implant or bridge is the better fit.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Dental Implant',
            treatment: 'Dental Implant',
            id: 'implant_single',
            detail: 'A dental implant replaces the missing tooth with a permanent, natural-looking solution that does not rely on the neighboring teeth.',
          },
          {
            label: 'ALTERNATIVE — Dental Bridge',
            treatment: 'Dental Bridge',
            id: 'implant_bridge',
            detail: 'A bridge fills the gap by anchoring a replacement tooth to the neighboring teeth — a faster and more affordable path.',
          },
        ],
        ideal_result: 'Your smile looks complete again — no visible gap, restored chewing function, and renewed confidence.',
        cta: "Book your free consultation and we'll walk you through implant and bridge options.",
        treatments: [
          { id: 'implant_single', label: 'Dental Implant' },
          { id: 'implant_bridge', label: 'Dental Bridge' },
        ],
        urgency: 'priority',
      };
    }

    case 'gum_excess': {
      const ev = evidenceFor('gum_excess')
        || 'Excess gum tissue is visible above your upper teeth when smiling.';
      return {
        ...baseSignals,
        headline: 'Your beautiful teeth are partially hidden by excess gum tissue — gum contouring can reveal more of your natural smile.',
        bullets: [
          ev,
          'Your teeth look healthy underneath — the cosmetic concern is the gum-to-tooth ratio.',
          'Gum contouring is a quick procedure that reshapes the gum line for a more balanced smile.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Gum Contouring',
            treatment: 'Gum Contouring',
            id: 'gum_contouring',
            detail: 'Precisely reshapes your gum line to reveal more of your natural teeth and create a more balanced, proportioned smile.',
          },
          {
            label: 'COMPLEMENTARY — Professional Whitening',
            treatment: 'Professional Whitening',
            id: 'whitening',
            detail: 'Brightens your teeth so they shine after the gum contouring reveals their full shape.',
          },
        ],
        ideal_result: 'Your smile shows the right balance of teeth and gum — your natural beauty fully revealed.',
        cta: "Book your free consultation to see exactly how much your smile can change.",
        treatments: [
          { id: 'gum_contouring', label: 'Gum Contouring' },
          { id: 'whitening',      label: 'Professional Whitening' },
        ],
        urgency: 'standard',
      };
    }

    case 'structural_compound': {
      const structuralEvidence = visible
        .filter(f => STRUCTURAL.has(f.code))
        .slice(0, 2)
        .map(f => f.evidence)
        .filter(Boolean);
      return {
        ...baseSignals,
        headline: 'Several visible details in your smile can be refined into a beautifully cohesive look with porcelain veneers.',
        bullets: [
          structuralEvidence[0] || 'Visible variation in tooth shape, length, or edge appearance.',
          structuralEvidence[1] || 'Cosmetic refinements would create a more harmonious smile line.',
          'A consultation will confirm whether veneers, bonding, or a combination is the right fit.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Porcelain Veneers',
            treatment: 'Porcelain Veneers',
            id: 'veneers',
            detail: 'Custom-crafted porcelain shells that reshape, lengthen, and brighten multiple teeth for a complete smile transformation.',
          },
          {
            label: 'ALTERNATIVE — Cosmetic Bonding',
            treatment: 'Cosmetic Bonding',
            id: 'bonding',
            detail: 'A more conservative approach using tooth-colored composite to refine specific areas without removing tooth structure.',
          },
        ],
        ideal_result: 'A balanced, harmonious smile with even shapes, smooth edges, and beautiful proportions.',
        cta: "Book your free consultation to see what your refined smile could look like.",
        treatments: [
          { id: 'veneers', label: 'Porcelain Veneers' },
          { id: 'bonding', label: 'Cosmetic Bonding' },
        ],
        urgency: 'standard',
      };
    }

    case 'color_alignment': {
      const alignmentEvidence = visible.find(f => ALIGNMENT.has(f.code));
      return {
        ...baseSignals,
        headline: 'Your smile shows both color and alignment opportunities — addressing them together can create a striking transformation.',
        bullets: [
          evidenceFor('yellowing') || evidenceFor('staining') || 'Visible discoloration that whitening can directly address.',
          (alignmentEvidence && alignmentEvidence.evidence) || 'Visible alignment that aligners can correct.',
          'Many patients combine the two for a complete refresh — your in-office consultation confirms the right path.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Professional Whitening',
            treatment: 'Professional Whitening',
            id: 'whitening',
            detail: 'In-office whitening delivers dramatic results in a single visit, addressing visible discoloration directly.',
          },
          {
            label: 'ALTERNATIVE — Invisalign',
            treatment: 'Invisalign',
            id: 'invisalign',
            detail: 'Clear aligners gently and discreetly correct alignment over time — works beautifully alongside whitening.',
          },
        ],
        ideal_result: 'A brighter, more even smile that catches the light and looks fresh from every angle.',
        cta: "Book your free consultation and we'll map out the best sequence for your smile.",
        treatments: [
          { id: 'whitening',  label: 'Professional Whitening' },
          { id: 'invisalign', label: 'Invisalign' },
        ],
        urgency: 'standard',
      };
    }

    case 'color_only': {
      const ev = evidenceFor('yellowing') || evidenceFor('staining') || evidenceFor('darkness')
        || 'Visible discoloration across multiple teeth.';
      return {
        ...baseSignals,
        headline: 'Your smile shows visible discoloration that professional whitening can beautifully reverse.',
        bullets: [
          ev,
          'Tooth structure and alignment look healthy — the opportunity is purely cosmetic color.',
          'Professional whitening typically delivers dramatic results in a single visit.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Professional Whitening',
            treatment: 'Professional Whitening',
            id: 'whitening',
            detail: 'In-office whitening delivers the most dramatic results in a single visit and is supervised by your dentist.',
          },
          {
            label: 'ALTERNATIVE — Take-Home Whitening Trays',
            treatment: 'Take-Home Whitening Trays',
            id: 'whitening_takehome',
            detail: 'Custom-fitted trays let you whiten gradually at home over a few weeks — same end result with more flexibility.',
          },
        ],
        ideal_result: 'A noticeably brighter, more confident smile — usually within 1-2 weeks.',
        cta: "Book your free consultation and we'll show you exactly what's possible.",
        treatments: [
          { id: 'whitening',          label: 'Professional Whitening' },
          { id: 'whitening_takehome', label: 'Take-Home Whitening Trays' },
        ],
        urgency: 'standard',
      };
    }

    case 'alignment_only': {
      const alignmentEvidence = visible.find(f => ALIGNMENT.has(f.code));
      const ev = (alignmentEvidence && alignmentEvidence.evidence)
        || 'Visible alignment that clear aligners can correct.';
      return {
        ...baseSignals,
        headline: 'Your smile has alignment opportunities that Invisalign can discreetly correct.',
        bullets: [
          ev,
          'Color and tooth structure look healthy — the focus is alignment.',
          'Clear aligners are virtually invisible and removable, fitting easily into adult life.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Invisalign',
            treatment: 'Invisalign',
            id: 'invisalign',
            detail: 'Clear aligners gradually move teeth into ideal position without metal brackets — most adult cases finish in 6-18 months.',
          },
          {
            label: 'COMPLEMENTARY — Professional Whitening',
            treatment: 'Professional Whitening',
            id: 'whitening',
            detail: 'A whitening treatment is a quick cosmetic boost during or after orthodontic treatment.',
          },
        ],
        ideal_result: 'A straighter, more even smile that you achieved discreetly — most people will not even know you wore aligners.',
        cta: "Book your free consultation to see your projected results.",
        treatments: [
          { id: 'invisalign', label: 'Invisalign' },
          { id: 'whitening',  label: 'Professional Whitening' },
        ],
        urgency: 'standard',
      };
    }

    case 'structural_minor': {
      const structural = visible.find(f => STRUCTURAL.has(f.code));
      const ev = (structural && structural.evidence)
        || 'A small visible variation in tooth shape or edge.';
      return {
        ...baseSignals,
        headline: 'A small refinement could make a meaningful difference in your smile.',
        bullets: [
          ev,
          'Cosmetic bonding can address localized concerns without affecting the rest of your teeth.',
          'A whitening treatment beforehand ensures the bonded area blends perfectly.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Cosmetic Bonding',
            treatment: 'Cosmetic Bonding',
            id: 'bonding',
            detail: 'A precise application of tooth-colored composite to reshape, lengthen, or smooth specific areas. Same-day result.',
          },
          {
            label: 'COMPLEMENTARY — Professional Whitening',
            treatment: 'Professional Whitening',
            id: 'whitening',
            detail: 'Brightens the surrounding teeth so the bonded area blends seamlessly.',
          },
        ],
        ideal_result: 'A subtle but noticeable refinement that completes your smile without major intervention.',
        cta: "Book your free consultation to see what bonding could do.",
        treatments: [
          { id: 'bonding',   label: 'Cosmetic Bonding' },
          { id: 'whitening', label: 'Professional Whitening' },
        ],
        urgency: 'standard',
      };
    }

    case 'inconclusive':
    default: {
      return {
        ...baseSignals,
        headline: "Your smile looks healthy on camera — an in-person consultation can show you what's possible.",
        bullets: [
          'Nothing specific jumped out from this photo that requires cosmetic treatment.',
          'A full evaluation in our office gives the most accurate picture.',
          "We'll take proper clinical photos and walk through any enhancement you're considering.",
        ],
        plan: [
          {
            label: 'BEST OPTION — Free In-Office Consultation',
            treatment: 'Consultation',
            id: 'consultation',
            detail: "We'll take proper clinical photos and walk through any enhancement you're considering — no pressure, no guesswork.",
          },
        ],
        ideal_result: "You'll leave with a clear, personalized picture of what would actually enhance your smile.",
        cta: "Book your free consultation — we'll show you exactly what's possible.",
        treatments: [],
        urgency: 'standard',
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FINDING POST-PROCESSORS — clean up known AI biases before routing
// ═══════════════════════════════════════════════════════════════

function postProcessFindings(findings) {
  if (!findings || !Array.isArray(findings.visible_findings)) {
    return { visible_findings: [], photo_adequacy: {} };
  }

  // Filter 1: drop low-confidence findings entirely. Exception:
  // missing_tooth keeps low-confidence findings because false negatives
  // are far costlier than false positives ($3-5K implant case lost).
  let cleaned = findings.visible_findings.filter(f => {
    const conf = (f.confidence || '').toLowerCase();
    if (conf === 'low' && f.code !== 'missing_tooth') return false;
    return true;
  });

  // Filter 2: drop mild gum_excess (false-positive pattern in v13.x logs)
  cleaned = cleaned.filter(f => !(f.code === 'gum_excess' && f.severity === 'mild'));

  // Filter 3: drop solo gum_excess (real gummy smiles co-occur with short_teeth)
  if (cleaned.length === 1 && cleaned[0].code === 'gum_excess') {
    cleaned = [];
  }

  // Filter 4: AI sometimes returns severe spacing that is actually a missing
  // tooth it failed to recognize. Promote severe upper-anterior spacing to
  // missing_tooth — false positives acceptable per business rules.
  cleaned = cleaned.map(f => {
    if (f.code === 'spacing'
        && f.severity === 'severe'
        && (f.location === 'upper_anterior' || f.location === 'generalized')) {
      console.log('[v14] promoting severe anterior spacing to missing_tooth');
      return {
        ...f,
        code: 'missing_tooth',
        evidence: f.evidence || 'A wide gap is visible in the upper front arch.',
      };
    }
    return f;
  });

  return {
    visible_findings: cleaned,
    photo_adequacy: findings.photo_adequacy || {},
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function parseJsonSafe(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const cleaned = raw.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isHardReject(qParsed) {
  // Whitelist of hard-reject reasons. Anything else is a false positive
  // that we ignore (the AI quality reviewer is too aggressive).
  const text = ((qParsed.reason || '') + ' ' + (qParsed.hint || '')).toLowerCase();
  const KEYWORDS = [
    'not a mouth', 'not a smile', 'no teeth visible', 'mouth is closed',
    'completely closed', 'no mouth', 'wall', 'ceiling', 'food', 'pet',
    'too dark', 'pure black', 'silhouette', 'pitch black',
    'unrecognizable', 'extremely blurry', 'completely out of focus',
    'motion blur',
  ];
  return KEYWORDS.some(k => text.includes(k));
}

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

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════

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

    // ── DEEP DIVE — explain a specific treatment to a patient ──
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, SMILE_DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `Explain this treatment for this patient: ${treatmentLabel}` },
      ], 500);
      const data = await res.json();
      const text = (data?.content?.[0]?.text || '').trim() || 'Call (818) 706-6077 for details.';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ── QUALITY GATE ──
    try {
      const qRes = await callClaude(apiKey, QUALITY_PROMPT, [
        imageContent,
        { type: 'text', text: 'Assess photo quality.' },
      ], 150);
      const qParsed = parseJsonSafe((await qRes.json())?.content?.[0]?.text);
      if (qParsed && qParsed.usable === false && isHardReject(qParsed)) {
        console.log('[v14] quality gate hard-rejected:', qParsed.reason);
        return new Response(JSON.stringify({
          retake_required: true,
          reason: qParsed.reason || 'We need a clearer photo to give you an accurate result.',
          hint: qParsed.hint || 'Please retake your photo showing your smile clearly.',
        }), { status: 200, headers });
      }
    } catch (e) {
      console.warn('[v14] quality gate skipped:', e.message);
    }

    // ── EMERGENCY TRIAGE ──
    let triage = { safe: true };
    try {
      const tRes = await callClaude(apiKey, TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Assess this image.' },
      ], 50);
      triage = parseJsonSafe((await tRes.json())?.content?.[0]?.text) || { safe: true };
    } catch (e) {
      console.warn('[v14] triage skipped:', e.message);
    }

    if (triage.safe === false) {
      const eRes = await callClaude(apiKey, EMERGENCY_PROMPT, [
        imageContent,
        { type: 'text', text: 'Write the urgent message.' },
      ], 400);
      const text = ((await eRes.json())?.content?.[0]?.text || '').trim()
        || 'Your photo shows something that should be checked promptly. Call (818) 706-6077 — same-day appointments available, consultation is free.';
      return new Response(JSON.stringify({
        emergency: true,
        urgency: 'priority',
        analysis: text,
        treatments: [],
      }), { status: 200, headers });
    }

    // ── OBSERVE — AI classifies findings (no treatments) ──
    let findings = { visible_findings: [], photo_adequacy: {} };
    try {
      const oRes = await callClaude(apiKey, OBSERVE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Classify the visible findings.' },
      ], 800);
      const parsed = parseJsonSafe((await oRes.json())?.content?.[0]?.text);
      if (parsed) findings = parsed;
      console.log('[v14] raw findings:', JSON.stringify(findings).substring(0, 600));
    } catch (e) {
      console.error('[v14] observe error:', e.message);
    }

    // Apply known-bias filters
    findings = postProcessFindings(findings);
    console.log('[v14] cleaned findings:', JSON.stringify(findings).substring(0, 600));

    // ── HEALTH TRIAGE — silent backend signal only ──
    let healthFlag = null;
    try {
      const hRes = await callClaude(apiKey, HEALTH_TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Screen for visible dental pathology.' },
      ], 200);
      healthFlag = parseJsonSafe((await hRes.json())?.content?.[0]?.text);
      console.log('[v14] pathology flag (backend-only):', JSON.stringify(healthFlag));
    } catch (e) {
      console.warn('[v14] pathology screen skipped:', e.message);
    }

    // ── ROUTE ── deterministic, no LLM
    const scenario = routeScenario(findings);
    console.log('[v14] routed to scenario:', scenario);

    // ── BUILD RESPONSE ── from template
    const response = buildResponse(scenario, findings, healthFlag);

    return new Response(JSON.stringify(response), { status: 200, headers });

  } catch (err) {
    console.error('[v14] handler error:', err.message);
    return new Response(JSON.stringify({
      error: 'Something went wrong. Call (818) 706-6077.',
    }), { status: 500, headers });
  }
}
