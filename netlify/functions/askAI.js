// askAI.js – النسخة النهائية مع شخصية وذاكرة متوافقة مع Google AI

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

  const { conversationHistory, context } = JSON.parse(event.body);

  // ---  هذا هو التعديل الرئيسي ---
  // ندمج تعليمات الشخصية مع المحتوى في أول رسالة للمستخدم
  
  // 1. إنشاء "برومبت" البداية الذي يعرّف شخصية الـ AI
  const initialPrompt = `أنت "المعلم الخبير" من منصة "أثر". مهمتك هي مساعدة الطالب على فهم محتوى المحاضرة التالي:
  ---
  محتوى المحاضرة:
  ${context}
  ---
  قواعدك:
  - اشرح المفاهيم بطريقة بسيطة وواضحة.
  - استخدم أمثلة إذا كان السؤال يتطلب ذلك.
  - كن ودودًا ومشجعًا في إجاباتك.
  - يجب أن تكون جميع إجاباتك مبنية فقط على "محتوى المحاضرة" المقدم لك.
  `;

  // 2. بناء سجل المحادثة بالشكل الصحيح
  const contents = conversationHistory.map((turn, index) => {
    // ندمج التعليمات مع أول سؤال للمستخدم
    if (index === 0) {
      return {
        role: 'user',
        parts: [{ text: `${initialPrompt}\n\nسؤالي الأول هو: ${turn.content}` }]
      };
    }
    // باقي المحادثة تبقى كما هي
    return {
      role: turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }]
    };
  });

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
      console.error("Invalid response from API or content blocked:", responseData);
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
