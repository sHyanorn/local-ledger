// Commands the app menu sends to the page: its keyboard shortcuts.

export const COMMANDS = [
  'overview',
  'transactions',
  'budgets',
  'reports',
  'transfers',
  'new-transaction',
  'find',
  'settings',
] as const
export type Command = (typeof COMMANDS)[number]

export const isCommand = (value: unknown): value is Command =>
  (COMMANDS as readonly unknown[]).includes(value)
