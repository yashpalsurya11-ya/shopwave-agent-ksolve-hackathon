import 'dotenv/config';
import OpenAI from 'openai';

async function testGroq() {
  const key = process.env.GROQ_API_KEY;
  console.log('Testing Groq key:', key ? key.slice(0, 5) + '...' : 'MISSING');
  
  if (!key || key === 'your_groq_key_here') {
    console.error('Error: Please set GROQ_API_KEY in your .env file.');
    return;
  }

  try {
    const client = new OpenAI({
      apiKey: key,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    console.log('Calling Groq (llama-3.3-70b-versatile)...');
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Say hello in a very enthusiastic way!' }],
    });

    console.log('✅ Success!');
    console.log('Response:', response.choices[0].message.content);
  } catch (err) {
    console.error('❌ Groq Test Error:', err.message);
  }
}

testGroq();
