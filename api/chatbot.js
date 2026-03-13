const SYSTEM_PROMPT = 'You are a friendly Patient Concierge for Agoura Hills Dental Designs, a premium dental practice in Agoura Hills, CA run by Drs. Shawn and David Matian. Help patients with: scheduling (call 818-706-6077), services (Invisalign, veneers, implants, whitening, cleanings, emergency, cosmetic, general dentistry), insurance (PPO plans via Careington and Connection Dental, Delta Dental PPO/Premier, United Concordia TRICARE), hours (Mon-Fri 8am-5pm, Sat by appt), location (30320 Canwood St Suite 5, Agoura Hills CA 91301). Be warm, professional, concise. Never invent clinical info. Encourage free consultation bookings.';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body;
    if (!body || !body.messages || !body.messages.length) {
      return res.status(400).json({ error: 'Messages required' });
    }

    var apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ reply: "I'm having trouble connecting. Please call (818) 706-6077." });
    }

    var messages = [{ role: 'system', content: SYSTEM_PROMPT }].concat(
      body.messages.map(function(m) {
        return {
          role: m.role,
          content: Array.isArray(m.content) ? m.content.map(function(c) { return c.text || ''; }).join('') : m.content
        };
      })
    );

    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: messages, max_tokens: 300, temperature: 0.7 })
    });

    if (!response.ok) {
      var err = await response.json();
      console.error('OpenAI error:', JSON.stringify(err));
      return res.status(200).json({ reply: "Having trouble right now. Please call (818) 706-6077." });
    }

    var data = await response.json();
    var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      ? data.choices[0].message.content
      : "How can I help? Call us at (818) 706-6077.";

    return res.status(200).json({ reply: reply });

  } catch (error) {
    console.error('Chatbot error:', error);
    return res.status(200).json({ reply: "Something went wrong. Please call (818) 706-6077." });
  }
};
