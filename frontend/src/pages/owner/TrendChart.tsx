import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatNumber } from '../../lib/format'

/**
 * Categorical series colours in fixed order (validated: CVD-safe for 4 series; two are
 * below 3:1 contrast, so a legend and a table view always come with the chart).
 * A house keeps its colour because the order follows the sorted house list.
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

export interface TrendPoint {
  week: string // label, e.g. "2 Nov"
  [house: string]: number | string | null
}

interface Props {
  title: string
  unit: string
  digits: number
  data: TrendPoint[]
  houses: string[]
}

/** One measure per chart (never two y-axes), one line per house. */
export default function TrendChart({ title, unit, digits, data, houses }: Props) {
  const format = (value: unknown) =>
    typeof value === 'number' ? `${formatNumber(value, digits)}${unit}` : '–'
  return (
    <section className="card" aria-label={title}>
      <h2 style={{ marginBottom: 8 }}>{title}</h2>
      <div style={{ width: '100%', height: 230 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false}
              width={44} domain={['auto', 'auto']}
              tickFormatter={(v: number) => formatNumber(v, digits)} />
            <Tooltip formatter={(value) => format(value)} labelFormatter={(l) => `Minggu ${l}`}
              contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 13, color: '#1f2937' }} />
            {houses.map((house, i) => {
              const color = SERIES_COLORS[i % SERIES_COLORS.length]
              return (
                // Straight segments: weekly values, no invented curve between them.
                <Line key={house} type="linear" dataKey={house} name={house} stroke={color}
                  strokeWidth={2} dot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: color, stroke: '#fff', strokeWidth: 2 }}
                  connectNulls={false} isAnimationActive={false} />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
