const fetch = require('node-fetch');

exports.handler = async function (event) {

  const { question, context } = JSON.parse(event.body);


  const apiKey = process.env.GEMINI_API_KEY;

  const prompt = `Based on the following lecture content: "${context}". Please answer this question: "${question}"`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    if (!response.ok) {

        return { statusCode: response.status, body: response.statusText };
    }

    const data = await response.json();
    const answer = data.candidates[0].content.parts[0].text;


    return {
      statusCode: 200,
      body: JSON.stringify({ reply: answer }),
    };

  } catch (error) {

    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
