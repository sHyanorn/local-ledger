import { describe, expect, it } from 'vitest'
import {
  chartMarkup,
  groupedBars,
  horizontalBars,
  niceTicks,
  scale,
  trendLine,
} from '../../src/shared/charts'

const format = (value: number) => `$${(value / 100).toFixed(0)}`

describe('niceTicks', () => {
  it.each([
    [0, 980, [0, 200, 400, 600, 800, 1000]],
    [0, 1, [0, 0.2, 0.4, 0.6, 0.8, 1]],
    [-450, 1200, [-500, 0, 500, 1000, 1500]],
    [0, 0, [0, 1]],
    [120, 980, [0, 200, 400, 600, 800, 1000]],
  ])('from %d to %d', (low, high, ticks) => {
    expect(niceTicks(low, high)).toEqual(ticks)
  })
})

describe('scale', () => {
  it('maps a range onto another, upside down too', () => {
    const y = scale([0, 100], [200, 0])
    expect(y(0)).toBe(200)
    expect(y(50)).toBe(100)
    expect(scale([5, 5], [0, 10])(5)).toBe(0)
  })
})

describe('charts', () => {
  it('draw a bar per value per group, from the zero line', () => {
    const chart = groupedBars({
      groups: [
        { label: 'Oct', values: [500000, 320000] },
        { label: 'Nov', values: [500000, 0] },
      ],
      series: ['income', 'spending'],
      format,
      label: 'Income and spending',
    })
    const bars = chart.shapes.filter((shape) => shape.tag === 'rect')
    expect(bars.map((bar) => bar.className)).toEqual([
      'bar income',
      'bar spending',
      'bar income',
      'bar spending',
    ])
    expect(bars[3]?.attrs.height).toBe(0)
    const zero = chart.shapes.find((shape) => shape.className === 'axis zero')
    for (const bar of bars) {
      expect(Number(bar.attrs.y) + Number(bar.attrs.height)).toBeCloseTo(
        Number(zero?.attrs.y1),
        0,
      )
    }
    expect(bars[0]?.title).toBe('Oct income: $5000')
  })

  it('order horizontal bars largest first', () => {
    const chart = horizontalBars({
      items: [
        { label: 'Fake Small', value: 100 },
        { label: 'Fake Large', value: 900 },
      ],
      format,
      label: 'Spending by category',
    })
    expect(
      chart.shapes
        .filter((shape) => shape.className === 'label')
        .map((shape) => shape.text),
    ).toEqual(['Fake Large', 'Fake Small'])
    expect(chart.height).toBe(52)
  })

  it('draw a trend as one path through every point', () => {
    const chart = trendLine({
      points: [
        { label: 'Sep', value: 100 },
        { label: 'Oct', value: 300 },
        { label: 'Nov', value: 200 },
      ],
      format,
      label: 'Fake Coffee by month',
    })
    const path = chart.shapes.find((shape) => shape.tag === 'path')
    expect(String(path?.attrs.d).match(/[ML]/g)).toEqual(['M', 'L', 'L'])
    expect(
      trendLine({ points: [], format, label: 'Empty' }).shapes.some(
        (s) => s.tag === 'path',
      ),
    ).toBe(false)
  })
})

describe('chartMarkup', () => {
  it('escapes text, writes attribute names as SVG spells them, and uses no inline style', () => {
    const markup = chartMarkup(
      horizontalBars({
        items: [{ label: '<script>alert("x")</script> & Fake', value: 5 }],
        format,
        label: 'A "label"',
      }),
    )
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&#60;script&#62;')
    expect(markup).toContain('&#38; Fake')
    expect(markup).toContain('text-anchor="end"')
    expect(markup).toContain('aria-label="A &#34;label&#34;"')
    expect(markup).not.toMatch(/style=/)
  })
})
