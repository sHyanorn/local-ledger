// Text that a spreadsheet would read as a formula (OWASP "CSV Injection").
// Excel also reads the full-width forms of = + - @ as formula starts.

const FORMULA_START = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/

/** Whether a spreadsheet could take this text, typed into a cell, for a formula. */
export const startsLikeFormula = (text: string): boolean =>
  FORMULA_START.test(text)
