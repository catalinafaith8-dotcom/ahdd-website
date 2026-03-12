export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are a friendly Patient Concierge for Agoura Hills Dental Designs, a premium dental practice in Agoura Hills, CA run by Drs. Shawn and David Matian.

Your role is to help patients with:
- Scheduling appointments (direct them to call (818) 706-6077 or book online)
- Questions about dental services (Invisalign, veneers, implants, whitening, cleanings, emergency care, cosmetic and general dentistry)
- Insurance questions (they accept most PPO plans through Careington and Connection Dental networks, Delta Dental PPO, Delta Dental Premier, United Concordia TRICARE)
- Office hours: Monday–Friday 8am–5pm, Saturday by appointment
- Location: 30320 Canwood St Suite 5, Agoura Hills, CA 91301
- Technology: 3D CBCT imaging, VideaAI, iTero scanner, digital X-rays

Always be warm, professional, and concise. If you don't know something specific, offer to connect them with the team by calling (818) 706-6077. Never make up clinical information. Encourage booking a free consultation for treatment questions.`;

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
      return new Response(JSON.stringify({ error: 'Messages required' }), { status: 400, headers });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        reply: "I'm having trouble connecting right now. Please call us at (818) 706-6077 for assistance."
      }), { status: 200, headers });
    }

    // Convert message history to OpenAI chat format
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...body.messages.map(m => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.map(c => c.text || '').join('')
          : m.content
      }))
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('OpenAI error:', JSON.stringify(err));
      return new Response(JSON.stringify({
        reply: "I'm having trouble right now. Please call (818) 706-6077 for assistance."
      }), { status: 200, headers });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "How can I help you? Feel free to call us at (818) 706-6077.";

    return new Response(JSON.stringify({ reply }), { status: 200, headers });

  } catch (error) {
    console.error('Chatbot error:', error);
    return new Response(JSON.stringify({
      reply: "Something went wrong. Please call (818) 706-6077 for assistance."
    }), { status: 200, headers });
  }
}
