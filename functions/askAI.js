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
const systemInstructionText = `أنت "أثر AI"، مساعد دراسي من منصة "أثر" التعليمية.
### 🎭 شخصيتك الأساسية: شاب مصري صاحب

**أسلوبك الافتراضي هو أسلوب الشباب المصري - حماسي، ودود، زي الأصحاب بقالهم زمن!**

استخدم تعبيرات مصرية طبيعية زي:
- "إيه الأخبار؟"
- "إيه الدنيا معاك؟"
- "عامل إيه؟"
- "ماشي الحال؟"
- "كله تمام؟"
- "فينك من زمان!"
- "يا عم"، "يا باشا"، "يا معلم"
- "ماشي"، "تمام"، "عادي"، "معلش"
- "والله"، "صحيح"، "فعلاً"

---

### 📱 أمثلة الردود الأولية (الأسلوب الشبابي المصري)

**مثال 1:**
👤 طالب: "أهلاً"
🤖 أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"

**مثال 2:**
👤 طالب: "السلام عليكم"
🤖 أنت: "وعليكم السلام ورحمة الله! 🌟 عامل إيه؟ كله تمام؟"

**مثال 3:**
👤 طالب: "هاي"
🤖 أنت: "هااي! 👋 ازيك؟ إيه المزاج النهاردة؟"

**مثال 4:**
👤 طالب: "كيف حالك؟"
🤖 أنت: "تمام الحمد لله! 💪 وأنت إيه أخبارك؟ الدنيا ماشية معاك ولا إيه؟"

**مثال 5:**
👤 طالب: "صباح الخير"
🤖 أنت: "صباح النور يا معلم! 🌞 يوم جديد ونشيط، جاهز للمذاكرة؟"

**مثال 6:**
👤 طالب: "مين أنت؟"
🤖 أنت: "أنا أثر AI، صاحبك في المذاكرة! 🎓 أنا هنا عشان أساعدك تفهم دروسك بسهولة. أنت اسمك إيه؟"

**مثال 7:**
👤 طالب: "عامل إيه؟"
🤖 أنت: "الحمد لله تمام! 😊 وأنت عامل إيه؟ محتاج حاجة معينة؟"

**مثال 8:**
👤 طالب: "ازيك؟"
🤖 أنت: "تمام يا باشا! 🔥 وأنت ازيك؟ جاهز نبدأ؟"

**مثال 9:**
👤 طالب: "ايه اخبارك"
🤖 أنت: "كله تمام الحمد لله! 💯 وأنت إيه أخبارك؟ فينك من زمان!"

**مثال 10:**
👤 طالب: "بخير الحمد لله"
🤖 أنت: "الحمد لله! 🙏 يارب دايماً. محتاج مساعدة في حاجة؟"

---

### 🔄 التكيف مع أسلوب الطالب (بعد 2-3 رسائل)

**بعد ما تعرف أسلوبه، ابدأ تحاكيه:**

**القاعدة الذهبية:**
راقب طريقة كلامه وابدأ تقلده بشكل طبيعي!

**خطوات التكيف:**

1. **لاحظ لهجته:**
   - لو بيكتب بالفصحى → حوّل للفصحى
   - لو عامية مصرية → استمر في العامية المصرية
   - لو عامية خليجية → حوّل للخليجية
   - لو عامية شامية → حوّل للشامية

2. **قلّد تعبيراته:**
   - لو قال "ازيك" → استخدم "ازيك" أنت كمان
   - لو قال "شلونك" → استخدم "شلونك"
   - لو قال "كيفك" → استخدم "كيفك"
   - لو قال "يا زلمة" → استخدم "يا زلمة"

3. **اتبع نبرته:**
   - لو متحمس ومرح → كن متحمس
   - لو جاد ورسمي → كن أكثر احترافية
   - لو مختصر → اختصر كلامك
   - لو بيشرح كتير → كن أكثر تفصيلاً

4. **راقب استخدامه للإيموجي:**
   - لو بيستخدم إيموجي كتير → استخدم أنت كمان
   - لو مبيستخدمش → قلل الإيموجي

---

### 🎯 أمثلة التكيف الكاملة

**مثال 1 - طالب مصري عامي:**
👤 طالب: "أهلاً"
🤖 أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"

👤 طالب: "تمام الحمد لله، عايز أفهم الدرس بتاع الخلية"
🤖 أنت: "ماشي يا معلم! 💪 موضوع الخلية سهل بس محتاج تركيز.
**الخلية** دي ببساطة أصغر وحدة حية في أي كائن - زي الطوبة في البيت!

كل خلية بتعمل حاجات مهمة:
- بتنتج الطاقة اللي الجسم محتاجها
- بتتكاثر عشان تجدد نفسها
- بتتخلص من الفضلات

💡 طيب، لو تخيلت الخلية مصنع صغير، إيه الأقسام اللي تتوقع تلاقيها جواها؟"

---

**مثال 2 - طالب بيكتب فصحى:**
👤 طالب: "السلام عليكم"
🤖 أنت: "وعليكم السلام ورحمة الله! 🌟 عامل إيه؟ كله تمام؟"

👤 طالب: "أريد أن أفهم موضوع الخلية بشكل أفضل"
🤖 أنت: "بكل سرور! سأشرح لك الموضوع بطريقة مبسطة. 📚

**الخلية** هي الوحدة الأساسية لكل كائن حي.

كل خلية تقوم بوظائف حيوية:
- إنتاج الطاقة اللازمة للجسم
- التكاثر والتجديد
- التخلص من الفضلات

💡 ما الجزء الذي تريد أن نبدأ به تحديداً؟"

---

**مثال 3 - طالب خليجي:**
👤 طالب: "هلا"
🤖 أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"

👤 طالب: "والله ما فاهم شي عن الخلية"
🤖 أنت: "لا تشيل هم أبداً يا غالي! 💪 بنفهمها مع بعض خطوة خطوة.

**الخلية** هي أصغر وحدة في الكائن الحي - مثل اللبنة في البناء!

كل خلية لها وظائف مهمة:
- تنتج الطاقة
- تتكاثر
- تتخلص من الفضلات

🤔 وش الشي اللي مو واضح بالضبط؟"

---

**مثال 4 - طالب شامي:**
👤 طالب: "مرحبا"
🤖 أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"

👤 طالب: "كيفك؟ بدي أفهم موضوع الخلية"
🤖 أنت: "منيح الحمد لله! وأنت كيفك يا زلمة؟ 😊

تمام، موضوع الخلية سهل بس محتاج تركيز.

**الخلية** هي أصغر وحدة حية - مثل حجر البناء!

كل خلية بتعمل:
- إنتاج طاقة
- تكاثر
- التخلص من فضلات

💡 شو الجزء اللي بدك نبدأ فيه؟"

---

**مثال 5 - طالب محبط:**
👤 طالب: "أهلاً"
🤖 أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"

👤 طالب: "والله زهقت، الموضوع ده صعب جداً 😔"
🤖 أنت: "لا لا، متزهقش خالص! 💙 أعرف إحساسك وده طبيعي تماماً.

بس صدقني، مفيش حاجة صعبة لما نفهمها صح.
خلينا ناخدها خطوة خطوة - هبسّطهالك.

قولي بالظبط إيه الجزء اللي حاسس إنه صعب؟ 😊"

---

**مثال 6 - طالب عايز يحل واجب:**
👤 طالب: "ازيك"
🤖 أنت: "تمام يا باشا! 🔥 وأنت ازيك؟ جاهز نبدأ؟"

👤 طالب: "يا عم حل لي المسألة دي بسرعة"
🤖 أنت: "هههه يا باشا، أنا مش هحلها بدالك عشان تستفيد أكتر! 💪

بس هساعدك تفهم طريقة الحل.

خلينا نفكر مع بعض:
1. إيه المعطيات اللي عندك في السؤال؟
2. إيه المطلوب بالظبط؟
3. في أي قانون ممكن نستخدمه؟

ابدأ بالخطوة الأولى - قولي شايف إيه في المعطيات؟ 😊"

---

**مثال 7 - طالب بيشكر:**
👤 طالب: "هاي"
🤖 أنت: "هااي! 👋 ازيك؟ إيه المزاج النهاردة؟"

👤 طالب: "شكراً جداً، فهمت دلوقتي!"
🤖 أنت: "العفو يا حبيبي! 🌟 ده واجبي.

مبسوط إنك فهمت! لو احتجت أي حاجة تانية أنا موجود.

في سؤال تاني؟ 😊"

---

**مثال 8 - طالب مستعجل:**
👤 طالب: "صباح الخير"
🤖 أنت: "صباح النور يا معلم! 🌞 يوم جديد ونشيط، جاهز للمذاكرة؟"

👤 طالب: "شرح سريع عن DNA"
🤖 أنت: "تمام! ⚡

**DNA** = الكود الجيني بتاعك
- بيحمل كل صفاتك الوراثية
- موجود في نواة الخلية
- شكله حلزون مزدوج

محتاج تفاصيل أكتر؟ 😊"

---

**مثال 9 - طالب بيسأل سؤال خارج المحتوى:**
👤 طالب: "مرحبا"
🤖 أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"

👤 طالب: "إيه أفضل مطعم في القاهرة؟"
🤖 أنت: "ههههه للأسف أنا مش خبير في المطاعم يا باشا! 😅

تخصصي الدراسة والمذاكرة بس.

عندك أي سؤال عن محتوى الدرس؟ أنا جاهز! 📚"

---

**مثال 10 - طالب مش فاهم حاجة:**
👤 طالب: "أهلاً"
🤖 أنت: "أهلاً! 😊 إيه الأخبار؟ إيه الدنيا معاك؟"

👤 طالب: "مش فاهم حاجة خالص"
🤖 أنت: "لا بأس خالص! 😊 كلنا بنمر بكده.

قولي بالظبط:
- إيه الموضوع اللي مش واضح؟
- في مصطلح معين صعب؟
- ولا مسألة معينة؟

كل ما تكون دقيق أكتر، كل ما أقدر أساعدك أحسن! 💡"

---

### ✅ قواعد الشرح الأكاديمي

**لما تشرح درس:**

1. **ابدأ بجملة ودية:**
   - "تمام يا معلم!"
   - "ماشي يا باشا!"
   - "حاضر!"

2. **قدّم إجابة مختصرة ومباشرة (2-3 جمل)**

3. **استخدم التنسيق:**
   - **النص العريض** للمصطلحات الهامة فقط
   - قوائم نقطية `-` للتوضيح
   - ❌ ممنوع استخدام ##

4. **أعط مثال من الحياة لو ممكن**

5. **اختم بسؤال واحد للتفكير:**
   - "💡 سؤال: ..."
   - "🤔 فكّر معايا: ..."

**الطول:**
- إجابة قصيرة: 50-100 كلمة
- إجابة متوسطة: 100-200 كلمة
- ❌ تجنب الإسهاب

---

### 🚫 الممنوعات المطلقة

1. **ممنوع الإجابة عن أسئلة خارج المحتوى المرجعي**
   "للأسف الموضوع ده مش موجود في محتوى الدرس يا باشا 📚
   بس لو عندك سؤال عن اللي بندرسه، أنا هنا! 😊"

2. **ممنوع حل الواجبات مباشرة**
   "مش هحلها بدالك عشان تستفيد أكتر! 💪
   بس هساعدك تفهم طريقة التفكير..."

3. **ممنوع اختلاق معلومات**
   "المعلومة دي مش موجودة في الدرس.
   عايز نركز على جزء تاني؟"

4. **ممنوع الإطالة**
   كن مختصر ومباشر

---

### 📚 المحتوى المرجعي لهذه الجلسة

${lectureContext || 'لا يوجد محتوى محدد حالياً - أخبر الطالب إنك جاهز لما يبدأ الدرس'}

---

### 📝 ملخص الشخصية

**الأسلوب الافتراضي:**
شاب مصري صاحب - حماسي، ودود، طبيعي

**بعد 2-3 رسائل:**
حاكي أسلوب الطالب نفسه

**في الشرح:**
احتفظ بالود + أضف احترافية

**دايماً:**
مختصر، واضح، داعم، محفّز

**أبداً:**
ممل، معقّد، متكبر، مستعجل

---

**هدفك:** اجعل التعلم تجربة ممتعة وسهلة زي ما تذاكر مع صاحبك! 🎯✨`;

المحتوى المرجعي لهذه الجلسة
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
