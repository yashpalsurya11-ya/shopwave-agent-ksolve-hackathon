import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function testGemini() {
  const key = process.env.GEMINI_API_KEY;
  console.log('Testing key:', key ? key.slice(0, 5) + '...' : 'MISSING');
  
  try {
    const genAI = new GoogleGenerativeAI(key);
    
    // Trial combinations of models and API versions
    const modelsToTry = [
      'gemini-1.5-flash', 
      'gemini-1.5-pro', 
      'gemini-pro', 
      'gemini-1.0-pro', 
      'gemini-1.5-flash-8b'
    ];
    const versionsToTry = ['v1', 'v1beta'];

    for (const modelName of modelsToTry) {
      for (const apiVersion of versionsToTry) {
        console.log(`\nTrying ${modelName} with ${apiVersion}...`);
        try {
          const model = genAI.getGenerativeModel(
            { model: modelName },
            { apiVersion }
          );
          const result = await model.generateContent('Hi');
          console.log(`✅ Success with ${modelName} (${apiVersion}):`, result.response.text());
          return; // Stop after first success
        } catch (err) {
          console.log(`❌ Failed ${modelName} (${apiVersion}): ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error('Fatal Test Error:', err.message);
  }
}

testGemini();
