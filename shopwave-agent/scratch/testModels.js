import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const modelsToTest = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash-exp"
];

async function testModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  console.log("--- Testing Gemini Models ---");
  for (const modelName of modelsToTest) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("hi");
      console.log(`✅ SUCCESS: ${modelName}`);
    } catch (err) {
      console.log(`❌ FAILED : ${modelName} (${err.message})`);
    }
  }
  console.log("----------------------------");
}

testModels();
