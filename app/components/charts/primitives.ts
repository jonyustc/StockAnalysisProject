/**
 * Chart primitives — scales, ticks, geometry, formatting.
 *
 * Pure and client-safe. Colours are the validated dark-surface steps; this app
 * renders dark only, so these are the selected dark values rather than a
 * flipped light palette.
 */

import { formatBDT, formatPerShare, formatPercent, formatRatio } from '@/lib/units'

export const CHART_COLORS = {
  series1: '#3987e5', // blue
  series2: '#d95926', // orange
  series3: '#199e70', // aqua
  surface: '#1a1a19',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  muted: '#898781',
  gridline: '#2c2c2a',
  baseline: '#383835',
} as const

export const SERIES_COLORS = [CHART_COLORS.series1, CHART_COLORS.series2, CHART_COLORS.series3]

export type ValueFormat = 'bdt' | 'percent' | 'ratio' | 'per_share'

export interface ChartSeries {
  key: string
  label: string
  /** One value per category, aligned by index. null renders as a gap. */
  values: (number | null)[]
}

export const PLOT = {
  width: 640,
  height: 240,
  padLeft: 60,
  padRight: 16,
  padTop: 16,
  padBottom: 28,
} as const

export const innerWidth = PLOT.width - PLOT.padLeft - PLOT.padRight
export const innerHeight = PLOT.height - PLOT.padTop - PLOT.padBottom

export function formatValue(value: number, format: ValueFormat): string {
  switch (format) {
    case 'bdt':
      return formatBDT(value)
    case 'percent':
      return formatPercent(value, 1)
    case 'per_share':
      return formatPerShare(value)
    case 'ratio':
      return formatRatio(value)
  }
}

/** Axis labels stay terse — the tooltip carries the precise figure. */
export function formatTick(value: number, format: ValueFormat): string {
  switch (format) {
    case 'bdt':
      return formatBDT(value, { decimals: 0 })
    case 'percent':
      return `${(value * 100).toFixed(0)}%`
    case 'per_share':
      return value.toFixed(0)
    case 'ratio':
      return value.toFixed(1)
  }
}

/** A step that lands on 1, 2, 2.5 or 5 × a power of ten. */
function niceStep(rough: number): number {
  if (rough <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalised = rough / magnitude

  if (normalised <= 1) return magnitude
  if (normalised <= 2) return 2 * magnitude
  if (normalised <= 2.5) return 2.5 * magnitude
  if (normalised <= 5) return 5 * magnitude
  return 10 * magnitude
}

export interface Scale {
  min: number
  max: number
  ticks: number[]
  /** Value → y pixel. */
  y: (value: number) => number
  /** Where zero sits, for bars to grow from. */
  zeroY: number
}

/**
 * A y-scale anchored at zero. Bar charts must start at zero or the bar lengths
 * lie; line charts here share the rule so the two read consistently side by
 * side.
 */
export function buildScale(values: (number | null)[], tickCount = 4): Scale {
  const defined = values.filter((v): v is number => v !== null && !Number.isNaN(v))

  const rawMax = defined.length > 0 ? Math.max(...defined, 0) : 1
  const rawMin = defined.length > 0 ? Math.min(...defined, 0) : 0

  const step = niceStep((rawMax - rawMin) / tickCount || 1)
  const max = Math.ceil(rawMax / step) * step || step
  const min = Math.floor(rawMin / step) * step

  const ticks: number[] = []
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toPrecision(12)))

  const span = max - min || 1
  const y = (value: number) => PLOT.padTop + innerHeight * (1 - (value - min) / span)

  return { min, max, ticks, y, zeroY: y(0) }
}

/** Centre x of each category band. */
export function bandCentres(count: number): number[] {
  if (count === 0) return []
  const band = innerWidth / count
  return Array.from({ length: count }, (_, i) => PLOT.padLeft + band * (i + 0.5))
}

/**
 * A rect with rounded corners on the data end only, anchored to the baseline.
 * Rounding both ends would detach the bar from its axis.
 */
export function barPath(
  x: number,
  width: number,
  valueY: number,
  zeroY: number,
  radius = 4,
): string {
  const up = valueY <= zeroY
  const top = up ? valueY : zeroY
  const bottom = up ? zeroY : valueY
  const height = Math.abs(bottom - top)
  const r = Math.min(radius, width / 2, height)

  if (height < 0.5) return ''

  return up
    ? `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
    : `M${x},${top} L${x},${bottom - r} Q${x},${bottom} ${x + r},${bottom} L${x + width - r},${bottom} Q${x + width},${bottom} ${x + width},${bottom - r} L${x + width},${top} Z`
}

/** Line path that breaks at gaps rather than bridging them with a straight lie. */
export function linePath(points: (readonly [number, number] | null)[]): string {
  let path = ''
  let penDown = false

  for (const point of points) {
    if (point === null) {
      penDown = false
      continue
    }
    path += `${penDown ? 'L' : 'M'}${point[0]},${point[1]} `
    penDown = true
  }

  return path.trim()
}
