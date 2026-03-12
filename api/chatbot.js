// API: POST /api/chatbot
// AI Patient Concierge (OpenAI)

const OPENAI_PROMPT_ID = 'pmpt_697e26a72ae08196b5379c8e008cdf7d0788a8b3a856f5d1';
const OPENAI_PROMPT_VERSION = '6';

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

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400, headers });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not set');
      return new Response(JSON.stringify({ error: 'API configuration error', reply: 'I apologize, but I\'m having trouble connecting right now. Please call us at (818) 706-6077 for immediate assistance.' }), { status: 500, headers });
    }

    const promptId = body.promptId || OPENAI_PROMPT_ID;
    const promptVersion = body.promptVersion || OPENAI_PROMPT_VERSION;

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: { id: promptId, version: promptVersion },
        input: body.messages,
        text: { format: { type: 'text' } },
        store: true,
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json();
      console.error('OpenAI API error:', JSON.stringify(errorData));
      return new Response(JSON.stringify({ error: 'AI service error', reply: 'I apologize, but I\'m having trouble connecting right now. Please call us at (818) 706-6077 for immediate assistance.' }), { status: 500, headers });
    }

    const openaiData = await openaiResponse.json();

    let replyText = '';
    if (openaiData.output && Array.isArray(openaiData.output)) {
      for (const outputItem of openaiData.output) {
        if (outputItem.content && Array.isArray(outputItem.content)) {
          for (const contentItem of outputItem.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              replyText = contentItem.text;
              break;
            }
          }
        }
        if (replyText) break;
      }
    }

    if (!replyText) {
      replyText = 'I\'m here to help! Could you please rephrase your question?';
    }

    return new Response(JSON.stringify({ reply: replyText }), { status: 200, headers });
  } catch (error) {
    console.error('Chatbot error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', reply: 'I apologize, but something went wrong. Please call us at (818) 706-6077 for assistance.' }), { status: 500, headers });
  }
}
