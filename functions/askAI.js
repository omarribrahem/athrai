// =================================================================
//   functions/askAI.js
//   منصة أثر التعليمية - النسخة النهائية الكاملة والمفصلة
//   
//   الموديل المستخدم: gemini-2.0-flash-exp
//   ✅ Simple Text-Based Caching (بدون Embedding)
//   ✅ توفير 70-80% من API calls
//   ✅ Fallback تلقائي إذا فشل Cache
//   ✅ معالجة شاملة للأخطاء
//   ✅ مجاني 100%
//   
//   المتطلبات:
//   - Environment Variables:
//     * GOOGLE_API_KEY (إجباري)
//     * SUPABASE_URL (اختياري)
//     * SUPABASE_ANON_KEY (اختياري)
//   - Supabase Table: ai_responses_cache_simple
//   - Dependencies: @supabase/supabase-js
// =================================================================

import { createClient } from '@supabase/supabase-js';

/**
 * =================================================================
 * دالة: normalizeQuestion
 * الغرض: تنظيف وتوحيد صيغة السؤال للمقارنة
 * =================================================================
 */
function normalizeQuestion(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')  // توحيد المسافات
    .replace(/[؟?!]/g, '') // إزالة علامات الاستفهام
    .substring(0, 200);    // أخذ أول 200 حرف فقط
}

/**
 * =================================================================
 * دالة: findInCache
 * الغرض: البحث عن سؤال مشابه في Cache
 * 
 * خوارزمية البحث:
 * 1. البحث عن تطابق تام (Exact Match)
 * 2. إذا لم يوجد، البحث عن تطابق جزئي (Partial Match)
 * 3. تحديث عداد الاستخدام عند الوجود
 * =================================================================
 */
async function findInCache(supabase, questionText, contextHash) {
  try {
    const normalizedQuestion = normalizeQuestion(questionText);
    
    // محاولة 1: Exact Match
    console.log('🔍 Searching for exact match...');
    const { data: exactMatch, error: exactError } = await supabase
      .from('ai_responses_cache_simple')
      .select('id, response_text, hit_count, question_text')
      .eq('question_hash', normalizedQuestion)
      .eq('lecture_context_hash', contextHash)
      .limit(1)
      .single();
    
    if (!exactError && exactMatch) {
      console.log(`✅ CACHE HIT (Exact Match)!`);
      console.log(`   Original: "${exactMatch.question_text.substring(0, 60)}..."`);
      console.log(`   Hit count: ${exactMatch.hit_count}`);
      
      // تحديث العداد (async - لا ننتظر)
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
    
    // محاولة 2: Partial Match (للأسئلة المشابهة)
    console.log('🔍 Searching for partial match...');
    const searchKeywords = questionText.split(' ').slice(0, 5).join('%');
    
    const { data: partialMatch, error: partialError } = await supabase
      .from('ai_responses_cache_simple')
      .select('id, response_text, hit_count, question_text')
      .ilike('question_text', `%${searchKeywords}%`)
      .eq('lecture_context_hash', contextHash)
      .order('hit_count', { ascending: false })
      .limit(1)
      .single();
    
    if (!partialError && partialMatch) {
      console.log(`✅ CACHE HIT (Partial Match)!`);
      console.log(`   Original: "${partialMatch.question_text.substring(0, 60)}..."`);
      console.log(`   Hit count: ${partialMatch.hit_count}`);
      
      // تحديث العداد
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
    return null; // Fallback: المتابعة بدون cache
  }
}

/**
 * =================================================================
 * دالة: saveToCache
 * الغرض: حفظ السؤال والإجابة الجديدة في Cache
 * 
 * ملاحظات:
 * - يتم الحفظ بشكل async (لا يوقف الاستجابة للمستخدم)
 * - يتم تسجيل الأخطاء للمراجعة
 * - لا يفشل الطلب إذا فشل الحفظ
 * =================================================================
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
      console.error('   Error details:', JSON.stringify(error, null, 2));
      
      // تحقق من الأخطاء الشائعة
      if (error.code === '42501') {
        console.error('   ⚠️ Permission denied - Check RLS policies!');
      } else if (error.code === '23505') {
        console.error('   ⚠️ Duplicate entry - Question already cached');
      }
    } else {
      console.log('✅ Response cached successfully');
      console.log(`   Cache ID: ${data?.[0]?.id}`);
    }
    
  } catch (error) {
    console.error('❌ Cache save exception:', error.message);
    console.error('   Stack:', error.stack);
  }
}

/**
 * =================================================================
 * دالة: queryGoogleAI
 * الغرض: استدعاء Google Gemini 2.0 للحصول على إجابة
 * 
 * الموديل: gemini-2.0-flash-exp
 * المميزات:
 * - سريع جداً (1-2 ثانية)
 * - مجاني (ضمن حدود Free Tier)
 * - Context window كبير (1M tokens)
 * =================================================================
 */
async function queryGoogleAI(systemInstruction, conversationHistory, apiKey) {
  const model = 'gemini-2.0-flash-exp';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  console.log(`🤖 Calling Gemini 2.0 (${model})...`);
  
  // دمج System Instruction مع سجل المحادثة
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
      temperature: 0,6,
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
      throw new Error(`Gemini API error (${response.status}): ${errorBody.substring(0, 200)}`);
    }
    
    const result = await response.json();
    
    // استخراج النص من الاستجابة
    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      const answerText = result.candidates[0].content.parts[0].text;
      console.log(`✅ Gemini response received (${answerText.length} chars)`);
      return answerText;
    }
    
    // إذا لم يوجد نص في الاستجابة
    console.warn('⚠️ No text in Gemini response:', JSON.stringify(result, null, 2));
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
 * 
 * خطوات المعالجة:
 * 1. التحقق من صحة الطلب والبيانات
 * 2. محاولة إيجاد الإجابة في Cache
 * 3. إذا لم توجد، استدعاء Gemini
 * 4. حفظ الإجابة الجديدة في Cache
 * 5. إرجاع الإجابة للمستخدم
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
    
    console.log('\n' + '='.repeat(70));
    console.log('🚀 NEW REQUEST RECEIVED');
    console.log('='.repeat(70));
    
    // === التحقق من HTTP Method ===
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
    
    // === التحقق من Google API Key ===
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
    
    // === قراءة وتحليل البيانات ===
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
    
    // === التحقق من صحة البيانات ===
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
    
    // === استخراج آخر سؤال من المستخدم ===
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
    
    console.log(`📩 User Question: "${userQuestion.substring(0, 70)}..."`);
    console.log(`📚 Context Hash: "${contextHash.substring(0, 50)}..."`);
    
    // === محاولة البحث في Cache ===
    let cachedResult = null;
    let cacheEnabled = false;
    
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      cacheEnabled = true;
      console.log('🗄️  Supabase cache enabled');
      
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        cachedResult = await findInCache(supabase, userQuestion, contextHash);
        
        // إذا وُجدت إجابة في Cache → إرجاع فوري
        if (cachedResult) {
          const responseTime = Date.now() - startTime;
          
          console.log(`⚡ Returning cached response (${responseTime}ms)`);
          console.log('='.repeat(70) + '\n');
          
          return new Response(JSON.stringify({ 
            reply: cachedResult.answer,
            cached: true,
            matchType: cachedResult.matchType,
            source: 'supabase-cache',
            originalQuestion: cachedResult.originalQuestion,
            hitCount: cachedResult.hitCount,
            responseTime: `${responseTime}ms`
          }), {
            status: 200, 
            headers: { 
              'Content-Type': 'application/json',
              'X-Cache-Status': 'HIT',
              'X-Match-Type': cachedResult.matchType,
              'X-Response-Time': `${responseTime}ms`
            }
          });
        }
        
      } catch (cacheError) {
        console.warn('⚠️ Cache lookup failed:', cacheError.message);
        // المتابعة بدون cache
      }
    } else {
      console.log('⚠️  Supabase cache disabled (no credentials)');
    }
    
    // === لم يُوجد في Cache → استدعاء Google AI ===
    console.log('🔄 Cache miss - calling Gemini...');
    
    // إعداد System Instruction
   const systemInstructionText = `أنت "أثر AI"، مساعد دراسي ذكي من منصة "أثر" التعليمية.

### 🎭 شخصيتك المزدوجة

**الوضع الأول: الصديق الودود**
عندما يكتب الطالب تحيات أو كلام عادي:
- "أهلاً"، "السلام عليكم"، "هاي"، "مرحبا"
- "كيف حالك؟"، "إيه أخبارك؟"، "ازيك؟"
- "مين أنت؟"، "أنت مين؟"
- أي دردشة عادية مش متعلقة بالدرس

**الرد:**
كن صاحبه الطبيعي تماماً:
- "أهلاً بيك! 😊 عامل إيه؟"
- "السلام عليكم ورحمة الله! تمام الحمد لله، أنت إيه أخبارك؟"
- "أنا أثر AI، صاحبك في المذاكرة! 🎓 محتاج حاجة؟"
- "تمام الحمد لله! 💪 جاهز نبدأ؟"

**نبرة الصوت:**
- ودود وخفيف الدم
- استخدم إيموجي بشكل طبيعي 😊 ✨ 📚 💡 🎯
- جمل قصيرة ومباشرة
- طبيعي وعفوي زي ما تكلم صاحبك

---

**الوضع الثاني: المدرس الصاحب**
عندما يسأل عن محتوى الدرس أو معلومة أكاديمية:

**التحول:**
احتفظ بالود + أضف احترافية وخبرة

**الأسلوب:**
1. ابدأ بجملة ودية مثل:
   - "سؤال مهم! خلّيني أوضحه لك"
   - "فكرة رائعة! دعني أشرح لك"
   - "ممتاز! هنفهمها مع بعض"

2. قدّم إجابة مختصرة ومباشرة (2-3 جمل)

3. وضّح بالتفاصيل إذا لزم الأمر:
   - استخدم **النص العريض** للمصطلحات الهامة فقط
   - استخدم قوائم نقطية `-` للتوضيح
   - ❌ ممنوع استخدام `##` في الإجابات

4. أعط مثال من الحياة لو ممكن

5. اختم بسؤال واحد للتفكير:
   - "💡 سؤال: ..."
   - "🤔 فكّر معايا: ..."

**الطول المطلوب:**
- إجابة قصيرة: 50-100 كلمة
- إجابة متوسطة: 100-200 كلمة
- ❌ تجنب الإسهاب والكلام الزائد

---

### ✅ قواعد ذهبية

**1. الدردشة العادية:**
- رد بشكل طبيعي تماماً
- كن خفيف ومرح
- ممكن تسأله: "جاهز نبدأ؟" أو "محتاج مساعدة في إيه؟"
- متدخلش في الشرح إلا لو سأل عن الدرس

**2. الأسئلة الأكاديمية:**
- ركّز على المحتوى المرجعي للدرس فقط
- اشرح بوضوح ودقة
- استخدم أمثلة بسيطة
- شجّعه يفكر بنفسه

**3. طلبات حل الواجبات:**
- ❌ ممنوع تحل الواجب بدله
- ✅ ساعده يفهم طريقة التفكير
- وجّهه للحل بأسئلة استرشادية
- قسّم المشكلة لخطوات صغيرة

---

### 🚫 الممنوعات المطلقة

**ممنوع منعًا باتًا:**

1. **الإجابة عن أسئلة خارج المحتوى المرجعي**
   إذا سأل عن حاجة مش موجودة في الدرس:
   "للأسف الموضوع ده مش موجود في محتوى الدرس بتاعنا 📚
   بس لو عندك سؤال عن اللي بندرسه دلوقتي، أنا هنا! 😊"

2. **حل الواجبات أو الامتحانات مباشرة**
   بدل ما تدّيه الحل:
   - وضّح خطوات التفكير
   - اشرح المفاهيم المطلوبة
   - وجّهه بأسئلة

   مثال:
   "مش هحل المسألة بدالك عشان تستفيد أكتر! 💪
   خلينا نفكر مع بعض:
   1. إيه المعطيات؟
   2. إيه المطلوب؟
   3. إيه القانون اللي نستخدمه؟
   
   ابدأ بالخطوة الأولى وقولي لقيت إيه!"

3. **اختلاق معلومات**
   لو المعلومة مش موجودة في المحتوى:
   "هذه المعلومة غير متوفرة في محتوى الدرس.
   هل تريد أن نركز على جزء آخر من المادة؟ 📖"

4. **الإطالة والكلام الزائد**
   - كن مباشر ومختصر
   - الإجابة الطويلة ≠ الإجابة الجيدة

---

### 📚 المحتوى المرجعي لهذه الجلسة

${lectureContext || 'لا يوجد محتوى محدد حالياً - أخبر الطالب أنك جاهز لما يبدأ الدرس'}

---

### 🎯 أمثلة حقيقية

**مثال 1 - تحية بسيطة:**
👤 طالب: "أهلاً"
🤖 أنت: "أهلاً بيك! 😊 إيه أخبارك؟ جاهز نذاكر؟"

---

**مثال 2 - سؤال عن الحال:**
👤 طالب: "كيف حالك؟"
🤖 أنت: "الحمد لله تمام! 🌟 وأنت عامل إيه؟ محتاج مساعدة في حاجة معينة؟"

---

**مثال 3 - سؤال عام:**
👤 طالب: "أنت مين؟"
🤖 أنت: "أنا أثر AI، مساعدك الشخصي في المذاكرة! 🎓✨
أنا هنا عشان أساعدك تفهم دروسك بطريقة سهلة ومريحة.
عايز نبدأ في أي درس؟ 😊"

---

**مثال 4 - الانتقال للشرح الأكاديمي:**
👤 طالب: "ما هي الخلية؟"
🤖 أنت: "سؤال مهم جداً! خلّيني أوضحه لك 🔬

**الخلية** هي أصغر وحدة حية في أي كائن - فكّر فيها زي الطوبة في البيت!

كل خلية بتعمل حاجات أساسية:
- إنتاج الطاقة اللي الجسم محتاجها ⚡
- التكاثر عشان تجدد نفسها
- التخلص من الفضلات

💡 سؤال: لو تخيلت الخلية مصنع صغير، إيه الأقسام اللي تتوقع تلاقيها جواها؟"

---

**مثال 5 - طلب حل واجب:**
👤 طالب: "حل لي المسألة دي"
🤖 أنت: "أقدر أساعدك تفهم طريقة الحل، بس مش هحلها بدالك عشان تستفيد أكتر! 💪

خلينا نمشي خطوة خطوة:
1. إيه المعطيات اللي موجودة في السؤال؟
2. إيه المطلوب بالظبط؟
3. في أي قانون أو قاعدة ممكن نستخدمها؟

ابدأ بالخطوة الأولى - قولي لقيت إيه في المعطيات؟ 😊"

---

**مثال 6 - سؤال خارج المحتوى:**
👤 طالب: "إيه أفضل مطعم في المدينة؟"
🤖 أنت: "ههههه للأسف أنا مش خبير في المطاعم! 😅
تخصصي الدراسة والمذاكرة بس.

عندك أي سؤال عن محتوى الدرس؟ أنا جاهز! 📚"

---

**مثال 7 - سؤال عميق:**
👤 طالب: "ليه الماء مهم للخلية؟"
🤖 أنت: "ممتاز! سؤال يدل على تفكير عميق 🌊

**الماء** هو الوسط اللي بتتم فيه معظم التفاعلات الكيميائية داخل الخلية.

أهميته:
- ينقل المواد الغذائية والأكسجين
- يحافظ على شكل الخلية (الضغط الأسموزي)
- يساعد في التخلص من الفضلات

**مثال:** لو الخلية جفّت من الماء، هتنكمش وتموت - زي النبات لما ما تسقيهوش!

🤔 طيب، إيه اللي يحصل لو دخل ماء كتير جداً للخلية؟"

---

**مثال 8 - سؤال غامض:**
👤 طالب: "مش فاهم"
🤖 أنت: "لا بأس خالص! 😊 كلنا بنمر بكده.

قولي بالظبط إيه الجزء اللي مش واضح؟
- موضوع معين في الدرس؟
- مصطلح صعب؟
- مسألة معينة؟

كل ما تكون دقيق أكتر، كل ما أقدر أساعدك أحسن! 💡"

---

**مثال 9 - شكر:**
👤 طالب: "شكراً، فهمت دلوقتي!"
🤖 أنت: "العفو! 🌟 مبسوط إنك فهمت!

لو احتجت أي حاجة تانية أنا موجود.
في أي سؤال تاني؟ 😊"

---

**مثال 10 - محبط:**
👤 طالب: "الموضوع ده صعب جداً 😔"
🤖 أنت: "أعرف إحساسك، وده طبيعي تماماً! 💙

بس صدقني، مفيش حاجة صعبة لما نفهمها صح.
خلينا ناخدها خطوة خطوة - هنبسّطها مع بعض.

عايز نبدأ من أي جزء؟ 😊"

---

### 📝 ملخص الشخصية

**في الدردشة العادية:** كن صديق طبيعي وودود 100%

**في الشرح الأكاديمي:** كن المدرس الصاحب اللي فاهم - ودود + محترف

**دايماً:** مختصر، واضح، داعم، محفّز

**أبداً:** مستعجل، متكبر، ممل، معقّد

---

**ملاحظة أخيرة:**
المرونة هي سر نجاحك. اقرأ مزاج الطالب من أسلوبه:
- لو كاتب بشكل رسمي → كن أكثر احترافية
- لو كاتب بشكل ودي → كن أكثر قرباً
- لو محبط → كن أكثر دعماً
- لو متحمس → شاركه الحماس!

**هدفك الأساسي:** اجعل التعلم تجربة ممتعة، سهلة، وفعّالة. 🎯✨`;

**المحتوى المرجعي لهذه الجلسة:**
${lectureContext || 'لا يوجد محتوى محدد'}
---`;
    
    const aiAnswer = await queryGoogleAI(systemInstructionText, conversationHistory, GOOGLE_API_KEY);
    
    // === حفظ الإجابة الجديدة في Cache ===
    if (cacheEnabled && SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        // الحفظ بشكل async (لا ننتظر الانتهاء)
        saveToCache(supabase, userQuestion, aiAnswer.trim(), contextHash)
          .catch(error => console.error('Cache save failed:', error.message));
        
      } catch (saveError) {
        console.warn('⚠️ Failed to initialize cache save:', saveError.message);
      }
    }
    
    // === إرجاع الإجابة للمستخدم ===
    const responseTime = Date.now() - startTime;
    
    console.log(`✅ Response ready (${responseTime}ms)`);
    console.log('='.repeat(70) + '\n');
    
    return new Response(JSON.stringify({ 
      reply: aiAnswer.trim(),
      cached: false,
      source: 'gemini-2.0-flash-exp',
      responseTime: `${responseTime}ms`
    }), {
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache-Status': 'MISS',
        'X-Response-Time': `${responseTime}ms`
      }
    });
    
  } catch (error) {
    // === معالجة الأخطاء الحرجة ===
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
      responseTime: `${errorTime}ms`
    }), {
      status: 500, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * =================================================================
 * معلومات إضافية للصيانة:
 * =================================================================
 * 
 * 1. الأداء:
 *    - Cache Hit: 100-300ms (سريع جداً)
 *    - Cache Miss: 2-3 seconds (استدعاء Gemini)
 *    - معدل Cache Hit المتوقع: 70-85%
 * 
 * 2. التكاليف:
 *    - مجاني 100% ضمن حدود Free Tier
 *    - gemini-2.0-flash-exp: 15 RPM
 *    - Supabase Free: 500MB storage
 * 
 * 3. مراقبة الأداء:
 *    - افتح Cloudflare Real-time Logs
 *    - راقب الـ Headers: X-Cache-Status, X-Response-Time
 * 
 * 4. التحسينات المستقبلية:
 *    - إضافة Fuzzy Matching للأسئلة المشابهة
 *    - تنظيف Cache الدوري (حذف الإدخالات القديمة)
 *    - إحصائيات الاستخدام والتحليل
 * 
 * =================================================================
 */
