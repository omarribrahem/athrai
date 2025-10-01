// =================================================================
//   functions/askAI.js
//   منصة أثر - Semantic Caching for Cloudflare Pages
//   📊 يوفر 70-80% من تكاليف Google AI
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * إنشاء embedding vector من النص
 */
async function createEmbedding(text, apiKey) {
  const model = 'text-embedding-004';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: text }] }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Embedding failed (${response.status}): ${err}`);
    }

    const result = await response.json();
    
    if (!result.embedding?.values) {
      throw new Error('Invalid embedding response');
    }
    
    return result.embedding.values; // Array[768]
  } catch (error) {
    console.error('❌ createEmbedding:', error.message);
    throw error;
  }
}

/**
 * البحث عن سؤال مشابه
 */
async function findSimilarQuestion(supabase, embedding, threshold = 0.85) {
  try {
    const { data, error } = await supabase.rpc('match_questions', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: 1
    });

    if (error) {
      console.error('❌ RPC error:', error);
      return null;
    }

    if (data && data.length > 0) {
      const match = data[0];
      const percent = (match.similarity * 100).toFixed(1);
      
      console.log(`✅ CACHE HIT! ${percent}% similar`);
      console.log(`   Original: "${match.question_text.substring(0, 50)}..."`);
      
      // Update stats
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
        original: match.question_text,
        hits: match.hit_count + 1
      };
    }

    console.log(`❌ CACHE MISS (threshold: ${threshold})`);
    return null;
  } catch (err) {
    console.error('❌ findSimilar exception:', err);
    return null;
  }
}

/**
 * حفظ السؤال والإجابة
 */
async function saveToCache(supabase, question, embedding, answer, contextHash) {
  try {
    const { error } = await supabase
      .from('ai_responses_cache')
      .insert({
        question_text: question,
        question_embedding: embedding,
        response_text: answer,
        lecture_context_hash: contextHash,
        hit_count: 1,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString()
      });

    if (error) {
      console.error('❌ Save error:', error);
    } else {
      console.log('💾 Cached successfully');
    }
  } catch (err) {
    console.error('❌ saveToCache exception:', err);
  }
}

/**
 * استدعاء Google Gemini
 */
async function callGemini(systemPrompt, messages, apiKey) {
  const model = 'gemini-1.5-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json();
    console.error('❌ Gemini error:', err);
    throw new Error(`Gemini failed: ${err.error?.message || 'Unknown'}`);
  }

  const result = await response.json();
  
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (text) return text;
  
  return 'عفواً، لم أتمكن من إيجاد إجابة مناسبة.';
}

/**
 * Main Handler - Cloudflare Pages Function
 */
export async function onRequest(context) {
  const start = Date.now();
  
  try {
    const { env, request } = context;
    
    // Environment vars
    const GOOGLE_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_KEY = env.SUPABASE_ANON_KEY;

    // Validate method
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check Google key
    if (!GOOGLE_KEY) {
      console.error('❌ GOOGLE_API_KEY missing');
      return new Response(JSON.stringify({ error: 'خطأ في الإعدادات' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse request
    const { conversationHistory, context: lectureContext } = await request.json();

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return new Response(JSON.stringify({ error: 'بيانات غير صحيحة' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get last user message
    const lastMsg = conversationHistory
      .slice()
      .reverse()
      .find(m => m.role === 'user');

    if (!lastMsg) {
      return new Response(JSON.stringify({ error: 'لا يوجد سؤال' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const question = lastMsg.content;
    console.log(`\n📩 "${question.substring(0, 60)}..."`);

    // === Try Cache ===
    let cached = null;

    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        
        console.log('🔍 Creating embedding...');
        const embedding = await createEmbedding(question, GOOGLE_KEY);
        
        console.log('🔎 Searching cache...');
        cached = await findSimilarQuestion(supabase, embedding, 0.85);

        if (cached) {
          const time = Date.now() - start;
          
          return new Response(JSON.stringify({ 
            reply: cached.answer,
            cached: true,
            source: 'semantic-cache',
            similarity: cached.similarity,
            originalQuestion: cached.original,
            hitCount: cached.hits,
            responseTime: `${time}ms`
          }), {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'X-Cache': 'HIT',
              'X-Time': `${time}ms`
            }
          });
        }
      } catch (cacheErr) {
        console.warn('⚠️ Cache failed:', cacheErr.message);
      }
    } else {
      console.warn('⚠️ Supabase not configured');
    }

    // === Call AI ===
    console.log('🤖 Calling Gemini...');

    const systemPrompt = `أنت "أثر AI" مساعد تعليمي ودود.

### قواعدك:
1. **التركيز:** إجابة محتوى المحاضرة فقط
2. **إيجاز:** إجابة مختصرة أولاً
3. **Markdown:** **عريض** و- قوائم
4. **متابعة:** سؤال بسيط بعد الإجابة

### ممنوع:
- اختلاق معلومات
- حل واجبات مباشرة

---
**المحتوى:**
${lectureContext || 'لا يوجد'}
---`;

    const messages = conversationHistory.map((m, i) => ({
      role: (i === conversationHistory.length - 1 && m.role === 'user') ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const answer = await callGemini(systemPrompt, messages, GOOGLE_KEY);

    // === Save to Cache ===
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        const embedding = await createEmbedding(question, GOOGLE_KEY);
        const hash = lectureContext ? btoa(lectureContext.substring(0, 100)) : 'default';
        
        await saveToCache(supabase, question, embedding, answer.trim(), hash);
      } catch (saveErr) {
        console.warn('⚠️ Save failed:', saveErr.message);
      }
    }

    const time = Date.now() - start;

    return new Response(JSON.stringify({ 
      reply: answer.trim(),
      cached: false,
      source: 'google-ai',
      responseTime: `${time}ms`
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'X-Time': `${time}ms`
      }
    });

  } catch (error) {
    console.error('❌ FATAL:', error);
    const time = Date.now() - start;
    
    return new Response(JSON.stringify({ 
      error: 'خطأ في الخادم',
      details: error.message,
      responseTime: `${time}ms`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
