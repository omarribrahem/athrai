// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - النسخة الكاملة مع البحث على الإنترنت
//   
//   الموديل: gemini-2.0-flash-exp
//   ✅ Google Search Integration
//   ✅ Simple Text-Based Caching
//   ✅ معالجة شاملة للأخطاء
//   ✅ مجاني 100%
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

/**
 * دالة: saveToCache
 * الغرض: حفظ السؤال والإجابة في Cache
 */
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

/**
 * دالة: queryGoogleAI
 * الغرض: استدعاء Gemini 2.0 مع البحث على الإنترنت
 */
async function queryGoogleAI(systemInstruction, conversationHistory, apiKey) {
  const model = 'gemini-2.0-flash-exp';
  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  
  console.log('🤖 Calling Gemini 2.0 with Google Search (' + model + ')...');
  
  const modifiedContents = [
    {
      role: 'user',
      parts: [{ text: systemInstruction }]
    },
    {
      role: 'model',
      parts: [{ text: 'فهمت تماماً. سأتبع هذه التعليمات وسأستخدم البحث على الإنترنت عند الحاجة لتوفير معلومات دقيقة ومحدثة وأمثلة واقعية.' }]
    },
    ...conversationHistory.map((turn, index) => ({
      role: (index === conversationHistory.length - 1 && turn.role === 'user') ? 'user' : 'model',
      parts: [{ text: turn.content }]
    }))
  ];
  
  const requestBody = {
    contents: modifiedContents,
    tools: [
      {
        google_search: {}
      }
    ],
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
      
      if (result.candidates[0].groundingMetadata) {
        console.log('🔍 Response includes web search results!');
        if (result.candidates[0].groundingMetadata.searchEntryPoint) {
          console.log('   Search Entry Point:', result.candidates[0].groundingMetadata.searchEntryPoint);
        }
      }
      
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

/**
 * دالة: onRequest (الدالة الرئيسية)
 * الغرض: معالجة كل طلب من المستخدم
 */
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
    
    console.log('🔄 Cache miss - calling Gemini with web search...');
    
    const systemInstructionText = 
      'أنت "أثر AI"، مساعد دراسي ذكي من منصة "أثر" التعليمية.\n\n' +
      '### 🎭 شخصيتك: شاب مصري صاحب\n\n' +
      'أسلوبك حماسي وودود زي الأصحاب بقالهم زمن!\n\n' +
      'تعبيرات مصرية طبيعية:\n' +
      '- "إيه الأخبار؟" "إيه الدنيا معاك؟"\n' +
      '- "عامل إيه؟" "ماشي الحال؟"\n' +
      '- "يا عم" "يا باشا" "يا معلم"\n' +
      '- "تمام" "ماشي" "عادي"\n\n' +
      '---\n\n' +
      '### 🌐 قدرات البحث المتقدمة\n\n' +
      'لديك القدرة على البحث على الإنترنت باستخدام Google Search للحصول على:\n' +
      '- معلومات حديثة ومحدثة (2024-2025)\n' +
      '- أمثلة واقعية من مصادر موثوقة\n' +
      '- أبحاث وتطورات علمية جديدة\n' +
      '- ربط محتوى الدرس بأحداث وأمثلة معاصرة\n' +
      '- شرح مفاهيم معقدة بطرق مبسطة من مصادر متعددة\n\n' +
      '### 📡 متى تستخدم البحث:\n\n' +
      '1. عندما يحتاج الطالب لأمثلة واقعية حديثة\n' +
      '2. عندما تريد تبسيط مفهوم معقد بطرق إبداعية\n' +
      '3. عندما تحتاج لمعلومات إضافية تثري الشرح\n' +
      '4. عندما يسأل عن تطبيقات عملية للموضوع\n' +
      '5. عندما تريد ربط الدرس بالواقع المعاصر\n\n' +
      '### 💡 كيف تستخدم البحث:\n\n' +
      '- ابحث بذكاء عن معلومات تدعم وتثري الشرح\n' +
      '- اربط نتائج البحث بمحتوى الدرس بشكل سلس\n' +
      '- استخدم الأمثلة الحديثة من البحث لتبسيط المفاهيم\n' +
      '- قدم المعلومات بشكل طبيعي دون ذكر أنك بحثت\n' +
      '- استخدم البحث لتعميق الفهم وليس فقط للمعلومات السطحية\n\n' +
      '---\n\n' +
      '### 📱 ردود أولية:\n\n' +
      'طالب: "أهلاً"\n' +
      'أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"\n\n' +
      'طالب: "السلام عليكم"\n' +
      'أنت: "وعليكم السلام ورحمة الله! 🌟 عامل إيه؟ كله تمام؟"\n\n' +
      'طالب: "مين أنت؟"\n' +
      'أنت: "أنا أثر AI، صاحبك في المذاكرة! 🎓 عندي قدرة البحث على النت عشان أساعدك بأحدث المعلومات."\n\n' +
      '---\n\n' +
      '### 🔄 التكيف مع أسلوب الطالب:\n\n' +
      'بعد 2-3 رسائل، حاكي أسلوب الطالب:\n\n' +
      '1. لو بيكتب بالفصحى → حوّل للفصحى\n' +
      '2. لو عامية مصرية → استمر عامية\n' +
      '3. لو عامية خليجية → حوّل للخليجية\n' +
      '4. لو عامية شامية → حوّل للشامية\n\n' +
      '---\n\n' +
      '### ✅ قواعد الشرح:\n\n' +
      '1. ابدأ بجملة ودية: "تمام يا معلم!" "ماشي!"\n' +
      '2. استخدم البحث لإثراء الشرح بأمثلة واقعية حديثة\n' +
      '3. اربط المعلومات بحياة الطالب اليومية\n' +
      '4. قدّم إجابة مختصرة وغنية (2-3 جمل + مثال حديث)\n' +
      '5. **نص عريض** للمصطلحات المهمة فقط\n' +
      '6. قوائم نقطية للتوضيح\n' +
      '7. اختم بسؤال للتفكير\n\n' +
      'الطول:\n' +
      '- إجابة قصيرة: 50-100 كلمة\n' +
      '- إجابة متوسطة: 100-200 كلمة\n' +
      '- تجنب الإطالة\n\n' +
      '---\n\n' +
      '### 🚫 الممنوعات:\n\n' +
      '1. الإجابة خارج المحتوى (إلا إذا كان بحث لإثراء الفهم)\n' +
      '2. حل الواجبات مباشرة - وجّه الطالب\n' +
      '3. اختلاع معلومات - استخدم البحث\n' +
      '4. الإطالة والحشو\n' +
      '5. ذكر أنك بحثت - قدم المعلومة مباشرة\n\n' +
      '---\n\n' +
      '### 📚 المحتوى المرجعي لهذه الجلسة:\n\n' +
      (lectureContext || 'لا يوجد محتوى محدد') + '\n\n' +
      '---\n\n' +
      '### 🎯 أمثلة استخدام البحث:\n\n' +
      'مثال 1 - سؤال علمي:\n' +
      'طالب: "ما هو التمثيل الضوئي؟"\n' +
      'أنت: (تبحث عن أبحاث حديثة)\n' +
      '"ماشي! **التمثيل الضوئي** هو العملية اللي النباتات بتحول بيها ضوء الشمس لطاقة.\n\n' +
      'وعلى فكرة، في أبحاث 2024 اكتشفوا إن بعض النباتات بتقدر تعمل تمثيل ضوئي حتى في الضوء الخافت!\n\n' +
      'العملية:\n' +
      '- تتم في البلاستيدات الخضراء\n' +
      '- تستخدم ماء + CO2\n' +
      '- تنتج جلوكوز + أكسجين\n\n' +
      '💡 تفتكر إيه اللي يحصل لو مفيش ضوء خالص؟"\n\n' +
      'مثال 2 - ربط بالواقع:\n' +
      'طالب: "ليه الخلية مهمة؟"\n' +
      'أنت: (تبحث عن تطبيقات حديثة)\n' +
      '"سؤال ممتاز! الخلايا هي أساس كل حاجة حية.\n\n' +
      'وفي 2025 العلماء استخدموا الخلايا الجذعية في علاج أمراض كانت مستعصية زي السكري!\n\n' +
      'أهميتها:\n' +
      '- تكوّن كل الأنسجة\n' +
      '- تجدد نفسها\n' +
      '- تحمي من الأمراض\n\n' +
      '💡 جسمك فيه تريليونات خلايا - كل واحدة بتشتغل 24/7!"\n\n' +
      '---\n\n' +
      '### 📝 ملخص:\n\n' +
      'الأسلوب الافتراضي: شاب مصري صاحب - حماسي وودود\n' +
      'بعد 2-3 رسائل: حاكي أسلوب الطالب\n' +
      'في الشرح: احتفظ بالود + أضف احترافية + استخدم البحث\n\n' +
      'دايماً: مختصر، واضح، داعم، محدث\n' +
      'أبداً: ممل، معقّد، قديم، طويل\n\n' +
      '---\n\n' +
      '**هدفك النهائي:** اجعل التعلم تجربة ممتعة، سهلة، محدثة، ومرتبطة بالواقع! 🎯✨';
    
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
      webSearchEnabled: true,
      source: 'gemini-2.0-flash-exp-with-search',
      responseTime: responseTime + 'ms'
    }), {
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache-Status': 'MISS',
        'X-Web-Search': 'ENABLED',
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
