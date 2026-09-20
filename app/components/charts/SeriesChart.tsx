'use client'

import { useRef, useState } from 'react'

import {
  bandCentres,
  barPath,
  buildScale,
  CHART_COLORS,
  formatTick,
  formatValue,
  innerHeight,
  innerWidth,
  linePath,
  PLOT,
  SERIES_COLORS,
  type ChartSeries,
  type ValueFormat,
} from './primitives'

interface Props {
  title: string
  /** One label per x position, e.g. "FY2025". */
  categories: string[]
  series: ChartSeries[]
  format: ValueFormat
  kind: 'bar' | 'line'
  /** Shown under the title — say what the chart means, not what it is. */
  caption?: string
}

/**
 * Bars for magnitude, lines for trend. Both share one y-axis anchored at zero;
 * a second axis is never offered, because two scales on one plot invent a
 * correlation that is not in the data.
 */
export function SeriesChart({ title, categories, series, format, kind, caption }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const allValues = series.flatMap((s) => s.values)
  const scale = buildScale(allValues)
  const centres = bandCentres(categories.length)
  const band = innerWidth / Math.max(categories.length, 1)

  // Bars share the band, with a 2px surface gap between neighbours.
  const barWidth = Math.max(4, (band * 0.62) / series.length - 2)
  const groupWidth = barWidth * series.length + 2 * (series.length - 1)

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return

    const rect = svg.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * PLOT.width
    const index = Math.round((x - PLOT.padLeft - band / 2) / band)

    setHover(index >= 0 && index < categories.length ? index : null)
  }

  return (
    <figure className="rounded border border-neutral-800 bg-[#1a1a19] p-4">
      <figcaption className="mb-1">
        <h3 className="text-sm font-medium text-neutral-100">{title}</h3>
        {caption ? <p className="mt-0.5 text-xs text-neutral-500">{caption}</p> : null}
      </figcaption>

      {/* A legend is always present for two or more series, so identity is
          never carried by colour alone. */}
      {series.length > 1 ? (
        <ul className="mb-2 flex flex-wrap gap-4">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-neutral-400">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
          className="w-full"
          role="img"
          aria-label={`${title}. ${series.length} series over ${categories.length} periods.`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Gridlines: solid hairlines, one shade off the surface. */}
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PLOT.padLeft}
                x2={PLOT.padLeft + innerWidth}
                y1={scale.y(tick)}
                y2={scale.y(tick)}
                stroke={tick === 0 ? CHART_COLORS.baseline : CHART_COLORS.gridline}
                strokeWidth={1}
              />
              <text
                x={PLOT.padLeft - 8}
                y={scale.y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill={CHART_COLORS.muted}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatTick(tick, format)}
              </text>
            </g>
          ))}

          {/* Hover band, drawn behind the marks with a generous hit area. */}
          {hover !== null ? (
            <rect
              x={centres[hover] - band / 2}
              y={PLOT.padTop}
              width={band}
              height={innerHeight}
              fill="#ffffff"
              opacity={0.04}
            />
          ) : null}

          {kind === 'bar'
            ? series.map((s, seriesIndex) =>
                s.values.map((value, index) => {
                  if (value === null) return null
                  const groupLeft = centres[index] - groupWidth / 2
                  const x = groupLeft + seriesIndex * (barWidth + 2)
                  const path = barPath(x, barWidth, scale.y(value), scale.zeroY)
                  if (!path) return null

                  return (
                    <path
                      key={`${s.key}-${index}`}
                      d={path}
                      fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                      opacity={hover === null || hover === index ? 1 : 0.45}
                    />
                  )
                }),
              )
            : series.map((s, seriesIndex) => {
                const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length]
                const points = s.values.map((value, index) =>
                  value === null ? null : ([centres[index], scale.y(value)] as const),
                )

                return (
                  <g key={s.key}>
                    <path
                      d={linePath(points)}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={hover === null ? 1 : 0.85}
                    />
                    {points.map((point, index) =>
                      point === null ? null : (
                        <circle
                          key={index}
                          cx={point[0]}
                          cy={point[1]}
                          r={hover === index ? 4.5 : 3}
                          fill={color}
                          // A 2px surface ring keeps overlapping markers apart.
                          stroke={CHART_COLORS.surface}
                          strokeWidth={2}
                        />
                      ),
                    )}
                  </g>
                )
              })}

          {/* X axis */}
          <line
            x1={PLOT.padLeft}
            x2={PLOT.padLeft + innerWidth}
            y1={PLOT.padTop + innerHeight}
            y2={PLOT.padTop + innerHeight}
            stroke={CHART_COLORS.baseline}
          />
          {categories.map((label, index) => (
            <text
              key={label}
              x={centres[index]}
              y={PLOT.height - 8}
              textAnchor="middle"
              fontSize={10}
              fill={hover === index ? CHART_COLORS.inkSecondary : CHART_COLORS.muted}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {label}
            </text>
          ))}
        </svg>

        {hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-2 text-xs shadow-lg"
            style={{
              left: `${(centres[hover] / PLOT.width) * 100}%`,
              transform:
                hover > categories.length / 2 ? 'translateX(-105%)' : 'translateX(5%)',
            }}
          >
            <p className="mb-1 font-medium text-neutral-200">{categories[hover]}</p>
            {series.map((s, i) => (
              <p key={s.key} className="flex items-center justify-between gap-3 text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                  {s.label}
                </span>
                <span className="tabular-nums text-neutral-200">
                  {s.values[hover] === null ? '—' : formatValue(s.values[hover]!, format)}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  )
}
