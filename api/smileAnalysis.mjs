// api/smileAnalysis.mjs
// Agoura Hills Dental Designs — Drs. David & Shawn Matian
// v17 — CLINICAL PRIORITY HARDENING (missing-tooth verifier + corroboration)
//
//   v16 had the right architecture: structured OBSERVE → decision tree →
//   template. The decision tree correctly prioritizes missing teeth
//   (rule #4: missing_count >= 1 → missing_tooth template, BEFORE any
//   cosmetic route).
//
//   The failure mode discovered in production: a patient submitted a
//   photo with an obviously visible missing front tooth, and OBSERVE
//   returned missing_count: 0. The decision tree did exactly what it
//   was told, routed to "yellowing + crowding" → Invisalign + Whitening.
//   Result: a clinically wrong, trust-destroying, revenue-destroying
//   recommendation for an implant case.
//
//   v17 fixes the upstream vision failure with three changes:
//   1. OBSERVE's missing-tooth instructions get a dedicated, leading,
//      visually-prescriptive block (look HERE, look for THIS pattern).
//   2. A new MISSING_TOOTH_VERIFIER pass runs in parallel with OBSERVE
//      and asks ONE question: is there a visible gap? Cheap, focused,
//      hard to miss. Used to corroborate OBSERVE's missing_count.
//   3. Post-OBSERVE corroboration: if verifier says yes and OBSERVE
//      says zero, the verifier wins. We log the disagreement so we
//      can monitor false positives.
//
//   PLUS: a post-route guardrail that catches the exact failure mode
//   from the production photo. If the route lands on a cosmetic-only
//   scenario (invisalign_*, whitening_only, bonding_whitening) but
//   the verifier flagged a missing tooth, we override to missing_tooth.
//
//   PRESERVED FROM v16:
//   - The 13-template library, the decision tree order, the GHL
//     forwarding contract, quality gate, emergency triage, pathology
//     screen, deep-dive mode, edge runtime, CORS — all unchanged.
//
//   ═══════════════════════════════════════════════════════════════
//   REGRESSION TEST FIXTURES (manual)
//   ═══════════════════════════════════════════════════════════════
//   When this file changes, run each of these through the deployed
//   endpoint and confirm the expected outcome. The first one is the
//   exact production failure that motivated v17.
//
//   1. MISSING-TOOTH CASE (the v17 forcing function)
//      Photo: clearly visible missing upper-front tooth (e.g. #8 or #9).
//      Expected:
//        - observed.missing_count >= 1
//        - clinical_observations.maxillary_anterior.teeth_missing
//          contains at least one of #7-#10
//        - scenario = "missing_tooth"
//        - response.headline references a tooth number (e.g. "#8")
//        - plan.best_option mentions "Implant" or "Bridge"
//        - treatments includes implants and/or bridge
//        - urgency = "priority"
//      Pre-v17 actual: returned invisalign_whitening. UNACCEPTABLE.
//
//   2. HEALTHY SMILE
//      Photo: clean, aligned, no obvious gap or shade issue.
//      Expected:
//        - observed.missing_count = 0, chip_count = 0
//        - clinical_observations.visualization_quality good
//        - scenario likely "whitening_only" (gentle) or
//          "inconclusive" page-aware fallback
//        - urgency = "standard"
//        - no implant/bridge recommendation
//
//   3. HEAVY DISCOLORATION ONLY
//      Photo: visibly stained/yellow but no chips/gaps/crowding.
//      Expected:
//        - observed.yellowing = true, missing_count = 0
//        - scenario = "whitening_only"
//        - plan.best_option = "In-Office Whitening"
//        - treatments includes whitening
//        - response.bullets reference shade
//
//   4. CROWDING + WARM SHADE (the originally-mis-served case, done right)
//      Photo: anterior crowding with warm shade, NO chips, NO missing.
//      Expected:
//        - observed.crowding = true, yellowing = true, missing_count = 0
//        - clinical_observations.maxillary_anterior.alignment references
//          specific teeth ("crowding at #9 #10")
//        - scenario = "invisalign_whitening"
//        - plan.best_option = "Invisalign", alternative = whitening
//        - response references at least one tooth number
//
//   5. GINGIVAL RECESSION ON LOWER ANTERIORS
//      Photo: visible gum recession on #24-#25 area.
//      Expected:
//        - clinical_observations.gingival_findings notes recession at
//          specific lower-incisor positions
//        - pathology screen may flag perio
//        - response acknowledges gingival concern in bullets
//        - if perio flag fires, scenario may route to inconclusive_general
//          with periodontal language; if not, recession should still
//          appear in clinical_observations for ops review
//
//   6. LIMITED VIEW / LIPS COVERING MOST TEETH
//      Photo: partial smile, only #7-#10 partially visible.
//      Expected:
//        - clinical_observations.visualization_quality reads "limited..."
//          and lists which teeth are partially visible
//        - response language hedges ("based on what's visible...")
//        - no over-confident structural claim
//
//   v16 ORIGINAL HEADER (preserved for context):
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

// DENTAL_ANATOMY_REFERENCE — injected into OBSERVE_PROMPT as the model's
// clinical cheat sheet. The model uses this to reason about every photo
// as a structured anatomical system instead of a vague visual region.
// Keep this dense — it has to fit comfortably in the system prompt budget.
const DENTAL_ANATOMY_REFERENCE = `═══════════════════════════════════════════════════════════════════
DENTAL ANATOMY REFERENCE — use this for every photo
═══════════════════════════════════════════════════════════════════

UNIVERSAL NUMBERING SYSTEM (US standard, 1-32):

MAXILLARY (upper arch) — left-to-right as viewed in photo (patient's right to patient's left):
  #1  Upper right third molar (wisdom)
  #2  Upper right second molar
  #3  Upper right first molar
  #4  Upper right second premolar (bicuspid)
  #5  Upper right first premolar
  #6  Upper right canine (cuspid)
  #7  Upper right lateral incisor
  #8  Upper right central incisor
  #9  Upper left central incisor
  #10 Upper left lateral incisor
  #11 Upper left canine
  #12 Upper left first premolar
  #13 Upper left second premolar
  #14 Upper left first molar
  #15 Upper left second molar
  #16 Upper left third molar

MANDIBULAR (lower arch) — left-to-right as viewed in photo (patient's left to patient's right):
  #17 Lower left third molar
  #18 Lower left second molar
  #19 Lower left first molar
  #20 Lower left second premolar
  #21 Lower left first premolar
  #22 Lower left canine
  #23 Lower left lateral incisor
  #24 Lower left central incisor
  #25 Lower right central incisor
  #26 Lower right lateral incisor
  #27 Lower right canine
  #28 Lower right first premolar
  #29 Lower right second premolar
  #30 Lower right first molar
  #31 Lower right second molar
  #32 Lower right third molar

CRITICAL ORIENTATION RULE: a selfie shows the patient facing the camera.
The patient's RIGHT side appears on the LEFT of the photo, and vice versa.
This is the #1 source of AI side-confusion errors. When you say
"patient's right central incisor," you mean tooth #8, which appears on
the LEFT side of the image. Double-check before committing to a side.

TOOTH GROUPS:
  INCISORS    #7-#10 + #23-#26      front teeth, biting/cutting, most cosmetic
  CANINES     #6, #11, #22, #27     pointed "corner" teeth, tear/grip
  PREMOLARS   #4-#5, #12-#13, #20-#21, #28-#29   transition teeth
  MOLARS      #2-#3, #14-#15, #18-#19, #30-#31   grinding/chewing
  WISDOM      #1, #16, #17, #32     often impacted/extracted

REGIONS:
  ANTERIOR  #6-#11 (upper), #22-#27 (lower)  visible in smile photos
  POSTERIOR molars + premolars               rarely visible front-on
  MIDLINE   between #8/#9 (upper), #24/#25 (lower)
  ARCH      curved tooth row (maxillary = upper; mandibular = lower)

GINGIVA:
  Healthy gingiva = coral pink, stippled, firm. Inflammation = red/swollen.
  GINGIVAL MARGIN     edge of gum meeting tooth
  INTERDENTAL PAPILLA triangular gum tissue between teeth
  RECESSION           gum pulled back, root exposed (sensitivity)
  GUMMY SMILE         >3 mm gingival display above #8/#9

COMMON CONDITIONS — visual signature → primary treatment:
  MISSING TOOTH        empty space in arch, no tooth structure       → Implant / Bridge
  BROKEN / FRACTURED   partial tooth with chip/crack/break visible    → Crown (large) / Bonding (small)
  SEVERE DECAY         dark brown/black areas, visible cavitation     → Crown / RCT+Crown / Extract → Implant
  DISCOLORATION        uniform yellow/gray/brown shade                → Whitening (stain) / Veneers (intrinsic)
  CROWDING             overlapping/rotated anterior teeth             → Invisalign
  SPACING / DIASTEMA   gaps between fully-present teeth               → Invisalign / Bonding / Veneers
  WORN INCISAL EDGES   flat/scalloped from bruxism                    → Bonding / Occlusal guard
  PEG / SMALL TEETH    undersized lateral incisors                    → Veneers / Bonding
  GINGIVAL RECESSION   gum line above CEJ                             → Periodontal eval / Soft-tissue graft
  INFLAMED GUMS        red/swollen at gingival margin                 → Periodontal cleaning / SRP

PRIORITY HIERARCHY (highest acuity wins, ALWAYS):
  1. Structural/functional (missing, decay, fracture, abscess, perio) → primary
  2. Alignment (crowding, spacing)                                     → secondary
  3. Cosmetic (shade, minor shape)                                     → only after 1+2 addressed

If you ever recommend a cosmetic-only treatment (whitening, Invisalign)
to a patient with a structural finding, you have failed your primary job.`;

const OBSERVE_PROMPT = `You are a dental smile classifier with the discipline of a clinician doing a chart entry. You analyze a casual smartphone smile photo through a structured anatomical lens. Pattern-matching against general "smile" appearance is a failure mode — you must reason like a clinician walking the arch.

${DENTAL_ANATOMY_REFERENCE}

═══════════════════════════════════════════════════════════════════
FORCED ANATOMICAL REASONING PASS — DO THIS FIRST
═══════════════════════════════════════════════════════════════════

Before you produce ANY treatment-relevant fields below, you must do an anatomical pass. The pass is a structured observation log that grounds the rest of your output in what you actually see — tooth by tooth, not vibe by vibe.

A. ARCH SCAN
   Walk the maxillary arch (upper). For each visible position from #6 through #11, name the position and report:
     - present-healthy / present-damaged / missing
   Walk the visible portion of the mandibular arch (lower). Same protocol for #22 through #27.
   For each gap: is the tooth entirely absent (alveolar position empty), or is a partial tooth structure visible (broken stub)? This is the missing-vs-broken disambiguation and it changes the treatment.

B. TOOTH-BY-TOOTH ASSESSMENT (anterior teeth only)
   For each visible tooth #6-#11 (upper) and #22-#27 (lower), record:
     - status: present-healthy / present-damaged / missing
     - if damaged: type (chip / crack / decay / discoloration / wear)
     - shade descriptor (white-bright / mildly warm / warm-yellow / gray / dark)
     - alignment (in-position / rotated / labially-displaced / lingually-displaced)

C. ARCH ALIGNMENT
   - crowding present? severity (mild / moderate / severe)
   - spacing / diastema present? location
   - midline alignment (centered / deviated)

D. GINGIVAL ASSESSMENT
   - gum color (healthy-pink / inflamed-red)
   - recession visible? on which teeth
   - gingival margin level (even / uneven)
   - visible plaque or tartar?

E. OCCLUSAL / WEAR ASSESSMENT
   - visible wear on incisal edges? which teeth
   - edges scalloped or flat (bruxism indicator)?

F. SYNTHESIS
   Rank the findings by severity using the priority hierarchy:
     1. Structural/functional (missing, decay, fracture, perio) — ALWAYS PRIMARY
     2. Alignment — secondary unless severe
     3. Cosmetic shade — last
   Identify the dominant finding. This will drive the treatment recommendation downstream.

═══════════════════════════════════════════════════════════════════
CLINICAL PRIORITY ORDER — REINFORCEMENT
═══════════════════════════════════════════════════════════════════

The most consequential finding in any dental photo is a MISSING TOOTH. You already checked for it in Pass A. Now you commit to it.

Recommending a cosmetic treatment (Invisalign, whitening) to someone with a missing tooth is a clinical accuracy failure and a trust-destroying experience for the patient. Bias toward NOTICING a gap, not missing one. A false positive (you flag a gap that turns out to be a deep shadow) is recoverable in consultation — a false negative (you miss a visible gap and recommend whitening) is catastrophic.

VISUALIZATION CAVEAT: if lips, angle, or focus obscure the view, do not guess. Use visualization_quality = "limited — only #X-#Y partially visible" and hedge accordingly. Saying "I can't fully see" is correct; making up findings is harmful.

═══ STEP 1 — MISSING TEETH (CHECK FIRST, ALWAYS) ═══

Walk the upper arch tooth-by-tooth from the patient's right canine to the left canine. Then walk the visible portion of the lower arch the same way. As you walk, ask at every position: "Is there a tooth here, or is there an empty space where a tooth should be?"

A visible gap typically looks like ONE of these:
  - A dark space between two teeth that is the WIDTH of a tooth (not a thin diastema gap — a full tooth-sized absence)
  - A spot where the tooth-row line breaks — two teeth on either side, nothing in between
  - A shorter, partial tooth stub adjacent to a normal-height neighbor
  - The dark interior of the mouth showing through where a tooth should be the boundary
  - An obvious asymmetry — the patient's left side has a tooth at position X, but the right side does not

Front central incisors (positions #8 and #9) are the highest-priority check — they are the most visible teeth, the easiest to confirm a gap on, and the most clinically/cosmetically meaningful when absent.

DO count:
  - A full-tooth-width gap, even if you are only 70-80% certain
  - A partially-broken-down stub that no longer functions as a tooth
DO NOT count:
  - Normal even spacing between otherwise-complete teeth (a thin diastema)
  - The dark mouth space BEHIND the front teeth
  - Teeth that look unusually shaped but are present

- missing_count: Integer count of teeth clearly absent. If you see even ONE clearly absent tooth in the front (incisor or canine), return at least 1. Do not return 0 just because you are not 100% certain — a 70%+ certainty of a visible gap counts as 1.
- missing_in_same_area: If 2+ missing, are they clustered in the same arch/region? (true/false)
- damaged_remaining_teeth: If multiple missing, do the REMAINING visible teeth ALSO look damaged, broken down, or severely decayed? (true/false — only relevant when missing_count >= 3)

═══ STEP 2 — COLOR & SHADE ═══
- yellowing: Are the teeth visibly yellow, warm, or stained? (Most adults have some yellowing — flag if teeth are clearly not white-bright.)

═══ STEP 3 — ALIGNMENT ═══
- crowding: Are teeth visibly overlapping, rotated, or out of arch alignment?
- misalignment_with_chips: Are teeth BOTH misaligned AND showing chips/wear/breakage?

═══ STEP 4 — STRUCTURAL DAMAGE ═══
Look CAREFULLY at the EDGES of every visible tooth, especially front incisors. Flag chips, wear, jagged edges, broken pieces, or any irregularity in the bite-edge line.
- chip_count: Approximate count of teeth with visible chips, wear, or broken edges. 0 if none visible. Look at lower teeth too — wear is extremely common there.

═══ STEP 5 — TOOTH SHAPE ═══
- misshapen_teeth: Do any teeth appear unusually shaped (peg-shaped, narrow, malformed, much smaller than neighbors)? (true/false)
- uneven_teeth: Do the front teeth show clearly different heights/sizes that aren't from chips? (true/false)

═══ STEP 6 — GUM & TEETH PROPORTION ═══
- gummy_smile: Does the smile show an unusual amount of gum tissue above the upper teeth? (true/false)
- short_or_baby_teeth: Do the upper front teeth look very small, short, or "baby-tooth-like" relative to the gum/lip frame? (true/false)

═══ STEP 7 — EXISTING DENTAL WORK ═══
- has_existing_crowns_or_veneers: Are there clearly existing porcelain restorations visible (uniform white teeth, distinct from natural teeth)? (true/false)

═══ STEP 8 — SELF-CHECK ═══
Before you write your final JSON output, re-read what you have. Ask yourself:
  - If a layperson glanced at this photo, what is the FIRST thing they would notice?
  - If a missing tooth is visible, does my missing_count reflect that?
  - If I set missing_count > 0, am I about to also write a summary that mentions yellowing or crowding without mentioning the gap? If yes, fix the summary — the gap leads.

If your check reveals an inconsistency (e.g. you see a clearly visible gap in the photo but your missing_count is 0), correct your output BEFORE returning. The downstream code uses missing_count to drive treatment recommendations — getting this wrong steers patients into the wrong treatment.

═══ EVIDENCE ═══
- summary: Two short sentences describing what you actually see in the photo, plain language, for use in patient-facing copy. If missing_count > 0, the FIRST sentence MUST reference the visible gap (e.g. "a missing front tooth," "a gap in the upper smile line"). Do not lead with shade or alignment when a structural finding is present.

Return ONLY this JSON, no preamble, no markdown.

The top-level booleans/counts drive the downstream decision tree — keep them strictly accurate. The "clinical_observations" block is your structured anatomical pass — it grounds the recommendation in real findings and becomes auditable provenance. If something is not visible, use empty arrays / empty strings / "limited" — never guess.

{
  "clinical_observations": {
    "maxillary_anterior": {
      "teeth_visible":   ["<universal numbers like #7, #8, #9>"],
      "teeth_missing":   ["<universal numbers of clearly absent teeth>"],
      "teeth_broken":    ["<universal numbers of partially-present / fractured teeth>"],
      "teeth_decayed":   ["<universal numbers showing decay / cavitation>"],
      "alignment":       "<short note, e.g. 'mild crowding at #9 #10' or 'in-arch alignment'>",
      "shade":           "<short shade descriptor, e.g. 'mildly warm', 'warm-yellow'>",
      "notes":           "<one short clinical note if relevant, else empty>"
    },
    "mandibular_anterior": {
      "teeth_visible":   [],
      "teeth_missing":   [],
      "teeth_broken":    [],
      "teeth_decayed":   [],
      "alignment":       "",
      "shade":           "",
      "notes":           ""
    },
    "gingival_findings":     "<one short sentence, e.g. 'mild marginal inflammation at #8 #9; no recession visible' or 'no visible gingival concerns'>",
    "midline_alignment":     "centered" | "deviated" | "not assessable",
    "visualization_quality": "<'good — full anterior visible', or 'limited — only #X-#Y partially visible', etc.>",
    "dominant_finding":      "<one short phrase naming the single dominant finding, e.g. 'missing #8' or 'mild generalized yellowing'>"
  },
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
  "summary": "<two short sentences for patient-facing copy. If missing_count > 0, the first sentence MUST reference the visible gap by tooth number or position (e.g. 'A missing upper front tooth (#8)').>"
}`;

// MISSING_TOOTH_VERIFIER — runs in parallel with OBSERVE as a focused second
// look. Asks ONE question — is there a visible gap where a tooth should be?
// Used to corroborate OBSERVE's missing_count. If verifier disagrees with
// OBSERVE (verifier sees a gap, OBSERVE returned 0), verifier wins and we
// log the disagreement. This catches the production failure mode where the
// vision pass biased toward cosmetic findings and missed the obvious gap.
const MISSING_TOOTH_VERIFIER_PROMPT = `You are looking at a casual smartphone smile photo. You answer ONE question with extreme care: is there a visible MISSING TOOTH in this photo?

A missing tooth means a tooth that should be present in the dental arch is ABSENT — there is a clear empty space where a tooth belongs. The classic presentations:
  - A dark, tooth-sized gap between two otherwise-normal teeth
  - A broken stub where a full tooth should be (a tooth so broken down it no longer functions)
  - The mouth interior visible through the smile line because a front tooth is gone
  - The patient's two sides of the smile are asymmetric — one side has a tooth at a position, the other side has empty space

Walk the upper arch from one canine to the other, then walk the visible lower arch. At every position, ask: "Is there a tooth here, or is this an empty space?" Pay extra attention to the front central incisors (the two biggest front teeth) — gaps there are the most visible and the most clinically meaningful.

DO NOT confuse a missing tooth with:
  - The normal dark space INSIDE the mouth behind the front teeth
  - A small thin space between two otherwise-complete teeth (diastema)
  - A tooth that looks unusually shaped but is structurally present

If you see a clear gap, answer true even if you are not 100% certain. A 70%+ certainty counts. If you are less than 70% certain, answer false but note your uncertainty in the location field.

If a tooth is gone, identify its Universal Numbering position when possible (#1-#32). Anterior reference: maxillary anterior is #6-#11 (left of midline in photo = patient's right = #6,#7,#8; right of midline in photo = patient's left = #9,#10,#11). Mandibular anterior is #22-#27.

ORIENTATION GUARD: a selfie shows the patient facing the camera, so the patient's right side appears on the LEFT half of the photo. Triple-check this before labeling a side.

Return ONLY this JSON:
{
  "missing_tooth_visible": true | false,
  "count": <integer — best estimate of how many teeth are absent, 0 if none>,
  "tooth_numbers": ["<universal numbers of absent teeth, e.g. '#8', '#9'>"],
  "location": "<short plain description with tooth #, e.g. 'upper front #8 (patient's right central incisor)' — or empty string>",
  "confidence": "high" | "medium" | "low"
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
  headline: 'Based on your photo, a dental implant or implant-supported bridge is the most effective way to restore your smile.',
  bullets: [
    'A titanium implant fully replaces the missing tooth — looks, feels, and functions like a natural tooth.',
    'When multiple teeth are missing in one area, an implant-supported bridge can replace them with fewer implants.',
    'Both options protect the underlying jawbone and prevent shifting of neighboring teeth.',
  ],
  plan: {
    best_option: 'BEST OPTION — Dental Implant',
    best_detail: 'A permanent titanium post topped with a custom crown. Functions exactly like a natural tooth, preserves the jawbone, and lasts a lifetime with proper care.',
    alternative: 'ALTERNATIVE — Implant-Supported Bridge',
    alt_detail: 'Two implants support a bridge replacing three or more adjacent teeth in one area — more stable than a traditional bridge and protects the bone underneath.',
  },
  risks: [
    'The jawbone where the tooth is missing begins to resorb (shrink) within months, making future treatment more complex and more costly.',
    'Neighboring teeth shift into the empty space, throwing off your bite and causing wear, chips, or TMJ issues.',
    'The longer you wait, the more likely you will need a bone graft before an implant can be placed — adding time and cost to the procedure.',
  ],
  ideal_result: 'A complete, natural-looking smile with a replacement tooth that functions and feels exactly like the original.',
  urgency: 'soon',
  treatments: [
    { id: 'implants', label: 'Dental Implants' },
    { id: 'implant_bridge', label: 'Implant Bridge' },
  ],
  cta: 'Book your complimentary consultation — Drs. Matian will do a 3D scan, plan your implant placement, and give you an exact same-day quote.',
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
// ANATOMICAL ENRICHMENT & VALIDATION
// ════════════════════════════════════════════════════════════════════

// Pull a usable tooth-number reference out of clinical_observations.
// Returns a string like "#8" or "#8 and #9" or null if nothing usable.
function pickToothRef(co, scenario) {
  if (!co) return null;
  const max = co.maxillary_anterior || {};
  const man = co.mandibular_anterior || {};
  const pickList = (arr) => Array.isArray(arr) ? arr.filter(Boolean).slice(0, 2) : [];

  // For missing-tooth scenarios, prefer missing teeth
  if (scenario === 'missing_tooth' || scenario === 'implant_bridge' || scenario === 'all_on_4') {
    const m = [...pickList(max.teeth_missing), ...pickList(man.teeth_missing)].slice(0, 2);
    if (m.length) return m.join(' and ');
  }
  // For damage scenarios, prefer broken/decayed
  if (scenario === 'crowns_or_veneers' || scenario === 'bonding_whitening') {
    const d = [...pickList(max.teeth_broken), ...pickList(max.teeth_decayed),
               ...pickList(man.teeth_broken), ...pickList(man.teeth_decayed)].slice(0, 2);
    if (d.length) return d.join(' and ');
  }
  // For alignment / cosmetic scenarios, reference the visible anterior teeth
  const v = [...pickList(max.teeth_visible)].slice(0, 2);
  if (v.length) return v.join(' and ');
  return null;
}

// Splice a tooth-number reference into the template's headline and first
// bullet so patient-facing copy is anatomically specific to THIS photo.
// Non-destructive: if no usable ref is found, leave the template alone.
function enrichWithAnatomy(response, observed, scenario) {
  const co = observed?.clinical_observations;
  if (!co || !response) return response;

  const ref = pickToothRef(co, scenario);
  const dominant = (co.dominant_finding || '').trim();

  // Headline: append a parenthetical with the specific finding when we have one.
  if (ref && response.headline && !/#\d+/.test(response.headline)) {
    if (scenario === 'missing_tooth' || scenario === 'implant_bridge' || scenario === 'all_on_4') {
      response.headline = response.headline.replace(/\.?$/, ` — specifically ${ref}.`);
    } else if (dominant) {
      response.headline = response.headline.replace(/\.?$/, ` (${dominant}).`);
    }
  }

  // First bullet: prepend a specific anatomical finding when available.
  if (Array.isArray(response.bullets) && response.bullets.length > 0) {
    const first = response.bullets[0];
    if (ref && !/#\d+/.test(first)) {
      if (scenario === 'missing_tooth' || scenario === 'implant_bridge' || scenario === 'all_on_4') {
        response.bullets[0] = `Visible gap at ${ref}. ${first}`;
      } else if (scenario === 'crowns_or_veneers' || scenario === 'bonding_whitening') {
        response.bullets[0] = `Damage visible at ${ref}. ${first}`;
      } else if (co?.dominant_finding) {
        response.bullets[0] = `${co.dominant_finding}. ${first}`;
      }
    }
  }

  // Stash the dominant finding + clinical_observations on the response so GHL
  // can surface them and ops can audit. Patient-facing widget already ignores
  // underscore-prefixed fields it doesn't know about.
  response._clinical_observations = co;
  if (dominant) response._dominant_finding = dominant;
  return response;
}

// Anatomical specificity check: headline or at least one bullet must reference
// a specific tooth (#N) or an anatomical term. If not, the model defaulted to
// generic boilerplate and the response is unfit to ship.
const ANATOMICAL_TERMS_RE = /#\d+|incisor|canine|cuspid|molar|premolar|bicuspid|maxillary|mandibular|anterior|posterior|gingival|gum line|gum-line|midline|arch/i;
function hasAnatomicalSpecificity(response) {
  if (!response) return false;
  const corpus = [response.headline, ...(Array.isArray(response.bullets) ? response.bullets : [])]
    .filter(s => typeof s === 'string').join(' \n ');
  return ANATOMICAL_TERMS_RE.test(corpus);
}

// Side-confusion heuristic: if a single finding sentence mentions BOTH
// "right" and "left" with tooth context, flag it. The model is likely
// confusing patient orientation. Returns true if a likely confusion exists.
function hasSideConfusion(response) {
  if (!response) return false;
  const sentences = [response.headline, ...(Array.isArray(response.bullets) ? response.bullets : [])]
    .filter(s => typeof s === 'string');
  for (const s of sentences) {
    const lower = s.toLowerCase();
    const hasRight = /\bright\b/.test(lower);
    const hasLeft = /\bleft\b/.test(lower);
    const hasToothCtx = /tooth|incisor|canine|cuspid|molar|premolar|#\d+/.test(lower);
    if (hasRight && hasLeft && hasToothCtx) return true;
  }
  return false;
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

    // ─── 3. OBSERVE + MISSING-TOOTH VERIFIER (parallel) ────────────
    // We run the structured OBSERVE pass and a dedicated missing-tooth
    // verifier IN PARALLEL. Verifier is a focused second look that asks
    // ONE question — is there a visible gap? If OBSERVE missed one,
    // verifier catches it. Cost: one extra Claude call per analysis.
    let observed = null;
    let missingVerifier = null;
    try {
      const [oRes, mRes] = await Promise.all([
        callClaude(apiKey, OBSERVE_PROMPT, [
          imageContent, { type: 'text', text: 'Answer all classification questions.' },
        ], 700),
        callClaude(apiKey, MISSING_TOOTH_VERIFIER_PROMPT, [
          imageContent, { type: 'text', text: 'Is there a visible missing tooth?' },
        ], 200),
      ]);
      observed = parseJsonSafe((await oRes.json())?.content?.[0]?.text);
      missingVerifier = parseJsonSafe((await mRes.json())?.content?.[0]?.text);
      console.log('[v17] observed:', JSON.stringify(observed).substring(0, 600));
      console.log('[v17] missing_verifier:', JSON.stringify(missingVerifier));
    } catch (e) {
      console.error('[v17] observe/verifier error:', e.message);
    }

    // ─── 3b. CORROBORATE missing_count ─────────────────────────────
    // If verifier sees a gap with medium/high confidence but OBSERVE
    // returned 0 — verifier wins. This is the exact production bug:
    // OBSERVE biased toward cosmetic findings, missed the obvious gap.
    if (observed && missingVerifier?.missing_tooth_visible === true) {
      const vCount = Math.max(1, Number(missingVerifier.count) || 1);
      const vConfidence = (missingVerifier.confidence || 'low').toLowerCase();
      const oCount = Number(observed.missing_count) || 0;
      if (oCount === 0 && (vConfidence === 'high' || vConfidence === 'medium')) {
        console.log('[v17] CORROBORATION OVERRIDE — verifier saw gap that OBSERVE missed.',
          'observed.missing_count=0 →', vCount,
          '| location:', missingVerifier.location,
          '| confidence:', vConfidence);
        observed.missing_count = vCount;
        // Also bump summary so it leads with the gap.
        if (missingVerifier.location) {
          observed.summary = `A visible missing tooth at the ${missingVerifier.location}. ${observed.summary || ''}`.trim();
        }
      } else if (vCount > oCount && vConfidence === 'high') {
        console.log('[v17] CORROBORATION BUMP — verifier counted more gaps than OBSERVE.',
          'observed.missing_count=', oCount, '→', vCount);
        observed.missing_count = vCount;
      }
    }

    // ─── 4. PATHOLOGY (silent backend signal, EXCEPT dark margins) ──
    let pathologyFlag = null;
    try {
      const hRes = await callClaude(apiKey, HEALTH_TRIAGE_PROMPT, [
        imageContent, { type: 'text', text: 'Screen for visible pathology.' },
      ], 250);
      pathologyFlag = parseJsonSafe((await hRes.json())?.content?.[0]?.text);
      console.log('[v17] pathology:', JSON.stringify(pathologyFlag));
    } catch (e) {
      console.warn('[v17] pathology skipped:', e.message);
    }

    // ─── 5. ROUTE ──────────────────────────────────────────────────
    let scenario = routeDecision(observed, pathologyFlag);
    console.log('[v17] routed to:', scenario);

    // ─── 5b. POST-ROUTE GUARDRAIL ──────────────────────────────────
    // Final safety net for the production failure mode: if the route
    // landed on a cosmetic-only scenario but the verifier flagged a
    // missing tooth with any non-low confidence, override to
    // missing_tooth. Catches the case where OBSERVE returned 0,
    // corroboration didn't trigger (e.g. verifier confidence was
    // medium but we still picked a cosmetic route for another reason),
    // and routing missed the structural finding.
    const COSMETIC_ONLY_SCENARIOS = new Set([
      'invisalign_only',
      'invisalign_whitening',
      'whitening_only',
      'bonding_whitening',
    ]);
    if (
      COSMETIC_ONLY_SCENARIOS.has(scenario)
      && missingVerifier?.missing_tooth_visible === true
      && (missingVerifier.confidence || '').toLowerCase() !== 'low'
    ) {
      console.log('[v17] POST-ROUTE GUARDRAIL — overriding cosmetic route',
        scenario, '→ missing_tooth (verifier flagged gap).');
      scenario = 'missing_tooth';
      // Force missing_count to at least 1 so downstream extractVisibleFindings
      // emits the missing_tooth code for GHL.
      if (observed) observed.missing_count = Math.max(1, Number(observed.missing_count) || 1);
    }

    // ─── 6. BUILD RESPONSE ─────────────────────────────────────────
    let response = buildResponse(scenario, observed, pathologyFlag, pagePath);

    // ─── 6b. ANATOMICAL ENRICHMENT ─────────────────────────────────
    // Splice tooth numbers from clinical_observations into headline/bullets
    // so the patient-facing copy is specific to THIS photo, not generic.
    response = enrichWithAnatomy(response, observed, scenario);

    // ─── 6c. ANATOMICAL SPECIFICITY VALIDATION ─────────────────────
    // Fail closed if the response doesn't reference any specific tooth or
    // anatomical term — model defaulted to generic language. ONE retry
    // with a stricter reminder to reference tooth numbers.
    if (!hasAnatomicalSpecificity(response)) {
      console.log('[v17] SPECIFICITY FAIL — retrying OBSERVE with anatomy reminder.');
      try {
        const strictMsg = 'Your previous classification produced generic language. Re-analyze and ensure your clinical_observations include specific Universal Numbering tooth numbers (#1-#32) for every visible anterior tooth, every missing tooth, and every damaged tooth. The downstream patient copy must reference at least one specific tooth by number.';
        const oRetry = await callClaude(apiKey, OBSERVE_PROMPT, [
          imageContent,
          { type: 'text', text: strictMsg },
        ], 1100);
        const observedRetry = parseJsonSafe((await oRetry.json())?.content?.[0]?.text);
        if (observedRetry) {
          console.log('[v17] retry observed:', JSON.stringify(observedRetry).substring(0, 600));
          // Re-corroborate with the still-valid verifier signal
          if (missingVerifier?.missing_tooth_visible === true) {
            const vCount = Math.max(1, Number(missingVerifier.count) || 1);
            const vConfidence = (missingVerifier.confidence || 'low').toLowerCase();
            if ((Number(observedRetry.missing_count) || 0) === 0
                && (vConfidence === 'high' || vConfidence === 'medium')) {
              observedRetry.missing_count = vCount;
            }
          }
          const scenarioRetry = routeDecision(observedRetry, pathologyFlag);
          let responseRetry = buildResponse(scenarioRetry, observedRetry, pathologyFlag, pagePath);
          responseRetry = enrichWithAnatomy(responseRetry, observedRetry, scenarioRetry);
          if (hasAnatomicalSpecificity(responseRetry)) {
            response = responseRetry;
            console.log('[v17] retry produced specific output, using it.');
          } else {
            console.log('[v17] retry still generic, keeping enriched original.');
          }
        }
      } catch (e) {
        console.warn('[v17] specificity retry failed:', e.message);
      }
    }

    // ─── 6d. SIDE-CONFUSION HEURISTIC ──────────────────────────────
    // If a single finding sentence references BOTH "right" and "left"
    // with tooth context, the model likely confused orientation. Strip
    // side language as a safety net so we don't ship a misleading sentence.
    if (hasSideConfusion(response)) {
      console.log('[v17] SIDE-CONFUSION detected — neutralizing right/left wording.');
      const neutralize = (s) => typeof s === 'string'
        ? s.replace(/\b(patient'?s?\s+)?(right|left)\s+(?=(central |lateral )?(incisor|canine|cuspid|molar|premolar|tooth))/gi, '')
            .replace(/\s+/g, ' ').trim()
        : s;
      response.headline = neutralize(response.headline);
      if (Array.isArray(response.bullets)) response.bullets = response.bullets.map(neutralize);
    }

    // Surface verifier signal in the GHL forwarding payload for ops
    // visibility — does not change patient-facing copy.
    if (missingVerifier) response._missing_verifier = missingVerifier;
    return new Response(JSON.stringify(response), { status: 200, headers });

  } catch (err) {
    console.error('[v16] handler error:', err.message);
    return new Response(JSON.stringify({
      error: 'Something went wrong. Call (818) 706-6077.',
    }), { status: 500, headers });
  }
}
