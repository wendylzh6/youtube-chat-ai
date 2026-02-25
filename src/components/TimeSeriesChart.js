import { useRef } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from 'recharts';

// ── Shared helpers ────────────────────────────────────────────────────────────

const fmtNum = (v) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return Math.round(v).toLocaleString();
};

const metricLabel = (m) => (m || '').replace(/_/g, ' ');

const tickFmt = (v) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v;
};

const axisText = { fill: '#94a3b8', fontSize: 10, fontFamily: 'Inter,sans-serif' };

const tooltipBox = {
  background: '#ffffff',
  border: '1px solid rgba(15,23,42,0.1)',
  borderRadius: 10,
  padding: '0.6rem 0.9rem',
  fontSize: '0.8rem',
  fontFamily: 'Inter,sans-serif',
  color: '#334155',
  maxWidth: 240,
  boxShadow: '0 4px 16px rgba(15,23,42,0.1)',
};

// ── Tooltips ──────────────────────────────────────────────────────────────────

function TimeTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={tooltipBox}>
      {d.title && (
        <p style={{ margin: '0 0 0.3rem', fontWeight: 700, color: '#0f172a', fontSize: '0.78rem', lineHeight: 1.3 }}>
          {d.title.slice(0, 60)}{d.title.length > 60 ? '…' : ''}
        </p>
      )}
      <p style={{ margin: 0, color: '#6366f1' }}>
        {payload[0].name}: <strong>{Number(d.value).toLocaleString()}</strong>
      </p>
      {d.date && <p style={{ margin: '0.2rem 0 0', color: '#94a3b8', fontSize: '0.72rem' }}>{d.date}</p>}
    </div>
  );
}

function RankTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={tooltipBox}>
      {d.fullTitle && (
        <p style={{ margin: '0 0 0.3rem', fontWeight: 700, color: '#0f172a', fontSize: '0.78rem', lineHeight: 1.3 }}>
          {d.fullTitle.slice(0, 80)}{d.fullTitle.length > 80 ? '…' : ''}
        </p>
      )}
      <p style={{ margin: 0, color: '#6366f1' }}>
        {payload[0].name}: <strong>{Number(d.value).toLocaleString()}</strong>
      </p>
    </div>
  );
}

function ScatterTooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={tooltipBox}>
      {d.label && (
        <p style={{ margin: '0 0 0.3rem', fontWeight: 700, color: '#0f172a', fontSize: '0.78rem', lineHeight: 1.3 }}>
          {d.label.slice(0, 60)}{d.label.length > 60 ? '…' : ''}
        </p>
      )}
      <p style={{ margin: 0, color: '#6366f1' }}>X: <strong>{fmtNum(d.x)}</strong></p>
      <p style={{ margin: '0.1rem 0 0', color: '#6366f1' }}>Y: <strong>{fmtNum(d.y)}</strong></p>
    </div>
  );
}

function HistTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={tooltipBox}>
      <p style={{ margin: '0 0 0.2rem', fontWeight: 700, color: '#0f172a', fontSize: '0.78rem' }}>
        Range: {d.bin}
      </p>
      <p style={{ margin: 0, color: '#6366f1' }}>
        Videos: <strong>{d.count}</strong>
      </p>
    </div>
  );
}

// ── PNG download ──────────────────────────────────────────────────────────────

export function downloadChartAsPng(container, filename) {
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) return;

  const bbox = svg.getBoundingClientRect();
  const width = Math.max(bbox.width || 0, 640);
  const height = Math.max(bbox.height || 0, 320);

  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);

  clone.querySelectorAll('text').forEach((el) => {
    el.style.fontFamily = 'Arial, sans-serif';
  });

  const svgData = new XMLSerializer().serializeToString(clone);
  const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);

  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = filename || 'chart.png';
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    });
  };
  img.onerror = () => {
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = (filename || 'chart').replace(/\.png$/, '.svg');
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  };
  img.src = svgDataUrl;
}

// ── Format date for display ───────────────────────────────────────────────────

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString([], { month: 'short', year: '2-digit' });
  } catch {
    return d;
  }
};

// ── Chart sub-renderers ───────────────────────────────────────────────────────

function TimeseriesBarChart({ data, metric }) {
  const formatted = data.map((d) => ({ ...d, displayDate: fmtDate(d.date) }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={formatted} margin={{ top: 8, right: 16, left: 0, bottom: 72 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" vertical={false} />
        <XAxis
          dataKey="displayDate"
          tick={axisText}
          axisLine={{ stroke: 'rgba(15,23,42,0.08)' }}
          tickLine={false}
          angle={-45}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ ...axisText, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={55}
          tickFormatter={tickFmt}
        />
        <Tooltip content={<TimeTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)' }} />
        <Bar dataKey="value" name={metricLabel(metric)} fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TimeseriesLineChart({ data, metric }) {
  const formatted = data.map((d) => ({ ...d, displayDate: fmtDate(d.date) }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={formatted} margin={{ top: 8, right: 16, left: 0, bottom: 72 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" vertical={false} />
        <XAxis
          dataKey="displayDate"
          tick={axisText}
          axisLine={{ stroke: 'rgba(15,23,42,0.08)' }}
          tickLine={false}
          angle={-45}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ ...axisText, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={55}
          tickFormatter={tickFmt}
        />
        <Tooltip content={<TimeTooltip />} />
        <Line
          dataKey="value"
          name={metricLabel(metric)}
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ fill: '#6366f1', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#4f46e5' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RankingChart({ data, metric }) {
  const height = Math.max(280, data.length * 44);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 64, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ ...axisText, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={tickFmt}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ ...axisText, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={160}
        />
        <Tooltip content={<RankTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)' }} />
        <Bar
          dataKey="value"
          name={metricLabel(metric)}
          fill="#6366f1"
          radius={[0, 4, 4, 0]}
          label={{ position: 'right', formatter: tickFmt, fill: '#94a3b8', fontSize: 10, fontFamily: 'Inter,sans-serif' }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScatterPlot({ data, metric, yMetric }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 8, right: 24, left: 0, bottom: 32 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" />
        <XAxis
          dataKey="x"
          type="number"
          name={metricLabel(metric)}
          tick={{ ...axisText, fontSize: 11 }}
          axisLine={{ stroke: 'rgba(15,23,42,0.08)' }}
          tickLine={false}
          tickFormatter={tickFmt}
          label={{ value: metricLabel(metric), position: 'insideBottom', offset: -16, fill: '#94a3b8', fontSize: 10, fontFamily: 'Inter,sans-serif' }}
        />
        <YAxis
          dataKey="y"
          type="number"
          name={metricLabel(yMetric)}
          tick={{ ...axisText, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={55}
          tickFormatter={tickFmt}
          label={{ value: metricLabel(yMetric), angle: -90, position: 'insideLeft', offset: 12, fill: '#94a3b8', fontSize: 10, fontFamily: 'Inter,sans-serif' }}
        />
        <ZAxis range={[36, 36]} />
        <Tooltip content={<ScatterTooltipContent />} cursor={{ strokeDasharray: '3 3' }} />
        <Scatter data={data} fill="#6366f1" fillOpacity={0.65} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function HistogramChart({ data, metric }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} barCategoryGap="4%" margin={{ top: 8, right: 16, left: 0, bottom: 56 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" vertical={false} />
        <XAxis
          dataKey="bin"
          tick={{ ...axisText, fontSize: 9 }}
          axisLine={{ stroke: 'rgba(15,23,42,0.08)' }}
          tickLine={false}
          angle={-30}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ ...axisText, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={36}
          label={{ value: 'videos', angle: -90, position: 'insideLeft', offset: 14, fill: '#94a3b8', fontSize: 10, fontFamily: 'Inter,sans-serif' }}
        />
        <Tooltip content={<HistTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)' }} />
        <Bar dataKey="count" name="videos" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function TimeSeriesChart({ data, metric, chartType = 'timeseries', yMetric, onEnlarge }) {
  const chartRef = useRef(null);

  if (!data?.length) return null;

  const handleDownload = () => {
    const slug = `${(metric || 'chart').replace(/_/g, '-')}-${chartType}`;
    downloadChartAsPng(chartRef.current, `${slug}.png`);
  };

  const chartLabel = {
    timeseries: `${metricLabel(metric)} over time`,
    timeseries_bar: `${metricLabel(metric)} over time`,
    timeseries_line: `${metricLabel(metric)} trend`,
    ranking: `Top videos by ${metricLabel(metric)}`,
    scatter: `${metricLabel(metric)} vs ${metricLabel(yMetric)}`,
    histogram: `${metricLabel(metric)} distribution`,
  }[chartType] || `${metricLabel(metric)} over time`;

  const renderChart = () => {
    if (chartType === 'timeseries_line') return <TimeseriesLineChart data={data} metric={metric} />;
    if (chartType === 'ranking') return <RankingChart data={data} metric={metric} />;
    if (chartType === 'scatter') return <ScatterPlot data={data} metric={metric} yMetric={yMetric} />;
    if (chartType === 'histogram') return <HistogramChart data={data} metric={metric} />;
    return <TimeseriesBarChart data={data} metric={metric} />;
  };

  return (
    <div className="timeseries-chart-wrap" ref={chartRef}>
      <div className="timeseries-chart-header">
        <span className="timeseries-chart-label">{chartLabel}</span>
        <div style={{ display: 'flex', gap: '0.35rem', marginRight: '0.5rem' }}>
          <button className="chart-enlarge-btn" onClick={handleDownload} title="Download chart as PNG">
            ↓
          </button>
          {onEnlarge && (
            <button className="chart-enlarge-btn" onClick={onEnlarge} title="Enlarge">
              ⤢
            </button>
          )}
        </div>
      </div>
      {renderChart()}
    </div>
  );
}
