import { useState } from 'react';
import './YouTubeDownload.css';

export default function YouTubeDownload() {
  const [url, setUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(10);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    if (!url.trim() || downloading) return;
    setDownloading(true);
    setProgress(null);
    setVideos(null);
    setError('');

    try {
      const response = await fetch('/api/youtube/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), maxVideos: Number(maxVideos) }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'progress') {
                setProgress({ current: event.current, total: event.total, percent: event.percent });
              } else if (event.type === 'done') {
                setVideos(event.videos);
                setProgress({ current: event.videos.length, total: event.videos.length, percent: 100 });
              } else if (event.type === 'error') {
                setError(event.message);
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      }
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadJson = () => {
    if (!videos) return;
    const blob = new Blob([JSON.stringify(videos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'channel_videos.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="yt-download">
      <div className="yt-download-card">
        <h2 className="yt-download-title">YouTube Channel Download</h2>
        <p className="yt-download-subtitle">
          Download video metadata, descriptions, and transcripts from a YouTube channel.
          Drag the JSON into the Chat tab to analyze with AI.
        </p>

        <div className="yt-download-form">
          <input
            type="text"
            className="yt-download-input"
            placeholder="Channel URL — e.g. https://www.youtube.com/@veritasium"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleDownload()}
            disabled={downloading}
          />
          <div className="yt-form-row">
            <label className="yt-label">
              Max videos
              <input
                type="number"
                className="yt-number-input"
                value={maxVideos}
                onChange={(e) =>
                  setMaxVideos(Math.min(100, Math.max(1, parseInt(e.target.value) || 10)))
                }
                min={1}
                max={100}
                disabled={downloading}
              />
            </label>
            <button
              className="yt-download-btn"
              onClick={handleDownload}
              disabled={downloading || !url.trim()}
            >
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          </div>
        </div>

        {(downloading || progress) && (
          <div className="yt-progress">
            <div className="yt-progress-bar">
              {progress ? (
                <div className="yt-progress-fill" style={{ width: `${progress.percent}%` }} />
              ) : (
                <div className="yt-progress-fill yt-progress-indeterminate" />
              )}
            </div>
            <span className="yt-progress-text">
              {progress
                ? `${progress.current} / ${progress.total} videos (${progress.percent}%)`
                : 'Fetching channel data…'}
            </span>
          </div>
        )}

        {error && <p className="yt-error">{error}</p>}

        {videos && (
          <div className="yt-results">
            <div className="yt-results-header">
              <span className="yt-results-count">
                {videos.length} video{videos.length !== 1 ? 's' : ''} downloaded
              </span>
              <button className="yt-json-btn" onClick={handleDownloadJson}>
                Download JSON
              </button>
            </div>

            <div className="yt-video-list">
              {videos.map((v, i) => (
                <div key={v.video_id || i} className="yt-video-item">
                  {v.thumbnail && (
                    <img src={v.thumbnail} alt={v.title} className="yt-video-thumb" />
                  )}
                  <div className="yt-video-info">
                    <a
                      href={v.video_url || `https://www.youtube.com/watch?v=${v.video_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="yt-video-title"
                    >
                      {v.title}
                    </a>
                    <div className="yt-video-meta">
                      {v.view_count != null && (
                        <span>{Number(v.view_count).toLocaleString()} views</span>
                      )}
                      {v.duration && <span>{v.duration}</span>}
                      {v.release_date && (
                        <span>
                          {new Date(v.release_date).toLocaleDateString([], {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                      {v.transcript && (
                        <span className="yt-has-transcript">✓ transcript</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
