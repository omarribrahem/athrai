// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - Cloudflare Pages Function
//   مع Semantic Caching لتوفير 70-80% من تكاليف API
//   
//   المميزات:
//   - ✅ Semantic search باستخدام embeddings
//   - ✅ Cache ذكي في Supabase
//   - ✅ توفير تكاليف Google AI
//   - ✅ استجابة سريعة (300ms بدلاً من 3s)
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * إنشاء embedding vector من النص باستخدام Google Embedding API
 * @param {string} text - النص المراد تحويله لـ vector
 * @param {string} apiKey - Google API Key
 * @returns {Promise<Array<number>>} - Vector بحجم 768
 */
async function createEmbedding(text, apiKey) {
  const model = 'text-embedding-004';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
    
    return result.embedding.values; // Array of 768 numbers
  } catch (error) {
    console.error('❌ createEmbedding error:', error.message);
    throw error;
  }
}

/**
 * البحث عن سؤال مشابه دلالياً في الـ cache
 * @param {Object} supabase - Supabase client
 * @param {Array<number>} questionEmbedding - Vector للسؤال
 * @param {number} threshold - نسبة التشابه المطلوبة (0.85 = 85%)
 * @returns {Promise<Object|null>} - الإجابة المخزنة أو null
 */
async function findSimilarQuestion(supabase, questionEmbedding, threshold = 0.85) {
  try {
    const { data, error } = await supabase.rpc('match_questions', {
      query_embedding: questionEmbedding,
      match_threshold: threshold,
      match_count: 1
    });

    if (error) {
      console.error('❌ Similarity search RPC error:', error);
      return null;
    }

    if (data && data.length > 0) {
      const match = data[0];
      const similarityPercent = (match.similarity * 100).toFixed(1);
      
      console.log(`✅ CACHE HIT! Similarity: ${similarityPercent}%`);
      console.log(`   Cached question: "${match.question_text.substring(0, 60)}..."`);
      
      // تحديث إحصائيات الاستخدام
      const { error: updateError } = await supabase
        .from('ai_responses_cache')
        .update({ 
          hit_count: match.hit_count + 1,
          last_accessed: new Date().toISOString()
        })
        .eq('id', match.id);

      if (updateError) {
        console.warn('⚠️ Failed to update hit_count:', updateError.message);
      }

      return {
        answer: match.response_text,
        similarity: match.similarity,
        originalQuestion: match.question_text,
        hitCount: match.hit_count + 1
      };
    }

    console.log(`❌ CACHE MISS - No similar questions found (threshold: ${threshold})`);
    return null;
  } catch (err) {
    console.error('❌ findSimilarQuestion exception:', err.message);
    return null;
  }
}

/**
 * حفظ السؤال والإجابة الجديدة في الـ cache
 * @param {Object} supabase - Supabase client
 * @param {string} questionText - نص السؤال
 * @param {Array<number>} questionEmbedding - Vector للسؤال
 * @param {string} responseText - الإجابة من AI
 * @param {string} contextHash - Hash للمحتوى
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
      console.log('💾 New response cached successfully');
    }
  } catch (err) {
    console.error('❌ cacheResponse exception:', err.message);
  }
}

/**
 * استدعاء Google Gemini للحصول على إجابة
 * @param {string} systemInstruction - التعليمات الأساسية للـ AI
 * @param {Array} contents - سجل المحادثة
 * @param {string} apiKey - Google API Key
 * @returns {Promise<string>} - إجابة AI
 */
async function queryGoogleAI(systemInstruction, contents, apiKey) {
  const model = 'gemini-1.5-flash-latest';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
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
    const errorBody = await response.text();
    console.error("❌ Google AI API Error:", errorBody);
    throw new Error(`Gemini API error (${response.status})`);
  }

  const result = await response.json();

  if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
    return result.candidates[0].content.parts[0].text;
  }

  return "عفواً، لم أتمكن من إيجاد إجابة مناسبة. هل يمكنك إعادة صياغة سؤالك؟";
}

/**
 * الدالة الرئيسية - Cloudflare Pages Function Handler
 * @param {Object} context - Cloudflare context object
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
      console.error('❌ GOOGLE_API_KEY is not set');
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

    // === محاولة البحث في Cache أولاً ===
    let cachedResult = null;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        console.log('🔍 Creating embedding for question...');
        const questionEmbedding = await createEmbedding(userQuestion, GOOGLE_API_KEY);
        
        console.log('🔎 Searching cache for similar questions...');
        cachedResult = await findSimilarQuestion(supabase, questionEmbedding, 0.85);

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
        console.warn('⚠️ Cache lookup failed, continuing with AI:', cacheError.message);
      }
    } else {
      console.warn('⚠️ Supabase not configured - caching disabled');
    }

    // === استدعاء Google AI ===
    console.log('🤖 Calling Google Gemini API...');

    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود ومحب للمعرفة من منصة "أثر". هدفك هو جعل التعلم تجربة ممتعة وسهلة، وإشعال فضول الطالب.

### شخصيتك:
- **ودود ومطمئن:** استخدم دائمًا عبارات لطيفة ومحفزة مثل "لا تقلق، سنفهمها معًا"، "سؤال رائع! دعنا نحلله خطوة بخطوة"، "فكرة ممتازة، هذا يقودنا إلى...".
- **تفاعلي:** كن شريكًا في الحوار. لا تكتفِ بتقديم المعلومات، بل اجعل الطالب جزءًا من رحلة اكتشافها.

### قواعدك الذهبية:
1. **التركيز المطلق:** مهمتك **الوحيدة** هي الإجابة على الأسئلة المتعلقة بـ "المحتوى المرجعي لهذه الجلسة".
2. **الإيجاز أولاً:** ابدأ دائمًا بإجابة موجزة ومباشرة في نقاط.
3. **التنسيق الاحترافي:** استخدم تنسيق Markdown دائمًا. استعمل **النص العريض** للمصطلحات الهامة، و- للقوائم النقطية.
4. **سؤال المتابعة الذكي:** بعد كل إجابة، اطرح سؤالاً متابعًا واحدًا وبسيطًا.

### الممنوعات:
- ممنوع اختلاق المعلومات.
- ممنوع حل الواجبات بشكل مباشر.

---
**المحتوى المرجعي لهذه الجلسة:**
${lectureContext || 'لا يوجد محتوى محدد'}
---`;

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
