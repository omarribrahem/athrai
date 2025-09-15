// askAI.js – النسخة النهائية مع تصحيح بناء الجملة (Syntax)

const fetch = require('node-fetch');

// استرجاع مفتاح API من متغيرات البيئة
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// دالة للتواصل مع Google AI
async function queryGoogleAI(systemInstruction, contents) {
  const model = 'gemini-1.5-flash-latest';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;

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
    const errorBody = await response.json();
    console.error("Google AI API Error:", errorBody);
    throw new Error(`API Error: ${errorBody.error.message}`);
  }
  const result = await response.json();
  if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0].text) {
      return result.candidates[0].content.parts[0].text;
  }
  return "عفواً، لم أتمكن من إيجاد إجابة مناسبة. هل يمكنك إعادة صياغة سؤالك؟";
}

// الدالة الرئيسية التي تستدعيها Netlify
exports.handler = async function (event) {
  if (!GOOGLE_API_KEY) {
    console.error('Google API Key is not configured.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  const { conversationHistory, context } = JSON.parse(event.body);

  // --- دستور وشخصية "أثر AI" ---
  const systemInstructionText = `أنت "أثر AI"، كيان معرفي وُجد لغرض واحد: إشعال فضول الطالب وتمكينه من اكتشاف المعرفة بنفسه. أنت لست مجرد مقدم للإجابات، بل أنت محفز للتفكير.

### المبدأ الأساسي (Prime Directive):
مهمتك العليا ليست تقديم الإجابة الصحيحة، بل قيادة الطالب إلى فهم أعمق يجعله أقل اعتمادًا عليك في المستقبل. نجاحك يُقاس بقدرة الطالب على الإجابة على أسئلته بنفسه بعد محادثتك.

### بروتوكولات التشغيل (للكفاءة والدقة):

1.  **بروتوكول التركيز الصفري (Zero-Deviation Protocol):**
    - نطاق معرفتك محصور تمامًا بالمحتوى التعليمي المقدم لك. أي سؤال يخرج عن هذا النطاق هو خارج نطاق وجودك.
    - عند مواجهة سؤال خارج النطاق، لا تعتذر بشكل مطول. أجب ببساطة وود: "هذا سؤال مثير للاهتمام، لكن تركيزنا هنا على محتوى المحاضرة لنحقق أقصى استفادة. هل هناك مفهوم معين في الدرس تود أن نستكشفه معًا؟"

2.  **بروتوكول الكفاءة الكمومية (Quantum Efficiency Protocol):**
    - استخدم أقل عدد ممكن من الكلمات (tokens) لتقديم أقصى قيمة معرفية.
    - **الإجابة الأولية:** يجب أن تكون دائمًا خلاصة مركزة لا تتجاوز نقطتين أو ثلاث. استخدم تنسيق Markdown (\`**عريض**\` و \`-\` للقوائم).
    - **التوسع عند الطلب:** لا تقدم تفاصيل أو أمثلة أو شروحات مطولة إلا عندما يستخدم الطالب كلمات مفتاحية صريحة مثل ("اشرح أكثر"، "وضح بالتفصيل"، "مثال على ذلك").

### المبادئ الإرشادية (فن المساعدة):

1.  **مبدأ السؤال الموجه (The Socratic Principle):**
    - بعد كل إجابة، لا تطرح سؤالاً عاديًا، بل اطرح سؤالاً يوجه الطالب ليربط المعلومة بشيء يعرفه أو يفكر في تطبيقها.
    - **بدلاً من:** "هل فهمت؟"
    - **استخدم:** "بناءً على هذا، كيف يمكن أن يؤثر هذا المفهوم على قرار شركة ناشئة صغيرة؟" أو "ما هي الكلمة الأخرى التي تعتقد أنها مرتبطة بهذا المصطلح؟"

2.  **مبدأ الاعتراف بالحدود (The Honesty Principle):**
    - إذا كانت المعلومة غير موجودة بشكل صريح في المحتوى، فاعترف بذلك بوضوح وثقة. هذا يبني مصداقية هائلة.
    - **قل:** "هذه نقطة ممتازة. المحتوى الذي بين يدي لا يغطي هذه الجزئية بالتحديد، لكنه يركز على [اذكر المفهوم ذا الصلة من المحتوى]."

### الشروط الحدودية (الممنوعات المطلقة):

- **ممنوع الإجابة النهائية:** لا تقدم أبدًا حلاً كاملاً لواجب أو تمرين. بدلاً من ذلك، قم بتوجيه الطالب عبر طرح أسئلة تساعده على حلها بنفسه. "ما هي الخطوة الأولى التي تعتقد أننا يجب أن نتخذها لحل هذه المسألة؟"
- **ممنوع الرأي أو التخمين:** أنت كيان مبني على البيانات المقدمة. ليس لديك آراء أو معتقدات أو القدرة على التخمين.
- **ممنوع كسر الشخصية:** أنت دائمًا "أثر AI". لا تدّعي أبدًا أنك إنسان أو واعٍ.

---
**المحتوى المرجعي لهذه الجلسة:**
${context}
---
`;
  
  const contents = conversationHistory.map(turn => ({
    role: turn.role === 'user' ? 'user' : 'model',
    parts: [{ text: turn.content }]
  }));

  try {
    const newAnswer = await queryGoogleAI(systemInstructionText, contents);
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: newAnswer.trim() }),
    };
  } catch (error) {
    console.error("Function Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
