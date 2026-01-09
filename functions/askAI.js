// =================================================================
//   functions/askAI.js (DIAGNOSTIC MODE)
//   كود فحص الموديلات المتاحة لحل مشكلة 404
// =================================================================

export async function onRequest(context) {
  const { env } = context;
  const apiKey = env.GOOGLE_API_KEY;

  if (!apiKey) return new Response("Missing API Key", { status: 500 });

  // رابط لجلب قائمة الموديلات المتاحة لك
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // فلترة الموديلات لعرض موديلات "gemini" فقط
    const availableModels = data.models
      ? data.models
          .filter(m => m.name.includes('gemini'))
          .map(m => m.name.replace('models/', '')) // إزالة كلمة models/ لتسهيل القراءة
      : [];

    return new Response(JSON.stringify({
      message: "✅ تم الاتصال بنجاح! إليك قائمة الموديلات المتاحة لك:",
      available_models: availableModels,
      instruction: "اختر أحد هذه الأسماء وضعه في المتغير 'model' في الكود الأصلي."
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
