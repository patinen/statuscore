type AnalyticsSeriesBucket = {
  start: string;
  end: string;
  checkCount: number;
  successCount: number;
  uptimePercentage: number | null;
  averageResponseTimeMs: number | null;
};

type AxisLabel = {
  x: number;
  label: string;
};

function buildAxisLabels(series: AnalyticsSeriesBucket[], chartWidth: number): AxisLabel[] {
  if (series.length === 0) {
    return [];
  }

  const firstIndex = 0;
  const middleIndex = Math.floor((series.length - 1) / 2);
  const lastIndex = series.length - 1;

  const indexes = Array.from(new Set([firstIndex, middleIndex, lastIndex]));

  return indexes.map((index) => ({
    x: series.length === 1 ? chartWidth / 2 : (index / (series.length - 1)) * chartWidth,
    label: new Date(series[index].start).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }));
}

export function UptimeSeriesChart({ series }: { series: AnalyticsSeriesBucket[] }) {
  const width = 720;
  const height = 220;
  const chartLeft = 48;
  const chartTop = 20;
  const chartWidth = width - chartLeft - 16;
  const chartHeight = height - chartTop - 42;

  const labels = buildAxisLabels(series, chartWidth);

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-950/70 p-3">
      <div className="mb-2 text-sm font-medium text-zinc-200">Uptime Over Time</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label="Uptime percentage chart">
        <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartTop + chartHeight} stroke="#3f3f46" strokeWidth="1" />
        <line x1={chartLeft} y1={chartTop + chartHeight} x2={chartLeft + chartWidth} y2={chartTop + chartHeight} stroke="#3f3f46" strokeWidth="1" />

        <text x={8} y={chartTop + 5} fontSize="10" fill="#a1a1aa">100%</text>
        <text x={20} y={chartTop + chartHeight + 4} fontSize="10" fill="#a1a1aa">0%</text>

        {series.map((bucket, index) => {
          const x = series.length === 1 ? chartLeft + chartWidth / 2 : chartLeft + (index / (series.length - 1)) * chartWidth;
          const value = bucket.uptimePercentage;
          const barWidth = Math.max(2, chartWidth / Math.max(series.length, 1) - 2);

          if (value === null) {
            return (
              <g key={`${bucket.start}-empty`}>
                <line
                  x1={x - barWidth / 2}
                  y1={chartTop + chartHeight}
                  x2={x + barWidth / 2}
                  y2={chartTop + chartHeight}
                  stroke="#52525b"
                  strokeWidth="2"
                />
                <title>{`${new Date(bucket.start).toLocaleString()} - No check data`}</title>
              </g>
            );
          }

          const normalized = Math.min(100, Math.max(0, value));
          const barHeight = (normalized / 100) * chartHeight;
          const y = chartTop + chartHeight - barHeight;

          return (
            <g key={`${bucket.start}-bar`}>
              <rect x={x - barWidth / 2} y={y} width={barWidth} height={barHeight} fill="#34d399" opacity="0.9" />
              <title>{`${new Date(bucket.start).toLocaleString()} - ${value.toFixed(2)}% uptime (${bucket.successCount}/${bucket.checkCount})`}</title>
            </g>
          );
        })}

        {labels.map((label) => (
          <text
            key={`x-${label.x}-${label.label}`}
            x={chartLeft + label.x}
            y={height - 8}
            fontSize="10"
            fill="#a1a1aa"
            textAnchor="middle"
          >
            {label.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function LatencySeriesChart({ series }: { series: AnalyticsSeriesBucket[] }) {
  const width = 720;
  const height = 220;
  const chartLeft = 48;
  const chartTop = 20;
  const chartWidth = width - chartLeft - 16;
  const chartHeight = height - chartTop - 42;

  const labels = buildAxisLabels(series, chartWidth);
  const latencyValues = series
    .map((bucket) => bucket.averageResponseTimeMs)
    .filter((value): value is number => value !== null);

  const minValue = latencyValues.length > 0 ? Math.min(...latencyValues) : 0;
  const maxValue = latencyValues.length > 0 ? Math.max(...latencyValues) : 0;
  const range = maxValue - minValue;

  const toY = (value: number) => {
    if (range === 0) {
      return chartTop + chartHeight / 2;
    }

    const normalized = (value - minValue) / range;
    return chartTop + chartHeight - normalized * chartHeight;
  };

  const segments: Array<Array<{ x: number; y: number; bucket: AnalyticsSeriesBucket; value: number }>> = [];
  let currentSegment: Array<{ x: number; y: number; bucket: AnalyticsSeriesBucket; value: number }> = [];

  series.forEach((bucket, index) => {
    const value = bucket.averageResponseTimeMs;
    const x = series.length === 1 ? chartLeft + chartWidth / 2 : chartLeft + (index / (series.length - 1)) * chartWidth;

    if (value === null) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
      return;
    }

    currentSegment.push({ x, y: toY(value), bucket, value });
  });

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-950/70 p-3">
      <div className="mb-2 text-sm font-medium text-zinc-200">Average Latency Over Time</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label="Average latency chart">
        <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartTop + chartHeight} stroke="#3f3f46" strokeWidth="1" />
        <line x1={chartLeft} y1={chartTop + chartHeight} x2={chartLeft + chartWidth} y2={chartTop + chartHeight} stroke="#3f3f46" strokeWidth="1" />

        <text x={8} y={chartTop + 5} fontSize="10" fill="#a1a1aa">
          {latencyValues.length > 0 ? `${Math.round(maxValue)} ms` : '—'}
        </text>
        <text x={8} y={chartTop + chartHeight + 4} fontSize="10" fill="#a1a1aa">
          {latencyValues.length > 0 ? `${Math.round(minValue)} ms` : '—'}
        </text>

        {segments.map((segment, segmentIndex) => (
          <polyline
            key={`segment-${segmentIndex}`}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="2"
            points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
          />
        ))}

        {segments.flatMap((segment) =>
          segment.map((point) => (
            <g key={`${point.bucket.start}-point`}>
              <circle cx={point.x} cy={point.y} r="2.5" fill="#93c5fd" />
              <title>{`${new Date(point.bucket.start).toLocaleString()} - ${point.value.toFixed(1)} ms`}</title>
            </g>
          )),
        )}

        {labels.map((label) => (
          <text
            key={`latency-x-${label.x}-${label.label}`}
            x={chartLeft + label.x}
            y={height - 8}
            fontSize="10"
            fill="#a1a1aa"
            textAnchor="middle"
          >
            {label.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
