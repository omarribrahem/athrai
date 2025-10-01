// =================================================================
//          ملف: functions/askAI.js
//          النسخة المتكاملة مع Supabase للـ Caching
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * دالة لإنشاء hash من النص (للبحث السريع)
 */
async function hashText(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * دالة للبحث في الـ cache قبل استدعاء API
 */
async function getCachedResponse(supabase, questionHash) {
  try {
    const { data, error } = await supabase
      .from('ai_responses_cache')
      .select('response_text, id, hit_count')
      .eq('question_hash', questionHash)
      .maybeSingle(); // بدل single() عشان ميديش error لو مالقاش حاجة

    if (error) {
      console.error('Cache lookup error:', error);
      return null;
    }

    if (data) {
      console.log(`✅ Cache HIT! Hit count: ${data.hit_count + 1}`);
      
      // تحديث عداد الاستخدام ووقت آخر وصول
      await supabase
        .from('ai_responses_cache')
        .update({ 
          hit_count: data.hit_count + 1,
          last_accessed: new Date().toISOString()
        })
        .eq('id', data.id);

      return data.response_text;
    }

    console.log('❌ Cache MISS - Question not found in cache');
    return null;
  } catch (err) {
    console.error('getCachedResponse exception:', err);
    return null;
  }
}

/**
 * دالة لحفظ الإجابة في الـ cache
 */
async function cacheResponse(supabase, questionHash, questionText, responseText, contextHash) {
  try {
    const { error } = await supabase
      .from('ai_responses_cache')
      .insert({
        question_hash: questionHash,
        question_text: questionText,
        response_text: responseText,
        lecture_context_hash: contextHash,
        hit_count: 1,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString()
      });

    if (error) {
      console.error('Cache save error:', error);
    } else {
      console.log('💾 Response cached successfully');
    }
  } catch (err) {
    console.error('cacheResponse exception:', err);
  }
}

/**
 * دالة للتواصل مع Google AI (Gemini)
 */
async function queryGoogleAI(systemInstruction, contents, apiKey) {
  const model = 'gemini-2.0-flash-exp';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800,
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
    throw new Error(`API Error: ${errorBody.error?.message || 'Unknown error'}`);
  }

  const result = await response.json();

  if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
    return result.candidates[0].content.parts[0].text;
  }

  return "عفواً، لم أتمكن من إيجاد إجابة مناسبة. هل يمكنك إعادة صياغة سؤالك؟";
}

/**
 * الدالة الرئيسية - Cloudflare Pages Function
 */
export async function onRequest(context) {
  try {
    const { env, request } = context;
    
    // استخراج المتغيرات البيئية
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

    // التحقق من الـ Method
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // التحقق من المتغيرات البيئية
    if (!GOOGLE_API_KEY) {
      console.error('❌ GOOGLE_API_KEY is missing');
      return new Response(JSON.stringify({ error: 'خطأ في إعدادات Google API.' }), {
        status: 500, 
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('⚠️ Supabase credentials missing - caching disabled');
    }

    // قراءة البيانات من الطلب
    const { conversationHistory, context: lectureContext } = await request.json();

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return new Response(JSON.stringify({ error: 'بيانات المحادثة غير صحيحة.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // استخراج آخر سؤال من المستخدم
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
    console.log(`📩 User question: ${userQuestion.substring(0, 50)}...`);

    // محاولة استخدام الـ Cache (إذا كان Supabase متاح)
    let cachedAnswer = null;
    let supabase = null;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      
      const questionHash = await hashText(userQuestion.toLowerCase().trim());
      const contextHash = await hashText(lectureContext || '');

      console.log(`🔍 Question hash: ${questionHash.substring(0, 16)}...`);
      
      cachedAnswer = await getCachedResponse(supabase, questionHash);

      if (cachedAnswer) {
        return new Response(JSON.stringify({ 
          reply: cachedAnswer,
          cached: true,
          source: 'cache'
        }), {
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            'X-Cache-Status': 'HIT'
          },
        });
      }
    }

    // استدعاء Google AI
    console.log(`🤖 Calling Google AI API...`);

    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود ومحب للمعرفة من منصة "أثر". هدفك هو جعل التعلم تجربة ممتعة وسهلة، وإشعال فضول الطالب.

### شخصيتك:
- **ودود ومطمئن:** استخدم دائمًا عبارات لطيفة ومحفزة مثل "لا تقلق، سنفهمها معًا"، "سؤال رائع! دعنا نحلله خطوة بخطوة"، "فكرة ممتازة، هذا يقودنا إلى...".
- **تفاعلي:** كن شريكًا في الحوار. لا تكتفِ بتقديم المعلومات، بل اجعل الطالب جزءًا من رحلة اكتشافها.

### قواعدك الذهبية:
1.  **التركيز المطلق:** مهمتك **الوحيدة** هي الإجابة على الأسئلة المتعلقة بـ "المحتوى المرجعي لهذه الجلسة".
2.  **الإيجاز أولاً:** ابدأ دائمًا بإجابة موجزة ومباشرة في نقاط.
3.  **التنسيق الاحترافي:** استخدم تنسيق Markdown دائمًا.
4.  **سؤال المتابعة الذكي:** بعد كل إجابة، اطرح سؤالاً متابعًا واحدًا.

### الممنوعات:
- ممنوع اختلاق المعلومات.
- ممنوع حل الواجبات بشكل مباشر.

---
**المحتوى المرجعي لهذه الجلسة:**

${lectureContext || 'لا يوجد محتوى محدد.'}
---
`;

    const contents = conversationHistory.map((turn, index) => {
      const isLastMessage = index === conversationHistory.length - 1;
      return {
        role: isLastMessage && turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.content }]
      };
    });

    const newAnswer = await queryGoogleAI(systemInstructionText, contents, GOOGLE_API_KEY);

    // حفظ الإجابة في الـ Cache
    if (supabase) {
      const questionHash = await hashText(userQuestion.toLowerCase().trim());
      const contextHash = await hashText(lectureContext || '');
      await cacheResponse(supabase, questionHash, userQuestion, newAnswer.trim(), contextHash);
    }

    return new Response(JSON.stringify({ 
      reply: newAnswer.trim(),
      cached: false,
      source: 'ai'
    }), {
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache-Status': 'MISS'
      },
    });

  } catch (error) {
    console.error("❌ Function Error:", error);
    return new Response(JSON.stringify({ 
      error: 'حدث خطأ ما في الخادم.',
      details: error.message 
    }), {
      status: 500, 
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
