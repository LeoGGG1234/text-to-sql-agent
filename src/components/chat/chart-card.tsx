'use client';

/**
 * ChartCard — renders the chart spec produced by the renderChart tool.
 *
 * The agent returns { chartSpec: { chartType, title, xAxis, yAxis, data } };
 * this component draws it with Recharts. Falls back to a small notice if the
 * spec is malformed.
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface ChartSpec {
  chartType: 'bar' | 'line' | 'pie';
  title: string;
  xAxis: string;
  yAxis: string;
  data: { label: string; value: number }[];
}

const COLORS = [
  '#818cf8', '#34d399', '#fbbf24', '#f87171', '#60a5fa',
  '#c084fc', '#4ade80', '#fb923c', '#e879f9', '#2dd4bf',
];

const AXIS_STYLE = { fontSize: 11, fill: '#a1a1aa' };
const TOOLTIP_STYLE = {
  backgroundColor: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  fontSize: 12,
  color: '#e4e4e7',
};
const TOOLTIP_LABEL_STYLE = { color: '#a1a1aa', fontWeight: 500 };
const TOOLTIP_ITEM_STYLE = { color: '#e4e4e7' };

export function ChartCard({ result }: { result: unknown }) {
  const spec = (result as { chartSpec?: ChartSpec })?.chartSpec;

  if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) {
    return (
      <div className="mt-2 p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-500">
        无法渲染图表（数据为空）
      </div>
    );
  }

  return (
    <div className="mt-2 p-3 rounded-lg bg-zinc-950 border border-zinc-800">
      <div className="text-sm text-zinc-200 mb-2 font-medium">{spec.title}</div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(spec)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderChart(spec: ChartSpec) {
  switch (spec.chartType) {
    case 'line':
      return (
        <LineChart data={spec.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="label" tick={AXIS_STYLE} stroke="#3f3f46" />
          <YAxis tick={AXIS_STYLE} stroke="#3f3f46" />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} cursor={{ stroke: '#52525b' }} />
          <Line
            type="monotone"
            dataKey="value"
            name={spec.yAxis}
            stroke="#818cf8"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </LineChart>
      );

    case 'pie':
      return (
        <PieChart>
          <Pie
            data={spec.data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={(e) => e.label}
            labelLine={false}
          >
            {spec.data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
        </PieChart>
      );

    case 'bar':
    default:
      return (
        <BarChart data={spec.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="label" tick={AXIS_STYLE} stroke="#3f3f46" />
          <YAxis tick={AXIS_STYLE} stroke="#3f3f46" />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} cursor={{ fill: '#27272a' }} />
          <Bar dataKey="value" name={spec.yAxis} radius={[3, 3, 0, 0]}>
            {spec.data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      );
  }
}
