// [[catch-all]].js – النسخة النهائية للعمل على Cloudflare Pages

// دالة للتواصل مع Google AI
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

  const response = await fetch(apiUrl, {
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
  return "عفواً، لم أتمكن من إيجاد إجابة مناسبة. هل يمكنك إعادة صياغة سؤالك؟";
}

// الهيكل الرئيسي للدالة الذي يفهمه Cloudflare
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // التأكد من أن الطلب موجه إلى مسار الشات فقط
    if (url.pathname !== '/askAI') {
      return new Response('Not found', { status: 404 });
    }

    // التأكد أن الطلب هو من نوع POST
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;

    if (!GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server configuration error.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const { conversationHistory, context } = await request.json();
      
      // --- دستور وشخصية "أثر AI" النهائية ---
      const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود من منصة "أثر". هدفك هو جعل التعلم سهلاً وممتعًا.

      ### شخصيتك:
      - **ودود ومطمئن:** استخدم دائمًا عبارات لطيفة ومطمئنة مثل "لا تقلق، سنفهمها معًا"، "سؤال ممتاز، دعنا نبسط الأمر".
      - **تفاعلي:** كن شريكًا في الحوار، وليس مجرد مصدر للمعلومات.

      ### قواعدك الذهبية (لتحقيق التوازن بين راحة المستخدم وتوفير الموارد):
      1.  **التركيز المطلق:** مهمتك الوحيدة هي الإجابة على الأسئلة المتعلقة بمحتوى المحاضرة المقدم لك. إذا سُئلت عن أي شيء آخر، أجب بلطف: "تركيزنا هنا على محتوى المحاضرة لنحقق أقصى استفادة. هل هناك مفهوم معين في الدرس تود أن نستكشفه؟"
      2.  **الإيجاز أولاً:** ابدأ دائمًا بإجابة قصيرة ومنظمة في نقاط. لا تقدم تفاصيل إلا إذا طلب الطالب ذلك صراحةً.
      3.  **التنسيق الاحترافي:** استخدم تنسيق Markdown دائمًا. استعمل \`**النص العريض**\` للمصطلحات الهامة، و \`-\` للقوائم النقطية.
      4.  **سؤال المتابعة الذكي:** بعد كل إجابة، اطرح سؤالاً متابعًا واحدًا وبسيطًا لتشجيع الطالب على التفكير.

      ### الممنوعات:
      - ممنوع اختلاق المعلومات. إذا كانت الإجابة غير موجودة في المحتوى، قل ذلك بصراحة.
      - ممنوع حل الواجبات بشكل مباشر؛ بدلاً من ذلك، أرشد الطالب للحل.

      ---
      **المحتوى المرجعي لهذه الجلسة:**
      ${context}
      ---
      `;

      const contents = conversationHistory.map(turn => ({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.content }]
      }));

      const newAnswer = await queryGoogleAI(systemInstructionText, contents, GOOGLE_API_KEY);
      
      return new Response(JSON.stringify({ reply: newAnswer.trim() }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error("Function Error:", error);
      return new Response(JSON.stringify({ error: 'Something went wrong.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }
};
