import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

async function listModels() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const models = await genAI.listModels();
    
    console.log("--- Available Gemini Models ---");
    models.models.forEach((m) => {
      console.log(`${m.name} (supports: ${m.supportedGenerationMethods.join(", ")})`);
    });
    console.log("-------------------------------");
  } catch (err) {
    console.error("Error listing models:", err.message);
  }
}

listModels();
