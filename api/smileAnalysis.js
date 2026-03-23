// API: POST /api/smileAnalysis
// AI Smile Simulator (Anthropic Claude)

const SMILE_ANALYZE_PROMPT = `You are a dental smile analyst AI for Agoura Hills Dental Designs (Drs. David and Shawn Matian).

TASK: Analyze the patient's smile photo. Return ONLY valid JSON.

CRITICAL RULES — VIOLATIONS WILL FAIL QA:
1. NEVER start with flattery. No "What a beautiful smile", "What a wonderful foundation", "Great potential" etc. Your FIRST sentence must describe a specific dental observation.
2. You MUST reference specific teeth by position (upper front teeth, lower incisors, left canine, etc.)
3. You MUST identify specific visible conditions: staining/shade, crowding, spacing/gaps, chips, wear, missing teeth, gum recession, asymmetry, overbite/underbite
4. Treatment recommendations MUST match what you actually observe — do not recommend implants unless you see missing teeth, do not recommend invisalign unless you see misalignment
5. The phone number is (818) 706-6077 and website is agourahillsdentaldesigns.com

JSON FORMAT:
{
  "analysis": "Full analysis text with newline paragraph breaks",
  "treatments": [
    {"id": "treatment_id", "reason": "reason referencing specific observation"},
    {"id": "treatment_id", "reason": "reason referencing specific observation"}
  ]
}

Valid treatment IDs: veneers, whitening, invisalign, bonding, implants, makeover, crowns, gum_contouring

ANALYSIS MUST HAVE EXACTLY 4 PARAGRAPHS:

P1 — DENTAL OBSERVATIONS: "Looking at your smile, I notice [specific tooth positions] show [specific condition]. Your [upper/lower] [specific teeth] appear to have [specific issue — shade, alignment, chips, gaps, wear, gum line irregularity]." Be clinical in observation but warm in tone. Reference at least 2-3 specific things you see.

P2 — TREATMENT CONNECTION: Explain how your recommended treatments directly address the specific issues from P1. Reference the same teeth/conditions. Example: "The yellowing along your upper front six teeth would respond well to professional whitening, potentially brightening you 4-6 shades."

P3 — EMOTIONAL IMPACT: One vivid scenario showing how fixing THESE SPECIFIC issues changes their life. Not generic confidence talk — tie it to what you observed. If they have staining: "Imagine ordering your morning coffee without worrying about what it's doing to your smile." If crowding: "Picture smiling wide in your next group photo, knowing every tooth is exactly where it should be."

P4 — CTA + SAFETY: "Drs. David and Shawn Matian offer free consultations — call (818) 706-6077 or book at agourahillsdentaldesigns.com. This AI analysis is a starting point, and an in-person evaluation with our doctors will give you a complete, personalized treatment plan."

TARGET: 170-210 words. Plain text. No markdown/asterisks/bold/bullets.

IF TEETH NOT VISIBLE:
{"analysis": "I couldn't clearly see your teeth in this photo. Please try again with a natural smile showing your teeth, good lighting, and a straight-on angle.", "treatments": []}`;

const SMILE_DEEPDIVE_PROMPT = `You are a dental smile analyst AI for Agoura Hills Dental Designs (Drs. David and Shawn Matian).

The patient saw their analysis and wants details on a specific treatment. They're interested — give them specifics that make them book.

WRITE EXACTLY 4 PARAGRAPHS:

P1 — TREATMENT EXPLANATION: What it is, how it works, typical timeline. 2-3 sentences, plain language.

P2 — WHY IT FITS THEIR SMILE: Reference specific teeth and conditions from their photo. Which teeth benefit, what changes, what the result looks like. Must reference at least 2 specific observations from the image. Example: "The wear patterns I notice on your upper front four teeth, combined with the slight shade variation between your centrals and laterals, are exactly what veneers are designed to address."

P3 — LIFE IMPACT: One vivid, specific scenario tied to their actual dental issues. Not generic confidence — specific to what fixing their observed issues would change.

P4 — CTA: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com for a free consultation. Drs. David and Shawn Matian will use 3D imaging to create your personalized treatment plan."

RULES: 170-210 words. Plain text only. No markdown/bold/bullets. Reference specific teeth. Use "I notice" / "could" / "may" — never diagnose or guarantee.`;

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { imageBase64, mediaType, treatmentLabel, mode } = body;

    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: 'Missing required fields: imageBase64, mediaType' }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return new Response(JSON.stringify({ error: 'API configuration error. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const isDeepDive = mode === 'deep_dive' && treatmentLabel;
    const systemPrompt = isDeepDive ? SMILE_DEEPDIVE_PROMPT : SMILE_ANALYZE_PROMPT;
    const userMessage = isDeepDive
      ? `I just received my smile analysis and I'm interested in learning more about: ${treatmentLabel}. Please give me a detailed, personalized explanation of what this treatment could do for my smile.`
      : `Please analyze my smile and recommend the best treatments for me. Respond with ONLY valid JSON.`;

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: systemPrompt,
        messages: isDeepDive ? [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              { type: 'text', text: userMessage },
            ],
          },
        ] : [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              { type: 'text', text: userMessage },
            ],
          },
          {
            role: 'assistant',
            content: '{"analysis": "Looking at your smile, I notice',
          },
        ],
      }),
    });

    const anthropicData = await anthropicResponse.json();

    if (anthropicData.error) {
      console.error('Anthropic API error:', JSON.stringify(anthropicData.error));
      return new Response(JSON.stringify({ error: 'AI analysis temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const rawText = anthropicData.content && anthropicData.content[0] ? anthropicData.content[0].text : '';

    if (!rawText) {
      return new Response(JSON.stringify({ error: 'No analysis generated. Please try again or call (818) 706-6077.' }), { status: 500, headers });
    }

    // Deep dive mode: return plain text
    if (isDeepDive) {
      return new Response(JSON.stringify({ analysis: rawText }), { status: 200, headers });
    }

    // Analyze mode: parse JSON (prepend the assistant prefill)
    try {
      let fullText = '{"analysis": "Looking at your smile, I notice ' + rawText;
      let cleaned = fullText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      }
      const parsed = JSON.parse(cleaned);
      return new Response(JSON.stringify({ analysis: parsed.analysis || '', treatments: parsed.treatments || [] }), { status: 200, headers });
    } catch (parseErr) {
      console.error('JSON parse error, returning raw text:', parseErr.message);
      // Try to extract analysis from the prefilled text
      const fallbackAnalysis = 'Looking at your smile, I notice ' + rawText.replace(/[{}"\[\]]/g, '').substring(0, 500);
      return new Response(JSON.stringify({
        analysis: fallbackAnalysis,
        treatments: [
          { id: 'makeover', reason: 'A comprehensive approach to enhancing your smile' },
          { id: 'whitening', reason: 'A great starting point for a brighter smile' },
        ],
      }), { status: 200, headers });
    }
  } catch (error) {
    console.error('Smile analysis error:', error);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again or call (818) 706-6077.' }), { status: 500, headers });
  }
}
