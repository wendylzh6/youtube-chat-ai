// ── JSON Tool declarations (YouTube channel data) ─────────────────────────────

export const JSON_TOOL_DECLARATIONS = [
  {
    name: 'compute_stats_json',
    description:
      'Compute descriptive statistics — mean, median, std, min, max, count — for any numeric field ' +
      'in the loaded YouTube channel JSON data. ' +
      'Available numeric fields: view_count, like_count, comment_count. ' +
      'ALWAYS call this when the user asks for: statistics, average, averages, mean, median, std, ' +
      'distribution, summary, min, max, range, spread, or any descriptive stat about a numeric metric. ' +
      'Example: "what is the average view count" → call with field="view_count".',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description: 'The numeric field name to analyze, e.g. "view_count", "like_count", "comment_count".',
        },
      },
      required: ['field'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Plot numeric metrics from the channel JSON as a smart chart chosen for the question. ' +
      'Returns chart data rendered automatically in the UI. ' +
      'ALWAYS call this when the user asks to "plot", "chart", "graph", "visualize", ' +
      '"show over time", "compare videos", "top videos", "ranking", "correlation", "distribution", ' +
      'or asks how a metric changed. ' +
      'Select chart_type based on what the user needs:\n' +
      '- "timeseries_bar": metric vs date as bar chart (≤20 videos, or comparing periods)\n' +
      '- "timeseries_line": metric vs date as line chart (trends over many videos)\n' +
      '- "ranking": horizontal bar sorted by value (top-N, most/least X, comparisons)\n' +
      '- "scatter": one metric vs another metric (correlations, e.g. views vs likes)\n' +
      '- "histogram": value distribution across all videos (spread, distribution queries)',
    parameters: {
      type: 'OBJECT',
      properties: {
        metric: {
          type: 'STRING',
          description: 'Primary numeric field: "view_count", "like_count", or "comment_count".',
        },
        chart_type: {
          type: 'STRING',
          description:
            'Chart type to render. Choose based on the question:\n' +
            '"timeseries_bar" — bar chart vs release date (good for ≤20 videos or time periods)\n' +
            '"timeseries_line" — line chart vs release date (good for long-term trends)\n' +
            '"ranking" — horizontal bar sorted by metric value (good for top-N and comparisons)\n' +
            '"scatter" — scatter plot of metric vs y_metric (good for correlations)\n' +
            '"histogram" — frequency bins of metric values (good for distribution questions)\n' +
            'Default: "timeseries_bar".',
        },
        y_metric: {
          type: 'STRING',
          description: 'For scatter only: the Y-axis metric, e.g. "like_count". X-axis uses metric.',
        },
        limit: {
          type: 'NUMBER',
          description: 'Max videos to include (default: all for timeseries; 15 for ranking).',
        },
      },
      required: ['metric'],
    },
  },
  {
    name: 'play_video',
    description:
      'Find and display a video from the loaded YouTube JSON data as an interactive card. ' +
      'Can find by title substring (query), ordinal position (1st, 2nd, 3rd…), or named criteria. ' +
      'Returns a video card the UI renders automatically — the user can click it to open on YouTube. ' +
      'ALWAYS call this when the user says "play", "show me", "open", "watch", "find the video about…", ' +
      '"most viewed", "most liked", "most commented", "most played", "latest", "oldest", etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Title substring to search for, e.g. "black hole" or "climate change".',
        },
        ordinal: {
          type: 'NUMBER',
          description: '1-based index of the video in the dataset, e.g. 1 for first, 2 for second.',
        },
        criteria: {
          type: 'STRING',
          description:
            'Criteria: "most viewed", "most liked", "most commented", "most played", ' +
            '"least viewed", "least liked", "least commented", "latest", "oldest". ' +
            'Use when the user asks for the best/worst/newest/oldest/most-commented video.',
        },
      },
      required: [],
    },
  },
  {
    name: 'generateImage',
    description:
      'Generate an image from a text prompt using Gemini image generation. ' +
      'Optionally anchored to any reference images the user has attached. ' +
      'Use this when the user says "generate an image", "create a thumbnail", "make an image", ' +
      '"draw a picture", "render a photo", "design a banner", "sketch an illustration", ' +
      'or any similar request to create or produce a visual or image.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Detailed text description of the image to generate.',
        },
        style: {
          type: 'STRING',
          description: 'Optional style hint, e.g. "photorealistic", "cartoon", "watercolor".',
        },
      },
      required: ['prompt'],
    },
  },
];

export const JSON_TOOL_NAMES = JSON_TOOL_DECLARATIONS.map((t) => t.name);

// Data-only tools (no generateImage) — used with chatWithTools so the model never
// sees a generateImage declaration it will refuse to call.
export const JSON_DATA_TOOL_DECLARATIONS = JSON_TOOL_DECLARATIONS.filter((t) => t.name !== 'generateImage');

// Kept for import compatibility
export const GENERATE_IMAGE_DECLARATION = JSON_TOOL_DECLARATIONS.find((t) => t.name === 'generateImage');

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmtBinLabel = (lo, hi) => {
  const f = (v) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return Math.round(v).toString();
  };
  return `${f(lo)}–${f(hi)}`;
};

// ── Math helpers ──────────────────────────────────────────────────────────────

const numericValues = (data, field) =>
  data
    .map((item) => {
      const v = parseFloat(item[field]);
      return isNaN(v) ? null : v;
    })
    .filter((v) => v !== null);

const median = (sorted) =>
  sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

const fmt = (n) => +n.toFixed(4);

// ── Client-side JSON tool executor ───────────────────────────────────────────

export const executeJsonTool = (toolName, args, data) => {
  if (!data?.length) return { error: 'No JSON data loaded.' };

  switch (toolName) {
    case 'compute_stats_json': {
      const { field } = args;
      const vals = numericValues(data, field);
      if (!vals.length)
        return {
          error: `No numeric values found for field "${field}". Available fields: ${Object.keys(data[0]).join(', ')}`,
        };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        field,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'plot_metric_vs_time': {
      const { metric, chart_type, y_metric, limit } = args;
      const chartType = chart_type || 'timeseries_bar';

      // ── Scatter ──────────────────────────────────────────────────────────
      if (chartType === 'scatter') {
        const yField = y_metric || (metric === 'view_count' ? 'like_count' : 'view_count');
        const validVideos = data.filter((v) => v[metric] != null && v[yField] != null);
        if (!validVideos.length)
          return { error: `No videos with both "${metric}" and "${yField}".` };
        const sliced = limit ? validVideos.slice(0, limit) : validVideos;
        return {
          _chartType: 'scatter',
          data: sliced.map((v) => ({
            x: Number(v[metric]),
            y: Number(v[yField]),
            label: v.title || '',
          })),
          metric,
          yMetric: yField,
        };
      }

      // ── Histogram ─────────────────────────────────────────────────────────
      if (chartType === 'histogram') {
        const vals = data.map((v) => Number(v[metric])).filter((v) => !isNaN(v));
        if (!vals.length) return { error: `No numeric values for "${metric}".` };
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const binCount = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
        const binSize = (max - min) / binCount || 1;
        const bins = Array.from({ length: binCount }, (_, i) => ({
          lo: min + i * binSize,
          hi: min + (i + 1) * binSize,
          count: 0,
        }));
        vals.forEach((v) => {
          const idx = Math.min(Math.floor((v - min) / binSize), binCount - 1);
          bins[idx].count++;
        });
        return {
          _chartType: 'histogram',
          data: bins.map((b) => ({ bin: fmtBinLabel(b.lo, b.hi), count: b.count, lo: b.lo, hi: b.hi })),
          metric,
        };
      }

      // ── Ranking (horizontal bar) ──────────────────────────────────────────
      if (chartType === 'ranking') {
        const validVideos = data.filter((v) => v[metric] != null);
        if (!validVideos.length) return { error: `No videos with "${metric}" data.` };
        const sorted = [...validVideos].sort((a, b) => Number(b[metric]) - Number(a[metric]));
        const sliced = sorted.slice(0, limit || 15);
        return {
          _chartType: 'ranking',
          data: sliced.map((v) => ({
            label: (v.title || '').slice(0, 38) + ((v.title || '').length > 38 ? '…' : ''),
            value: Number(v[metric]),
            fullTitle: v.title || '',
          })),
          metric,
        };
      }

      // ── Timeseries line ───────────────────────────────────────────────────
      if (chartType === 'timeseries_line') {
        const validVideos = data
          .filter((v) => v[metric] != null && v.release_date)
          .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));
        const sliced = limit ? validVideos.slice(0, limit) : validVideos;
        if (!sliced.length) return { error: `No videos with both "${metric}" and "release_date".` };
        return {
          _chartType: 'timeseries_line',
          data: sliced.map((v) => ({ date: v.release_date, value: Number(v[metric]), title: v.title || '' })),
          metric,
        };
      }

      // ── Timeseries bar (default) ──────────────────────────────────────────
      const validVideos = data
        .filter((v) => v[metric] != null && v.release_date)
        .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));
      const sliced = limit ? validVideos.slice(0, limit) : validVideos;
      if (!sliced.length)
        return { error: `No videos with both "${metric}" and "release_date". Try a different metric.` };
      return {
        _chartType: 'timeseries',
        data: sliced.map((v) => ({ date: v.release_date, value: Number(v[metric]), title: v.title || '' })),
        metric,
      };
    }

    case 'play_video': {
      const { query, ordinal, criteria } = args;
      let video = null;

      if (criteria) {
        const c = criteria.toLowerCase();
        if (/most.?view|most.?play|most.?watch|most.?popular/i.test(c)) {
          video = [...data].sort((a, b) => (b.view_count || 0) - (a.view_count || 0))[0];
        } else if (/most.?lik/i.test(c)) {
          video = [...data].sort((a, b) => (b.like_count || 0) - (a.like_count || 0))[0];
        } else if (/most.?comment/i.test(c)) {
          video = [...data].sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0))[0];
        } else if (/least.?view|least.?play/i.test(c)) {
          video = [...data].sort((a, b) => (a.view_count || 0) - (b.view_count || 0))[0];
        } else if (/least.?lik/i.test(c)) {
          video = [...data].sort((a, b) => (a.like_count || 0) - (b.like_count || 0))[0];
        } else if (/least.?comment/i.test(c)) {
          video = [...data].sort((a, b) => (a.comment_count || 0) - (b.comment_count || 0))[0];
        } else if (/latest|newest|recent/i.test(c)) {
          video = [...data].sort((a, b) => new Date(b.release_date) - new Date(a.release_date))[0];
        } else if (/oldest|earliest/i.test(c)) {
          video = [...data].sort((a, b) => new Date(a.release_date) - new Date(b.release_date))[0];
        } else {
          video = data[0];
        }
      } else if (ordinal != null) {
        video = data[Math.max(0, ordinal - 1)] || data[0];
      } else if (query) {
        video =
          data.find((v) => v.title?.toLowerCase().includes(query.toLowerCase())) || data[0];
      } else {
        video = data[0];
      }

      if (!video) return { error: 'No video found matching criteria.' };

      return {
        _videoType: 'youtube',
        videoId: video.video_id,
        title: video.title || '',
        thumbnail: video.thumbnail || '',
        url: video.video_url || `https://www.youtube.com/watch?v=${video.video_id}`,
        duration: video.duration || '',
        view_count: video.view_count || null,
        like_count: video.like_count || null,
      };
    }

    default:
      return { error: `Unknown JSON tool: ${toolName}` };
  }
};
