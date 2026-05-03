// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v15.1 — Dedicated restoration detector (decay-under-crowns case)
//
//   v15 added failing_restoration as a finding code, but OBSERVE
//   alone failed to flag it on the decay-under-crowns photo —
//   AI saw "yellow lower teeth," called it yellowing, and routed
//   to whitening. Same architectural issue as missing-tooth in v13:
//   a multi-finding prompt is too diffuse for a specific clinical
//   signal.
//
//   v15.1 adds a dedicated detector following the v13.6 pattern:
//   - RESTORATION_DETECTOR_PROMPT runs in parallel after OBSERVE
//   - Single-purpose: "does patient have existing crowns/veneers,
//     and are any of them compromised?"
//   - Aggressive: "false positives are far less costly than false
//     negatives" (lost crown-replacement lead = $1500-3000)
//   - Result merged into findings:
//     * Compromised restoration → inject failing_restoration finding
//     * Sound restorations → drop color findings (whitening doesn't
//       work on porcelain), inject mismatched_dentistry as fallback
//
//   Also fixes log labels: all console messages now correctly say
//   [v15] instead of stale [v14] from the v14→v15 rewrite.
//
//   Architecture preserved: AI never sees treatment names. Detector
//   returns observation flags only. Code routes; templates speak.
//
//   Builds on v14 architecture (AI observes, code routes, templates speak).
//   v14.1 added failing_restoration + decay. v15 expands to the full
//   advisor-prescribed routing hierarchy:
//
//   New finding codes:
//     - dark_single_tooth (split from generic darkness — clinical signal)
//     - severe_wear (vs minor wear)
//     - major_chip (vs small chipping)
//     - recession (gum recession / black triangles)
//     - mismatched_dentistry (intact but cosmetically inconsistent)
//     - decay_severe (multiple decayed teeth)
//     - extensive_breakdown (full-arch territory)
//
//   Findings now carry a "count" field (for missing_tooth, decay,
//   chipping, mismatched_dentistry) so the router can distinguish
//   single vs multiple cases.
//
//   New router scenarios in priority order:
//     1. full_arch_consultation (extensive missing + failing)
//     2. comprehensive_evaluation (severe decay)
//     3. multiple_implants (4+ missing or scattered)
//     4. implant_bridge (2-3 adjacent missing)
//     5. missing_tooth (single)
//     6. restoration_needed (failing crowns or single decay)
//     7. severe_structural (major chip / severe wear)
//     8. recession_eval (gum-first evaluation)
//     9. gum_excess (true gummy smile)
//    10. dark_tooth (single dark — clinical first)
//    11. smile_makeover (mismatched old work)
//    12. structural_compound (>=2 minor structural)
//    13. color_alignment / color_only / alignment_only
//    14. structural_minor (1 minor)
//    15. inconclusive (page-aware fallback — never "looks healthy"
//        on a service page)
//
//   Page-aware inconclusive: pagePath is now passed through and used
//   to surface a service-specific consultation when no findings are
//   detected. Implants page never says "your smile looks healthy".
//
//   Architectural principle preserved: AI never sees treatment names.
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

const RESTORATION_DETECTOR_PROMPT = `You are a dental imaging specialist. Your ONLY job is to determine if this photo shows EXISTING DENTAL WORK (crowns, veneers, bridges) and whether any of it appears compromised.

═══ STEP 1: DOES THIS PATIENT HAVE EXISTING CROWNS OR VENEERS? ═══

Strong signals that teeth ARE restored (crowns/veneers):
- A row of teeth that all look UNIFORM in color, shape, and size — natural teeth always have small variations, restored teeth often look "perfectly even"
- Color mismatch between upper and lower arches (e.g., bright white upper teeth, naturally yellow lower teeth) — this strongly suggests the upper arch is restored
- Teeth that look unusually opaque or porcelain-like
- Teeth with no visible texture or surface detail

═══ STEP 2: IF YES, ARE THE RESTORATIONS COMPROMISED? ═══

Look for failure signals:
- DARK MARGINS: dark line, shadow, or visible staining where the crown meets the gumline (suggests decay underneath, marginal seal failure, or recession exposing the crown edge)
- COLOR MISMATCH within the upper or lower arch (one or two crowns look different in shade from the others)
- Visible CHIPPING or wear on what appears to be a crown/veneer
- A GAP between the restoration and adjacent tooth or gum
- Old crown showing dark line at the gumline — even if subtle

═══ DECISIVE INSTRUCTION ═══

The biggest failure mode is missing patients who already have crowns and routing them to whitening — whitening does NOT work on porcelain restorations and the patient gets a useless recommendation.

When you see what looks like existing dental work AND ANY signs of compromise (especially dark margins at the gumline), flag it. False positives are far less costly than false negatives — a patient sent to in-office evaluation can always be redirected to whitening; a patient sent to whitening for failing crowns is a lost lead.

═══ OUTPUT (RETURN ONLY JSON) ═══

{
  "has_existing_restorations": true | false,
  "restoration_appears_compromised": true | false,
  "confidence": "high" | "medium" | "low",
  "evidence": "<one specific sentence describing what you see>",
  "indicator": "dark_margins" | "color_mismatch" | "chipping" | "gap" | "wear" | null
}

Defaults if uncertain: { "has_existing_restorations": false, "restoration_appears_compromised": false, "confidence": "low", "evidence": "", "indicator": null }`;

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

dark_single_tooth — ONE specific tooth notably darker than ALL its
  neighbors (suggests non-vital/dead tooth from old trauma). This is
  CLINICALLY DIFFERENT from yellowing. Use this code when one tooth is
  visibly darker than the others, NOT when multiple teeth share a
  yellow tint.

wear — Shortened, flattened, or worn-down incisal edges across multiple
  teeth (suggests grinding/bruxism pattern)

severe_wear — Pronounced wear where multiple teeth look dramatically
  shorter than they should, with flat or chipped edges across the front.
  Use when wear is the dominant visible feature, not just a minor finding.

chipping — Specific visible chip on a specific tooth (small, localized)

major_chip — A large fracture or visible break on a front tooth where a
  significant portion of the tooth is missing or broken. NOT a small chip.
  This is structural damage that warrants restorative consultation.

irregular_shape — Tooth visibly asymmetric or misshapen (peg-shaped lateral,
  small tooth that looks underdeveloped, baby-tooth-like appearance in
  an adult). Use this for tooth SHAPE issues, not gum coverage issues.

short_teeth — Teeth appear unusually short relative to gum line. May be
  due to gum coverage (use gum_excess if gums are also clearly excessive)
  or actual tooth shape issue (use irregular_shape if teeth are truly small).

edge_irregularity — Uneven or jagged incisal edges

gum_excess — DRAMATIC excess gum tissue: a band of gum visible above
  the upper teeth that visually dominates the smile and makes the teeth
  look short. Normal thin gum margins are NOT gum_excess. Do not flag
  unless it is unmistakable.

recession — Gum recession with visibly exposed yellow root surface, or
  "black triangles" (dark spaces between teeth at the gumline indicating
  papilla loss / interproximal bone loss). Patients with visible recession
  need a gum-health evaluation BEFORE any cosmetic work.

failing_restoration — Existing dental work (crowns, veneers, bridges, large
  fillings) that is visibly compromised. Look for:
  - Dark margins where the crown/restoration meets the natural tooth or gumline
    (suggesting decay underneath or seal failure)
  - Visible gap between the restoration and adjacent tooth
  - Color mismatch indicating the restoration is older or breaking down
  - A crown that looks dramatically different in shade from neighbors
  - Visible chipping or fracture on what is clearly a crown/veneer
  When patients have multiple existing crowns AND you see ANY of these signs,
  flag it. Patients with failing crowns need replacement, not whitening.

mismatched_dentistry — Existing dental work (crowns, veneers, fillings) that
  is INTACT but visibly mismatched in color, shape, or size from surrounding
  natural teeth. Different from failing_restoration: the work is sound but
  cosmetically inconsistent. Common in patients who had old dentistry that
  no longer matches their current smile aesthetic. Do not flag the same
  area as both failing_restoration and mismatched_dentistry — pick one.

decay — Visible tooth decay: brown/black cavitation or hole on a tooth surface,
  dark shadow indicating caries, or breakdown along the gumline. This is
  distinct from staining (which is surface-level) — decay implies structural
  loss or active disease. Flag when clearly visible, especially under or
  around existing dental work.

decay_severe — Multiple teeth (≥3) with visible decay, OR a single tooth
  with extensive breakdown showing more than half the visible tooth structure
  affected. Use this code instead of decay when the pattern is clearly more
  serious than a single small cavity. Routes to comprehensive evaluation.

extensive_breakdown — A pattern of widespread missing AND failing teeth
  visible across an entire arch (3+ missing combined with multiple failing
  restorations or decayed teeth). This is the highest-severity finding —
  use it ONLY when the visible state of the arch is dramatically compromised.
  Do not use for partial issues or single-area concerns.

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
      "count": <integer, ONLY for missing_tooth, decay, chipping, mismatched_dentistry — how many teeth are affected>,
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

const STRUCTURAL = new Set(['wear', 'chipping', 'irregular_shape', 'edge_irregularity', 'short_teeth', 'major_chip', 'severe_wear']);
const COLOR      = new Set(['yellowing', 'staining']);
const ALIGNMENT  = new Set(['crowding', 'rotation', 'spacing']);

/**
 * Route findings to a treatment scenario key.
 * Priority order is deliberate — earlier rules win.
 *
 * Final priority hierarchy (per v15 advisor audit):
 *   1. Photo unusable -> retake (handled at quality gate, not here)
 *   2. Emergency / trauma / swelling / abscess -> handled at TRIAGE pass
 *   3. Obvious pathology / decay / extensive breakdown
 *   4. Missing teeth (single, adjacent, multiple, full arch)
 *   5. Major chips / severe wear / structural damage
 *   6. Recession / black triangles -> gum eval before cosmetic
 *   7. Gummy smile / excess gum / short teeth from gum coverage
 *   8. Mismatched old dentistry -> smile makeover
 *   9. Multiple structural minor findings -> veneers
 *  10. Single dark tooth -> evaluation before whitening
 *  11. Color + alignment combo
 *  12. Color only
 *  13. Alignment only
 *  14. Single structural finding -> bonding
 *  15. Inconclusive -> page-aware fallback
 *
 * Returns the scenario key string.
 */
function routeScenario(findings) {
  const visible = findings.visible_findings || [];
  const codes = visible.map(f => f.code);
  const codeSet = new Set(codes);
  const has = (c) => codeSet.has(c);
  const countIn = (set) => codes.filter(c => set.has(c)).length;
  const find = (c) => visible.find(f => f.code === c);

  // ─── PRIORITY 1: Extensive breakdown (full-arch evaluation) ───
  // Trumps everything else. AI explicitly flagged dramatic widespread
  // damage, OR we infer it from many missing + many failing/decay.
  if (has('extensive_breakdown')) return 'full_arch_consultation';

  const missingCount = (find('missing_tooth')?.count) || (has('missing_tooth') ? 1 : 0);
  const decayCount = (find('decay')?.count) || (has('decay') ? 1 : 0);
  const failingCount = visible.filter(f => f.code === 'failing_restoration').length;
  if (missingCount >= 3 && (has('decay_severe') || decayCount + failingCount >= 2)) {
    return 'full_arch_consultation';
  }

  // ─── PRIORITY 2: Severe decay -> comprehensive evaluation ───
  if (has('decay_severe')) return 'comprehensive_evaluation';

  // ─── PRIORITY 3: Missing teeth (varies by count and adjacency) ───
  if (has('missing_tooth')) {
    const missingFinding = find('missing_tooth');
    const c = (missingFinding && missingFinding.count) || 1;
    // Multiple in one location vs scattered across arches
    const missingFindings = visible.filter(f => f.code === 'missing_tooth');
    const distinctLocations = new Set(missingFindings.map(f => f.location).filter(Boolean));
    const isScattered = distinctLocations.size >= 2;

    if (c >= 4 || isScattered) return 'multiple_implants';
    if (c === 2 || c === 3)    return 'implant_bridge';
    return 'missing_tooth'; // single
  }

  // ─── PRIORITY 4: Failing restorations or single-tooth decay ───
  if (has('failing_restoration') || has('decay')) return 'restoration_needed';

  // ─── PRIORITY 5: Major chip / severe wear -> restorative consultation ───
  if (has('major_chip') || has('severe_wear')) return 'severe_structural';

  // ─── PRIORITY 6: Recession / black triangles -> gum eval first ───
  if (has('recession')) return 'recession_eval';

  // ─── PRIORITY 7: True gummy smile (gum_excess prompt is strict) ───
  if (has('gum_excess')) return 'gum_excess';

  // ─── PRIORITY 8: Single dark tooth (clinical, not cosmetic whitening) ───
  if (has('dark_single_tooth')) return 'dark_tooth';

  // ─── PRIORITY 9: Mismatched old dentistry -> smile makeover ───
  if (has('mismatched_dentistry')) return 'smile_makeover';

  // ─── PRIORITY 10: Multiple structural minor findings -> veneers ───
  const structuralCount = countIn(STRUCTURAL);
  if (structuralCount >= 2) return 'structural_compound';

  // ─── PRIORITY 11-13: Color + Alignment combinations ───
  const hasColor     = countIn(COLOR) >= 1;
  const hasAlignment = countIn(ALIGNMENT) >= 1;
  if (hasColor && hasAlignment) return 'color_alignment';
  if (hasColor) return 'color_only';
  if (hasAlignment) return 'alignment_only';

  // ─── PRIORITY 14: Single structural finding -> bonding ───
  if (structuralCount === 1) return 'structural_minor';

  // ─── FALLBACK: nothing visible -> page-specific consultation ───
  return 'inconclusive';
}

// ═══════════════════════════════════════════════════════════════
// LAYER 3 — RESPONSE TEMPLATES
// Fixed patient-facing copy per scenario. No AI prose generation.
// ═══════════════════════════════════════════════════════════════

function buildResponse(scenario, findings, healthFlag, pagePath) {
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

    case 'full_arch_consultation': {
      return {
        ...baseSignals,
        headline: "Your photo shows several teeth that may need restorative attention — a full-mouth consultation is the right starting point.",
        bullets: [
          'Multiple areas in your smile appear to need replacement, repair, or evaluation.',
          'A comprehensive in-person exam will determine whether individual repairs, multiple implants, or a full-arch solution is the right path.',
          'There are excellent options available for restoring even extensive tooth loss or breakdown — the consultation is where we map out exactly what you need.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Full-Mouth Restorative Consultation',
            treatment: 'Full-Mouth Restorative Consultation',
            id: 'full_mouth_consult',
            detail: "We'll take complete clinical photos and X-rays to fully understand the condition of every tooth and create a personalized restoration plan.",
          },
          {
            label: 'POSSIBLE PATH — Full-Arch Implant Solution',
            treatment: 'Full-Arch Implant / All-on-4 Discussion',
            id: 'full_arch_implants',
            detail: 'For extensive tooth loss combined with failing teeth, full-arch implant solutions can replace an entire arch with a fixed, natural-looking result. This is one option among several we will discuss together.',
          },
        ],
        ideal_result: 'A renewed, complete smile with restored function — chewing, speaking, and smiling with confidence again.',
        cta: "Book your free consultation — we will take the time to understand your full situation and walk through every option.",
        treatments: [
          { id: 'full_mouth_consult',  label: 'Full-Mouth Consultation' },
          { id: 'full_arch_implants',  label: 'Full-Arch Implant Discussion' },
        ],
        urgency: 'priority',
      };
    }

    case 'comprehensive_evaluation': {
      const decayEv = evidenceFor('decay_severe') || evidenceFor('decay')
        || 'Multiple teeth appear to need restorative attention.';
      return {
        ...baseSignals,
        headline: "This looks like something worth checking in person before discussing cosmetic options.",
        bullets: [
          decayEv,
          'A comprehensive evaluation lets us identify exactly which teeth need attention and in what order.',
          'Restoring health and structure first protects your investment in any cosmetic work that follows.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Comprehensive Restorative Consultation',
            treatment: 'Comprehensive Restorative Consultation',
            id: 'comprehensive_eval',
            detail: 'A thorough exam with full clinical photos and X-rays to identify and prioritize all teeth needing care.',
          },
          {
            label: 'NEXT STEP — Treatment Plan Discussion',
            treatment: 'Treatment Plan Discussion',
            id: 'treatment_plan',
            detail: 'Once we know exactly what needs attention, we will discuss restorative options including crowns, fillings, and any needed replacement work.',
          },
        ],
        ideal_result: 'A healthy, restored mouth where every tooth is structurally sound — the foundation for any cosmetic enhancements you may want next.',
        cta: 'Book your free consultation — we will examine carefully and explain exactly what each tooth needs.',
        treatments: [
          { id: 'comprehensive_eval', label: 'Restorative Consultation' },
          { id: 'treatment_plan',     label: 'Treatment Plan Discussion' },
        ],
        urgency: 'priority',
      };
    }

    case 'multiple_implants': {
      const ev = evidenceFor('missing_tooth')
        || 'Multiple visible gaps where teeth are missing.';
      return {
        ...baseSignals,
        headline: "There are visible gaps where multiple teeth are missing — a tailored implant plan can fully restore your smile.",
        bullets: [
          ev,
          'Replacing multiple missing teeth restores both function and the natural appearance of your smile.',
          'An in-person consultation will determine the best combination of implants, bridges, or implant-supported restorations for your specific situation.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Multiple Implant Consultation',
            treatment: 'Multiple Implant Consultation',
            id: 'implants_multiple',
            detail: 'Individual or strategically placed implants replace each missing tooth with a permanent, natural-looking result.',
          },
          {
            label: 'ALTERNATIVE — Implant Bridge or Partial',
            treatment: 'Implant Bridge or Partial',
            id: 'implant_bridge',
            detail: 'Depending on the locations of the missing teeth, an implant-supported bridge or partial denture may be a more efficient solution.',
          },
        ],
        ideal_result: 'Your smile looks complete and natural again — every tooth restored, full chewing function returned, and lasting confidence.',
        cta: "Book your free consultation and we will design a personalized restoration plan.",
        treatments: [
          { id: 'implants_multiple', label: 'Multiple Implants' },
          { id: 'implant_bridge',    label: 'Implant Bridge' },
        ],
        urgency: 'priority',
      };
    }

    case 'implant_bridge': {
      const ev = evidenceFor('missing_tooth')
        || 'A visible gap spanning multiple adjacent positions in the dental arch.';
      return {
        ...baseSignals,
        headline: "Multiple adjacent missing teeth can be beautifully restored with an implant-supported bridge.",
        bullets: [
          ev,
          'When several teeth are missing in a row, an implant bridge provides a stable, long-lasting restoration that looks and feels natural.',
          'An in-person exam will confirm whether implants, a traditional bridge, or another approach is the best fit.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Implant Bridge',
            treatment: 'Implant Bridge',
            id: 'implant_bridge',
            detail: 'Implants placed at strategic positions support a multi-tooth bridge, replacing all the missing teeth in a single connected restoration.',
          },
          {
            label: 'ALTERNATIVE — Traditional Dental Bridge',
            treatment: 'Traditional Dental Bridge',
            id: 'bridge_traditional',
            detail: 'A traditional bridge anchors the replacement teeth to the natural teeth on either side of the gap — faster placement and a more affordable path.',
          },
        ],
        ideal_result: 'A complete, balanced smile with restored chewing strength and a natural appearance.',
        cta: "Book your free consultation to map out your bridge or implant options.",
        treatments: [
          { id: 'implant_bridge',     label: 'Implant Bridge' },
          { id: 'bridge_traditional', label: 'Dental Bridge' },
        ],
        urgency: 'priority',
      };
    }

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

    case 'restoration_needed': {
      const restoEvidence = evidenceFor('failing_restoration');
      const decayEvidence = evidenceFor('decay');
      // Prefer the more specific evidence; fall back gracefully
      const primaryEvidence = restoEvidence
        || decayEvidence
        || 'Existing dental work appears to be breaking down or showing signs of decay underneath.';
      const secondaryEvidence = (restoEvidence && decayEvidence)
        ? decayEvidence
        : 'Updating the affected areas will protect the underlying tooth and restore your smile.';
      const hasFailingResto = !!restoEvidence;
      const hasDecay = !!decayEvidence;

      return {
        ...baseSignals,
        headline: hasFailingResto
          ? "Your existing dental work shows signs of needing attention — replacing it will protect your teeth and refresh your smile."
          : "There are visible signs that some teeth need restorative attention before any cosmetic treatment.",
        bullets: [
          primaryEvidence,
          secondaryEvidence,
          'An in-person exam is essential here — we need clinical photos and X-rays to confirm what is happening underneath the existing work.',
        ],
        plan: [
          {
            label: 'BEST OPTION — In-Office Evaluation',
            treatment: 'In-Office Evaluation',
            id: 'consultation_priority',
            detail: "We'll take proper clinical photos and X-rays to confirm the condition of your existing dental work and identify any decay underneath. This is the right first step.",
          },
          {
            label: 'LIKELY PATH — New Crowns or Restorations',
            treatment: 'Crowns / Restorations',
            id: 'crowns',
            detail: 'New crowns or restorations replace failing dental work with fresh materials, protecting the underlying tooth and restoring both function and appearance.',
          },
        ],
        ideal_result: 'Your existing dental work is replaced with fresh, well-fitted restorations — your smile looks renewed and the underlying teeth are protected for the long term.',
        cta: 'Book your free consultation — we will examine the existing work and map out exactly what needs replacing.',
        treatments: [
          { id: 'crowns', label: 'Crowns / Restorations' },
          { id: 'consultation_priority', label: 'In-Office Evaluation' },
        ],
        urgency: 'priority',
      };
    }

    case 'severe_structural': {
      const ev = evidenceFor('major_chip') || evidenceFor('severe_wear')
        || visible.find(f => STRUCTURAL.has(f.code))?.evidence
        || 'Visible structural damage on a front tooth.';
      const isMajorChip = !!evidenceFor('major_chip');
      return {
        ...baseSignals,
        headline: isMajorChip
          ? "There's a noticeable break or fracture on your front teeth that warrants a restorative consultation."
          : "Significant wear on your front teeth can be beautifully restored with porcelain veneers or crowns.",
        bullets: [
          ev,
          'Damage of this scale typically needs more than cosmetic bonding to restore both appearance and strength.',
          'An in-person exam will confirm whether veneers, crowns, or another restorative approach is the right fit.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Veneers or Crown Consultation',
            treatment: 'Veneers or Crown Consultation',
            id: 'veneers_or_crown',
            detail: 'Custom porcelain restorations that rebuild both the appearance and the structural integrity of damaged front teeth.',
          },
          {
            label: 'ALTERNATIVE — Cosmetic Bonding (for Minor Areas)',
            treatment: 'Cosmetic Bonding',
            id: 'bonding',
            detail: 'For minor damage in specific spots, bonding may be a more conservative option — your dentist will confirm whether this is enough.',
          },
        ],
        ideal_result: 'Your front teeth look complete, even, and strong — your smile fully restored.',
        cta: "Book your free consultation to evaluate the right restorative approach.",
        treatments: [
          { id: 'veneers',  label: 'Porcelain Veneers' },
          { id: 'crowns',   label: 'Crowns' },
          { id: 'bonding',  label: 'Cosmetic Bonding' },
        ],
        urgency: 'priority',
      };
    }

    case 'recession_eval': {
      const ev = evidenceFor('recession')
        || 'Visible gum recession or "black triangles" between teeth.';
      return {
        ...baseSignals,
        headline: "Before any cosmetic work, your gums deserve a careful evaluation — they are the foundation of every smile.",
        bullets: [
          ev,
          'Visible recession or black triangles between teeth can indicate gum-health issues that should be assessed first.',
          'Once gum health is confirmed, we can confidently discuss any cosmetic enhancements you are considering.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Comprehensive Gum Evaluation',
            treatment: 'Comprehensive Gum Evaluation',
            id: 'gum_eval',
            detail: 'A thorough periodontal exam confirms the health of your gums and underlying bone — the right first step before any cosmetic work.',
          },
          {
            label: 'NEXT STEP — Cosmetic Consultation After Gum Health Confirmed',
            treatment: 'Cosmetic Consultation',
            id: 'cosmetic_consult',
            detail: 'Once we have confirmed your gums are healthy, we can discuss cosmetic options like veneers, whitening, or bonding with confidence.',
          },
        ],
        ideal_result: 'Healthy, stable gums that frame a beautiful smile — and a clear path to any cosmetic enhancements you want.',
        cta: 'Book your free consultation — we will start with the foundation and build from there.',
        treatments: [
          { id: 'gum_eval',         label: 'Gum Evaluation' },
          { id: 'cosmetic_consult', label: 'Cosmetic Consultation' },
        ],
        urgency: 'priority',
      };
    }

    case 'dark_tooth': {
      const ev = evidenceFor('dark_single_tooth')
        || 'One tooth appears notably darker than the surrounding teeth.';
      return {
        ...baseSignals,
        headline: "One tooth appears darker than the others — an in-person evaluation is the right first step before whitening.",
        bullets: [
          ev,
          'A single dark tooth is different from general yellowing — it can indicate the tooth needs evaluation rather than cosmetic whitening.',
          "Once we have evaluated the cause, we will discuss the right approach: internal whitening, a veneer, or another option.",
        ],
        plan: [
          {
            label: 'BEST OPTION — Dental Evaluation First',
            treatment: 'Dental Evaluation',
            id: 'dental_eval',
            detail: "We will examine the tooth and confirm what is causing the discoloration before recommending any treatment.",
          },
          {
            label: 'POSSIBLE PATHS — Internal Whitening or Veneer',
            treatment: 'Internal Whitening or Veneer',
            id: 'internal_or_veneer',
            detail: 'Depending on the cause, options may include internal bleaching of the affected tooth or a porcelain veneer to match the surrounding teeth.',
          },
        ],
        ideal_result: 'A balanced, even-shade smile where every tooth matches harmoniously.',
        cta: 'Book your free consultation and we will examine carefully before recommending the right path.',
        treatments: [
          { id: 'dental_eval',        label: 'Dental Evaluation' },
          { id: 'internal_or_veneer', label: 'Internal Whitening or Veneer' },
        ],
        urgency: 'priority',
      };
    }

    case 'smile_makeover': {
      const ev = evidenceFor('mismatched_dentistry')
        || 'Existing dental work appears mismatched in color, shape, or size.';
      return {
        ...baseSignals,
        headline: "Updating older dental work can transform a smile that has gradually become uneven over the years.",
        bullets: [
          ev,
          'When natural teeth are healthy but old crowns or fillings no longer match, replacing them creates a unified, fresh appearance.',
          'A smile-makeover consultation maps out exactly which restorations to update and in what order.',
        ],
        plan: [
          {
            label: 'BEST OPTION — Smile Makeover Consultation',
            treatment: 'Smile Makeover Consultation',
            id: 'smile_makeover',
            detail: 'A comprehensive cosmetic evaluation that identifies which existing restorations to update for a balanced, natural-looking result.',
          },
          {
            label: 'LIKELY PATHS — Veneers and Updated Crowns',
            treatment: 'Veneers and Updated Crowns',
            id: 'veneers_crowns',
            detail: 'Replacing mismatched older dentistry with new porcelain veneers or crowns that match in color, shape, and proportion.',
          },
        ],
        ideal_result: 'A unified, harmonious smile where every tooth blends naturally — old and new work indistinguishable from each other.',
        cta: "Book your free consultation and we will design a smile-makeover plan tailored to you.",
        treatments: [
          { id: 'smile_makeover',  label: 'Smile Makeover' },
          { id: 'veneers',         label: 'Porcelain Veneers' },
          { id: 'crowns',          label: 'Crowns' },
        ],
        urgency: 'standard',
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
      const ev = evidenceFor('yellowing') || evidenceFor('staining')
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
      // Page-aware fallback: when nothing specific is detected,
      // surface a consultation type that matches the page the
      // patient came from. Never say "your smile looks healthy"
      // on a service page where the patient is actively interested.
      const pageMap = {
        '/services/dental-implants':       { label: 'Implant Consultation',         id: 'consultation_implants',   tname: 'Dental Implant Consultation' },
        '/services/veneers':                { label: 'Smile Makeover Consultation',  id: 'consultation_makeover',   tname: 'Smile Makeover Consultation' },
        '/services/invisalign':             { label: 'Invisalign Consultation',      id: 'consultation_invisalign', tname: 'Invisalign Consultation' },
        '/services/teeth-whitening':        { label: 'Whitening Consultation',       id: 'consultation_whitening',  tname: 'Whitening Consultation' },
        '/services/restorative-dentistry':  { label: 'Restorative Consultation',     id: 'consultation_restorative',tname: 'Restorative Consultation' },
        '/services/emergency-dentistry':    { label: 'Same-Day Evaluation',          id: 'consultation_emergency',  tname: 'Emergency Evaluation' },
      };
      // Match pagePath case-insensitively, allow trailing slash
      const cleanPath = (pagePath || '').toLowerCase().replace(/\/$/, '');
      const ctx = pageMap[cleanPath];

      if (ctx) {
        return {
          ...baseSignals,
          headline: `Your photo did not show specific findings, but a ${ctx.label.toLowerCase()} can confirm what is possible for your smile.`,
          bullets: [
            'A casual phone photo cannot capture every detail — clinical photos and an in-person exam tell us much more.',
            'A consultation is the right next step to understand your specific situation and walk through your options.',
            'There is no pressure and no commitment — just a clear picture of what is possible.',
          ],
          plan: [
            {
              label: `BEST OPTION — ${ctx.label}`,
              treatment: ctx.tname,
              id: ctx.id,
              detail: "We'll take proper clinical photos and walk you through your options based on what we actually see in person.",
            },
          ],
          ideal_result: "You'll leave with a clear, personalized picture of what would actually enhance your smile.",
          cta: "Book your free consultation — we'll show you exactly what's possible.",
          treatments: [{ id: ctx.id, label: ctx.label }],
          urgency: 'standard',
        };
      }

      // Generic fallback (homepage, unknown page)
      return {
        ...baseSignals,
        headline: "Your smile looks healthy on camera — an in-person consultation can show you what's possible.",
        bullets: [
          'A casual phone photo can only show so much — clinical photos and an exam tell the full story.',
          'A free consultation is the right next step to understand any enhancements you may be considering.',
          "We'll take proper clinical photos and walk through any cosmetic options you're interested in.",
        ],
        plan: [
          {
            label: 'BEST OPTION — Free Cosmetic Consultation',
            treatment: 'Cosmetic Consultation',
            id: 'consultation',
            detail: "We'll take proper clinical photos and walk through any enhancement you're considering — no pressure, no guesswork.",
          },
        ],
        ideal_result: "You'll leave with a clear, personalized picture of what would actually enhance your smile.",
        cta: "Book your free consultation — we'll show you exactly what's possible.",
        treatments: [{ id: 'consultation', label: 'Free Cosmetic Consultation' }],
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
      console.log('[v15] promoting severe anterior spacing to missing_tooth');
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
        console.log('[v15] quality gate hard-rejected:', qParsed.reason);
        return new Response(JSON.stringify({
          retake_required: true,
          reason: qParsed.reason || 'We need a clearer photo to give you an accurate result.',
          hint: qParsed.hint || 'Please retake your photo showing your smile clearly.',
        }), { status: 200, headers });
      }
    } catch (e) {
      console.warn('[v15] quality gate skipped:', e.message);
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
      console.warn('[v15] triage skipped:', e.message);
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
      console.log('[v15] raw findings:', JSON.stringify(findings).substring(0, 600));
    } catch (e) {
      console.error('[v15] observe error:', e.message);
    }

    // Apply known-bias filters
    findings = postProcessFindings(findings);
    console.log('[v15] cleaned findings:', JSON.stringify(findings).substring(0, 600));

    // ── DEDICATED RESTORATION DETECTOR [v15.1] ──
    // OBSERVE alone does not reliably flag failing restorations on
    // patients who have crowns. A single-purpose detector with a narrow
    // question is dramatically more accurate. If detector confirms
    // compromised restoration, inject failing_restoration into findings
    // so the router routes to restoration_needed instead of color_only.
    let restoDetector = null;
    try {
      const rdRes = await callClaude(apiKey, RESTORATION_DETECTOR_PROMPT, [
        imageContent,
        { type: 'text', text: 'Does this photo show existing dental work, and is it compromised?' },
      ], 250);
      restoDetector = parseJsonSafe((await rdRes.json())?.content?.[0]?.text);
      console.log('[v15] restoration detector:', JSON.stringify(restoDetector));
    } catch (e) {
      console.warn('[v15] restoration detector skipped:', e.message);
    }

    // Inject finding if detector confirms compromised restoration
    if (restoDetector?.has_existing_restorations === true
        && restoDetector?.restoration_appears_compromised === true) {
      const alreadyFlagged = findings.visible_findings.some(f => f.code === 'failing_restoration');
      if (!alreadyFlagged) {
        console.log('[v15] OVERRIDE: detector found failing restoration that OBSERVE missed');
        findings.visible_findings.push({
          code: 'failing_restoration',
          location: 'generalized',
          severity: 'moderate',
          confidence: restoDetector.confidence || 'medium',
          evidence: restoDetector.evidence
            || 'Existing dental work shows signs of compromise (dark margins or color mismatch).',
        });
      }
    }

    // If patient has restorations but they appear sound, drop any
    // pure-color findings — whitening will not work on porcelain. Route
    // such cases to smile_makeover (mismatched cosmetic) or inconclusive
    // page-aware fallback instead of suggesting whitening for crowns.
    if (restoDetector?.has_existing_restorations === true
        && restoDetector?.restoration_appears_compromised === false) {
      const beforeLen = findings.visible_findings.length;
      findings.visible_findings = findings.visible_findings.filter(f => {
        if (f.code === 'yellowing' || f.code === 'staining') {
          console.log('[v15] dropping color finding because patient has existing restorations (whitening will not work)');
          return false;
        }
        return true;
      });
      // If nothing else remains, force smile_makeover signal
      if (findings.visible_findings.length === 0 && beforeLen > 0) {
        findings.visible_findings.push({
          code: 'mismatched_dentistry',
          location: 'generalized',
          severity: 'moderate',
          confidence: restoDetector.confidence || 'medium',
          evidence: restoDetector.evidence
            || 'Existing dental work is intact but the smile may benefit from cosmetic refinement.',
        });
      }
    }

    // ── HEALTH TRIAGE — silent backend signal only ──
    let healthFlag = null;
    try {
      const hRes = await callClaude(apiKey, HEALTH_TRIAGE_PROMPT, [
        imageContent,
        { type: 'text', text: 'Screen for visible dental pathology.' },
      ], 200);
      healthFlag = parseJsonSafe((await hRes.json())?.content?.[0]?.text);
      console.log('[v15] pathology flag (backend-only):', JSON.stringify(healthFlag));
    } catch (e) {
      console.warn('[v15] pathology screen skipped:', e.message);
    }

    // ── ROUTE ── deterministic, no LLM
    const scenario = routeScenario(findings);
    console.log('[v15] routed to scenario:', scenario);

    // ── BUILD RESPONSE ── from template
    const response = buildResponse(scenario, findings, healthFlag, pagePath);

    return new Response(JSON.stringify(response), { status: 200, headers });

  } catch (err) {
    console.error('[v15] handler error:', err.message);
    return new Response(JSON.stringify({
      error: 'Something went wrong. Call (818) 706-6077.',
    }), { status: 500, headers });
  }
}
