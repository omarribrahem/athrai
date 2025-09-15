// askAI.js – النسخة النهائية مع التخزين الدلالي (Semantic Caching)

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// --- إعدادات الاتصال ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// إنشاء اتصال مع قاعدة بيانات Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- دوال مساعدة ---

// دالة لتحويل النص إلى "بصمة معنى" (Embedding)
async function getEmbedding(text) {
  const model = 'text-embedding-004';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GOOGLE_API_KEY}`;
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] } }),
  });

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(`Embedding API Error: ${errorBody.error.message}`);
  }
  const result = await response.json();
  return result.embedding.values;
}

// دالة للحصول على إجابة من Gemini
async function getGenerativeAnswer(contents) {
  const model = 'gemini-1.5-flash-latest';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;

  const requestBody = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(`Generative API Error: ${errorBody.error.message}`);
  }
  const result = await response.json();
  return result.candidates[0].content.parts[0].text;
}


// --- الدالة الرئيسية ---
exports.handler = async function (event) {
  // التحقق من الإعدادات
  if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  const { conversationHistory, context } = JSON.parse(event.body);
  const lastUserQuestion = conversationHistory.findLast(turn => turn.role === 'user')?.content;

  if (!lastUserQuestion) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No user question found.' }) };
  }

  try {
    // 1. تحويل السؤال الأخير إلى "بصمة معنى"
    const questionEmbedding = await getEmbedding(lastUserQuestion);

    // 2. البحث في قاعدة البيانات عن سؤال مشابه
    const { data: similarQuestions, error: matchError } = await supabase.rpc('match_questions', {
      query_embedding: questionEmbedding,
      match_threshold: 0.9, // نسبة التشابه المطلوبة (90%)
      match_count: 1,       // نريد أفضل نتيجة واحدة فقط
    });

    if (matchError) throw new Error(`Supabase match error: ${matchError.message}`);

    // 3. التحقق من وجود نتيجة مشابهة (Cache Hit)
    if (similarQuestions && similarQuestions.length > 0) {
      console.log('CACHE HIT!');
      return {
        statusCode: 200,
        body: JSON.stringify({ reply: similarQuestions[0].answer }),
      };
    }

    // 4. إذا لم نجد نتيجة (Cache Miss)، اطلب إجابة جديدة من Gemini
    console.log('CACHE MISS!');
    const initialPrompt = `أنت "المعلم الخبير"... (نفس البرومبت السابق)`; // (اختصار للمساحة)
    
    const contents = conversationHistory.map((turn, index) => {
        if (index === 0) return { role: 'user', parts: [{ text: `${initialPrompt}\n\nسؤالي الأول هو: ${turn.content}` }]};
        return { role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turn.content }]};
    });
    
    const newAnswer = await getGenerativeAnswer(contents);
    
    // 5. خزّن السؤال الجديد، بصمته، وإجابته في قاعدة البيانات
    const { error: insertError } = await supabase.from('lecture_cache').insert({
        question: lastUserQuestion,
        answer: newAnswer,
        embedding: questionEmbedding,
    });
    
    if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: newAnswer.trim() }),
    };

  } catch (error) {
    console.error("Function Error:", error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Something went wrong.' }) 
    };
  }
};