// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v16 — CLEAN REWRITE: cosmetic-funnel decision tree
//
//   v15.4 ended up at 1671 lines with three dedicated detectors layered
//   on top of an OBSERVE prompt that kept missing findings. Each detector
//   was a band-aid: AI vision biased toward the most obvious finding,
//   skipped the rest, and we patched around it.
//
//   v16 throws all of that out. The widget is a COSMETIC LEAD FUNNEL
//   above all. It does not need 17 routing scenarios or three detector
//   layers. It needs a simple decision tree that mirrors what the
//   doctors actually recommend, and it needs OBSERVE to ask the right
//   questions in the first place.
//
//   ARCHITECTURE
//
//   1. QUALITY GATE      — reject blurry / non-smile photos (preserved)
//   2. EMERGENCY TRIAGE  — fractured tooth, visible blood, abscess (preserved)
//   3. OBSERVE           — single Claude call, asks ALL decision-tree
//                          questions explicitly as yes/no/count fields.
//                          AI is asked the same questions the doctors
//                          would ask when triaging a smile photo.
//   4. ROUTE             — pure JS pattern match on the decision tree.
//                          12 rules, in priority order (highest-acuity
//                          finding wins).
//   5. PATHOLOGY SIGNAL  — silent backend signal to GHL only. EXCEPTION:
//                          if AI specifically detects DARK MARGINS on
//                          existing porcelain crowns/veneers, that
//                          surfaces as "new restorations" recommendation
//                          per the doctors' clinical guidance.
//   6. BUILD RESPONSE    — 12 templates, one per decision-tree row.
//
//   DECISION TREE (in priority order — first match wins):
//
//     1. missing_count >= 4 with damaged_remaining     -> All-on-4 consult
//     2. missing_count >= 3 same area                  -> Implant Bridge
//     3. dark_margins_on_existing_crowns               -> New Restorations
//     4. missing_count == 1 or 2                       -> Implant or Bridge
//     5. multiple_chips_with_misalignment              -> Crowns or Veneers
//     6. gummy_smile or baby_teeth                     -> Gingivectomy + Veneers
//     7. misshapen_teeth                               -> Veneers
//     8. uneven_teeth                                  -> Veneers
//     9. single_chip + yellowing                       -> Bonding + Whitening
//    10. yellowing + crowding (no chips)               -> Invisalign + Whitening
//    11. crowding only (no yellowing, no chips)        -> Invisalign
//    12. yellowing only                                -> Whitening (in-office + take-home)
//    13. inconclusive (page-aware fallback)            -> service of the page
//
//   PRESERVED FROM v15:
//   - Quality gate prompt
//   - Emergency triage prompt + whitelist
//   - Health/pathology screen (silent backend, narrowed surface case)
//   - Deep-dive mode for treatment chip clicks
//   - Edge runtime + CORS
//   - GHL forwarding contract: response includes _findings.visible_findings,
//     _pathology_flag, _scenario for downstream tagging
//
//   WIDGET CONTRACT (unchanged):
//     { headline, bullets[], plan{best_option,best_detail,alternative,alt_detail},
//       ideal_result, urgency, treatments[{id,label}], cta?, emergency?, analysis? }
//
//   DROPPED FROM v15:
//   - 17-scenario routing hierarchy        -> 12 simple rules
//   - 3 dedicated detector passes          -> 1 OBSERVE pass with right questions
//   - postProcessFindings bias filters     -> not needed; OBSERVE asks correctly
//   - structural_compound branching        -> tree handles via specific finding flags
//   - page-aware inconclusive variations   -> simpler 4-page fallback

export const config = { runtime: 'edge' };

// ════════════════════════════════════════════════════════════════════
// PROMPTS
// ════════════════════════════════════════════════════════════════════

const QUALITY_PROMPT = `You are a photo quality reviewer for casual smartphone smile selfies.

Patients are sending you regular phone photos taken in their bathroom or living room. Your job is to identify ONLY photos so unusable that any analysis would be meaningless. Be VERY permissive — when in doubt, accept the photo.

REJECT only if ONE of these is true:
- The photo contains NO visible mouth, lips, or teeth at all
- The photo is so dark or blurry that no individual teeth can be distinguished
- The photo is clearly not a person (animal, object, screenshot)

ACCEPT all of these:
- Casual selfies with imperfect lighting
- Photos with phones, fingers, or hair partially in frame
- Photos where only some teeth are visible (top row, bottom row, partial smile)
- Photos at unusual angles
- Photos of older adults, children, or any age
- Photos where teeth visibility is partial but meaningful

Return ONLY this JSON:
{ "usable": true | false, "reason": "<short reason if false>", "hint": "<gentle suggestion if false>" }`;

const TRIAGE_PROMPT = `You are a dental EMERGENCY screener for casual smartphone smile photos. You only flag photos that show a TRUE EMERGENCY requiring same-day dental attention.

A TRUE EMERGENCY is ONLY one of these specific visible findings:
- visible_blood: active blood, bleeding, or fresh blood pooling in the mouth
- broken_tooth: a tooth that is clearly fractured, snapped, or has a piece missing exposing the inside
- trauma: injury — a knocked-out tooth, displaced tooth, split lip with dental injury
- abscess: visible swelling with pus, fistula, or large lump on gums next to a tooth
- deep_cavity: a tooth with a large dark hole/cavitation visibly exposing pulp

DO NOT flag any of these as emergencies (these are NORMAL or NON-URGENT):
- Pink, red, or slightly swollen gums (this is gingivitis or normal variation, NOT an emergency)
- Mild gum recession or gum inflammation
- Yellow, brown, or stained teeth
- Worn, chipped, or uneven tooth edges (cosmetic, not urgent)
- Crowding, gaps, or misalignment
- Visible plaque or tartar
- Existing dental work (crowns, fillings, veneers) that looks intact
- Slight color variations between teeth
- Anything that looks unusual but isn't actively bleeding, broken, or abscessed

Return ONLY this JSON:
{ "safe": true | false, "concern": "<one of the 5 categories above, or empty if safe>" }

If you are uncertain, return safe:true. False positives cause real harm by triggering unnecessary emergency banners on routine photos.`;

const HEALTH_TRIAGE_PROMPT = `You are screening a casual phone-photo smile for clearly visible dental pathology.

This is a SILENT BACKEND SIGNAL — the patient does not see your output directly. Your job is to flag anything the front desk should review during the consultation.

FLAG these categories:
- decay: visible cavities, dark holes, brown/black areas on tooth surfaces
- periodontal: significant recession, severely inflamed gums, visible bone loss
- abscess: visible swelling, fistula, drainage
- endodontic: visible discoloration suggesting nerve issue (single dark tooth)
- dark_margins: SPECIFIC TO porcelain crowns, veneers, or bridges where the gum-line edge shows a dark band/line — this indicates failing margins on existing dental work

DO NOT FLAG:
- Yellow tooth color (cosmetic, not pathology)
- Mild gum redness or normal pink gums
- Crowding or alignment issues
- Chips or wear on natural teeth (handled separately)

Return ONLY this JSON:
{
  "pathology": true | false,
  "category": "decay" | "periodontal" | "abscess" | "endodontic" | "dark_margins" | null,
  "severity": "mild" | "moderate" | "severe" | null,
  "primary_concern": "<one specific sentence describing what you see, or empty>",
  "is_dark_margin_on_existing_crown": true | false
}

The "is_dark_margin_on_existing_crown" field is critical — it is true ONLY when:
1. The patient clearly has existing porcelain crowns/veneers/bridges visible, AND
2. There is a clearly visible dark band or dark line at the gum-line where the restoration meets the gum

If the teeth are natural (no crowns visible), is_dark_margin_on_existing_crown MUST be false even if you see decay.`;

const OBSERVE_PROMPT = `You are a dental smile classifier. You answer specific yes/no questions about a casual smartphone smile photo. The questions match a real cosmetic consultation triage tree, so accuracy matters.

Look at the photo and answer EVERY field below. Use your best judgment when something is borderline — but err toward NOTICING findings, not missing them. Patients deserve to know about visible chips, wear, missing teeth, and damage.

═══ COLOR & SHADE ═══
- yellowing: Are the teeth visibly yellow, warm, or stained? (Most adults have some yellowing — flag if teeth are clearly not white-bright.)

═══ ALIGNMENT ═══
- crowding: Are teeth visibly overlapping, rotated, or out of arch alignment?
- misalignment_with_chips: Are teeth BOTH misaligned AND showing chips/wear/breakage?

═══ STRUCTURAL DAMAGE ═══
Look CAREFULLY at the EDGES of every visible tooth, especially front incisors. Flag chips, wear, jagged edges, broken pieces, or any irregularity in the bite-edge line.
- chip_count: Approximate count of teeth with visible chips, wear, or broken edges. 0 if none visible. Look at lower teeth too — wear is extremely common there.

═══ MISSING TEETH ═══
- missing_count: Approximate count of clearly missing teeth (a visible gap where a tooth should be). 0 if none.
- missing_in_same_area: If 2+ missing, are they clustered in the same arch/region? (true/false)
- damaged_remaining_teeth: If multiple missing, do the REMAINING visible teeth ALSO look damaged, broken down, or severely decayed? (true/false — only relevant when missing_count >= 3)

═══ TOOTH SHAPE ═══
- misshapen_teeth: Do any teeth appear unusually shaped (peg-shaped, narrow, malformed, much smaller than neighbors)? (true/false)
- uneven_teeth: Do the front teeth show clearly different heights/sizes that aren't from chips? (true/false)

═══ GUM & TEETH PROPORTION ═══
- gummy_smile: Does the smile show an unusual amount of gum tissue above the upper teeth? (true/false)
- short_or_baby_teeth: Do the upper front teeth look very small, short, or "baby-tooth-like" relative to the gum/lip frame? (true/false)

═══ EXISTING DENTAL WORK ═══
- has_existing_crowns_or_veneers: Are there clearly existing porcelain restorations visible (uniform white teeth, distinct from natural teeth)? (true/false)

═══ EVIDENCE ═══
- summary: Two short sentences describing what you actually see in the photo, plain language, for use in patient-facing copy.

Return ONLY this JSON, no preamble, no markdown:

{
  "yellowing": true | false,
  "crowding": true | false,
  "misalignment_with_chips": true | false,
  "chip_count": <integer>,
  "missing_count": <integer>,
  "missing_in_same_area": true | false,
  "damaged_remaining_teeth": true | false,
  "misshapen_teeth": true | false,
  "uneven_teeth": true | false,
  "gummy_smile": true | false,
  "short_or_baby_teeth": true | false,
  "has_existing_crowns_or_veneers": true | false,
  "summary": "<two short sentences>"
}`;

const EMERGENCY_PROMPT = `You are a caring dentist at Agoura Hills Dental Designs. The patient's photo has been flagged for ONE specific emergency: visible_blood, broken_tooth, trauma, abscess, or deep_cavity. The specific concern will be in the user message.

Write a short, warm message (2-3 short paragraphs) that:
1. Acknowledges what you see in the photo specifically (one sentence describing the actual finding)
2. Explains why same-day attention matters for THIS specific issue
3. Reassures them and directs them to call (818) 706-6077 — same-day appointments available, free consultation

CRITICAL: Address ONLY the specific concern in the user message. Do NOT freelance about other issues. Do NOT mention gum disease, gingivitis, or general oral health unless that is the specific concern flagged. Do NOT use clinical jargon. Speak warmly, directly, and briefly.`;

const DEEPDIVE_PROMPT = `You are a caring dentist at Agoura Hills Dental Designs explaining a specific treatment option for a patient who just had their photo analyzed. Speak directly TO the patient — warm, conversational, never clinical.

The user message will tell you which treatment to explain. Look at the photo, then write 2-3 short paragraphs covering:
1. Why this treatment specifically addresses what's visible in their photo
2. What the experience and result will look like
3. A gentle nudge toward calling (818) 706-6077 for a free consultation, OR booking online

Keep it short, real, and free of dental jargon. No bullet points or headers — just warm prose. Never say "I see" — instead, describe what's visible matter-of-factly.`;

// ════════════════════════════════════════════════════════════════════
// DECISION TREE — 12 rules, first match wins
// ════════════════════════════════════════════════════════════════════

function routeDecision(o, pathologyFlag) {
  // Defensive defaults if AI returned partial data
  const f = {
    yellowing: !!o?.yellowing,
    crowding: !!o?.crowding,
    misalignment_with_chips: !!o?.misalignment_with_chips,
    chip_count: Number(o?.chip_count) || 0,
    missing_count: Number(o?.missing_count) || 0,
    missing_in_same_area: !!o?.missing_in_same_area,
    damaged_remaining_teeth: !!o?.damaged_remaining_teeth,
    misshapen_teeth: !!o?.misshapen_teeth,
    uneven_teeth: !!o?.uneven_teeth,
    gummy_smile: !!o?.gummy_smile,
    short_or_baby_teeth: !!o?.short_or_baby_teeth,
    has_existing_crowns_or_veneers: !!o?.has_existing_crowns_or_veneers,
  };

  // 1. All-on-4 consult: 4+ missing AND damaged remaining teeth
  if (f.missing_count >= 4 && f.damaged_remaining_teeth) return 'all_on_4';

  // 2. Implant Bridge: 3+ missing in same area
  if (f.missing_count >= 3 && f.missing_in_same_area) return 'implant_bridge';

  // 3. New Restorations: dark margins on EXISTING crowns/veneers (porcelain only)
  if (
    pathologyFlag?.is_dark_margin_on_existing_crown === true
    && f.has_existing_crowns_or_veneers
  ) return 'new_restorations';

  // 4. Implant or Bridge: 1 or 2 missing teeth
  if (f.missing_count >= 1) return 'missing_tooth';

  // 5. Crowns or Veneers: multiple chips + misalignment
  if (f.chip_count >= 2 && (f.misalignment_with_chips || f.crowding)) return 'crowns_or_veneers';

  // 6. Gingivectomy + Veneers: gummy smile or short/baby teeth
  if (f.gummy_smile || f.short_or_baby_teeth) return 'gingivectomy_veneers';

  // 7. Veneers: misshapen
  if (f.misshapen_teeth) return 'veneers_shape';

  // 8. Veneers: uneven
  if (f.uneven_teeth) return 'veneers_uneven';

  // 9. Bonding + Whitening: 1 chip + yellowing
  if (f.chip_count === 1) return 'bonding_whitening';

  // 10. Invisalign + Whitening: yellowing + crowding (no chips)
  if (f.yellowing && f.crowding) return 'invisalign_whitening';

  // 11. Invisalign only: crowding without yellowing or chips
  if (f.crowding) return 'invisalign_only';

  // 12. Whitening: yellowing only
  if (f.yellowing) return 'whitening_only';

  // 13. Inconclusive — fall back to page service
  return 'inconclusive';
}

// ════════════════════════════════════════════════════════════════════
// TEMPLATES — 13 scenarios
// ════════════════════════════════════════════════════════════════════

function buildResponse(scenario, observed, pathologyFlag, pagePath) {
  const summary = observed?.summary || '';
  const tpl = TEMPLATES[scenario] || TEMPLATES.inconclusive;
  const result = (typeof tpl === 'function') ? tpl({ observed, pathologyFlag, pagePath }) : tpl;

  // Attach metadata for GHL forwarding (widget reads these)
  result._scenario = scenario;
  result._findings = {
    visible_findings: extractVisibleFindings(observed),
  };
  result._pathology_flag = pathologyFlag || null;
  return result;
}

function extractVisibleFindings(o) {
  const codes = [];
  if (!o) return [];
  if (o.yellowing) codes.push({ code: 'yellowing', severity: 'mild' });
  if (o.crowding) codes.push({ code: 'crowding', severity: 'moderate' });
  if (o.chip_count >= 1) codes.push({ code: 'chipping', severity: o.chip_count >= 2 ? 'moderate' : 'mild', count: o.chip_count });
  if (o.missing_count >= 1) codes.push({ code: 'missing_tooth', severity: o.missing_count >= 3 ? 'severe' : 'moderate', count: o.missing_count });
  if (o.misshapen_teeth) codes.push({ code: 'misshapen', severity: 'moderate' });
  if (o.uneven_teeth) codes.push({ code: 'uneven', severity: 'moderate' });
  if (o.gummy_smile) codes.push({ code: 'gum_excess', severity: 'moderate' });
  if (o.short_or_baby_teeth) codes.push({ code: 'short_teeth', severity: 'moderate' });
  if (o.has_existing_crowns_or_veneers) codes.push({ code: 'existing_dental_work', severity: 'mild' });
  return codes;
}

const TEMPLATES = {
  // ───────────────────────────────────────────── 1. ALL-ON-4 ─
  all_on_4: {
    headline: 'Your smile would benefit from a comprehensive full-mouth consultation to discuss complete restoration.',
    bullets: [
      'Multiple teeth appear to be missing or significantly damaged.',
      'A complete plan can rebuild both function and appearance in one coordinated treatment.',
      'Our doctors will review the best path forward — All-on-4 is one option to discuss.',
    ],
    plan: {
      best_option: 'BEST OPTION — All-on-4 Consultation',
      best_detail: 'A full-arch implant solution that replaces missing teeth and rebuilds your smile in a single coordinated treatment, often in one day.',
      alternative: 'ALTERNATIVE — Comprehensive Restorative Evaluation',
      alt_detail: 'A complete in-person exam to map the right combination of implants, bridges, or restorations for your specific case.',
    },
    ideal_result: 'A stable, comfortable, healthy-looking smile rebuilt with a plan designed around your whole mouth.',
    urgency: 'priority',
    treatments: [
      { id: 'all_on_4', label: 'All-on-4 Consultation' },
      { id: 'full_crowns', label: 'Full Mouth Restoration' },
    ],
    cta: 'Book a free consultation — our doctors will walk you through every option in person.',
  },

  // ────────────────────────────────────── 2. IMPLANT BRIDGE ─
  implant_bridge: {
    headline: 'Multiple missing teeth in one area can be replaced together with a coordinated implant solution.',
    bullets: [
      'Several missing teeth are visible in the same region of your smile.',
      'An implant-supported bridge can replace them as one stable, natural-looking unit.',
      'A consultation will confirm bone health and the right placement plan.',
    ],
    plan: {
      best_option: 'BEST OPTION — Implant-Supported Bridge',
      best_detail: 'A small number of implants support a bridge that replaces multiple teeth — more stable than a traditional bridge and protects the bone underneath.',
      alternative: 'ALTERNATIVE — Multiple Single Implants',
      alt_detail: 'Each missing tooth replaced with its own implant. Best for cases where teeth need to function independently.',
    },
    ideal_result: 'Your smile feels complete and confident again, with replacement teeth that look and function like the originals.',
    urgency: 'priority',
    treatments: [
      { id: 'implant_bridge', label: 'Implant Bridge' },
      { id: 'implants', label: 'Dental Implants' },
    ],
    cta: 'Schedule a free implant consultation — your treatment plan starts with a 3D scan and a conversation.',
  },

  // ────────────────────────────────── 3. NEW RESTORATIONS ─
  // Only fires when pathology AI specifically detects dark margins on
  // existing porcelain (failing crown/veneer margins). Per doctors:
  // any other decay → "in-person consult" (silent backend flag),
  // not patient-visible "new restorations" recommendation.
  new_restorations: {
    headline: 'Your existing dental work shows signs that may benefit from updating — a refresh can restore both look and seal.',
    bullets: [
      'A darker line is visible at the gumline where existing crowns or veneers meet your natural tooth.',
      'This is a common sign that older restorations are ready to be refreshed.',
      'Replacing them keeps the seal tight and brings the color back to a natural, current shade.',
    ],
    plan: {
      best_option: 'BEST OPTION — New Crowns or Veneers',
      best_detail: 'Replacing aging porcelain work with modern materials that match your natural teeth, seal the margin, and restore that fresh-from-the-lab look.',
      alternative: 'ALTERNATIVE — Comprehensive Restorative Evaluation',
      alt_detail: 'A full in-person review of all existing dental work and your bite, so we plan any updates the right way.',
    },
    ideal_result: 'A clean, sealed, natural-looking smile where your dental work blends in seamlessly with the rest of your teeth.',
    urgency: 'soon',
    treatments: [
      { id: 'crowns', label: 'New Crowns' },
      { id: 'veneers', label: 'Porcelain Veneers' },
    ],
    cta: 'Book a free restorative consultation — Drs. Matian will assess each restoration in person.',
  },

  // ─────────────────────────────────── 4. MISSING TOOTH (1-2) ─
  missing_tooth: {
    headline: 'A missing tooth in your smile line can be replaced beautifully — and it makes a bigger difference than most people expect.',
    bullets: [
      'A visible gap is present in your smile.',
      'A dental implant can replace the tooth permanently with a natural-looking, stable result.',
      'A bridge is also an option using neighboring teeth for support.',
    ],
    plan: {
      best_option: 'BEST OPTION — Dental Implant',
      best_detail: 'A titanium implant fully replaces the missing tooth — looks, feels, and functions like a natural tooth, and protects the bone underneath.',
      alternative: 'ALTERNATIVE — Dental Bridge',
      alt_detail: 'A bridge fills the space using the neighboring teeth (or implants) for support. A faster, often more affordable option.',
    },
    ideal_result: 'Your smile looks complete again, with the gap closed and the replacement tooth blending into the surrounding teeth.',
    urgency: 'priority',
    treatments: [
      { id: 'implants', label: 'Dental Implants' },
      { id: 'bridge', label: 'Dental Bridge' },
    ],
    cta: 'Book a free implant consultation — same-day appointments available.',
  },

  // ───────────────────────── 5. CROWNS OR VENEERS (multi-chip + align) ─
  crowns_or_veneers: {
    headline: 'When multiple teeth show damage and alignment shifts together, a coordinated crown or veneer plan can transform your smile.',
    bullets: [
      'Multiple teeth show visible chips, wear, or breakage.',
      'There are also alignment differences across the front teeth.',
      'Crowns or veneers can rebuild structure AND realign the visual line of the smile in one plan.',
    ],
    plan: {
      best_option: 'BEST OPTION — Porcelain Crowns',
      best_detail: 'Full coverage crowns rebuild damaged teeth from the ground up — strongest option when multiple teeth need both structure and shape correction.',
      alternative: 'ALTERNATIVE — Porcelain Veneers',
      alt_detail: 'A more conservative option for cases where the underlying tooth is healthy enough — veneers transform the front-facing surfaces beautifully.',
    },
    ideal_result: 'A balanced, even, intentionally-designed smile where every front tooth fits together cleanly.',
    urgency: 'soon',
    treatments: [
      { id: 'crowns', label: 'Porcelain Crowns' },
      { id: 'veneers', label: 'Porcelain Veneers' },
    ],
    cta: 'Book a free smile design consultation — see your full plan before committing.',
  },

  // ───────────────────────── 6. GINGIVECTOMY + VENEERS (gummy/baby) ─
  gingivectomy_veneers: {
    headline: 'Your gum-to-tooth proportion can be rebalanced for a smile that shows more tooth and less gum.',
    bullets: [
      'A larger band of gum tissue is visible above your upper front teeth, OR your front teeth appear short relative to the gum.',
      'Gum contouring reshapes the gumline to reveal more natural tooth length.',
      'Adding veneers afterward can perfect the shape and shade of the newly visible teeth.',
    ],
    plan: {
      best_option: 'BEST OPTION — Gum Contouring (Gingivectomy)',
      best_detail: 'A precise, comfortable procedure that reshapes the gumline to expose more of your natural tooth — instantly more proportional smile.',
      alternative: 'ALTERNATIVE — Veneers After Gum Contouring',
      alt_detail: 'Once the gumline is balanced, veneers refine the shape and color of the newly-visible teeth for a fully designed result.',
    },
    ideal_result: 'A confident, balanced smile with longer-looking teeth and a gumline that frames them naturally.',
    urgency: 'standard',
    treatments: [
      { id: 'gum_contouring', label: 'Gum Contouring' },
      { id: 'veneers', label: 'Porcelain Veneers' },
    ],
    cta: 'Book a free smile design consultation — see exactly what your new proportions will look like.',
  },

  // ─────────────────────────────────────── 7. VENEERS — SHAPE ─
  veneers_shape: {
    headline: 'Tooth shape is one of the easiest things to redesign — porcelain veneers can completely transform a smile.',
    bullets: [
      'One or more teeth show unusual shape or proportion.',
      'Veneers redesign the front-facing surfaces with custom-shaped porcelain.',
      'You see a digital preview of the result before any treatment begins.',
    ],
    plan: {
      best_option: 'BEST OPTION — Porcelain Veneers',
      best_detail: 'Custom-designed porcelain shells that reshape, recolor, and refine your visible teeth in just two appointments.',
      alternative: 'ALTERNATIVE — Cosmetic Bonding',
      alt_detail: 'A less invasive option for smaller shape corrections — bonded composite that can be done in a single visit.',
    },
    ideal_result: 'A smile with proportional, beautifully-shaped front teeth that look natural and intentional.',
    urgency: 'standard',
    treatments: [
      { id: 'veneers', label: 'Porcelain Veneers' },
      { id: 'bonding', label: 'Cosmetic Bonding' },
    ],
    cta: 'Book a free veneer consultation — preview your new smile digitally before deciding.',
  },

  // ───────────────────────────────────── 8. VENEERS — UNEVEN ─
  veneers_uneven: {
    headline: 'When teeth sit at slightly different heights, veneers can even out the smile line in a way nothing else can.',
    bullets: [
      'The front teeth show visible differences in height or size.',
      'Veneers can be designed to bring every tooth into a balanced, even line.',
      'The result looks completely natural — no one knows but you and your dentist.',
    ],
    plan: {
      best_option: 'BEST OPTION — Porcelain Veneers',
      best_detail: 'Custom-shaped veneers placed on the front teeth even out height, shape, and color simultaneously for a fully harmonized smile.',
      alternative: 'ALTERNATIVE — Cosmetic Bonding',
      alt_detail: 'A more conservative option for minor evenness corrections — composite material placed in a single visit.',
    },
    ideal_result: 'A smile where every front tooth lines up beautifully — the kind of "even" that looks effortless.',
    urgency: 'standard',
    treatments: [
      { id: 'veneers', label: 'Porcelain Veneers' },
      { id: 'bonding', label: 'Cosmetic Bonding' },
    ],
    cta: 'Book a free smile consultation — see your designed result before committing.',
  },

  // ───────────────────────────── 9. BONDING + WHITENING (1 chip) ─
  bonding_whitening: {
    headline: 'A single chipped edge plus some yellowing can be addressed in two simple, affordable visits.',
    bullets: [
      'One front tooth shows a visible chipped or worn edge.',
      'The overall tooth shade also has some warmth that whitening can brighten.',
      'Whitening first, then bonding the chip to the new brighter shade — clean and seamless.',
    ],
    plan: {
      best_option: 'BEST OPTION — Cosmetic Bonding',
      best_detail: 'Tooth-colored composite material that rebuilds the chipped edge in a single visit — color-matched to your other teeth.',
      alternative: 'ALTERNATIVE — Professional Whitening',
      alt_detail: 'In-office whitening (one visit) or take-home trays (two weeks) brighten the overall shade so the bonding blends in perfectly.',
    },
    ideal_result: 'A repaired edge and a brighter shade — the smile looks even and clean again.',
    urgency: 'standard',
    treatments: [
      { id: 'bonding', label: 'Cosmetic Bonding' },
      { id: 'whitening', label: 'Professional Whitening' },
    ],
    cta: 'Book a free consultation — bonding plus whitening is one of our most popular combos.',
  },

  // ─────────────────────────── 10. INVISALIGN + WHITENING ─
  invisalign_whitening: {
    headline: 'Your smile shows both alignment and color opportunities — addressing them together creates a striking transformation.',
    bullets: [
      'The front teeth show visible crowding or uneven positioning.',
      'The tooth shade also appears warm or yellow.',
      'Many patients combine the two for a complete refresh in one coordinated plan.',
    ],
    plan: {
      best_option: 'BEST OPTION — Invisalign',
      best_detail: 'Clear aligners gradually correct alignment while you keep your natural lifestyle — most cases finish in 6-12 months.',
      alternative: 'ALTERNATIVE — Professional Whitening',
      alt_detail: 'After (or alongside) Invisalign, whitening brightens the shade for a fully refreshed result. Our practice offers both in-office and take-home options.',
    },
    ideal_result: 'A naturally straighter, brighter smile with everything addressed together for a coordinated transformation.',
    urgency: 'standard',
    treatments: [
      { id: 'invisalign', label: 'Invisalign' },
      { id: 'whitening', label: 'Professional Whitening' },
    ],
    cta: 'Book a free consultation — Drs. Matian will scan your bite and design your treatment plan.',
  },

  // ─────────────────────────────────── 11. INVISALIGN ONLY ─
  invisalign_only: {
    headline: 'Your smile has a strong foundation — alignment is the main opportunity, and Invisalign can refine it discreetly.',
    bullets: [
      'The front teeth show visible crowding or uneven positioning.',
      'No major structural or color concerns are visible.',
      'Clear aligners are the most popular choice for cases like yours.',
    ],
    plan: {
      best_option: 'BEST OPTION — Invisalign',
      best_detail: 'Clear, removable aligners gradually correct your alignment without metal brackets. Most cases finish in 6-12 months.',
      alternative: 'ALTERNATIVE — Cosmetic Veneers',
      alt_detail: 'For patients who want an instant alignment-and-color makeover, veneers can correct the look in just two appointments.',
    },
    ideal_result: 'A naturally straighter smile where every front tooth fits cleanly into a balanced line.',
    urgency: 'standard',
    treatments: [
      { id: 'invisalign', label: 'Invisalign' },
      { id: 'veneers', label: 'Porcelain Veneers' },
    ],
    cta: 'Book a free Invisalign consultation — get your custom treatment plan and pricing the same day.',
  },

  // ───────────────────────────────── 12. WHITENING ONLY ─
  whitening_only: {
    headline: 'Your smile foundation is strong — the most visible opportunity is brightening the overall shade.',
    bullets: [
      'The teeth show a warm, yellow, or stained shade across multiple teeth.',
      'No major chips, missing teeth, or alignment issues are visible.',
      'Professional whitening is the fastest, highest-impact change for cases like yours.',
    ],
    plan: {
      best_option: 'BEST OPTION — In-Office Whitening',
      best_detail: 'A single appointment using professional-strength whitening that lifts the shade dramatically — visible difference the same day.',
      alternative: 'ALTERNATIVE — Custom Take-Home Whitening Trays',
      alt_detail: 'Professional trays you wear at home over two weeks — gradual, gentle, and great for sensitive teeth. Many patients combine both.',
    },
    ideal_result: 'A noticeably brighter, cleaner-looking smile that catches the light and looks fresh from every angle.',
    urgency: 'standard',
    treatments: [
      { id: 'whitening', label: 'Professional Whitening' },
      { id: 'whitening_takehome', label: 'Take-Home Whitening Trays' },
    ],
    cta: 'Book a free whitening consultation — same-day appointments available.',
  },

  // ────────────────────────────── 13. INCONCLUSIVE FALLBACK ─
  inconclusive: ({ pagePath }) => {
    const p = (pagePath || '').toLowerCase();
    // Page-aware soft fallback — recommend the service of the page they're on
    if (p.includes('whitening')) return INCONCLUSIVE_WHITENING;
    if (p.includes('invisalign')) return INCONCLUSIVE_INVISALIGN;
    if (p.includes('implant')) return INCONCLUSIVE_IMPLANTS;
    if (p.includes('veneer')) return INCONCLUSIVE_VENEERS;
    return INCONCLUSIVE_GENERAL;
  },
};

const INCONCLUSIVE_WHITENING = {
  headline: 'Your smile is hard to fully assess from this angle — but professional whitening is one of the most popular cosmetic refinements.',
  bullets: [
    'Most adults benefit from a professional shade lift even when teeth look healthy.',
    'In-office whitening is one visit, take-home trays are two weeks.',
    'A free consultation will confirm the best option for your specific shade and sensitivity.',
  ],
  plan: {
    best_option: 'BEST OPTION — Professional Whitening Consultation',
    best_detail: 'Drs. Matian assess your current shade, sensitivity, and goals — then design the right whitening plan for your case.',
    alternative: 'ALTERNATIVE — Comprehensive Cosmetic Consultation',
    alt_detail: 'If whitening alone isn\'t enough, a broader cosmetic plan (veneers, bonding, etc.) can be designed.',
  },
  ideal_result: 'A naturally brighter smile that fits your face and lifestyle.',
  urgency: 'standard',
  treatments: [
    { id: 'whitening', label: 'Professional Whitening' },
    { id: 'whitening_takehome', label: 'Take-Home Whitening Trays' },
  ],
  cta: 'Book a free whitening consultation — same-day appointments available.',
};

const INCONCLUSIVE_INVISALIGN = {
  headline: 'Invisalign works for a wide range of smiles — a quick scan will show exactly what your treatment would look like.',
  bullets: [
    'Clear aligners can address crowding, spacing, and bite issues most patients didn\'t even know were treatable.',
    'A 3D scan in our office shows your complete treatment plan and timeline before you decide.',
    'Most cases finish in 6-12 months with appointments every 8 weeks.',
  ],
  plan: {
    best_option: 'BEST OPTION — Invisalign Consultation',
    best_detail: 'A free in-office scan and consultation that shows your custom treatment plan, timeline, and pricing the same day.',
    alternative: 'ALTERNATIVE — Comprehensive Cosmetic Consultation',
    alt_detail: 'If alignment alone won\'t hit your goals, we design a broader cosmetic plan that may include veneers or whitening alongside Invisalign.',
  },
  ideal_result: 'A naturally straighter smile, achieved discreetly, on your timeline.',
  urgency: 'standard',
  treatments: [
    { id: 'invisalign', label: 'Invisalign' },
    { id: 'veneers', label: 'Porcelain Veneers' },
  ],
  cta: 'Book a free Invisalign consultation — get your treatment plan the same day.',
};

const INCONCLUSIVE_IMPLANTS = {
  headline: 'Implant candidacy depends on what we can see in person — book a free consultation to see your options.',
  bullets: [
    'Modern implants replace missing teeth permanently with results that look and feel natural.',
    'A free consultation includes a 3D scan to assess bone health and placement options.',
    'Single implants, implant bridges, and full-arch options are all available.',
  ],
  plan: {
    best_option: 'BEST OPTION — Implant Consultation',
    best_detail: 'A complimentary in-office consultation including a 3D scan, placement plan, and same-day pricing.',
    alternative: 'ALTERNATIVE — Comprehensive Restorative Evaluation',
    alt_detail: 'For cases where multiple teeth need attention, a broader plan can sequence implants alongside any other treatment.',
  },
  ideal_result: 'A complete, comfortable, fully restored smile.',
  urgency: 'soon',
  treatments: [
    { id: 'implants', label: 'Dental Implants' },
    { id: 'implant_bridge', label: 'Implant Bridge' },
  ],
  cta: 'Book a free implant consultation — same-day appointments available.',
};

const INCONCLUSIVE_VENEERS = {
  headline: 'Veneers transform smiles in ways photos can\'t fully show — book a free consultation to see your designed result.',
  bullets: [
    'Custom porcelain veneers redesign shape, color, and proportion in just two appointments.',
    'A digital smile preview lets you see your new look before any treatment begins.',
    'Most full-smile cases use 6-10 veneers depending on the smile line.',
  ],
  plan: {
    best_option: 'BEST OPTION — Veneer Consultation',
    best_detail: 'A free in-office consultation with digital smile preview — see your designed result, then decide.',
    alternative: 'ALTERNATIVE — Cosmetic Bonding',
    alt_detail: 'A more conservative, single-visit option for smaller cosmetic refinements.',
  },
  ideal_result: 'A custom-designed smile that fits your face and looks completely natural.',
  urgency: 'standard',
  treatments: [
    { id: 'veneers', label: 'Porcelain Veneers' },
    { id: 'bonding', label: 'Cosmetic Bonding' },
  ],
  cta: 'Book a free veneer consultation — preview your new smile digitally before deciding.',
};

const INCONCLUSIVE_GENERAL = {
  headline: 'A complimentary in-person consultation will show you exactly what\'s possible for your smile.',
  bullets: [
    'Drs. Matian have helped patients with every kind of smile concern.',
    'A free consultation includes a full review and a custom plan with pricing.',
    'No commitment — just a clear picture of your options.',
  ],
  plan: {
    best_option: 'BEST OPTION — Smile Design Consultation',
    best_detail: 'A relaxed, complimentary in-office consultation where Drs. Matian review your goals and design a plan around them.',
    alternative: 'ALTERNATIVE — Specific Treatment Consultation',
    alt_detail: 'If you already have a treatment in mind (Invisalign, whitening, implants), book directly for that.',
  },
  ideal_result: 'A clear, custom plan to achieve the smile you actually want.',
  urgency: 'standard',
  treatments: [
    { id: 'smile_makeover', label: 'Smile Design Consultation' },
  ],
  cta: 'Book a free consultation — same-day appointments available.',
};

// ════════════════════════════════════════════════════════════════════
// CLAUDE API HELPER
// ════════════════════════════════════════════════════════════════════

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

function parseJsonSafe(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  // Find first { and last } to handle preamble/postamble
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(cleaned.substring(start, end + 1));
  } catch {
    return null;
  }
}

function isHardReject(qParsed) {
  if (!qParsed || qParsed.usable !== false) return false;
  const reason = (qParsed.reason || '').toLowerCase();
  // Be permissive — only reject if reason mentions a hard fail keyword
  return /no.*mouth|no.*teeth|completely dark|completely black|not.*person|animal|object|screenshot/.test(reason);
}

// ════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════

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

    // ─── DEEP DIVE ─────────────────────────────────────────────────
    if (mode === 'deep_dive' && treatmentLabel) {
      const res = await callClaude(apiKey, DEEPDIVE_PROMPT, [
        imageContent,
        { type: 'text', text: `Explain this treatment for this patient: ${treatmentLabel}` },
      ], 500);
      const text = ((await res.json())?.content?.[0]?.text || '').trim()
        || 'Call (818) 706-6077 for details.';
      return new Response(JSON.stringify({ analysis: text }), { status: 200, headers });
    }

    // ─── 1. QUALITY GATE ───────────────────────────────────────────
    try {
      const qRes = await callClaude(apiKey, QUALITY_PROMPT, [
        imageContent, { type: 'text', text: 'Assess photo quality.' },
      ], 150);
      const qParsed = parseJsonSafe((await qRes.json())?.content?.[0]?.text);
      if (qParsed && qParsed.usable === false && isHardReject(qParsed)) {
        console.log('[v16] quality gate hard-rejected:', qParsed.reason);
        return new Response(JSON.stringify({
          retake_required: true,
          reason: qParsed.reason || 'We need a clearer photo to give you an accurate result.',
          hint: qParsed.hint || 'Please retake your photo showing your smile clearly.',
        }), { status: 200, headers });
      }
    } catch (e) {
      console.warn('[v16] quality gate skipped:', e.message);
    }

    // ─── 2. EMERGENCY TRIAGE ───────────────────────────────────────
    let triage = { safe: true };
    try {
      const tRes = await callClaude(apiKey, TRIAGE_PROMPT, [
        imageContent, { type: 'text', text: 'Assess this image.' },
      ], 50);
      triage = parseJsonSafe((await tRes.json())?.content?.[0]?.text) || { safe: true };
    } catch (e) {
      console.warn('[v16] triage skipped:', e.message);
    }

    if (triage.safe === false) {
      const concern = (triage.concern || '').toLowerCase();
      const HARD_EMERGENCY_KEYWORDS = [
        'visible_blood', 'broken_tooth', 'trauma', 'abscess', 'deep_cavity',
        'fractured', 'displaced', 'pus', 'fistula', 'bleeding',
        'broken', 'split lip',
      ];
      const isLegit = HARD_EMERGENCY_KEYWORDS.some(k => concern.includes(k));
      if (isLegit) {
        console.log('[v16] true emergency:', triage.concern);
        const eRes = await callClaude(apiKey, EMERGENCY_PROMPT, [
          imageContent,
          { type: 'text', text: `The specific concern in this photo is: ${triage.concern}. Address only that.` },
        ], 400);
        const text = ((await eRes.json())?.content?.[0]?.text || '').trim()
          || 'Your photo shows something that should be checked promptly. Call (818) 706-6077 — same-day appointments available, consultation is free.';
        return new Response(JSON.stringify({
          emergency: true,
          urgency: 'priority',
          analysis: text,
          treatments: [],
        }), { status: 200, headers });
      } else {
        console.log('[v16] triage flagged unsafe but concern not in whitelist — IGNORING:', triage.concern);
      }
    }

    // ─── 3. OBSERVE ────────────────────────────────────────────────
    let observed = null;
    try {
      const oRes = await callClaude(apiKey, OBSERVE_PROMPT, [
        imageContent, { type: 'text', text: 'Answer all classification questions.' },
      ], 600);
      observed = parseJsonSafe((await oRes.json())?.content?.[0]?.text);
      console.log('[v16] observed:', JSON.stringify(observed).substring(0, 600));
    } catch (e) {
      console.error('[v16] observe error:', e.message);
    }

    // ─── 4. PATHOLOGY (silent backend signal, EXCEPT dark margins) ──
    let pathologyFlag = null;
    try {
      const hRes = await callClaude(apiKey, HEALTH_TRIAGE_PROMPT, [
        imageContent, { type: 'text', text: 'Screen for visible pathology.' },
      ], 250);
      pathologyFlag = parseJsonSafe((await hRes.json())?.content?.[0]?.text);
      console.log('[v16] pathology:', JSON.stringify(pathologyFlag));
    } catch (e) {
      console.warn('[v16] pathology skipped:', e.message);
    }

    // ─── 5. ROUTE ──────────────────────────────────────────────────
    const scenario = routeDecision(observed, pathologyFlag);
    console.log('[v16] routed to:', scenario);

    // ─── 6. BUILD RESPONSE ─────────────────────────────────────────
    const response = buildResponse(scenario, observed, pathologyFlag, pagePath);
    return new Response(JSON.stringify(response), { status: 200, headers });

  } catch (err) {
    console.error('[v16] handler error:', err.message);
    return new Response(JSON.stringify({
      error: 'Something went wrong. Call (818) 706-6077.',
    }), { status: 500, headers });
  }
}
