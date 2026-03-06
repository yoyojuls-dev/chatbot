const express = require("express");
const path = require("path");




// server.js
const express = require('express');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const fs = require("node:fs");
require('dotenv').config(); // Optional: Use dotenv for easier local environment variable management (npm install dotenv)

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Serve frontend files
app.use(express.static(path.join(__dirname, "public")));

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
// --- Configuration ---
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("FATAL ERROR: GEMINI_API_KEY environment variable not set.");
    console.error("Please set the GEMINI_API_KEY environment variable before running the server.");
    console.error("Example (Linux/macOS): export GEMINI_API_KEY='YOUR_API_KEY'");
    console.error("Example (Windows CMD): set GEMINI_API_KEY=YOUR_API_KEY");
    console.error("Example (Windows PowerShell): $env:GEMINI_API_KEY='YOUR_API_KEY'");
    process.exit(1); // Exit if API key is missing
}

const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "Act as an specific chatbot for 'Our Lady of Fatima University' located at 1 Esperanza, Quezon City, 1118 Metro Manila\n\nParent organization: Our Lady of Fatima University Valenzuela City\n\nFocus only on Senior High School\n\nIf the query is not related to Senior High School of Our Lady of Fatima University - Quezon City Campus, say 'I do not know'\n",
    // Safety settings can be adjusted here if needed
    // safetySettings: [
    //   { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    //   { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    //   { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    //   { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    // ],
});

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    // responseMimeType: "text/plain", // Often inferred
};

// --- Load Chat History ---
let baseChatHistory = [];
const chatHistoryFilePath = 'chat_history.json';
try {
    if (fs.existsSync(chatHistoryFilePath)) {
        const historyData = fs.readFileSync(chatHistoryFilePath, 'utf8');
        baseChatHistory = JSON.parse(historyData);

        // **Important:** Filter out or handle fileData parts from the base history
        // as the fileUri is just a placeholder and won't work directly.
        // For simplicity here, we'll filter them out. Dynamic upload is separate.
        baseChatHistory = baseChatHistory.map(entry => ({
            ...entry,
            parts: entry.parts.filter(part => !part.fileData) // Remove parts with fileData
        })).filter(entry => entry.parts.length > 0); // Remove entries that are now empty

        console.log(`Chat history loaded successfully from ${chatHistoryFilePath}. File parts removed for initialization.`);
    } else {
        console.warn(`Warning: ${chatHistoryFilePath} not found. Starting with an empty history.`);
    }
} catch (err) {
    console.error(`Error loading or parsing ${chatHistoryFilePath}:`, err);
    console.warn("Proceeding with empty history due to error.");
    baseChatHistory = []; // Fallback to empty history on error
}

// --- In-memory store for active chat sessions ---
// Replace with a proper database or session store for production
const activeChatSessions = {};
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes timeout

// --- Middleware ---
app.use(express.json()); // To parse JSON request bodies
app.use(express.static('public')); // Serve static files (HTML, CSS, client JS)

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// --- API Endpoint for Chat ---
app.post('/api/chat', async (req, res) => {
    const userMessage = req.body.message;
    let sessionId = req.body.sessionId;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
        return res.status(400).json({ error: 'Invalid message provided.' });
    }

    try {
        let chatSession;
        let sessionData = sessionId ? activeChatSessions[sessionId] : null;

        // Validate or start new session
        if (sessionData && (Date.now() - sessionData.lastUsed < SESSION_TIMEOUT_MS)) {
            console.log(`[${sessionId}] Resuming session.`);
            chatSession = sessionData.session;
            sessionData.lastUsed = Date.now(); // Update last used time
        } else {
            if (sessionId) {
                console.log(`[${sessionId}] Session expired or invalid, starting new one.`);
            } else {
                console.log("Starting new session.");
            }
            sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`; // Generate a simple unique ID
            console.log(`[${sessionId}] Initializing chat with base history.`);

            // Start new chat WITH the loaded base history
            chatSession = model.startChat({
                generationConfig,
                history: JSON.parse(JSON.stringify(baseChatHistory)), // Use a deep copy of the base history
            });

            activeChatSessions[sessionId] = {
                session: chatSession,
                lastUsed: Date.now()
            };
             console.log(`[${sessionId}] Chat initialized.`);
        }

        console.log(`[${sessionId}] Sending message to Gemini: "${userMessage}"`);
        const result = await chatSession.sendMessage(userMessage);
        const response = await result.response;

        // Basic check for response content
        if (!response || !response.candidates || response.candidates.length === 0 || !response.candidates[0].content) {
             console.error(`[${sessionId}] Gemini returned an empty or invalid response structure.`);
             throw new Error("Received an empty or invalid response from the AI.");
        }

        // Extract text - adjust if using function calls or other content types
        const text = response.text(); // Uses the convenient .text() method

        console.log(`[${sessionId}] Received response from Gemini.`);
        res.json({ response: text, sessionId: sessionId }); // Send back response and session ID

    } catch (error) {
        console.error(`[${sessionId || 'NEW'}] Error interacting with Gemini:`, error);
        // Avoid sending detailed internal errors to the client in production
        res.status(500).json({ error: 'Failed to get response from AI. Please try again later.', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// --- Cleanup old sessions periodically (optional but recommended) ---
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    for (const sessionId in activeChatSessions) {
        if (now - activeChatSessions[sessionId].lastUsed > SESSION_TIMEOUT_MS) {
            delete activeChatSessions[sessionId];
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} expired chat sessions.`);
    }
}, 5 * 60 * 1000); // Clean up every 5 minutes


// --- Basic Root Route to Confirm Server is Running ---
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- Start Server ---
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    console.log("Serving static files from 'public' directory.");
    if (Object.keys(activeChatSessions).length > 0) {
      console.warn("Warning: Server restarted, existing in-memory chat sessions were lost.");
    }
  });
}

module.exports = app;

// --- Graceful Shutdown (Optional) ---
process.on('SIGINT', () => {
    console.log("\nGracefully shutting down from SIGINT (Ctrl+C)");
    // Perform any cleanup here if necessary
    process.exit(0);
});