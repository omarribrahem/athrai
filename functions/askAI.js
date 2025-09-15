// functions/askAI.js – نسخة مضمونة للعمل على Cloudflare Pages

// الهيكل الذي يفهمه Cloudflare لدالة اسمها askAI.js
export async function onRequest(context) {
  try {
    // context.env هو المكان الذي توجد فيه المفاتيح السرية
    const GOOGLE_API_KEY = context.env.GOOGLE_API_KEY;
    
    // التحقق من أن الطلب هو POST
    if (context.request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // التأكد من وجود مفتاح API
    if (!GOOGLE_API_KEY) {
      console.error('Google API Key is not configured.');
      return new Response(JSON.stringify({ error: 'Server configuration error.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { conversationHistory, context: lectureContext } = await context.request.json();

    // --- دستور وشخصية "أثر AI" ---
    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود... (نفس الدستور الذي اتفقنا عليه)`;

    const contents = conversationHistory.map(turn => ({
      role: turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }));

    // --- استدعاء Google AI ---
    const model = 'gemini-1.5-flash-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;
    
    const requestBody = {
      systemInstruction: { parts: [{ text: systemInstructionText }] },
      contents: contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!apiResponse.ok) {
        const errorBody = await apiResponse.json();
        throw new Error(`API Error: ${errorBody.error.message}`);
    }

    const result = await apiResponse.json();
    const newAnswer = result.candidates[0].content.parts[0].text;

    // إرجاع الرد بنجاح
    return new Response(JSON.stringify({ reply: newAnswer.trim() }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Function Error:", error.message);
    return new Response(JSON.stringify({ error: 'Something went wrong.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
