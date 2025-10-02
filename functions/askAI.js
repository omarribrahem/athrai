// =================================================================
//   functions/askAI.js
//   النسخة النهائية - Gemini 2.0 Flash
//   
//   الموديل المستخدم: gemini-2.0-flash-exp
//   ✅ متاح مجاناً
//   ✅ سريع جداً
//   ✅ يعمل بدون caching
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * استدعاء Gemini 2.0
 * الموديل: gemini-2.0-flash-exp (التجريبي المجاني)
 */
async function queryGoogleAI(systemInstruction, contents, apiKey) {
  // استخدام Gemini 2.0 Flash Experimental
  const model = 'gemini-2.0-flash-exp';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // دمج System Instruction كأول رسالة
  const modifiedContents = [
    { role: 'user', parts: [{ text: systemInstruction }] },
    { role: 'model', parts: [{ text: 'فهمت تماماً. سأتبع هذه التعليمات في جميع إجاباتي.' }] },
    ...contents
  ];

  const requestBody = {
    contents: modifiedContents,
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
    const errorBody = await response.text();
    console.error("❌ Gemini API Error:", errorBody);
    throw new Error(`Gemini API error (${response.status})`);
  }

  const result = await response.json();

  if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
    return result.candidates[0].content.parts[0].text;
  }

  return "عفواً، لم أتمكن من إيجاد إجابة مناسبة.";
}

/**
 * الدالة الرئيسية (مبسطة - بدون caching)
 */
export async function onRequest(context) {
  const startTime = Date.now();
  
  try {
    const { env, request } = context;
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;

    // التحقق من Method
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // التحقق من API Key
    if (!GOOGLE_API_KEY) {
      console.error('❌ GOOGLE_API_KEY missing');
      return new Response(JSON.stringify({ error: 'خطأ في إعدادات الخادم.' }), {
        status: 500, 
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // قراءة البيانات
    const { conversationHistory, context: lectureContext } = await request.json();

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return new Response(JSON.stringify({ error: 'بيانات المحادثة غير صحيحة.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // استخراج آخر سؤال
    const lastUserMessage = conversationHistory
      .slice()
      .reverse()
      .find(msg => msg.role === 'user');

    if (!lastUserMessage) {
      return new Response(JSON.stringify({ error: 'لم يتم العثور على سؤال.' }), {
        status: 400, 
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userQuestion = lastUserMessage.content;
    console.log(`\n📩 NEW REQUEST: "${userQuestion.substring(0, 70)}..."`);

    // استدعاء Gemini مباشرة
    console.log('🤖 Calling Gemini 2.0 Flash...');

    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود ومحب للمعرفة من منصة "أثر". هدفك هو جعل التعلم تجربة ممتعة وسهلة.

### شخصيتك:
- **ودود ومطمئن:** استخدم عبارات محفزة مثل "لا تقلق، سنفهمها معاً"، "سؤال رائع!"
- **تفاعلي:** اجعل الطالب جزءاً من رحلة الاكتشاف

### قواعدك:
1. **التركيز المطلق:** الإجابة على المحتوى المرجعي فقط
2. **الإيجاز:** ابدأ بإجابة موجزة ومباشرة في نقاط
3. **Markdown:** استخدم **العريض** للمصطلحات الهامة و- للقوائم
4. **سؤال المتابعة:** اطرح سؤال بسيط بعد الإجابة

### الممنوعات:
- ممنوع اختلاق المعلومات
- ممنوع حل الواجبات مباشرة

---
**المحتوى المرجعي:**
${lectureContext || 'لا يوجد محتوى'}
---`;

    const contents = conversationHistory.map((turn, index) => ({
      role: (index === conversationHistory.length - 1 && turn.role === 'user') ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }));

    const aiAnswer = await queryGoogleAI(systemInstructionText, contents, GOOGLE_API_KEY);

    const responseTime = Date.now() - startTime;

    return new Response(JSON.stringify({ 
      reply: aiAnswer.trim(),
      cached: false,
      source: 'gemini-2.0-flash-exp',
      responseTime: `${responseTime}ms`
    }), {
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'X-Response-Time': `${responseTime}ms`
      },
    });

  } catch (error) {
    console.error("❌ FATAL ERROR:", error);
    const errorTime = Date.now() - startTime;
    
    return new Response(JSON.stringify({ 
      error: 'حدث خطأ في الخادم',
      details: error.message,
      responseTime: `${errorTime}ms`
    }), {
      status: 500, 
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
