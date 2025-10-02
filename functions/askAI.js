// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - Free Tier Models
//   
//   الموديلات المستخدمة (كلها مجانية):
//   - gemini-1.5-flash (النص) - 15 requests/minute
//   - text-embedding-004 (Embeddings) - 1500 requests/day
//   
//   ✅ Semantic Caching
//   ✅ Supabase Integration
//   ✅ توفير 70-80% من API calls
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * إنشاء embedding من النص
 * Model: text-embedding-004 (Free tier)
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
    
    return result.embedding.values;
  } catch (error) {
    console.error('❌ createEmbedding error:', error.message);
    throw error;
  }
}

/**
 * البحث عن سؤال مشابه في Cache
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
 * حفظ السؤال والإجابة
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
      console.log('💾 Response cached');
    }
  } catch (err) {
    console.error('❌ cacheResponse exception:', err.message);
  }
}

/**
 * استدعاء Google Gemini
 * Model: gemini-1.5-flash (Free tier: 15 RPM)
 */
async function queryGoogleAI(systemInstruction, contents, apiKey) {
  const model = 'gemini-1.5-flash';
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
 * الدالة الرئيسية
 */
export async function onRequest(context) {
  const startTime = Date.now();
  
  try {
    const { env, request } = context;
    
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

    // التحقق من Method
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
    console.log(`\n📩 "${userQuestion.substring(0, 70)}..."`);

    // === محاولة Cache ===
    let cachedResult = null;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        console.log('🔍 Creating embedding...');
        const questionEmbedding = await createEmbedding(userQuestion, GOOGLE_API_KEY);
        
        console.log('🔎 Searching cache...');
        cachedResult = await findSimilarQuestion(supabase, questionEmbedding, 0.85);

        if (cachedResult) {
          const responseTime = Date.now() - startTime;
          
          return new Response(JSON.stringify({ 
            reply: cachedResult.answer,
            cached: true,
            source: 'semantic-cache',
            similarity: cachedResult.similarity,
            responseTime: `${responseTime}ms`
          }), {
            status: 200, 
            headers: { 
              'Content-Type': 'application/json',
              'X-Cache-Status': 'HIT'
            },
          });
        }
      } catch (cacheError) {
        console.warn('⚠️ Cache failed:', cacheError.message);
      }
    } else {
      console.warn('⚠️ Supabase not configured');
    }

    // === استدعاء Gemini ===
    console.log('🤖 Calling Gemini...');

    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود ومحب للمعرفة من منصة "أثر".

### شخصيتك:
- ودود ومطمئن
- تفاعلي ومحفز

### قواعدك:
1. **التركيز:** الإجابة على المحتوى المرجعي فقط
2. **الإيجاز:** ابدأ بإجابة موجزة ومباشرة
3. **Markdown:** استخدم **العريض** و- للقوائم
4. **المتابعة:** اطرح سؤال بسيط بعد الإجابة

### ممنوع:
- اختلاق معلومات
- حل واجبات مباشرة

---
**المحتوى:**
${lectureContext || 'لا يوجد محتوى'}
---`;

    const contents = conversationHistory.map((turn, index) => ({
      role: (index === conversationHistory.length - 1 && turn.role === 'user') ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }));

    const aiAnswer = await queryGoogleAI(systemInstructionText, contents, GOOGLE_API_KEY);

    // === حفظ في Cache ===
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
        console.warn('⚠️ Save failed:', saveError.message);
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
        'X-Cache-Status': 'MISS'
      },
    });

  } catch (error) {
    console.error("❌ ERROR:", error);
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
