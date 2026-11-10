// A minimal xlsx writer: SpreadsheetML parts zipped with fflate (D030).
// Text is always an inline string, never a formula, shown with the Text
// number format; text that starts like a formula also gets quotePrefix, so
// editing the cell keeps it text.
import { strToU8, zipSync, type Zippable } from 'fflate'
import { centsToDecimal } from '../../shared/money'
import { startsLikeFormula } from './formula'

/** A cell: text, a date (YYYY-MM-DD), an amount in cents, or empty. */
type Cell = string | { date: string } | { cents: number } | null

export interface Row {
  cells: Cell[]
  bold?: boolean
}

export interface Sheet {
  /** At most 31 characters, none of []:*?/\ . */
  name: string
  /** Column widths in characters. */
  widths: number[]
  rows: Row[]
  /** Keep the first row in view while scrolling. */
  freezeHeader?: boolean
}

// cellXfs: plain, bold; then text, text with quotePrefix, date and amount,
// each plain and bold.
const STYLE = { text: 2, quoted: 4, date: 6, amount: 8 } as const
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" quotePrefix="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** Control characters other than tab and line breaks, and two noncharacters. */
// eslint-disable-next-line no-control-regex
const INVALID = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g

/** Text without the characters XML cannot hold; a lone surrogate becomes U+FFFD. */
const xmlSafe = (text: string): string =>
  text.toWellFormed().replace(INVALID, '')

/**
 * Text as XML character data, from xmlSafe text. A carriage return is kept
 * as a reference, since parsers turn a literal one into a line feed; and
 * `_xHHHH_`, which Excel reads as an escaped character, has its underscore
 * escaped the same way.
 */
export function xmlText(text: string): string {
  return xmlSafe(text)
    .replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1')
    .replace(/[&<>"\r]/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** The column's letters: 0 is A, 26 is AA. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

/** Days since 1899-12-30, the serial Excel and LibreOffice use for dates. */
export function dateSerial(date: string): number {
  return (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000
}

function cellXml(cell: Cell, ref: string, bold: boolean): string {
  const weight = bold ? 1 : 0
  if (cell === null) return ''
  if (typeof cell === 'string') {
    // Tested as written, after dropping what XML cannot hold.
    const text = xmlSafe(cell)
    const style = (startsLikeFormula(text) ? STYLE.quoted : STYLE.text) + weight
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`
  }
  if ('date' in cell) {
    return `<c r="${ref}" s="${STYLE.date + weight}"><v>${dateSerial(cell.date)}</v></c>`
  }
  return `<c r="${ref}" s="${STYLE.amount + weight}"><v>${centsToDecimal(cell.cents)}</v></c>`
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join('')
  const rows = sheet.rows
    .map((row, index) => {
      const r = index + 1
      const cells = row.cells
        .map((cell, column) =>
          cellXml(cell, `${columnName(column)}${r}`, row.bold ?? false),
        )
        .join('')
      return `<row r="${r}">${cells}</row>`
    })
    .join('')
  const view = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : ''
  return `${HEAD}<worksheet xmlns="${NS}">${view}${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`
}

const SHEET_NAME = /^[^[\]:*?/\\]{1,31}$/

/** The workbook as xlsx bytes. Same sheets, same bytes. */
export function workbook(sheets: Sheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs a sheet')
  for (const sheet of sheets) {
    if (!SHEET_NAME.test(sheet.name)) throw new Error('Invalid sheet name')
  }
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, index) =>
              `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>` +
        sheets
          .map(
            (sheet, index) =>
              `<sheet name="${xmlText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
          )
          .join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, index) =>
              `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(STYLES),
  }
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet))
  })
  // A fixed time, so a file says nothing about when it was made.
  const zipped = zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) })
  // The parts hold the sheets' text uncompressed.
  for (const part of Object.values(files)) {
    if (part instanceof Uint8Array) part.fill(0)
  }
  return zipped
}
