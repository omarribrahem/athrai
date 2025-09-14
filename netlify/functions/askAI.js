// askAI.js – النسخة الكاملة للعمل مع LLaMA 3 على Hugging Face

const fetch = require('node-fetch');

// 1️⃣ دالة الاتصال بالـ API (موظف التوصيل)
async function queryAPI(data) {
  const response = await fetch(
    "https://api-inference.huggingface.co/v1/chat/completions", // endpoint الصحيح
    {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`, // حط التوكن هنا في بيئة السيرفر
      },
      method: "POST",
      body: JSON.stringify(data),
    }
  );
  const result = await response.json();
  return result;
}

// 2️⃣ الدالة الرئيسية التي تستقبل الطلبات من موقعك
exports.handler = async function (event) {
  const { question, context } = JSON.parse(event.body);

  // البرومبت اللي بيتبعت للموديل
  const prompt = `Based on the following lecture content: "${context}". Please answer this question concisely: "${question}"`;

  try {
    // 3️⃣ تجهيز الطلب وإرساله
    const responseData = await queryAPI({
      model: "meta-llama/Meta-Llama-3-8B-Instruct", // اسم الموديل
      messages: [
        { role: "system", content: "You are a helpful teacher who explains step by step." },
        { role: "user", content: prompt },
      ],
    });

    // 4️⃣ معالجة الرد
    if (responseData && responseData.choices && responseData.choices[0]) {
      const answer = responseData.choices[0].message.content;
      return {
        statusCode: 200,
        body: JSON.stringify({ reply: answer }),
      };
    } else {
      console.error("Unexpected API response:", responseData);
      throw new Error("Invalid response structure from API");
    }

  } catch (error) {
    console.error("Function Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
