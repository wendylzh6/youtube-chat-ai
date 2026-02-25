require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : '',
      lastName: lastName ? String(lastName).trim() : '',
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls, videoCard } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
      ...(videoCard && { videoCard }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
        videoCard: m.videoCard || undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image generation (Gemini 2.5 Flash Image) ─────────────────────────────────

const { GoogleGenAI } = require('@google/genai');
const genAI_img = new GoogleGenAI({ apiKey: process.env.REACT_APP_GEMINI_API_KEY || '' });

app.post('/api/generate-image', async (req, res) => {
  const { prompt, anchorImages = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    const contents = [
      ...anchorImages.map((img) => ({
        inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
      })),
      { text: prompt },
    ];

    const result = await genAI_img.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    const parts = result.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart) {
      const textPart = parts.find((p) => p.text);
      return res.status(500).json({
        error: textPart?.text || 'No image was generated. Try a different prompt.',
      });
    }

    res.json({ mimeType: imagePart.inlineData.mimeType, data: imagePart.inlineData.data });
  } catch (err) {
    console.error('[Image generation error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube Channel Download (SSE) ────────────────────────────────────────────

app.post('/api/youtube/channel', async (req, res) => {
  const { url, maxVideos = 10 } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url required' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const ytdl = require('@distube/ytdl-core');

    // Normalize channel URL and append /videos
    const channelBase = url.replace(/\/+$/, '');
    const channelUrl = channelBase.endsWith('/videos')
      ? channelBase
      : `${channelBase}/videos`;

    const pageResponse = await fetch(channelUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!pageResponse.ok) {
      throw new Error(`Failed to fetch channel page: HTTP ${pageResponse.status}`);
    }

    const html = await pageResponse.text();

    // Extract ytInitialData JSON from the page
    let ytData;
    const match =
      html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*(\{.+?\});\s*(?:var |<\/script>)/s);

    if (!match) {
      throw new Error(
        'Could not extract ytInitialData. The channel may not exist or YouTube blocked the request.'
      );
    }

    try {
      ytData = JSON.parse(match[1]);
    } catch {
      throw new Error('Failed to parse ytInitialData JSON.');
    }

    // Navigate to video renderers
    const tabs =
      ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];

    let videoRenderers = [];

    for (const tab of tabs) {
      const tabR = tab?.tabRenderer;
      if (!tabR) continue;

      // Modern layout: richGridRenderer
      const richGrid = tabR?.content?.richGridRenderer;
      if (richGrid?.contents?.length) {
        videoRenderers = richGrid.contents
          .filter((c) => c?.richItemRenderer?.content?.videoRenderer)
          .map((c) => c.richItemRenderer.content.videoRenderer);
        if (videoRenderers.length) break;
      }

      // Older layout: sectionListRenderer
      const sectionList = tabR?.content?.sectionListRenderer;
      if (sectionList) {
        for (const section of sectionList.contents || []) {
          const items =
            section?.itemSectionRenderer?.contents?.[0]?.gridRenderer?.items || [];
          videoRenderers = items
            .filter((it) => it?.gridVideoRenderer)
            .map((it) => it.gridVideoRenderer);
          if (videoRenderers.length) break;
        }
        if (videoRenderers.length) break;
      }
    }

    if (!videoRenderers.length) {
      throw new Error(
        'No videos found. Make sure the URL points to a public YouTube channel (e.g. https://www.youtube.com/@channelname).'
      );
    }

    const limit = Math.min(videoRenderers.length, Math.max(1, Number(maxVideos) || 10));
    const videos = [];

    for (let i = 0; i < limit; i++) {
      const vr = videoRenderers[i];
      const videoId = vr?.videoId;
      if (!videoId) continue;

      send({ type: 'progress', current: i + 1, total: limit, percent: Math.round(((i + 1) / limit) * 100) });

      // Basic metadata from ytInitialData
      const title = vr?.title?.runs?.[0]?.text || vr?.title?.simpleText || '';
      const thumbnailUrl =
        vr?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';
      const duration = vr?.lengthText?.simpleText || '';
      const publishedTimeText = vr?.publishedTimeText?.simpleText || '';
      const viewCountText =
        vr?.viewCountText?.simpleText || vr?.shortViewCountText?.simpleText || '';

      const videoData = {
        video_id: videoId,
        title,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: thumbnailUrl,
        duration,
        published_time_text: publishedTimeText,
        view_count_text: viewCountText,
        description: '',
        release_date: '',
        view_count: null,
        like_count: null,
        comment_count: null,
        transcript: '',
      };

      // Enrich with ytdl info (getInfo for comment count + richer data + captions)
      try {
        const info = await ytdl.getInfo(
          `https://www.youtube.com/watch?v=${videoId}`
        );
        const details = info.videoDetails;
        videoData.title = details.title || title;
        videoData.description = (details.shortDescription || '').slice(0, 1000);
        videoData.release_date = details.publishDate || '';
        videoData.view_count = details.viewCount ? parseInt(details.viewCount, 10) : null;
        videoData.like_count = details.likes != null ? parseInt(details.likes, 10) : null;
        videoData.thumbnail = details.thumbnails?.slice(-1)[0]?.url || thumbnailUrl;

        // comment_count: path 1 — player_response.videoDetails.commentCount
        const ccRaw = info.player_response?.videoDetails?.commentCount;
        if (ccRaw != null) {
          videoData.comment_count = parseInt(ccRaw, 10);
        } else {
          // path 2 — engagement panels in the next response
          const panels = info.response?.engagementPanels || [];
          for (const panel of panels) {
            const hdr =
              panel?.engagementPanelSectionListRenderer?.header
                ?.engagementPanelTitleHeaderRenderer;
            const countText = hdr?.contextualInfo?.runs?.[0]?.text;
            if (countText) {
              const n = parseInt(countText.replace(/,/g, ''), 10);
              if (!isNaN(n)) { videoData.comment_count = n; break; }
            }
          }
        }

        // Transcript: use yt-dlp (most reliable — bypasses YouTube bot detection)
        try {
          const { execFile } = require('child_process');
          const os = require('os');
          const path = require('path');
          const fs = require('fs');
          const tmpBase = path.join(os.tmpdir(), `yt_sub_${videoId}`);
          await new Promise((resolve) => {
            execFile(
              'yt-dlp',
              [
                '--skip-download',
                '--write-auto-sub',
                '--sub-lang', 'en',
                '--sub-format', 'json3',
                '-o', tmpBase,
                `https://www.youtube.com/watch?v=${videoId}`,
              ],
              { timeout: 20000 },
              (err) => resolve(err)
            );
          });
          const subFile = `${tmpBase}.en.json3`;
          if (fs.existsSync(subFile)) {
            const json = JSON.parse(fs.readFileSync(subFile, 'utf8'));
            const text = (json.events || [])
              .flatMap((e) => (e.segs || []).map((s) => s.utf8))
              .filter(Boolean)
              .join(' ')
              .replace(/\n/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 5000);
            if (text) videoData.transcript = text;
            fs.unlinkSync(subFile);
          }
        } catch {
          // transcript not available — keep empty
        }
      } catch (e) {
        console.warn(`[YouTube] ytdl info failed for ${videoId}:`, e.message);
      }

      videos.push(videoData);
    }

    send({ type: 'done', videos });
    res.end();
  } catch (err) {
    console.error('[YouTube endpoint error]', err.message);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
