// Charts as plain shapes: rectangles, paths, lines and text with class names
// and SVG attributes, never inline styles. The page draws them with React and
// the PDF export writes them as SVG text, so both look the same. Colors come
// from the class names in the stylesheets.

interface Shape {
  tag: 'rect' | 'path' | 'line' | 'text'
  className: string
  attrs: Record<string, string | number>
  /** Text content, for a text shape. */
  text?: string
  /** A tooltip, drawn as an SVG title. */
  title?: string
}

export interface Chart {
  width: number
  height: number
  /** What the chart shows, for screen readers and the PDF. */
  label: string
  shapes: Shape[]
}

/** Format a value for an axis or a tooltip, such as "$1.2k" or "$1,234.56". */
type Format = (value: number) => string

/**
 * Round axis bounds and a step of 1, 2 or 5 times a power of ten, about
 * `count` steps from the lowest to the highest value (and zero).
 */
export function niceTicks(low: number, high: number, count = 5): number[] {
  const min = Math.min(0, low)
  const max = Math.max(0, high)
  if (min === max) return [0, 1]
  const rough = (max - min) / count
  const power = 10 ** Math.floor(Math.log10(rough))
  const step =
    [1, 2, 5, 10].map((factor) => factor * power).find((s) => s >= rough) ??
    10 * power
  const ticks: number[] = []
  // Whole multiples of the step, cleaned of floating-point noise.
  for (let n = Math.floor(min / step); n <= Math.ceil(max / step); n++) {
    ticks.push(Number((n * step).toPrecision(12)))
  }
  return ticks
}

/** A linear map from one range of numbers to another. */
export function scale(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
): (value: number) => number {
  const span = d1 - d0 || 1
  return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

const round = (value: number) => Math.round(value * 10) / 10

const PAD = { top: 12, right: 12, bottom: 28, left: 64 }

/** A vertical scale over the values and zero, with its grid lines and ticks. */
function valueScale(
  values: number[],
  width: number,
  height: number,
  format: Format,
): { y: (value: number) => number; axis: Shape[] } {
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const y = scale(
    [ticks[0] ?? 0, ticks.at(-1) ?? 1],
    [height - PAD.bottom, PAD.top],
  )
  const left = PAD.left
  const right = width - PAD.right
  const axis = ticks.flatMap((tick): Shape[] => [
    {
      tag: 'line',
      className: tick === 0 ? 'axis zero' : 'grid',
      attrs: { x1: left, x2: right, y1: round(y(tick)), y2: round(y(tick)) },
    },
    {
      tag: 'text',
      className: 'tick',
      attrs: { x: left - 6, y: round(y(tick)) + 4, textAnchor: 'end' },
      text: format(tick),
    },
  ])
  return { y, axis }
}

/**
 * Bars side by side for each group, such as income and spending each month.
 * `series` names each bar in a group and becomes its class.
 */
export function groupedBars({
  groups,
  series,
  format,
  label,
  width = 640,
  height = 240,
}: {
  groups: { label: string; values: number[] }[]
  series: string[]
  format: Format
  label: string
  width?: number
  height?: number
}): Chart {
  const { y, axis: shapes } = valueScale(
    groups.flatMap((group) => group.values),
    width,
    height,
    format,
  )
  const band = (width - PAD.left - PAD.right) / Math.max(1, groups.length)
  const bar = (band * 0.7) / Math.max(1, series.length)
  groups.forEach((group, index) => {
    const start = PAD.left + index * band + band * 0.15
    group.values.forEach((value, n) => {
      const top = y(Math.max(0, value))
      shapes.push({
        tag: 'rect',
        className: `bar ${series[n] ?? ''}`.trim(),
        attrs: {
          x: round(start + n * bar),
          y: round(top),
          width: round(bar * 0.9),
          height: round(Math.max(0, Math.abs(y(value) - y(0)))),
        },
        title: `${group.label} ${series[n] ?? ''}: ${format(value)}`,
      })
    })
    shapes.push({
      tag: 'text',
      className: 'label',
      attrs: {
        x: round(PAD.left + (index + 0.5) * band),
        y: height - 8,
        textAnchor: 'middle',
      },
      text: group.label,
    })
  })
  return { width, height, label, shapes }
}

/** One horizontal bar per item, largest first, with its value at the end. */
export function horizontalBars({
  items,
  format,
  label,
  width = 640,
  rowHeight = 26,
}: {
  items: { label: string; value: number }[]
  format: Format
  label: string
  width?: number
  rowHeight?: number
}): Chart {
  const sorted = items.toSorted((a, b) => b.value - a.value)
  const labelWidth = 150
  const valueWidth = 96
  const x = scale(
    [0, Math.max(1, ...sorted.map((item) => item.value))],
    [labelWidth, width - valueWidth],
  )
  const shapes = sorted.flatMap((item, index): Shape[] => {
    const top = index * rowHeight
    return [
      {
        tag: 'text',
        className: 'label',
        attrs: {
          x: labelWidth - 8,
          y: top + rowHeight / 2 + 4,
          textAnchor: 'end',
        },
        text: item.label,
      },
      {
        tag: 'rect',
        className: 'bar',
        attrs: {
          x: labelWidth,
          y: top + 5,
          width: round(Math.max(0, x(item.value) - labelWidth)),
          height: rowHeight - 10,
        },
        title: `${item.label}: ${format(item.value)}`,
      },
      {
        tag: 'text',
        className: 'value',
        attrs: { x: round(x(item.value)) + 6, y: top + rowHeight / 2 + 4 },
        text: format(item.value),
      },
    ]
  })
  return {
    width,
    height: Math.max(rowHeight, sorted.length * rowHeight),
    label,
    shapes,
  }
}

/** A line through one value per period, with a dot at each. */
export function trendLine({
  points,
  format,
  label,
  width = 640,
  height = 200,
}: {
  points: { label: string; value: number }[]
  format: Format
  label: string
  width?: number
  height?: number
}): Chart {
  const { y, axis: shapes } = valueScale(
    points.map((point) => point.value),
    width,
    height,
    format,
  )
  const step = (width - PAD.left - PAD.right) / Math.max(1, points.length - 1)
  const x = (index: number) =>
    round(
      points.length === 1
        ? (PAD.left + width - PAD.right) / 2
        : PAD.left + index * step,
    )
  if (points.length > 0) {
    shapes.push({
      tag: 'path',
      className: 'line',
      attrs: {
        d: points
          .map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'}${x(index)},${round(y(point.value))}`,
          )
          .join(''),
      },
    })
  }
  points.forEach((point, index) => {
    shapes.push(
      {
        tag: 'rect',
        className: 'dot',
        attrs: {
          x: x(index) - 3,
          y: round(y(point.value)) - 3,
          width: 6,
          height: 6,
          rx: 3,
        },
        title: `${point.label}: ${format(point.value)}`,
      },
      {
        tag: 'text',
        className: 'label',
        attrs: { x: x(index), y: height - 8, textAnchor: 'middle' },
        text: point.label,
      },
    )
  })
  return { width, height, label, shapes }
}

/** Text safe inside HTML or SVG markup, attribute values included. */
export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** camelCase SVG attribute names as written in markup. */
const attribute = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** The chart as SVG markup, for a page without scripts. */
export function chartMarkup(chart: Chart): string {
  const body = chart.shapes
    .map((shape) => {
      const attrs = Object.entries(shape.attrs)
        .map(
          ([name, value]) =>
            ` ${attribute(name)}="${escapeHtml(String(value))}"`,
        )
        .join('')
      const title = shape.title
        ? `<title>${escapeHtml(shape.title)}</title>`
        : ''
      const text = shape.text ? escapeHtml(shape.text) : ''
      return `<${shape.tag} class="${escapeHtml(shape.className)}"${attrs}>${title}${text}</${shape.tag}>`
    })
    .join('')
  return `<svg class="chart" viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="${escapeHtml(chart.label)}">${body}</svg>`
}
