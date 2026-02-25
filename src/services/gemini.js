import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY || '');

const MODEL = 'gemini-2.5-flash-lite';

const SEARCH_TOOL = { googleSearch: {} };
const CODE_EXEC_TOOL = { codeExecution: {} };

export const CODE_KEYWORDS = /\b(plot|chart|graph|analyz|statistic|regression|correlat|histogram|visualiz|calculat|compute|run code|write code|execute|pandas|numpy|matplotlib|csv|data)\b/i;

let cachedPrompt = null;

async function loadSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    const res = await fetch('/prompt_chat.txt');
    cachedPrompt = res.ok ? (await res.text()).trim() : '';
  } catch {
    cachedPrompt = '';
  }
  return cachedPrompt;
}

// ── Image generation ──────────────────────────────────────────────────────────
// Calls the Express backend which runs gemini-2.5-flash-image via @google/genai
// in Node.js (avoids browser SDK compatibility issues).
// Returns { _imageType: 'generated', mimeType, data, prompt }

export const generateImage = async (prompt, anchorImageParts = []) => {
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, anchorImages: anchorImageParts }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Image generation failed');

  return {
    _imageType: 'generated',
    mimeType: json.mimeType,
    data: json.data,
    prompt,
  };
};

// ── Streaming chat (search or code execution) ─────────────────────────────────
// Yields:
//   { type: 'text', text }           — streaming text chunks
//   { type: 'fullResponse', parts }  — when code was executed; replaces streamed text
//   { type: 'grounding', data }      — Google Search metadata
//
// useCodeExecution: pass true to use codeExecution tool (CSV/analysis),
//                   false (default) to use googleSearch tool.
// Note: Gemini does not support both tools simultaneously.
export const streamChat = async function* (history, newMessage, imageParts = [], useCodeExecution = false) {
  const systemInstruction = await loadSystemPrompt();
  const tools = useCodeExecution ? [CODE_EXEC_TOOL] : [SEARCH_TOOL];
  const model = genAI.getGenerativeModel({ model: MODEL, tools });

  const baseHistory = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const chatHistory = systemInstruction
    ? [
        {
          role: 'user',
          parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }],
        },
        { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
        ...baseHistory,
      ]
    : baseHistory;

  const chat = model.startChat({ history: chatHistory });

  const parts = [
    { text: newMessage },
    ...imageParts.map((img) => ({
      inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
    })),
  ].filter((p) => p.text !== undefined || p.inlineData !== undefined);

  const result = await chat.sendMessageStream(parts);

  for await (const chunk of result.stream) {
    const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of chunkParts) {
      if (part.text) yield { type: 'text', text: part.text };
    }
  }

  const response = await result.response;
  const allParts = response.candidates?.[0]?.content?.parts || [];

  const hasCodeExecution = allParts.some(
    (p) =>
      p.executableCode ||
      p.codeExecutionResult ||
      (p.inlineData && p.inlineData.mimeType?.startsWith('image/'))
  );

  if (hasCodeExecution) {
    const structuredParts = allParts
      .map((p) => {
        if (p.text) return { type: 'text', text: p.text };
        if (p.executableCode)
          return {
            type: 'code',
            language: p.executableCode.language || 'PYTHON',
            code: p.executableCode.code,
          };
        if (p.codeExecutionResult)
          return {
            type: 'result',
            outcome: p.codeExecutionResult.outcome,
            output: p.codeExecutionResult.output,
          };
        if (p.inlineData)
          return { type: 'image', mimeType: p.inlineData.mimeType, data: p.inlineData.data };
        return null;
      })
      .filter(Boolean);

    yield { type: 'fullResponse', parts: structuredParts };
  }

  const grounding = response.candidates?.[0]?.groundingMetadata;
  if (grounding) {
    console.log('[Search grounding]', grounding);
    yield { type: 'grounding', data: grounding };
  }
};

// ── Function-calling chat (CSV + JSON + image generation tools) ───────────────
// Accepts any set of tool declarations. executeFn is async.
// Returns { text, charts, toolCalls, videoCards }

export const chatWithTools = async (history, newMessage, csvHeaders, executeFn, toolDeclarations, imageParts = []) => {
  const systemInstruction = await loadSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [{ functionDeclarations: toolDeclarations }],
  });

  const baseHistory = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const chatHistory = systemInstruction
    ? [
        {
          role: 'user',
          parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }],
        },
        { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
        ...baseHistory,
      ]
    : baseHistory;

  const chat = model.startChat({ history: chatHistory });

  const textContent = csvHeaders?.length
    ? `[CSV columns: ${csvHeaders.join(', ')}]\n\n${newMessage}`
    : newMessage;

  // Build the message parts — include any anchor images so Gemini can see them
  const msgParts = [
    ...imageParts.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
    { text: textContent },
  ];

  let response = (await chat.sendMessage(msgParts)).response;

  const charts = [];
  const toolCalls = [];
  const videoCards = [];

  for (let round = 0; round < 8; round++) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const funcCall = parts.find((p) => p.functionCall);
    if (!funcCall) break;

    const { name, args } = funcCall.functionCall;
    console.log('[Tool]', name, args);

    const toolResult = await executeFn(name, args);
    console.log('[Tool result]', toolResult);

    toolCalls.push({ name, args, result: toolResult });

    if (toolResult?._chartType || toolResult?._imageType) {
      charts.push(toolResult);
    }
    if (toolResult?._videoType) {
      videoCards.push(toolResult);
    }

    // Strip large binary data before sending back to Gemini — base64 images can
    // be 1-2 MB which blows the token limit and crashes the API call.
    const resultForGemini = toolResult?._imageType
      ? { success: true, imageGenerated: true, prompt: toolResult.prompt, mimeType: toolResult.mimeType }
      : toolResult?._chartType
        ? { success: true, chartGenerated: true, chartType: toolResult._chartType, dataPoints: toolResult.data?.length }
        : toolResult?._videoType
          ? { success: true, videoFound: true, title: toolResult.title, url: toolResult.url }
          : toolResult;

    response = (
      await chat.sendMessage([
        { functionResponse: { name, response: { result: resultForGemini } } },
      ])
    ).response;
  }

  return { text: response.text(), charts, toolCalls, videoCards };
};

// ── Backwards-compatible alias
export const chatWithCsvTools = chatWithTools;
