// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - النسخة النهائية المتكاملة
//   
//   الموديل: gemini-1.5-flash
//   ✅ متوافق مع الـ Frontend (JSON reply format)
//   ✅ Google Search Integration (بحث جوجل)
//   ✅ Supabase Caching (ذاكرة مؤقتة للأسئلة)
//   ✅ معالجة ذكية للأخطاء (Error Handling)
// =================================================================

import { createClient } from '@supabase/supabase-js';

// --- دوال مساعدة (Helpers) ---

/**
 * تنظيف نص السؤال لضمان دقة البحث في الذاكرة
 */
function normalizeQuestion(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[؟?!]/g, '')
    .substring(0, 200);
}

/**
 * البحث في الذاكرة المؤقتة (Supabase)
 * مغلفة بـ try-catch لضمان عدم توقف الموقع إذا لم يتم تفعيل قاعدة البيانات
 */
async function findInCache(supabase, questionText, contextHash) {
  try {
    const normalizedQuestion = normalizeQuestion(questionText);
    
    // 1. بحث عن تطابق تام (Exact Match)
    const { data: exactMatch, error: exactError } = await supabase
      .from('ai_responses_cache_simple')
      .select('id, response_text, hit_count, question_text')
      .eq('question_hash', normalizedQuestion)
      .eq('lecture_context_hash', contextHash)
      .limit(1)
      .single();
    
    if (!exactError && exactMatch) {
      console.log('✅ CACHE HIT (Exact Match)!');
      // تحديث العداد في الخلفية
      supabase.from('ai_responses_cache_simple')
        .update({ hit_count: exactMatch.hit_count + 1, last_accessed: new Date().toISOString() })
        .eq('id', exactMatch.id).then(() => {});
      
      return { answer: exactMatch.response_text };
    }
    
    // 2. بحث عن تطابق جزئي (Partial Match)
    const searchKeywords = questionText.split(' ').slice(0, 5).join('%');
    const { data: partialMatch, error: partialError } = await supabase
      .from('ai_responses_cache_simple')
      .select('id, response_text, hit_count, question_text')
      .ilike('question_text', '%' + searchKeywords + '%')
      .eq('lecture_context_hash', contextHash)
      .order('hit_count', { ascending: false })
      .limit(1)
      .single();
    
    if (!partialError && partialMatch) {
      console.log('✅ CACHE HIT (Partial Match)!');
      supabase.from('ai_responses_cache_simple')
        .update({ hit_count: partialMatch.hit_count + 1, last_accessed: new Date().toISOString() })
        .eq('id', partialMatch.id).then(() => {});
      
      return { answer: partialMatch.response_text };
    }
    
    return null; // لم يتم العثور على إجابة مخزنة
    
  } catch (error) {
    console.warn('⚠️ Cache lookup skipped:', error.message);
    return null;
  }
}

/**
 * حفظ الإجابة الجديدة في الذاكرة (Supabase)
 */
async function saveToCache(supabase, questionText, responseText, contextHash) {
  try {
    const normalizedQuestion = normalizeQuestion(questionText);
    await supabase.from('ai_responses_cache_simple').insert({
      question_text: questionText,
      question_hash: normalizedQuestion,
      response_text: responseText,
      lecture_context_hash: contextHash,
      hit_count: 1,
      created_at: new Date().toISOString(),
      last_accessed: new Date().toISOString()
    });
  } catch (error) {
    console.warn('⚠️ Cache save skipped:', error.message);
  }
}

// --- الدالة الرئيسية (Main Handler) ---

export async function onRequest(context) {
  const startTime = Date.now();
  
  try {
    const { env, request } = context;
    
    // 1. قراءة المتغيرات
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
    
    // التحقق من الطريقة والمفاتيح
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    
    if (!GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ 
        reply: "⚠️ خطأ في السيرفر: مفتاح Google API غير موجود." 
      }), { 
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. قراءة بيانات الطلب
    const body = await request.json();
    const { conversationHistory, context: lectureContext } = body;
    
    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return new Response(JSON.stringify({ reply: "حدث خطأ في قراءة المحادثة." }), { 
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const lastUserMessage = conversationHistory.slice().reverse().find(msg => msg.role === 'user');
    const userQuestion = lastUserMessage ? lastUserMessage.content : "";
    const contextHash = lectureContext ? lectureContext.substring(0, 50) : 'default';

    // 3. محاولة البحث في الكاش (إذا كان Supabase موجوداً)
    let cachedResult = null;
    let supabase = null;
    
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      cachedResult = await findInCache(supabase, userQuestion, contextHash);
    }

    if (cachedResult) {
      return new Response(JSON.stringify({ 
        reply: cachedResult.answer, // ✅ إرجاع المفتاح reply كما يطلبه الـ frontend
        cached: true,
        responseTime: `${Date.now() - startTime}ms`
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. تجهيز الطلب لـ Gemini
    const cleanHistory = conversationHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const systemInstruction = `
      أنت "أثر AI"، مساعد دراسي ذكي من منصة "أثر".
      - شخصيتك: شاب مصري ودود ومحفز (استخدم إيموجي، ولهجة مصرية بسيطة).
      - دورك: شرح المحتوى الدراسي بتبسيط، وربطه بأمثلة واقعية.
      - المصدر: استخدم المحتوى المرجعي التالي للإجابة:
      ${lectureContext || 'لا يوجد محتوى محدد.'}
      
      قواعد:
      - كن مختصراً ومفيداً.
      - إذا كان السؤال خارج الدراسة، أجب بذكاء واربطه بالدراسة إن أمكن.
    `;

    // 5. الاتصال بـ Gemini API
    const model = 'gemini-1.5-flash'; // الموديل المستقر
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;
    
    const requestBody = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: cleanHistory,
      tools: [
        { google_search: {} } // تفعيل البحث
      ],
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7
      }
    };

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API Error: ${geminiResponse.status} - ${errorText}`);
    }

    const data = await geminiResponse.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!replyText) {
      return new Response(JSON.stringify({ reply: "عذراً، لم أستطع تكوين إجابة. حاول مرة أخرى." }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 6. حفظ الإجابة في الكاش (في الخلفية)
    if (supabase) {
      context.waitUntil(saveToCache(supabase, userQuestion, replyText, contextHash));
    }

    // 7. إرسال الرد النهائي
    return new Response(JSON.stringify({ 
      reply: replyText, // ✅ هذا هو المفتاح المهم
      cached: false,
      responseTime: `${Date.now() - startTime}ms`
    }), {
      status: 200, 
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("❌ Worker Error:", error.message);
    
    // إرجاع الخطأ كرسالة للمستخدم بدلاً من فشل الطلب
    return new Response(JSON.stringify({ 
      reply: `عذراً يا صديقي، حدث خطأ تقني بسيط (Error ${error.message.substring(0, 50)}...). جرب تاني!` 
    }), {
      status: 200, // نرسل 200 ليظهر الرد في الشات
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
