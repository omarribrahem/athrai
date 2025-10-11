// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - النسخة النهائية
// =================================================================

import { createClient } from '@supabase/supabase-js';

function normalizeQuestion(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[؟?!]/g, '')
    .substring(0, 200);
}

async function findInCache(supabase, questionText, contextHash) {
  try {
    const normalizedQuestion = normalizeQuestion(questionText);
    
    console.log('🔍 Searching for exact match...');
    const { data: exactMatch, error: exactError } = await supabase
      .from('ai_responses_cache_simple')
      .select('id, response_text, hit_count, question_text')
      .eq('question_hash', normalizedQuestion)
      .eq('lecture_context_hash', contextHash)
      .limit(1)
      .single();
    
    if (!exactError && exactMatch) {
      console.log('✅ CACHE HIT (Exact Match)!');
      console.log('   Original: "' + exactMatch.question_text.substring(0, 60) + '..."');
      console.log('   Hit count: ' + exactMatch.hit_count);
      
      supabase
        .from('ai_responses_cache_simple')
        .update({ 
          hit_count: exactMatch.hit_count + 1,
          last_accessed: new Date().toISOString()
        })
        .eq('id', exactMatch.id)
        .then(() => console.log('   Counter updated.'))
        .catch(e => console.warn('   Counter update failed:', e.message));
      
      return {
        answer: exactMatch.response_text,
        matchType: 'exact',
        originalQuestion: exactMatch.question_text,
        hitCount: exactMatch.hit_count + 1
      };
    }
    
    console.log('🔍 Searching for partial match...');
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
      console.log('   Original: "' + partialMatch.question_text.substring(0, 60) + '..."');
      console.log('   Hit count: ' + partialMatch.hit_count);
      
      supabase
        .from('ai_responses_cache_simple')
        .update({ 
          hit_count: partialMatch.hit_count + 1,
          last_accessed: new Date().toISOString()
        })
        .eq('id', partialMatch.id)
        .then(() => console.log('   Counter updated.'))
        .catch(e => console.warn('   Counter update failed:', e.message));
      
      return {
        answer: partialMatch.response_text,
        matchType: 'partial',
        originalQuestion: partialMatch.question_text,
        hitCount: partialMatch.hit_count + 1
      };
    }
    
    console.log('❌ CACHE MISS - No similar questions found');
    return null;
    
  } catch (error) {
    console.error('❌ Cache search error:', error.message);
    return null;
  }
}

async function saveToCache(supabase, questionText, responseText, contextHash) {
  try {
    const normalizedQuestion = normalizeQuestion(questionText);
    
    console.log('💾 Saving to cache...');
    
    const { data, error } = await supabase
      .from('ai_responses_cache_simple')
      .insert({
        question_text: questionText,
        question_hash: normalizedQuestion,
        response_text: responseText,
        lecture_context_hash: contextHash,
        hit_count: 1,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString()
      })
      .select();
    
    if (error) {
      console.error('❌ Cache save error:', error.message);
      if (error.code === '42501') {
        console.error('   ⚠️ Permission denied - Check RLS policies!');
      } else if (error.code === '23505') {
        console.error('   ⚠️ Duplicate entry - Question already cached');
      }
    } else {
      console.log('✅ Response cached successfully');
      if (data && data[0]) {
        console.log('   Cache ID: ' + data[0].id);
      }
    }
    
  } catch (error) {
    console.error('❌ Cache save exception:', error.message);
  }
}

async function queryGoogleAI(systemInstruction, conversationHistory, apiKey) {
  const model = 'gemini-2.0-flash-exp';
  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  
  console.log('🤖 Calling Gemini 2.0 (' + model + ')...');
  
  const modifiedContents = [
    {
      role: 'user',
      parts: [{ text: systemInstruction }]
    },
    {
      role: 'model',
      parts: [{ text: 'فهمت تماماً. سأتبع هذه التعليمات في جميع إجاباتي.' }]
    },
    ...conversationHistory.map((turn, index) => ({
      role: (index === conversationHistory.length - 1 && turn.role === 'user') ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }))
  ];
  
  const requestBody = {
    contents: modifiedContents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 512,
      topP: 0.92,
      topK: 35
    }
  };
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("❌ Gemini API Error:", errorBody);
      throw new Error('Gemini API error (' + response.status + '): ' + errorBody.substring(0, 200));
    }
    
    const result = await response.json();
    
    if (result.candidates && result.candidates[0] && result.candidates[0].content && 
        result.candidates[0].content.parts && result.candidates[0].content.parts[0] && 
        result.candidates[0].content.parts[0].text) {
      const answerText = result.candidates[0].content.parts[0].text;
      console.log('✅ Gemini response received (' + answerText.length + ' chars)');
      return answerText;
    }
    
    console.warn('⚠️ No text in Gemini response:', JSON.stringify(result, null, 2));
    return "عفواً، لم أتمكن من إيجاد إجابة مناسبة. هل يمكنك إعادة صياغة سؤالك؟";
    
  } catch (error) {
    console.error("❌ queryGoogleAI error:", error.message);
    throw error;
  }
}

export async function onRequest(context) {
  const startTime = Date.now();
  
  try {
    const { env, request } = context;
    
    const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
    
    console.log('\n' + '='.repeat(70));
    console.log('🚀 NEW REQUEST RECEIVED');
    console.log('='.repeat(70));
    
    if (request.method !== 'POST') {
      console.log('❌ Invalid method:', request.method);
      return new Response(JSON.stringify({ 
        error: 'Method Not Allowed',
        message: 'Only POST requests are accepted'
      }), { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!GOOGLE_API_KEY) {
      console.error('❌ GOOGLE_API_KEY is not set!');
      return new Response(JSON.stringify({ 
        error: 'خطأ في إعدادات الخادم.',
        message: 'Google API Key is missing'
      }), {
        status: 500, 
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('❌ JSON Parse Error:', parseError.message);
      return new Response(JSON.stringify({ 
        error: 'بيانات غير صحيحة',
        message: 'Invalid JSON in request body'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { conversationHistory, context: lectureContext } = body;
    
    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      console.error('❌ Invalid conversation history');
      return new Response(JSON.stringify({ 
        error: 'بيانات المحادثة غير صحيحة.',
        message: 'conversationHistory must be an array'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const lastUserMessage = conversationHistory
      .slice()
      .reverse()
      .find(msg => msg.role === 'user');
    
    if (!lastUserMessage || !lastUserMessage.content) {
      console.error('❌ No user question found');
      return new Response(JSON.stringify({ 
        error: 'لم يتم العثور على سؤال.',
        message: 'No user message found in conversation history'
      }), {
        status: 400, 
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const userQuestion = lastUserMessage.content;
    const contextHash = lectureContext ? lectureContext.substring(0, 100) : 'default';
    
    console.log('📩 User Question: "' + userQuestion.substring(0, 70) + '..."');
    console.log('📚 Context Hash: "' + contextHash.substring(0, 50) + '..."');
    
    let cachedResult = null;
    let cacheEnabled = false;
    
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      cacheEnabled = true;
      console.log('🗄️  Supabase cache enabled');
      
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        cachedResult = await findInCache(supabase, userQuestion, contextHash);
        
        if (cachedResult) {
          const responseTime = Date.now() - startTime;
          
          console.log('⚡ Returning cached response (' + responseTime + 'ms)');
          console.log('='.repeat(70) + '\n');
          
          return new Response(JSON.stringify({ 
            reply: cachedResult.answer,
            cached: true,
            matchType: cachedResult.matchType,
            source: 'supabase-cache',
            originalQuestion: cachedResult.originalQuestion,
            hitCount: cachedResult.hitCount,
            responseTime: responseTime + 'ms'
          }), {
            status: 200, 
            headers: { 
              'Content-Type': 'application/json',
              'X-Cache-Status': 'HIT',
              'X-Match-Type': cachedResult.matchType,
              'X-Response-Time': responseTime + 'ms'
            }
          });
        }
        
      } catch (cacheError) {
        console.warn('⚠️ Cache lookup failed:', cacheError.message);
      }
    } else {
      console.log('⚠️  Supabase cache disabled (no credentials)');
    }
    
    console.log('🔄 Cache miss - calling Gemini...');
    
    // إعداد System Instruction
    const systemInstructionText = 
      'أنت "أثر AI"، مساعد دراسي من منصة "أثر" التعليمية.\n\n' +
      '### شخصيتك: شاب مصري صاحب\n\n' +
      'أسلوبك حماسي وودود زي الأصحاب!\n\n' +
      'تعبيرات مصرية:\n' +
      '- "إيه الأخبار؟" "إيه الدنيا معاك؟"\n' +
      '- "يا عم" "يا باشا" "يا معلم"\n\n' +
      '### ردود أولية:\n\n' +
      'طالب: "أهلاً"\n' +
      'أنت: "أهلاً! إيه الأخبار؟ إيه الدنيا معاك؟"\n\n' +
      'طالب: "السلام عليكم"\n' +
      'أنت: "وعليكم السلام! عامل إيه؟ كله تمام؟"\n\n' +
      'طالب: "مين أنت؟"\n' +
      'أنت: "أنا أثر AI، صاحبك في المذاكرة!"\n\n' +
      '### التكيف:\n\n' +
      'بعد 2-3 رسائل، حاكي أسلوب الطالب:\n' +
      '- لو فصحى → استخدم فصحى\n' +
      '- لو عامية مصرية → استمر عامية\n' +
      '- لو خليجي → حوّل للخليجية\n\n' +
      '### قواعد الشرح:\n\n' +
      '1. ابدأ بجملة ودية\n' +
      '2. إجابة مختصرة (2-3 جمل)\n' +
      '3. **نص عريض** للمصطلحات\n' +
      '4. قوائم نقطية للتوضيح\n' +
      '5. اختم بسؤال للتفكير\n\n' +
      '### الممنوعات:\n\n' +
      '1. الإجابة خارج المحتوى\n' +
      '2. حل الواجبات مباشرة\n' +
      '3. اختلاع معلومات\n' +
      '4. الإطالة\n\n' +
      '### المحتوى المرجعي:\n\n' +
      (lectureContext || 'لا يوجد محتوى محدد') + '\n\n' +
      '### أمثلة:\n\n' +
      'مصري: "عايز أفهم الخلية"\n' +
      'أنت: "ماشي! الخلية أصغر وحدة حية"\n\n' +
      'فصحى: "أريد أن أفهم الخلية"\n' +
      'أنت: "بكل سرور! الخلية هي الوحدة الأساسية"\n\n' +
      'خليجي: "ودي أفهم الخلية"\n' +
      'أنت: "تمام! الخلية أصغر وحدة حية"\n\n' +
      'هدفك: اجعل التعلم ممتع وسهل!';
    
    const aiAnswer = await queryGoogleAI(systemInstructionText, conversationHistory, GOOGLE_API_KEY);
    
    if (cacheEnabled && SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        saveToCache(supabase, userQuestion, aiAnswer.trim(), contextHash)
          .catch(error => console.error('Cache save failed:', error.message));
        
      } catch (saveError) {
        console.warn('⚠️ Failed to initialize cache save:', saveError.message);
      }
    }
    
    const responseTime = Date.now() - startTime;
    
    console.log('✅ Response ready (' + responseTime + 'ms)');
    console.log('='.repeat(70) + '\n');
    
    return new Response(JSON.stringify({ 
      reply: aiAnswer.trim(),
      cached: false,
      source: 'gemini-2.0-flash-exp',
      responseTime: responseTime + 'ms'
    }), {
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache-Status': 'MISS',
        'X-Response-Time': responseTime + 'ms'
      }
    });
    
  } catch (error) {
    console.error('\n' + '!'.repeat(70));
    console.error("❌ FATAL ERROR:");
    console.error('!'.repeat(70));
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('!'.repeat(70) + '\n');
    
    const errorTime = Date.now() - startTime;
    
    return new Response(JSON.stringify({ 
      error: 'حدث خطأ في الخادم',
      message: error.message,
      responseTime: errorTime + 'ms'
    }), {
      status: 500, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
