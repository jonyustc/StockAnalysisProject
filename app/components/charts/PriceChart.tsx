'use client'

import { useMemo, useRef, useState } from 'react'

import { movingAverage } from '@/lib/price-stats'
import { formatTradeDate } from '@/lib/trading-calendar'

export interface PricePoint {
  date: string
  close: number
}

/** A horizontal line worth seeing against the price: a cost, a target, a level. */
export interface PriceLine {
  label: string
  value: number
  colour: string
  /** Drawn dashed, for a level that is a reference rather than a fact. */
  dashed?: boolean
}

const RANGES = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: '1Y', days: 250 },
  { label: 'All', days: Number.MAX_SAFE_INTEGER },
] as const

const PLOT = { width: 960, height: 320, padLeft: 56, padRight: 16, padTop: 16, padBottom: 28 }
const inner = {
  width: PLOT.width - PLOT.padLeft - PLOT.padRight,
  height: PLOT.height - PLOT.padTop - PLOT.padBottom,
}

function niceTicks(low: number, high: number, count = 5): number[] {
  if (!(high > low)) return [low]
  const step = Math.pow(10, Math.floor(Math.log10((high - low) / count)))
  const size = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => (high - low) / s <= count) ?? step * 10
  const first = Math.ceil(low / size) * size
  const ticks: number[] = []
  for (let value = first; value <= high + 1e-9; value += size) ticks.push(Number(value.toFixed(6)))
  return ticks
}

/**
 * Daily closes, with the averages the price is usually read against and any
 * levels worth comparing it to — your cost, a target, a valuation band.
 *
 * Every line here is something that has happened or something someone chose.
 * None of it is a forecast, and the caption says so.
 */
export function PriceChart({
  history,
  lines = [],
  caption,
}: {
  history: PricePoint[]
  lines?: PriceLine[]
  caption?: string
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]['label']>('1Y')
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const { points, ma50, ma200 } = useMemo(() => {
    const days = RANGES.find((r) => r.label === range)!.days
    // The averages are worked out on the whole history, then cut to the
    // window — otherwise a 1M view would show a 50-day average of 20 days.
    const fullMa50 = movingAverage(history, 50)
    const fullMa200 = movingAverage(history, 200)
    const from = Math.max(0, history.length - days)
    return {
      points: history.slice(from),
      ma50: fullMa50.slice(from),
      ma200: fullMa200.slice(from),
    }
  }, [history, range])

  if (points.length < 2) {
    return <p className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-xs text-neutral-500">Not enough price history to draw a chart yet.</p>
  }

  const shown = lines.filter((line) => Number.isFinite(line.value))
  const values = [...points.map((p) => p.close), ...shown.map((l) => l.value)]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const pad = (high - low) * 0.08 || high * 0.02
  const min = low - pad
  const max = high + pad

  const x = (i: number) => PLOT.padLeft + (i / (points.length - 1)) * inner.width
  const y = (value: number) => PLOT.padTop + inner.height - ((value - min) / (max - min || 1)) * inner.height

  const path = (series: (number | null)[]) => {
    const parts: string[] = []
    let drawing = false
    series.forEach((value, i) => {
      if (value === null) {
        drawing = false
        return
      }
      parts.push(`${drawing ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`)
      drawing = true
    })
    return parts.join(' ')
  }

  const area = `M${x(0).toFixed(1)},${y(points[0].close).toFixed(1)} ${points
    .map((p, i) => `L${x(i).toFixed(1)},${y(p.close).toFixed(1)}`)
    .join(' ')} L${x(points.length - 1).toFixed(1)},${(PLOT.padTop + inner.height).toFixed(1)} L${x(0).toFixed(1)},${(
    PLOT.padTop + inner.height
  ).toFixed(1)} Z`

  const at = hover === null ? points.length - 1 : hover
  const current = points[at]
  const first = points[0].close
  const change = first > 0 ? current.close / first - 1 : 0

  function move(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const position = ((event.clientX - rect.left) / rect.width) * PLOT.width
    const index = Math.round(((position - PLOT.padLeft) / inner.width) * (points.length - 1))
    setHover(index >= 0 && index < points.length ? index : null)
  }

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-200">
            ৳{current.close.toFixed(2)}{' '}
            <span className="text-xs text-neutral-500">{formatTradeDate(current.date)}</span>
          </p>
          <p className="text-xs text-neutral-500">
            Over this window:{' '}
            <span className={change >= 0 ? 'text-emerald-500' : 'text-red-400'}>
              {change >= 0 ? '+' : ''}
              {(change * 100).toFixed(1)}%
            </span>{' '}
            · {points.length} trading days
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setRange(r.label)}
              className={`rounded border px-2 py-0.5 ${
                range === r.label
                  ? 'border-sky-700 text-sky-300'
                  : 'border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        className="mt-3 w-full"
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Daily closing prices"
      >
        <defs>
          <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </linearGradient>
        </defs>

        {niceTicks(min, max).map((tick) => (
          <g key={tick}>
            <line x1={PLOT.padLeft} x2={PLOT.width - PLOT.padRight} y1={y(tick)} y2={y(tick)} stroke="#262626" />
            <text x={PLOT.padLeft - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#737373">
              {tick.toFixed(tick >= 100 ? 0 : 1)}
            </text>
          </g>
        ))}

        {shown.map((line) => (
          <g key={line.label}>
            <line
              x1={PLOT.padLeft}
              x2={PLOT.width - PLOT.padRight}
              y1={y(line.value)}
              y2={y(line.value)}
              stroke={line.colour}
              strokeWidth={1}
              strokeDasharray={line.dashed === false ? undefined : '4 3'}
              opacity={0.85}
            />
            <text x={PLOT.width - PLOT.padRight} y={y(line.value) - 4} textAnchor="end" fontSize={9} fill={line.colour}>
              {line.label}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#price-fill)" />
        <path d={path(ma200)} fill="none" stroke="#a78bfa" strokeWidth={1} opacity={0.9} />
        <path d={path(ma50)} fill="none" stroke="#fbbf24" strokeWidth={1} opacity={0.9} />
        <path d={path(points.map((p) => p.close))} fill="none" stroke="#38bdf8" strokeWidth={1.6} />

        {hover !== null ? (
          <g>
            <line x1={x(at)} x2={x(at)} y1={PLOT.padTop} y2={PLOT.padTop + inner.height} stroke="#525252" strokeDasharray="3 3" />
            <circle cx={x(at)} cy={y(current.close)} r={3} fill="#38bdf8" />
          </g>
        ) : null}

        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
          <text key={i} x={x(i)} y={PLOT.height - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize={10} fill="#737373">
            {formatTradeDate(points[i].date)}
          </text>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-sky-400" />Close</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-amber-400" />50-day average</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-violet-400" />200-day average</span>
        {shown.map((line) => (
          <span key={line.label}>
            <span className="mr-1 inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: line.colour }} />
            {line.label}
          </span>
        ))}
      </div>

      {caption ? <p className="mt-2 text-xs text-neutral-600">{caption}</p> : null}
    </section>
  )
}
