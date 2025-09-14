// askAI.js – نسخة معدلة للعمل مع Google AI (Gemini Pro)

const fetch = require('node-fetch');

// 1️⃣ دالة الاتصال بواجهة برمجة تطبيقات Google AI
async function queryGoogleAI(data) {
  // اسم النموذج الذي سنستخدمه
  const model = 'gemini-pro';
  
  // رابط API الخاص بـ Gemini
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  // إذا لم يكن الرد ناجحًا، قم برمي خطأ
  if (!response.ok) {
    const errorBody = await response.json();
    console.error("Google AI API Error:", errorBody);
    throw new Error(`API request failed with status ${response.status}: ${errorBody.error.message}`);
  }

  const result = await response.json();
  return result;
}

// 2️⃣ الدالة الرئيسية التي تستقبل الطلبات من موقعك
exports.handler = async function (event) {
  // التأكد من أن الطلب هو POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // التأكد من وجود مفتاح API
  if (!process.env.GOOGLE_API_KEY) {
    console.error("Google API Key is not set.");
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Server configuration error.' }) 
    };
  }
  
  const { question, context } = JSON.parse(event.body);

  // البرومبت الذي سيتم إرساله للنموذج
  const prompt = `Based on the following lecture content: "${context}". Please answer this question concisely: "${question}"`;

  // تجهيز هيكل الطلب حسب متطلبات Google AI
  const requestBody = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    }
  };

  try {
    // 3️⃣ إرسال الطلب إلى Google AI
    const responseData = await queryGoogleAI(requestBody);

    // 4️⃣ معالجة الرد القادم من Gemini
    if (responseData.candidates && responseData.candidates[0].content && responseData.candidates[0].content.parts[0].text) {
      const answer = responseData.candidates[0].content.parts[0].text;
      return {
        statusCode: 200,
        body: JSON.stringify({ reply: answer.trim() }),
      };
    } else {
      // هذا يحدث إذا تم حظر الرد لأسباب تتعلق بالسلامة أو غيرها
      console.error("Invalid response structure from API or content blocked:", responseData);
      const defaultMessage = "عفواً، لم أتمكن من معالجة هذا الطلب حالياً.";
      return { 
        statusCode: 200, // نرسل 200 حتى تظهر الرسالة للمستخدم
        body: JSON.stringify({ reply: defaultMessage })
      };
    }

  } catch (error) {
    console.error("Function Error:", error);
    // إرجاع رسالة خطأ عامة للمستخدم
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Something went wrong on the server.' }) 
    };
  }
};
