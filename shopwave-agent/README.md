# 🤖 ShopWave | AI Autonomous Support Agent

> **Production-Grade ReAct Agent Demo for Ksolve Agentic AI Hackathon 2026**

## 🌐 Live Deployment
- **Frontend (Dashboard)**: [shopwave-agent-ksolve-hackathon.vercel.app](https://shopwave-agent-ksolve-hackathon.vercel.app/)
- **Backend (Agent API)**: [shopwave-agent-ksolve-hackathon.onrender.com](https://shopwave-agent-ksolve-hackathon.onrender.com/health)

ShopWave is an autonomous customer support resolution system that leverages the **Reason → Act → Observe (ReAct)** pattern to handle e-commerce support tickets with zero human intervention. It features a premium real-time dashboard, hybrid caching, and a robust safety-first architecture.

![Architecture](architecture.png)

## 🌟 Key Features

- **⚡ Advanced ReAct Loop**: A custom-built reasoning engine (no LangChain overhead) that allows the agent to think, call tools, and verify observations before providing a final resolution.
- **🚀 Ultra-Fast Caching**: Implements a **Hybrid Upstash Redis Cache**. Repeated tickets or similar subjects are resolved in milliseconds without hitting the LLM, significantly reducing latency and costs.
- **💎 Premium Dashboard**: A state-of-the-art Glassmorphism UI built with Vanilla JS, featuring real-time execution logs, ticket filtering, and live status updates.
- **🛡️ Programmatic Safety Guard**: A hard-coded validation layer that prevents sensitive actions (like `issueRefund`) from executing unless prerequisites (like `checkRefundEligibility`) are met. **LLM hallucinations cannot bypass this.**
- **🧬 Parallel Batch Processing**: Handles high-volume bursts by processing up to 20 tickets concurrently with sophisticated batching and cooling periods to stay within API rate limits.
- **📉 Fault Tolerance**: Built-in exponential backoff and retry logic for tool calls, simulating real-world network instability and API timeouts.

---

## 🏗️ System Architecture

The project is split into a hybrid cloud deployment for maximum performance:

- **Frontend (Vercel)**: Serves the static Glassmorphism dashboard and provides a Serverless API proxy for configuration.
- **Backend (Render)**: An Express/Node.js server that hosts the ReAct Agent, tool logic, and concurrency engine.
- **Cache (Upstash)**: Global Redis layer for high-speed ticket resolution.
- **LLM (Gemini 1.5 Flash)**: State-of-the-art reasoning for natural language understanding and tool selection.

---

## 📁 Project Structure

```text
shopwave-agent/
├── public/                 # 🖥️ Frontend (Vanilla JS + CSS)
│   ├── app.js              # Dashboard logic & Live logs
│   ├── style.css           # Premium Glassmorphism UI
│   └── index.html          # Main Entry Point
├── api/                    # ☁️ Vercel Serverless Functions
│   └── config.js           # Dynamic environment config
├── src/                    # ⚙️ Backend Agent Logic
│   ├── index.js            # Concurrency engine & Express API
│   ├── agent/
│   │   ├── reactLoop.js    # Core ReAct Thinking Loop
│   │   ├── tools.js        # 8 simulated async e-commerce tools
│   │   └── safetyGuard.js  # Safety & Validation layer
│   └── lib/
│       └── redis.js        # Upstash Redis integration
├── vercel.json             # Deployment & Routing Rules
└── .env                    # Environment Setup
```

---

## 🚀 Quick Start & Setup

### 1. Local Installation
```bash
git clone https://github.com/yashpalsurya11-ya/shopwave-agent-ksolve-hackathon.git
cd shopwave-agent
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root based on `.env.example`:
```env
# Core API
GEMINI_API_KEY=your_gemini_key

# Cache (Upstash Redis)
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# Deployment URL
BACKEND_URL=http://localhost:3000
```

### 3. Run Locally
```bash
# Start the Backend
npm start

# Open the Frontend
# Simply open public/index.html in your browser
```

---

## 🛠️ Tool Ecosystem

The agent has access to 8 sophisticated tools simulating a real e-commerce backend:

- `getOrder`: Read order database (includes timeout simulations).
- `checkRefundEligibility`: Verifies return windows (includes malformed data simulations).
- `getCustomer`: Fetch customer tier and loyalty status.
- `getProduct`: Pull return policies and product-specific guidelines.
- `searchKnowledgeBase`: Semantic search across store policies.
- `issueRefund`: **[PROTECTED]** Executes financial transactions.
- `sendReply`: Dispatch emails to customers.
- `escalate`: Hand off complex cases to a human support lead.

---

## 🔒 Security & Optimization

- **API Security**: Environment variables are never exposed to the frontend. A serverless proxy (`/api/config`) handles backend discovery.
- **Routing Safety**: Vercel rewrites prevent public access to `.env` or internal source code folders.
- **Rate-Limit Handling**: Configurable concurrency batches (default: 3) ensure the system doesn't hit Gemini API quotas during mass resolution.

---

### 🏆 Hackathon Notes
This agent was designed to prove that agentic workflows can be **performant, safe, and beautiful**. By moving away from heavy agent frameworks, we achieved a lightweight, highly customizable loop that feels like a real product.

**Developed for Ksolve Agentic AI Hackathon 2026.**
