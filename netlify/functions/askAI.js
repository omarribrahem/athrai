// askAI.js – النسخة الكاملة للعمل مع LLaMA 3 على Hugging Face

const fetch = require('node-fetch');

// 1️⃣ دالة الاتصال بالـ API (Featherless AI)
async function queryAPI(data) {
  const response = await fetch(
    "https://router.huggingface.co/featherless-ai/v1/completions",
    {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HF_TOKEN}`,
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
    // 3️⃣ تجهيز الطلب وإرساله (مطابق للـ API الجديد)
    const responseData = await queryAPI({
      model: "meta-llama/Meta-Llama-3-8B-Instruct",
      prompt: prompt,
      max_tokens: 512,
      temperature: 0.7
    });

    // 4️⃣ معالجة الرد
    if (responseData && responseData.choices && responseData.choices[0] && responseData.choices[0].text) {
      const answer = responseData.choices[0].text;
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
