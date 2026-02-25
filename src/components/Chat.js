import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, chatWithTools, generateImage, CODE_KEYWORDS } from '../services/gemini';
import { parseCsvToRows, executeTool, computeDatasetSummary, enrichWithEngagement, buildSlimCsv } from '../services/csvTools';
import { CSV_TOOL_DECLARATIONS } from '../services/csvTools';
import { JSON_DATA_TOOL_DECLARATIONS, JSON_TOOL_NAMES, executeJsonTool } from '../services/jsonTools';
import {
  getSessions,
  createSession,
  deleteSession,
  saveMessage,
  loadMessages,
} from '../services/mongoApi';
import EngagementChart from './EngagementChart';
import VideoCard from './VideoCard';
import TimeSeriesChart, { downloadChartAsPng } from './TimeSeriesChart';
import './Chat.css';

// ── play_video intent detection (client-side fallback) ────────────────────────

const detectPlayVideoArgs = (text) => {
  const t = text.toLowerCase();
  if (/most.?view|most.?watch|most.?popular|most.?play/i.test(t)) return { criteria: 'most viewed' };
  if (/most.?lik/i.test(t)) return { criteria: 'most liked' };
  if (/most.?comment/i.test(t)) return { criteria: 'most commented' };
  if (/latest|newest|most.?recent/i.test(t)) return { criteria: 'latest' };
  if (/oldest|earliest/i.test(t)) return { criteria: 'oldest' };
  if (/least.?view/i.test(t)) return { criteria: 'least viewed' };
  if (/least.?lik/i.test(t)) return { criteria: 'least liked' };
  if (/\bfirst\b|\b#?1\b/i.test(t)) return { ordinal: 1 };
  if (/\bsecond\b|\b#?2\b/i.test(t)) return { ordinal: 2 };
  if (/\bthird\b|\b#?3\b/i.test(t)) return { ordinal: 3 };
  const m = text.match(/(?:play|show me|open|find|watch)\s+(?:me\s+)?(?:the\s+)?(?:video(?:\s+(?:about|on|of|for|called|titled|named))?\s+)?(.+)/i);
  return m ? { query: m[1].trim().replace(/[?!.]+$/, '') } : {};
};

// ── compute_stats_json field detection ────────────────────────────────────────

const detectStatsField = (text) => {
  const t = text.toLowerCase();
  if (/\blik/i.test(t) && !/dislik/i.test(t)) return 'like_count';
  if (/\bcomment/i.test(t)) return 'comment_count';
  return 'view_count';
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const parseCSV = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rowCount = lines.length - 1;
  const preview = lines.slice(0, 6).join('\n');
  const raw = text.length > 500000 ? text.slice(0, 500000) : text;
  const base64 = toBase64(raw);
  const truncated = text.length > 500000;
  return { headers, rowCount, preview, base64, truncated };
};

const messageText = (m) => {
  if (m.parts) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// ── Structured part renderer (code execution responses) ───────────────────────

function StructuredParts({ parts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return (
            <div key={i} className="part-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type === 'code') {
          return (
            <div key={i} className="part-code">
              <div className="part-code-header">
                <span className="part-code-lang">
                  {part.language === 'PYTHON' ? 'Python' : part.language}
                </span>
              </div>
              <pre className="part-code-body">
                <code>{part.code}</code>
              </pre>
            </div>
          );
        }
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return (
            <div key={i} className="part-result">
              <div className="part-result-header">
                <span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Output' : '✗ Error'}
                </span>
              </div>
              <pre className="part-result-body">{part.output}</pre>
            </div>
          );
        }
        if (part.type === 'image') {
          return (
            <img
              key={i}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt="Generated plot"
              className="part-image"
            />
          );
        }
        return null;
      })}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat({ username, firstName, lastName, onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [csvContext, setCsvContext] = useState(null);
  const [sessionCsvRows, setSessionCsvRows] = useState(null);
  const [sessionCsvHeaders, setSessionCsvHeaders] = useState(null);
  const [csvDataSummary, setCsvDataSummary] = useState(null);
  const [sessionSlimCsv, setSessionSlimCsv] = useState(null);
  // JSON channel data
  const [jsonData, setJsonData] = useState(null);
  const [jsonFileName, setJsonFileName] = useState(null);
  // Enlarged modal
  const [enlargedItem, setEnlargedItem] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  const justCreatedSessionRef = useRef(false);
  const enlargedChartRef = useRef(null);

  // Display name: first name if available, else username
  const displayName = firstName || username;
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || username;

  useEffect(() => {
    const init = async () => {
      const list = await getSessions(username);
      setSessions(list);
      setActiveSessionId('new');
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') {
      setMessages([]);
      return;
    }
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setMessages([]);
    loadMessages(activeSessionId).then(setMessages);
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // Expose JSON to window for Python code execution
  useEffect(() => {
    window.__channelJson = jsonData;
  }, [jsonData]);

  // Close modal on Escape
  useEffect(() => {
    if (!enlargedItem) return;
    const handler = (e) => { if (e.key === 'Escape') setEnlargedItem(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enlargedItem]);

  // ── Session management ──────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new');
    setMessages([]);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setJsonData(null);
    setJsonFileName(null);
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setJsonData(null);
    setJsonFileName(null);
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);
    await deleteSession(sessionId);
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const processJsonFile = async (file) => {
    try {
      const text = await fileToText(file);
      const parsed = JSON.parse(text);
      const data = Array.isArray(parsed) ? parsed : [parsed];
      setJsonData(data);
      setJsonFileName(file.name);
      window.__channelJson = data;
    } catch {
      // Invalid JSON — ignore
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (csvFiles.length > 0) {
      const file = csvFiles[0];
      const text = await fileToText(file);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: file.name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (jsonFiles.length > 0) {
      await processJsonFile(jsonFiles[0]);
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (csvFiles.length > 0) {
      const text = await fileToText(csvFiles[0]);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: csvFiles[0].name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (jsonFiles.length > 0) {
      await processJsonFile(jsonFiles[0]);
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  // ── Stop generation ─────────────────────────────────────────────────────────

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ data: reader.result.split(',')[1], mimeType: file.type, name: 'pasted-image' });
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => {
    abortRef.current = true;
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !csvContext && !jsonData) || streaming || !activeSessionId) return;

    let sessionId = activeSessionId;
    if (sessionId === 'new') {
      const title = chatTitle();
      const { id } = await createSession(username, 'assistant', title);
      sessionId = id;
      justCreatedSessionRef.current = true;
      setActiveSessionId(id);
      setSessions((prev) => [{ id, agent: 'assistant', title, createdAt: new Date().toISOString(), messageCount: 0 }, ...prev]);
    }

    // ── Routing intent ─────────────────────────────────────────────────────
    const PYTHON_ONLY_KEYWORDS = /\b(regression|scatter|histogram|seaborn|matplotlib|numpy|time.?series|heatmap|box.?plot|violin|distribut|linear.?model|logistic|forecast|trend.?line)\b/i;
    const IMAGE_GEN_RE = /\b(generate|create|draw|paint|render|make|sketch|design)\b.*\b(image|photo|picture|illustration|artwork|thumbnail|logo|banner|poster|icon|visual)\b|\b(image|photo|picture|thumbnail)\b.*\b(generat|creat|draw|paint|render|make|sketch)\b|\b(generate|create|make|draw|render|sketch|design)\s+(an?\s+)?(image|photo|picture|thumbnail|illustration|artwork|logo|banner|poster|icon|visual)\b/i;
    const wantPythonOnly = PYTHON_ONLY_KEYWORDS.test(text) && !jsonData;
    const wantCode = CODE_KEYWORDS.test(text) && !!sessionCsvRows && !jsonData;
    // Detect image gen in the frontend — never rely on the chat model to call it
    const wantsImageGen = IMAGE_GEN_RE.test(text) || (images.length > 0 && /\b(generat|draw|paint|creat|render|make|sketch|transform|style)\b/i.test(text));
    const capturedCsv = csvContext;

    // generateImage is handled directly (not via function-calling) so it is NOT in allTools.
    // gemini-2.5-flash-lite refuses to call it as a function tool; we bypass that by detecting
    // image-gen intent ourselves and calling generateImage() directly in the try block below.
    const allTools = [
      ...(sessionCsvRows ? CSV_TOOL_DECLARATIONS : []),
      ...(jsonData ? JSON_DATA_TOOL_DECLARATIONS : []),
    ];
    const useTools = allTools.length > 0 && !wantPythonOnly && !wantCode && !capturedCsv && !wantsImageGen;
    const useCodeExecution = wantPythonOnly || wantCode;

    // ── Build prompt ──────────────────────────────────────────────────────
    const userNameContext = `[User: ${fullName}]\n\n`;

    const sessionSummary = csvDataSummary || '';
    const slimCsvBlock = sessionSlimCsv
      ? `\n\nFull dataset (key columns):\n\`\`\`csv\n${sessionSlimCsv}\n\`\`\``
      : '';

    // JSON context block — full block only on first message, brief tag on subsequent ones
    const jsonAlreadyIntroduced = messages.some((m) => m.role === 'model' && m.content);
    const jsonContextBlock = jsonData
      ? jsonAlreadyIntroduced
        ? `\n\n[Active dataset: "${jsonFileName}" | ${jsonData.length} videos]`
        : `\n\n[YouTube Channel JSON: "${jsonFileName}" | ${jsonData.length} videos]\nFields: ${Object.keys(jsonData[0] || {}).join(', ')}\nFirst video preview:\n${JSON.stringify(jsonData[0], null, 2).slice(0, 400)}`
      : '';

    const needsBase64 = !!capturedCsv && wantPythonOnly;

    const csvPrefix = capturedCsv
      ? needsBase64
        ? `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

IMPORTANT — to load the full data in Python use this exact pattern:
\`\`\`python
import pandas as pd, io, base64
df = pd.read_csv(io.BytesIO(base64.b64decode("${capturedCsv.base64}")))
\`\`\`

---

`
        : `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

---

`
      : sessionSummary
      ? `[CSV columns: ${sessionCsvHeaders?.join(', ')}]\n\n${sessionSummary}\n\n---\n\n`
      : '';

    const userContent = text || (images.length ? '(Image)' : jsonData ? '(JSON loaded)' : '(CSV attached)');
    const promptForGemini =
      userNameContext +
      csvPrefix +
      jsonContextBlock +
      (jsonContextBlock ? '\n\n---\n\n' : '') +
      (text || (images.length ? 'What do you see in this image?' : jsonData ? 'Please analyze this channel data.' : 'Please analyze this CSV data.'));

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
      csvName: capturedCsv?.name || null,
      jsonName: jsonData && !capturedCsv ? jsonFileName : null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = [...images];
    setImages([]);
    setCsvContext(null);
    setStreaming(true);

    await saveMessage(sessionId, 'user', userContent, capturedImages.length ? capturedImages : null);

    const imageParts = capturedImages.map((img) => ({ mimeType: img.mimeType, data: img.data }));

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() },
    ]);

    abortRef.current = false;

    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolCalls = [];
    let videoCard = null;

    try {
      if (wantsImageGen) {
        // ── Direct image generation (bypass function-calling) ──────────────
        // gemini-2.5-flash-lite refuses to call a generateImage function tool,
        // so we detect the intent ourselves and call the backend directly.
        const imageResult = await generateImage(text, imageParts);
        toolCharts = [imageResult];
        fullContent = 'Here\'s your generated image!';
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: fullContent, charts: [imageResult] }
              : msg
          )
        );
      } else if (useTools) {
        console.log('[Chat] useTools=true | csv rows:', sessionCsvRows?.length, '| json videos:', jsonData?.length);
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls, videoCards: returnedVideoCards } = await chatWithTools(
          history,
          promptForGemini,
          sessionCsvRows ? sessionCsvHeaders : null,
          async (toolName, args) => {
            if (toolName === 'generateImage') {
              return generateImage(args.prompt + (args.style ? ` Style: ${args.style}` : ''), capturedImages);
            }
            if (JSON_TOOL_NAMES.includes(toolName)) {
              return executeJsonTool(toolName, args, jsonData);
            }
            return executeTool(toolName, args, sessionCsvRows);
          },
          allTools,
          imageParts
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        videoCard = returnedVideoCards?.[0] || null;

        // ── Fallback: play_video ──────────────────────────────────────────────
        // If JSON is loaded and user asked about playing/showing a video but
        // Gemini didn't call play_video, detect intent and execute directly.
        if (jsonData && !videoCard && /\b(play|show me|open|watch|find)\b/i.test(text)) {
          const args = detectPlayVideoArgs(text);
          const fallback = executeJsonTool('play_video', args, jsonData);
          if (fallback?._videoType) {
            videoCard = fallback;
            toolCalls = [...toolCalls, { name: 'play_video', args, result: fallback }];
          }
        }

        // ── Fallback: compute_stats_json ──────────────────────────────────────
        // If JSON is loaded, no tool calls fired, and user asked about stats,
        // compute them directly and append to the response.
        if (
          jsonData &&
          toolCalls.length === 0 &&
          /\b(stat|average|avg|mean|median|std|min|max|distribut|range|spread)\b/i.test(text)
        ) {
          const field = detectStatsField(text);
          const statsResult = executeJsonTool('compute_stats_json', { field }, jsonData);
          if (!statsResult.error) {
            toolCalls = [{ name: 'compute_stats_json', args: { field }, result: statsResult }];
          }
        }

        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                  videoCard: videoCard || undefined,
                }
              : msg
          )
        );
      } else {
        for await (const chunk of streamChat(history, promptForGemini, imageParts, useCodeExecution)) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            // eslint-disable-next-line no-loop-func
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
            );
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            // eslint-disable-next-line no-loop-func
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId ? { ...msg, content: '', parts: structuredParts } : msg
              )
            );
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      const errText = `Error: ${err.message}`;
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg))
      );
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg))
      );
    }

    const savedContent = structuredParts
      ? structuredParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;

    await saveMessage(
      sessionId,
      'model',
      savedContent,
      null,
      toolCharts.length ? toolCharts : null,
      toolCalls.length ? toolCalls : null,
      videoCard || null
    );

    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s))
    );

    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  // Download a generated image
  const downloadGeneratedImage = (chart) => {
    const ext = chart.mimeType?.split('/')[1] || 'png';
    const slug = (chart.prompt || 'generated-image')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
      .replace(/-$/, '');
    const a = document.createElement('a');
    a.href = `data:${chart.mimeType};base64,${chart.data}`;
    a.download = `${slug}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      {/* ── Sidebar ──────────────────────────────── */}
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <button className="new-chat-btn" onClick={handleNewChat}>
            + New Chat
          </button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div
                className="sidebar-session-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === session.id ? null : session.id);
                }}
              >
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{fullName}</span>
        </div>
      </aside>

      {/* ── Main chat area ───────────────────────── */}
      <div className="chat-main">
        <>
        <header className="chat-header">
          <h2 className="chat-header-title">{activeSession?.title ?? 'New Chat'}</h2>
        </header>

        <div
          className={`chat-messages${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-meta">
                <span className="chat-msg-role">
                  {m.role === 'user' ? displayName : 'Assistant'}
                </span>
                <span className="chat-msg-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* CSV badge on user messages */}
              {m.csvName && (
                <div className="msg-csv-badge">
                  📄 {m.csvName}
                </div>
              )}

              {/* JSON badge on user messages */}
              {m.jsonName && (
                <div className="msg-json-badge">
                  📊 {m.jsonName}
                </div>
              )}

              {/* Image attachments */}
              {m.images?.length > 0 && (
                <div className="chat-msg-images">
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                  ))}
                </div>
              )}

              {/* Message body */}
              <div className="chat-msg-content">
                {m.role === 'model' ? (
                  m.parts ? (
                    <StructuredParts parts={m.parts} />
                  ) : m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <span className="thinking-dots">
                      <span /><span /><span />
                    </span>
                  )
                ) : (
                  m.content
                )}
              </div>

              {/* Video card */}
              {m.videoCard && (
                <VideoCard {...m.videoCard} />
              )}

              {/* Charts: engagement, timeseries, generated images */}
              {m.charts?.map((chart, ci) => {
                if (chart._chartType === 'engagement') {
                  return (
                    <EngagementChart
                      key={ci}
                      data={chart.data}
                      metricColumn={chart.metricColumn}
                    />
                  );
                }
                if (['timeseries', 'timeseries_line', 'ranking', 'scatter', 'histogram'].includes(chart._chartType)) {
                  return (
                    <TimeSeriesChart
                      key={ci}
                      data={chart.data}
                      metric={chart.metric}
                      chartType={chart._chartType}
                      yMetric={chart.yMetric}
                      onEnlarge={() => setEnlargedItem({ type: 'timeseries', ...chart })}
                    />
                  );
                }
                if (chart._imageType === 'generated') {
                  return (
                    <div key={ci} className="generated-image-wrap">
                      <img
                        src={`data:${chart.mimeType};base64,${chart.data}`}
                        alt={chart.prompt || 'Generated image'}
                        className="generated-image"
                        onClick={() => setEnlargedItem({ type: 'image', ...chart })}
                        title="Click to enlarge"
                      />
                      {chart.prompt && (
                        <div className="generated-image-prompt">{chart.prompt}</div>
                      )}
                      <div className="generated-image-actions">
                        <button
                          className="img-action-btn"
                          onClick={() => setEnlargedItem({ type: 'image', ...chart })}
                        >
                          ⤢ Enlarge
                        </button>
                        <button
                          className="img-action-btn"
                          onClick={() => downloadGeneratedImage(chart)}
                        >
                          ↓ Download
                        </button>
                      </div>
                    </div>
                  );
                }
                return null;
              })}

              {/* Tool calls log */}
              {m.toolCalls?.length > 0 && (
                <details className="tool-calls-details">
                  <summary className="tool-calls-summary">
                    🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                  </summary>
                  <div className="tool-calls-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="tool-call-item">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                        {tc.result && !tc.result._chartType && !tc.result._imageType && !tc.result._videoType && (
                          <span className="tool-call-result">
                            → {JSON.stringify(tc.result).slice(0, 200)}
                            {JSON.stringify(tc.result).length > 200 ? '…' : ''}
                          </span>
                        )}
                        {(tc.result?._chartType || tc.result?._imageType) && (
                          <span className="tool-call-result">→ rendered chart/image</span>
                        )}
                        {tc.result?._videoType && (
                          <span className="tool-call-result">→ video card rendered</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Search sources */}
              {m.grounding?.groundingChunks?.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="sources-label">Sources</span>
                  <div className="sources-list">
                    {m.grounding.groundingChunks.map((chunk, i) =>
                      chunk.web ? (
                        <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">
                          {chunk.web.title || chunk.web.uri}
                        </a>
                      ) : null
                    )}
                  </div>
                  {m.grounding.webSearchQueries?.length > 0 && (
                    <div className="sources-queries">
                      Searched: {m.grounding.webSearchQueries.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {dragOver && <div className="chat-drop-overlay">Drop CSV, JSON, or images here</div>}

        {/* ── Input area ── */}
        <div className="chat-input-area">
          {/* CSV chip */}
          {csvContext && (
            <div className="csv-chip">
              <span className="csv-chip-icon">📄</span>
              <span className="csv-chip-name">{csvContext.name}</span>
              <span className="csv-chip-meta">
                {csvContext.rowCount} rows · {csvContext.headers.length} cols
              </span>
              <button className="csv-chip-remove" onClick={() => setCsvContext(null)} aria-label="Remove CSV">×</button>
            </div>
          )}

          {/* JSON chip */}
          {jsonFileName && (
            <div className="json-chip">
              <span className="json-chip-icon">📊</span>
              <span className="json-chip-name">{jsonFileName}</span>
              <span className="json-chip-meta">
                {jsonData?.length} videos
              </span>
              <button
                className="json-chip-remove"
                onClick={() => { setJsonData(null); setJsonFileName(null); }}
                aria-label="Remove JSON"
              >×</button>
            </div>
          )}

          {/* Image previews */}
          {images.length > 0 && (
            <div className="chat-image-previews">
              {images.map((img, i) => (
                <div key={i} className="chat-img-preview">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.csv,text/csv,.json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <div className="chat-input-row">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              title="Attach image, CSV, or JSON"
            >
              📎
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask about your channel data, request analysis, or generate images…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              onPaste={handlePaste}
              disabled={streaming}
            />
            {streaming ? (
              <button onClick={handleStop} className="stop-btn">
                ■ Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && !images.length && !csvContext && !jsonData}
              >
                Send
              </button>
            )}
          </div>
        </div>
        </>
      </div>

      {/* ── Enlarge modal ── */}
      {enlargedItem && (
        <div className="enlarge-overlay" onClick={() => setEnlargedItem(null)}>
          <div className="enlarge-content" onClick={(e) => e.stopPropagation()}>
            <button className="enlarge-close" onClick={() => setEnlargedItem(null)}>✕</button>
            {enlargedItem.type === 'image' && (
              <>
                <img
                  src={`data:${enlargedItem.mimeType};base64,${enlargedItem.data}`}
                  alt={enlargedItem.prompt || 'Generated image'}
                  className="enlarge-image"
                />
                {enlargedItem.prompt && (
                  <div className="enlarge-image-prompt">{enlargedItem.prompt}</div>
                )}
                <div className="generated-image-actions">
                  <button className="img-action-btn" onClick={() => downloadGeneratedImage(enlargedItem)}>
                    ↓ Download
                  </button>
                </div>
              </>
            )}
            {enlargedItem.type === 'timeseries' && (
              <>
                <div className="enlarge-chart" ref={enlargedChartRef}>
                  <TimeSeriesChart
                    data={enlargedItem.data}
                    metric={enlargedItem.metric}
                    chartType={enlargedItem._chartType}
                    yMetric={enlargedItem.yMetric}
                  />
                </div>
                <div className="generated-image-actions">
                  <button
                    className="img-action-btn"
                    onClick={() => downloadChartAsPng(enlargedChartRef.current, `${enlargedItem.metric.replace(/_/g, '-')}-${enlargedItem._chartType || 'chart'}.png`)}
                  >
                    ↓ Download PNG
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
