// askAI.js – نسخة معدلة للعمل على Cloudflare Workers

// دالة للتواصل مع Google AI (لا تحتاج لتغيير)
async function queryGoogleAI(systemInstruction, contents, apiKey) {
  const model = 'gemini-1.5-flash-latest';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    }
  };

  const response = await fetch(apiUrl, { // نستخدم fetch المدمجة في Cloudflare
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.json();
    console.error("Google AI API Error:", errorBody);
    throw new Error(`API Error: ${errorBody.error.message}`);
  }
  
  const result = await response.json();
  if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0].text) {
    return result.candidates[0].content.parts[0].text;
  }
  return "عفواً، لم أتمكن من إيجاد إجابة مناسبة.";
}

// --- هذا هو التغيير الرئيسي ---
// Cloudflare تستخدم هذا الهيكل لتشغيل الدوال
export default {
  async fetch(request, env) {
    // env هو المكان الذي توجد فيه المفاتيح السرية (مثل process.env في Netlify)
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;

    if (!GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server configuration error.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const { conversationHistory, context } = await request.json();

      const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود... (نفس الدستور الذي اتفقنا عليه)`; // (اختصار للمساحة)

      const contents = conversationHistory.map(turn => ({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.content }]
      }));

      const newAnswer = await queryGoogleAI(systemInstructionText, contents, GOOGLE_API_KEY);
      
      return new Response(JSON.stringify({ reply: newAnswer.trim() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error("Function Error:", error);
      return new Response(JSON.stringify({ error: 'Something went wrong.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
};
