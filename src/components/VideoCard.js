export default function VideoCard({ videoId, title, thumbnail, url, duration, view_count }) {
  const targetUrl = url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '#');

  const formatViews = (n) => {
    if (!n) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`;
    return `${n} views`;
  };

  return (
    <a
      className="video-card"
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: 'none' }}
    >
      <div className="video-card-thumb-wrap">
        {thumbnail ? (
          <img src={thumbnail} alt={title} className="video-card-thumb" />
        ) : (
          <div className="video-card-thumb-placeholder">▶</div>
        )}
        {duration && <span className="video-card-duration">{duration}</span>}
      </div>
      <div className="video-card-info">
        <div className="video-card-title">{title}</div>
        {view_count && (
          <div className="video-card-meta">{formatViews(view_count)}</div>
        )}
        <div className="video-card-play-hint">Click to open on YouTube ↗</div>
      </div>
    </a>
  );
}
