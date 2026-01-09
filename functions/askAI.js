// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - النسخة المستقرة
//   
//   الموديل: gemini-1.5-flash (Updated for stability)
//   ✅ Google Search Integration
//   ✅ Supabase Caching
//   ✅ Error Handling & Safety Settings
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * دالة: normalizeQuestion
 * الغرض: تنظيف وتوحيد صيغة السؤال
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
 * دالة: findInCache
 * الغرض: البحث عن سؤال مشابه في Cache
 */
async function findInCache(supabase, questionText, contextHash) {
  try {
    const normalizedQuestion = normalizeQuestion(questionText);
    
    // 1. Search for Exact Match
    const { data: exactMatch, error: exactError } = await supabase
      .from('ai_responses_cache_simple')
      .select('id, response_text, hit_count, question_text')
      .eq('question_hash', normalizedQuestion)
      .eq('lecture_context_hash', contextHash)
      .limit(1)
      .single();
    
    if (!exactError && exactMatch) {
      console.log('✅ CACHE HIT (Exact Match)!');
      
      // Update hit count asynchronously (fire and forget)
      supabase.from('ai_responses_cache_simple')
        .update({ hit_count: exactMatch.hit_count + 1, last_accessed: new Date().toISOString() })
        .eq('id', exactMatch.id).then(() => {});
      
      return {
        answer: exactMatch.response_text,
        matchType: 'exact',
        originalQuestion: exactMatch.question_text,
        hitCount: exactMatch.hit_count + 1
      };
    }
    
    // 2. Search for Partial Match (using Text Search)
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
      
      return {
        answer: partialMatch.response_text,
        matchType: 'partial',
        originalQuestion: partialMatch.question_text,
        hitCount: partialMatch.hit_count + 1
      };
    }
    
    return null; // Cache Miss
    
  } catch (error) {
    console.warn('⚠️ Cache search error (Non-fatal):', error.message);
    return null;
  }
}

/**
 * دالة: saveToCache
 * الغرض: حفظ السؤال والإجابة في Cache
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
    console.warn('⚠️ Cache save error (Non-fatal):', error.message);
  }
}

/**
 * دالة: queryGoogleAI
 * الغرض: استدعاء Gemini مع البحث على الإنترنت وتنسيق صحيح
 */
async function queryGoogleAI(systemInstruction, conversationHistory, apiKey) {
  // ✅ SWITCHED TO 1.5-FLASH FOR STABILITY & QUOTA
  const model = 'gemini-1.5-flash'; 
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  console.log(`🤖 Calling ${model} with Google Search...`);

  // Clean history structure
  const cleanHistory = conversationHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  const requestBody = {
    // ✅ SYSTEM INSTRUCTION FIELD
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: cleanHistory,
    // ✅ GOOGLE SEARCH TOOL
    tools: [
      { google_search: {} } 
    ],
    // ✅ SAFETY SETTINGS (Prevent Blocking)
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
    ],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048, // Increased for search results
      topP: 0.95,
      topK: 40
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`❌ Gemini API Error (${response.status}):`, errorBody);
      throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];

    // Check if blocked by safety
    if (candidate?.finishReason === 'SAFETY') {
      return "عذراً، لا يمكنني الإجابة على هذا السؤال لأنه يخالف معايير السلامة.";
    }

    const answerText = candidate?.content?.parts?.[0]?.text;

    if (answerText) {
      if (candidate?.groundingMetadata?.searchEntryPoint) {
        console.log('✅ Response used Google Search');
      }
      return answerText;
    }

    console.warn('⚠️ Empty response from Gemini:', JSON.stringify(result));
    return "عفواً، لم أتمكن من تكوين إجابة. يرجى إعادة الصياغة.";

  } catch (error) {
    console.error("❌ queryGoogleAI error:", error.message);
    throw error;
  }
}

/**
 * دالة: onRequest (الدالة الرئيسية)
 */
export async function onRequest(context) {
  const startTime = Date.now();
  
  try {
    const { env, request } = context;
    
    // Environment Variables Check
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
    
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    
    if (!GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server Config Error: Missing API Key' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const body = await request.json();
    const { conversationHistory, context: lectureContext } = body;
    
    // Basic Validation
    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return new Response('Invalid conversation history', { status: 400 });
    }

    // Get User Question
    const lastUserMessage = conversationHistory.slice().reverse().find(msg => msg.role === 'user');
    if (!lastUserMessage) return new Response('No question found', { status: 400 });

    const userQuestion = lastUserMessage.content;
    const contextHash = lectureContext ? lectureContext.substring(0, 100) : 'default';

    // 1. Try Cache (Supabase)
    let cachedResult = null;
    let cacheEnabled = false;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      cacheEnabled = true;
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      cachedResult = await findInCache(supabase, userQuestion, contextHash);
      
      if (cachedResult) {
        return new Response(JSON.stringify({ 
          reply: cachedResult.answer,
          cached: true,
          matchType: cachedResult.matchType
        }), {
          headers: { 'Content-Type': 'application/json', 'X-Cache-Status': 'HIT' }
        });
      }
    }

    // 2. Prepare System Prompt (The Persona)
    const systemInstructionText = 
      'أنت "أثر AI"، مساعد دراسي ذكي من منصة "أثر" التعليمية.\n\n' +
      '### 🎭 شخصيتك: شاب مصري صاحب\n' +
      'أسلوبك حماسي وودود زي الأصحاب بقالهم زمن! (إيه الأخبار؟، يا معلم، يا باشا)\n\n' +
      '### 🌐 قدرات البحث:\n' +
      'لديك أداة Google Search. استخدمها دائماً للحصول على أمثلة واقعية حديثة (2024-2025) وربط الدرس بالواقع.\n\n' +
      '### ✅ قواعد الشرح:\n' +
      '1. ابدأ بودية.\n' +
      '2. اشرح باختصار (100-200 كلمة).\n' +
      '3. استخدم نقاط (Bullet points).\n' +
      '4. ممنوع التأليف: ابحث عن المعلومة.\n\n' +
      '### 📚 المحتوى المرجعي للجلسة:\n' +
      (lectureContext || 'لا يوجد محتوى محدد') + '\n\n' +
      'هدفك: اجعل التعلم ممتعاً ومفيداً!';

    // 3. Call Gemini API
    const aiAnswer = await queryGoogleAI(systemInstructionText, conversationHistory, GOOGLE_API_KEY);

    // 4. Save to Cache (Background Task)
    if (cacheEnabled && SUPABASE_URL && SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      // Don't await - let it run in background
      context.waitUntil(saveToCache(supabase, userQuestion, aiAnswer.trim(), contextHash));
    }

    const responseTime = Date.now() - startTime;

    return new Response(JSON.stringify({ 
      reply: aiAnswer.trim(),
      cached: false,
      responseTime: responseTime + 'ms'
    }), {
      status: 200, 
      headers: { 'Content-Type': 'application/json', 'X-Cache-Status': 'MISS' }
    });

  } catch (error) {
    console.error("❌ FATAL ERROR:", error.message);
    return new Response(JSON.stringify({ 
      error: 'Internal Server Error', 
      message: error.message 
    }), {
      status: 500, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
