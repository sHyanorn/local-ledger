import { createElement } from 'react'
import type { Chart } from '../../../shared/charts'

/** Draws a chart's shapes as SVG; sizes come from its viewBox, colors from CSS. */
export function ChartView({ chart }: { chart: Chart }) {
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      role="img"
      aria-label={chart.label}
    >
      {chart.shapes.map((shape, index) =>
        createElement(
          shape.tag,
          { key: index, className: shape.className, ...shape.attrs },
          shape.title ? <title>{shape.title}</title> : null,
          shape.text ?? null,
        ),
      )}
    </svg>
  )
}
