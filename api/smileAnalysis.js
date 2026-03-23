// API: POST /api/smileAnalysis
// AI Smile Analysis — Agoura Hills Dental Designs

const SMILE_ANALYZE_PROMPT = `You are a dental triage AI for Agoura Hills Dental Designs (Drs. David and Shawn Matian, (818) 706-6077).

EMERGENCY DETECTION — CHECK FIRST:
If you see ANY of: abscess, swelling, visible pus, severely broken/fractured tooth, exposed nerve, dark decay lesions, or signs of acute infection — respond with this JSON and nothing else:
{"emergency": true, "analysis": "Your photo shows signs that may need urgent attention. Please don't wait — call us today at (818) 706-6077. Same-day emergency appointments are available.", "treatments": []}

STANDARD ANALYSIS — only if no emergency signs present:
Return ONLY valid JSON. Short, punchy, human. No essays.

JSON FORMAT:
{"emergency": false, "analysis": "2-3 sentences max. One specific observation. One benefit of fixing it.", "treatments": [{"id": "treatment_id", "reason": "one short sentence"}]}

Valid treatment IDs: veneers, whitening, invisalign, bonding, implants, makeover, crowns, gum_contouring

RULES:
- MAX 60 WORDS in the analysis field. Hard limit.
- First sentence: one specific observation (tooth position + condition). No flattery, no "great smile".
- Last sentence: what their smile could look like after treatment.
- 1-3 treatment IDs only. Only recommend what you actually see evidence for.
- Plain text only. No markdown, no bullets, no asterisks.

IF TEETH NOT CLEARLY VISIBLE:
{"emergency": false, "analysis": "We couldn't see your teeth clearly. Try a straight-on smile with good lighting — no sign-up needed.", "treatments": []}`;

const SMILE_DEEPDIVE_PROMPT = `You are a dental concierge AI for Agoura Hills Dental Designs ((818) 706-6077).

Patient wants to know more about a specific treatment. Be warm, specific, brief. This should make them want to book.

WRITE 3 SHORT PARAGRAPHS:
P1 — What the treatment is and how long it takes. 2 sentences max.
P2 — Why it fits THIS person's smile. Reference 1-2 specific things you observe in their photo. 2 sentences max.
P3 — One vivid moment that changes when this is fixed. End with: "Call (818) 706-6077 or book at agourahillsdentaldesigns.com for your free consultation."

MAX 80 WORDS TOTAL. Plain text only. No markdown. Use "could" and "may" — never guarantee outcomes.`;

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
      ? `I want to know more about: ${treatmentLabel}. What would this do for my smile?`
      : `Analyze my smile photo. Return ONLY valid JSON. No preamble, no explanation outside the JSON.`;

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: [
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
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error('Anthropic HTTP error:', anthropicResponse.status, errText);
      return new Response(JSON.stringify({ error: 'AI analysis temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const anthropicData = await anthropicResponse.json();

    if (anthropicData.error) {
      console.error('Anthropic API error:', JSON.stringify(anthropicData.error));
      return new Response(JSON.stringify({ error: 'AI analysis temporarily unavailable. Please call (818) 706-6077.' }), { status: 500, headers });
    }

    const rawText = anthropicData?.content?.[0]?.text?.trim() || '';

    if (!rawText) {
      return new Response(JSON.stringify({ error: 'No analysis generated. Please try again or call (818) 706-6077.' }), { status: 500, headers });
    }

    // Deep dive: return plain text
    if (isDeepDive) {
      return new Response(JSON.stringify({ analysis: rawText }), { status: 200, headers });
    }

    // Analyze mode: parse JSON, strip any accidental markdown fences
    try {
      let cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);
      return new Response(JSON.stringify({
        emergency: parsed.emergency || false,
        analysis: parsed.analysis || '',
        treatments: parsed.treatments || [],
      }), { status: 200, headers });
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message, '| Raw:', rawText.substring(0, 200));
      return new Response(JSON.stringify({
        emergency: false,
        analysis: 'We had trouble reading your photo. Try a straight-on smile with good lighting, or call us at (818) 706-6077.',
        treatments: [],
      }), { status: 200, headers });
    }

  } catch (error) {
    console.error('Smile analysis error:', error);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again or call (818) 706-6077.' }), { status: 500, headers });
  }
}
