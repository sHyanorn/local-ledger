import {
  DATE_ORDERS,
  ENCODINGS,
  type Encoding,
  type ImportFile,
  type Mapping,
} from '../../../shared/imports'
import { DATE_ORDER_NAMES, ENCODING_NAMES } from './importing'

export function ColumnEditor({
  file,
  mapping,
  encoding,
  onMapping,
  onEncoding,
}: {
  file: ImportFile
  mapping: Mapping
  encoding: Encoding
  onMapping: (mapping: Mapping) => void
  onEncoding: (encoding: Encoding) => void
}) {
  const first = file.sample[0] ?? []
  const example = file.sample[mapping.header ? 1 : 0] ?? []
  const label = (index: number) => {
    const name = mapping.header ? first[index]?.trim() : ''
    const value = example[index]?.trim()
    return [`${index + 1}`, name || value].filter(Boolean).join(' · ')
  }
  const columns = [...Array(file.columns).keys()]
  // A plain function, not a component: a component defined here would be
  // a new type each render, and its select would lose focus on every change.
  const columnSelect = (
    name: string,
    value: number,
    onChange: (value: number) => void,
  ) => (
    <label>
      {name}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {columns.map((index) => (
          <option key={index} value={index}>
            {label(index)}
          </option>
        ))}
      </select>
    </label>
  )
  const amount = mapping.amount

  return (
    <section className="columns" aria-label="Columns">
      <div className="form column-form">
        {columnSelect('Date', mapping.date, (date) =>
          onMapping({ ...mapping, date }),
        )}
        <label>
          Date format
          <select
            value={mapping.dateOrder}
            onChange={(event) =>
              onMapping({
                ...mapping,
                dateOrder: event.target.value as Mapping['dateOrder'],
              })
            }
          >
            {DATE_ORDERS.map((order) => (
              <option key={order} value={order}>
                {DATE_ORDER_NAMES[order]}
              </option>
            ))}
          </select>
        </label>
        {columnSelect('Description', mapping.description[0] ?? 0, (column) =>
          onMapping({ ...mapping, description: [column] }),
        )}
        <label>
          Text encoding
          <select
            value={encoding}
            onChange={(event) => onEncoding(event.target.value as Encoding)}
          >
            {ENCODINGS.map((option) => (
              <option key={option} value={option}>
                {ENCODING_NAMES[option]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="segmented">
          <legend>Amounts</legend>
          <label>
            <input
              type="radio"
              name="amount-kind"
              checked={amount.kind === 'signed'}
              onChange={() =>
                onMapping({
                  ...mapping,
                  amount: {
                    kind: 'signed',
                    column:
                      amount.kind === 'split' ? amount.debit : amount.column,
                    negate: false,
                  },
                })
              }
            />
            One Column
          </label>
          <label>
            <input
              type="radio"
              name="amount-kind"
              checked={amount.kind === 'split'}
              onChange={() => {
                const start =
                  amount.kind === 'signed' ? amount.column : amount.debit
                onMapping({
                  ...mapping,
                  amount: {
                    kind: 'split',
                    debit: start,
                    credit: Math.min(start + 1, file.columns - 1),
                  },
                })
              }}
            />
            Out and In
          </label>
        </fieldset>
        {amount.kind === 'signed' ? (
          <>
            {columnSelect('Amount', amount.column, (column) =>
              onMapping({ ...mapping, amount: { ...amount, column } }),
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={amount.negate}
                onChange={(event) =>
                  onMapping({
                    ...mapping,
                    amount: { ...amount, negate: event.target.checked },
                  })
                }
              />
              Money out is positive
            </label>
          </>
        ) : (
          <>
            {columnSelect('Money out', amount.debit, (debit) =>
              onMapping({ ...mapping, amount: { ...amount, debit } }),
            )}
            {columnSelect('Money in', amount.credit, (credit) =>
              onMapping({ ...mapping, amount: { ...amount, credit } }),
            )}
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={mapping.header}
            onChange={(event) =>
              onMapping({ ...mapping, header: event.target.checked })
            }
          />
          First row names the columns
        </label>
      </div>
    </section>
  )
}
