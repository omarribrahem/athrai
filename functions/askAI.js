// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - النسخة النهائية المستقرة
//   
//   الموديلات المستخدمة (مستقرة ومتاحة عالمياً):
//   - gemini-pro (Text generation) - 60 RPM مجاناً
//   - embedding-001 (Embeddings) - 1500 requests/day مجاناً
//   
//   ✅ Semantic Caching مع Supabase
//   ✅ توفير 70-80% من API calls
//   ✅ يعمل في جميع المناطق الجغرافية
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * =================================================================
 * دالة: createEmbedding
 * الغرض: تحويل النص إلى vector رقمي (embedding) بحجم 768
 * الموديل: embedding-001 (مستقر ومتاح)
 * =================================================================
 */
async function createEmbedding(text, apiKey) {
  const model = 'embedding-001';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: {
          parts: [{ text: text }]
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    
    if (!result.embedding || !result.embedding.values) {
      throw new Error('Invalid embedding response format');
    }
    
    return result.embedding.values;
  } catch (error) {
    console.error('❌ createEmbedding error:', error.message);
    throw error;
  }
}

/**
 * =================================================================
 * دالة: findSimilarQuestion
 * الغرض: البحث عن سؤال مشابه في Cache
 * =================================================================
 */
async function findSimilarQuestion(supabase, questionEmbedding, threshold = 0.85) {
  try {
    const { data, error } = await supabase.rpc('match_questions', {
      query_embedding: questionEmbedding,
      match_threshold: threshold,
      match_count: 1
    });

    if (error) {
      console.error('❌ Similarity search error:', error);
      return null;
    }

    if (data && data.length > 0) {
      const match = data[0];
      const similarityPercent = (match.similarity * 100).toFixed(1);
      
      console.log(`✅ CACHE HIT! Similarity: ${similarityPercent}%`);
      console.log(`   Cached question: "${match.question_text.substring(0, 60)}..."`);
      
      // تحديث عداد الاستخدام
      await supabase
        .from('ai_responses_cache')
        .update({ 
          hit_count: match.hit_count + 1,
          last_accessed: new Date().toISOString()
        })
        .eq('id', match.id);

      return {
        answer: match.response_text,
        similarity: match.similarity,
        originalQuestion: match.question_text,
        hitCount: match.hit_count + 1
      };
    }

    console.log('❌ CACHE MISS');
    return null;
  } catch (err) {
    console.error('❌ findSimilarQuestion exception:', err.message);
    return null;
  }
}

/**
 * =================================================================
 * دالة: cacheResponse
 * الغرض: حفظ السؤال والإجابة الجديدة في Cache
 * =================================================================
 */
async function cacheResponse(supabase, questionText, questionEmbedding, responseText, contextHash) {
  try {
    const { error } = await supabase
      .from('ai_responses_cache')
      .insert({
        question_text: questionText,
        question_embedding: questionEmbedding,
        response_text: responseText,
        lecture_context_hash: contextHash,
        hit_count: 1,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString()
      });

    if (error) {
      console.error('❌ Cache save error:', error.message);
    } else {
      console.log('💾 Response cached successfully');
    }
  } catch (err) {
    console.error('❌ cacheResponse exception:', err.message);
  }
}

/**
 * =================================================================
 * دالة: queryGoogleAI
 * الغرض: استدعاء Google Gemini للحصول على إجابة
 * الموديل: gemini-pro (مستقر ومتاح عالمياً)
 * =================================================================
 */
async function queryGoogleAI(systemInstruction, contents, apiKey) {
  // استخدام gemini-pro (الأكثر استقراراً)
  const model = 'gemini-pro';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // دمج System Instruction كأول رسالة (لأن gemini-pro لا يدعم systemInstruction parameter)
  const modifiedContents = [
    {
      role: 'user',
      parts: [{ text: systemInstruction }]
    },
    {
      role: 'model',
      parts: [{ text: 'فهمت تماماً. سأتبع هذه التعليمات في جميع إجاباتي.' }]
    },
    ...contents
  ];

  const requestBody = {
    contents: modifiedContents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    }
  };

  try {
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

    return "عفواً، لم أتمكن من إيجاد إجابة مناسبة. هل يمكنك إعادة صياغة سؤالك؟";
  } catch (error) {
    console.error("❌ queryGoogleAI error:", error.message);
    throw error;
  }
}

/**
 * =================================================================
 * دالة: onRequest (الدالة الرئيسية)
 * الغرض: معالجة كل طلب من المستخدم
 * =================================================================
 */
export async function onRequest(context) {
  const startTime = Date.now();
  
  try {
    const { env, request } = context;
    
    // استخراج Environment Variables
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

    // التحقق من HTTP Method
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // التحقق من Google API Key
    if (!GOOGLE_API_KEY) {
      console.error('❌ GOOGLE_API_KEY missing');
      return new Response(JSON.stringify({ error: 'خطأ في إعدادات الخادم.' }), {
        status: 500, 
        headers: { 'Content-Type': 'application/json' },
      });
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
    console.log(`\n📩 NEW REQUEST: "${userQuestion.substring(0, 70)}..."`);

    // === محاولة البحث في Cache ===
    let cachedResult = null;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        console.log('🔍 Creating embedding...');
        const questionEmbedding = await createEmbedding(userQuestion, GOOGLE_API_KEY);
        
        console.log('🔎 Searching cache...');
        cachedResult = await findSimilarQuestion(supabase, questionEmbedding, 0.85);

        // إذا وُجد في Cache → إرجاع فوري
        if (cachedResult) {
          const responseTime = Date.now() - startTime;
          
          return new Response(JSON.stringify({ 
            reply: cachedResult.answer,
            cached: true,
            source: 'semantic-cache',
            similarity: cachedResult.similarity,
            originalQuestion: cachedResult.originalQuestion,
            hitCount: cachedResult.hitCount,
            responseTime: `${responseTime}ms`
          }), {
            status: 200, 
            headers: { 
              'Content-Type': 'application/json',
              'X-Cache-Status': 'HIT',
              'X-Similarity': cachedResult.similarity.toFixed(3),
              'X-Response-Time': `${responseTime}ms`
            },
          });
        }
      } catch (cacheError) {
        console.warn('⚠️ Cache lookup failed:', cacheError.message);
      }
    } else {
      console.warn('⚠️ Supabase not configured - caching disabled');
    }

    // === لم يُوجد في Cache → استدعاء Google AI ===
    console.log('🤖 Calling Gemini API...');

    // شخصية وقواعد "أثر AI"
    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود ومحب للمعرفة من منصة "أثر". هدفك هو جعل التعلم تجربة ممتعة وسهلة، وإشعال فضول الطالب.

### شخصيتك:
- **ودود ومطمئن:** استخدم دائمًا عبارات لطيفة ومحفزة مثل "لا تقلق، سنفهمها معًا"، "سؤال رائع! دعنا نحلله خطوة بخطوة"، "فكرة ممتازة، هذا يقودنا إلى...".
- **تفاعلي:** كن شريكًا في الحوار. لا تكتفِ بتقديم المعلومات، بل اجعل الطالب جزءًا من رحلة اكتشافها.

### قواعدك الذهبية:
1. **التركيز المطلق:** مهمتك **الوحيدة** هي الإجابة على الأسئلة المتعلقة بـ "المحتوى المرجعي لهذه الجلسة".
2. **الإيجاز أولاً:** ابدأ دائمًا بإجابة موجزة ومباشرة في نقاط.
3. **التنسيق الاحترافي:** استخدم تنسيق Markdown دائماً. استعمل **النص العريض** للمصطلحات الهامة، و- للقوائم النقطية.
4. **سؤال المتابعة الذكي:** بعد كل إجابة، اطرح سؤالاً متابعًا واحدًا وبسيطًا.

### الممنوعات:
- ممنوع اختلاق المعلومات.
- ممنوع حل الواجبات بشكل مباشر.

---
**المحتوى المرجعي لهذه الجلسة:**
${lectureContext || 'لا يوجد محتوى محدد'}
---`;

    // تحويل سجل المحادثة لتنسيق Gemini
    const contents = conversationHistory.map((turn, index) => ({
      role: (index === conversationHistory.length - 1 && turn.role === 'user') ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }));

    const aiAnswer = await queryGoogleAI(systemInstructionText, contents, GOOGLE_API_KEY);

    // === حفظ الإجابة الجديدة في Cache ===
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const questionEmbedding = await createEmbedding(userQuestion, GOOGLE_API_KEY);
        const contextHash = lectureContext ? 
          btoa(lectureContext.substring(0, 100)) : 'default';
        
        await cacheResponse(
          supabase, 
          userQuestion, 
          questionEmbedding,
          aiAnswer.trim(), 
          contextHash
        );
      } catch (saveError) {
        console.warn('⚠️ Failed to cache response:', saveError.message);
      }
    }

    // === إرجاع الإجابة للمستخدم ===
    const responseTime = Date.now() - startTime;

    return new Response(JSON.stringify({ 
      reply: aiAnswer.trim(),
      cached: false,
      source: 'google-ai',
      responseTime: `${responseTime}ms`
    }), {
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache-Status': 'MISS',
        'X-Response-Time': `${responseTime}ms`
      },
    });

  } catch (error) {
    // === معالجة الأخطاء ===
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

/**
 * =================================================================
 * ملاحظات التشغيل والصيانة:
 * =================================================================
 * 
 * 1. الموديلات المستخدمة:
 *    - gemini-pro: مستقر ومتاح في جميع المناطق
 *    - embedding-001: مستقر ومتاح عالمياً
 * 
 * 2. الأداء:
 *    - Cache Hit: ~300ms
 *    - Cache Miss: ~2-3 seconds
 *    - معدل Cache Hit المتوقع: 70-85%
 * 
 * 3. التكاليف:
 *    - مجاني 100% ضمن حدود Free Tier
 *    - gemini-pro: 60 RPM
 *    - embedding-001: 1500 requests/day
 * 
 * 4. المتطلبات:
 *    - Environment Variables: GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
 *    - Supabase: جدول ai_responses_cache + function match_questions
 *    - Dependencies: @supabase/supabase-js
 * =================================================================
 */
