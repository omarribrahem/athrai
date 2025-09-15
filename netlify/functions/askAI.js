// askAI.js – نسخة مطورة بشخصية وذاكرة أفضل

const fetch = require('node-fetch');

async function queryGoogleAI(data) {
  const model = 'gemini-1.5-flash-latest';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorBody = await response.json();
    console.error("Google AI API Error:", errorBody);
    throw new Error(`API request failed: ${errorBody.error.message}`);
  }
  return response.json();
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!process.env.GOOGLE_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  // الآن نستقبل سجل المحادثة بالكامل بدلاً من سؤال واحد
  const { conversationHistory, context } = JSON.parse(event.body);

  // 1. إعطاء الذكاء الاصطناعي شخصية (System Instruction)
  const systemInstruction = {
    role: "system",
    parts: [{
      text: `أنت "المعلم الخبير" من منصة "أثر". مهمتك هي مساعدة الطالب على فهم محتوى المحاضرة.
      - اشرح المفاهيم بطريقة بسيطة وواضحة.
      - استخدم أمثلة إذا كان السؤال يتطلب ذلك.
      - كن ودودًا ومشجعًا في إجاباتك.
      - يجب أن تكون جميع إجاباتك مبنية **فقط** على "محتوى المحاضرة" المقدم لك.
      - هذا هو محتوى المحاضرة: """${context}"""`
    }]
  };
  
  // 2. بناء سجل المحادثة لإعطاء الـ AI ذاكرة
  const contents = [
    systemInstruction, // نبدأ دائمًا بالشخصية
    ...conversationHistory.map(turn => ({ // ثم نضيف المحادثة السابقة
      role: turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }))
  ];

  const requestBody = {
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    }
  };

  try {
    const responseData = await queryGoogleAI(requestBody);

    if (responseData.candidates && responseData.candidates[0].content) {
      const answer = responseData.candidates[0].content.parts[0].text;
      return {
        statusCode: 200,
        body: JSON.stringify({ reply: answer.trim() }),
      };
    } else {
      console.error("Invalid response from API:", responseData);
      return { 
        statusCode: 200,
        body: JSON.stringify({ reply: "عفواً، لم أتمكن من معالجة هذا الطلب حالياً." })
      };
    }
  } catch (error) {
    console.error("Function Error:", error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Something went wrong.' }) 
    };
  }
};
