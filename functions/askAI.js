// =================================================================
//   functions/askAI.js - النسخة مع Semantic Search
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * دالة لإنشاء embedding من النص باستخدام Google AI
 */
async function createEmbedding(text, apiKey) {
  const model = 'text-embedding-004';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;

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
    throw new Error('Embedding API failed');
  }

  const result = await response.json();
  return result.embedding.values; // array of 768 numbers
}

/**
 * دالة للبحث عن أسئلة مشابهة دلالياً (Semantic Search)
 */
async function findSimilarQuestion(supabase, questionEmbedding, threshold = 0.85) {
  try {
    // استخدام cosine similarity للبحث
    const { data, error } = await supabase.rpc('match_questions', {
      query_embedding: questionEmbedding,
      match_threshold: threshold,
      match_count: 1
    });

    if (error) {
      console.error('Similarity search error:', error);
      return null;
    }

    if (data && data.length > 0) {
      const match = data[0];
      console.log(`✅ Found similar question! Similarity: ${(match.similarity * 100).toFixed(1)}%`);
      
      // تحديث الإحصائيات
      await supabase
        .from('ai_responses_cache')
        .update({ 
          hit_count: match.hit_count + 1,
          last_accessed: new Date().toISOString()
        })
        .eq('id', match.id);

      return match.response_text;
    }

    console.log('❌ No similar question found');
    return null;
  } catch (err) {
    console.error('findSimilarQuestion exception:', err);
    return null;
  }
}

/**
 * دالة لحفظ السؤال والإجابة مع embedding
 */
async function cacheResponseWithEmbedding(
  supabase, 
  questionText, 
  questionEmbedding,
  responseText, 
  contextHash
) {
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
      console.error('Cache save error:', error);
    } else {
      console.log('💾 Response cached with embedding');
    }
  } catch (err) {
    console.error('cacheResponseWithEmbedding exception:', err);
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
 * الدالة الرئيسية
 */
export async function onRequest(context) {
  try {
    const { env, request } = context;
    
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (!GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'خطأ في إعدادات Google API.' }), {
        status: 500, 
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { conversationHistory, context: lectureContext } = await request.json();

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

    // محاولة البحث الدلالي في الـ Cache
    let cachedAnswer = null;
    let supabase = null;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      
      // إنشاء embedding للسؤال
      console.log('🔍 Creating question embedding...');
      const questionEmbedding = await createEmbedding(userQuestion, GOOGLE_API_KEY);
      
      // البحث عن أسئلة مشابهة (85% similarity أو أكثر)
      cachedAnswer = await findSimilarQuestion(supabase, questionEmbedding, 0.85);

      if (cachedAnswer) {
        return new Response(JSON.stringify({ 
          reply: cachedAnswer,
          cached: true,
          source: 'semantic-cache'
        }), {
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            'X-Cache-Status': 'HIT-SEMANTIC'
          },
        });
      }
    }

    // استدعاء Google AI
    console.log(`🤖 Calling Google AI API...`);

    const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ودود ومحب للمعرفة من منصة "أثر".

### قواعدك الذهبية:
1. **التركيز المطلق:** الإجابة فقط على الأسئلة المتعلقة بالمحتوى المرجعي.
2. **الإيجاز أولاً:** ابدأ بإجابة موجزة.
3. **Markdown:** استخدم التنسيق دائمًا.
4. **سؤال متابعة:** اطرح سؤالاً بسيطاً بعد الإجابة.

---
**المحتوى المرجعي:**
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

    // حفظ الإجابة مع embedding
    if (supabase) {
      const questionEmbedding = await createEmbedding(userQuestion, GOOGLE_API_KEY);
      const contextHash = lectureContext ? 
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lectureContext))
          .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''))
        : '';
      
      await cacheResponseWithEmbedding(
        supabase, 
        userQuestion, 
        questionEmbedding,
        newAnswer.trim(), 
        contextHash
      );
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
