// الكود النهائي لـ askAI.js مع اسم الموديل الصحيح

const fetch = require('node-fetch');

// 1. تعريف "موظف التوصيل" - الدالة المسؤولة عن الاتصال بالـ API
async function queryAPI(data) {
    const response = await fetch(
        "https://router.huggingface.co/v1/chat/completions",
        {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`,
            },
            method: "POST",
            body: JSON.stringify(data),
        }
    );
    const result = await response.json();
    return result;
}


// 2. الدالة الرئيسية التي تستقبل الطلبات من موقعك
exports.handler = async function (event) {
  const { question, context } = JSON.parse(event.body);
  const prompt = `Based on the following lecture content: "${context}". Please answer this question concisely: "${question}"`;

  try {
    // 3. تجهيز "الطلب" وإرساله مع "موظف التوصيل"
    const responseData = await queryAPI({
        // *** السطر الذي تم تعديله ***
        model: "Qwen/Qwen2-7B-Instruct:featherless-ai",
        messages: [
            { role: "user", content: prompt },
        ],
    });

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
