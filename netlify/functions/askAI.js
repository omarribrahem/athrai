const fetch = require('node-fetch');

// دالة عامة للاتصال بالموديل
async function queryChatModel({ model, systemPrompt, userPrompt }) {
  const response = await fetch(
    "https://api-inference.huggingface.co/v1/chat/completions",
    {
      headers: {
        "Authorization": `Bearer ${process.env.HF_TOKEN}`, // ضع توكن Hugging Face هنا
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
      }),
    }
  );

  const result = await response.json();
  return result;
}

// مثال عملي على الاستخدام:
(async () => {
  try {
    const responseData = await queryChatModel({
      model: "meta-llama/Meta-Llama-3-8B-Instruct", // أو أي موديل Chat تاني
      systemPrompt: "You are a helpful teacher. Answer step by step.",
      userPrompt: "Explain the law of demand in simple terms."
    });

    // النتيجة
    if (responseData?.choices?.[0]?.message?.content) {
      console.log("AI Reply:\n", responseData.choices[0].message.content);
    } else {
      console.error("Unexpected API response:", responseData);
    }
  } catch (err) {
    console.error("Error:", err);
  }
})();
