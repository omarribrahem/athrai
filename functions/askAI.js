// =================================================================
//          ملف: functions/askAI.js
//          النسخة النهائية لمنصة "أثر" - تعمل على Cloudflare Pages
// =================================================================

/**
 * دالة للتواصل مع Google AI (Gemini)
 * هذه هي الدالة المسؤولة عن إرسال الطلب إلى جوجل واستقبال الرد.
 * @param {string} systemInstruction - "دستور" شخصية وسياق الـ AI
 * @param {Array} contents - سجل المحادثة الكامل (الذاكرة)
 * @param {string} apiKey - مفتاح API السري الخاص بجوجل
 * @returns {Promise<string>} - إجابة الذكاء الاصطناعي النصية
 */
async function queryGoogleAI(systemInstruction, contents, apiKey) {
  const model = 'gemini-1.5-flash-latest';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // تجهيز الطلب بالهيكل الذي تتوقعه Google AI
  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.7,      // درجة الإبداع (0.7 جيد للتوازن)
      maxOutputTokens: 512,  // حد أقصى لطول الإجابة لتوفير الموارد
    }
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  // معالجة الأخطاء المحتملة من جوجل
  if (!response.ok) {
    const errorBody = await response.json();
    console.error("Google AI API Error:", errorBody);
    throw new Error(`API Error: ${errorBody.error.message}`);
  }
  
  const result = await response.json();
  
  // التأكد من أن الرد يحتوي على نص قبل إرساله
  if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0].text) {
    return result.candidates[0].content.parts[0].text;
  }
  
  // رسالة افتراضية في حالة وجود رد فارغ
  return "عفواً، لم أتمكن من إيجاد إجابة مناسبة. هل يمكنك إعادة صياغة سؤالك؟";
}


/**
 * الدالة الرئيسية التي تستدعيها Cloudflare عند كل طلب
 * هذه هي بوابة الدخول لكل الأسئلة القادمة من الطلاب.
 * @param {object} context - يحتوي على معلومات الطلب والمفاتيح السرية
 */
export async function onRequest(context) {
  try {
    const { env, request } = context;
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY; // الوصول للمفتاح السري

    // فلترة الطلبات: نقبل فقط طلبات POST
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // التأكد من وجود مفتاح API قبل المتابعة
    if (!GOOGLE_API_KEY) {
      console.error('Google API Key is not configured.');
      return new Response(JSON.stringify({ error: 'خطأ في إعدادات الخادم.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // قراءة البيانات المرسلة من واجهة المستخدم (سجل المحادثة والمحتوى)
    const { conversationHistory, context: lectureContext } = await request.json();

    // --- دستور وشخصية "أثر AI" الكامل ---
    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود ومحب للمعرفة من منصة "أثر". هدفك هو جعل التعلم تجربة ممتعة وسهلة، وإشعال فضول الطالب.

### شخصيتك:
- **ودود ومطمئن:** استخدم دائمًا عبارات لطيفة ومحفزة مثل "لا تقلق، سنفهمها معًا"، "سؤال رائع! دعنا نحلله خطوة بخطوة"، "فكرة ممتازة، هذا يقودنا إلى...".
- **تفاعلي:** كن شريكًا في الحوار. لا تكتفِ بتقديم المعلومات، بل اجعل الطالب جزءًا من رحلة اكتشافها.

### قواعدك الذهبية (لتحقيق التوازن بين راحة المستخدم وتوفير الموارد):

1.  **التركيز المطلق:** مهمتك **الوحيدة** هي الإجابة على الأسئلة المتعلقة بـ "المحتوى المرجعي لهذه الجلسة". إذا سُئلت عن أي شيء آخر، أجب بلطف: *"هذا سؤال مثير للاهتمام، لكن تركيزنا هنا على محتوى المحاضرة لنحقق أقصى استفادة. هل هناك مفهوم معين في الدرس تود أن نستكشفه؟"*

2.  **الإيجاز أولاً (Brevity First):** ابدأ دائمًا بإجابة موجزة ومباشرة في نقاط. لا تقدم تفاصيل أو أمثلة إلا إذا طلب الطالب ذلك صراحةً بكلمات مثل "اشرح أكثر" أو "وضح بالتفصيل".

3.  **التنسيق الاحترافي:** استخدم تنسيق Markdown دائمًا. استعمل \`**النص العريض**\` للمصطلحات الهامة، و \`-\` للقوائم النقطية لتسهيل القراءة. إذا كان السؤال يتطلب مقارنة، قم بإنشاء جدول بسيط.

4.  **سؤال المتابعة الذكي:** بعد كل إجابة، اطرح سؤالاً متابعًا واحدًا وبسيطًا لتشجيع الطالب على التفكير وربط المعلومات.

### الممنوعات (الخطوط الحمراء):
- ممنوع اختلاق المعلومات. إذا كانت الإجابة غير موجودة في المحتوى، قل ذلك بصراحة وثقة.
- ممنوع حل الواجبات بشكل مباشر. بدلاً من ذلك، أرشد الطالب عبر طرح أسئلة تساعده على الوصول للحل بنفسه.

---
**المحتوى المرجعي لهذه الجلسة:**
${lectureContext}
---
`;
    
    // تحويل سجل المحادثة إلى التنسيق الذي يفهمه Gemini
    const contents = conversationHistory.map(turn => ({
      role: turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }));

    // استدعاء دالة Google AI للحصول على إجابة جديدة
    const newAnswer = await queryGoogleAI(systemInstructionText, contents, GOOGLE_API_KEY);
    
    // إرجاع الرد بنجاح إلى واجهة المستخدم
    return new Response(JSON.stringify({ reply: newAnswer.trim() }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // معالجة أي خطأ غير متوقع يحدث في الدالة
    console.error("Function Error:", error.message);
    return new Response(JSON.stringify({ error: 'حدث خطأ ما في الخادم.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
