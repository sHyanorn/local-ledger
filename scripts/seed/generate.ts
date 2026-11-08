// Fake ledger data for demos and tests. Every merchant and name is
// invented. The same seed and end date always give the same ledger.
import type { AccountFields } from '../../src/shared/ledger'

export interface SeedOptions {
  /** Selects one of many equally plausible ledgers. */
  seed?: number
  /** The last day with transactions. */
  end?: Date
  /** How far back the transactions go. */
  months?: number
  /** Roughly how many transactions; recurring ones come first. */
  transactions?: number
}

export interface SeedTransaction {
  account: string
  date: string
  amountCents: number
  description: string
  /** "Parent" or "Parent/Child"; null leaves it uncategorized. */
  category: string | null
  notes: string
}

export interface SeedLedger {
  accounts: AccountFields[]
  /** Top-level categories with their subcategories. */
  categories: { name: string; children: string[] }[]
  transactions: SeedTransaction[]
}

const ACCOUNTS: AccountFields[] = [
  {
    name: 'Everyday',
    type: 'bank',
    currency: 'AUD',
    openingBalanceCents: 250000,
  },
  {
    name: 'Savings',
    type: 'savings',
    currency: 'AUD',
    openingBalanceCents: 1200000,
  },
  {
    name: 'Credit Card',
    type: 'credit',
    currency: 'AUD',
    openingBalanceCents: 0,
  },
  {
    name: 'Travel Cash',
    type: 'cash',
    currency: 'CNY',
    openingBalanceCents: 200000,
  },
]

const CATEGORIES = [
  { name: 'Income', children: ['Salary', 'Interest', 'Refunds'] },
  { name: 'Housing', children: ['Rent', 'Utilities', 'Internet'] },
  { name: 'Food', children: ['Groceries', 'Dining Out', 'Coffee'] },
  { name: 'Transport', children: ['Fuel', 'Public Transport', 'Rideshare'] },
  { name: 'Shopping', children: ['Clothing', 'Electronics', 'Household'] },
  { name: 'Health', children: ['Pharmacy', 'Fitness'] },
  { name: 'Entertainment', children: ['Streaming', 'Events'] },
  { name: 'Travel', children: [] },
]

interface Recurring {
  account: string
  category: string
  description: string
  cents: number
  /** Days between occurrences; 0 means monthly on `day`. */
  every: number
  day: number
}

const RECURRING: Recurring[] = [
  {
    account: 'Everyday',
    category: 'Income/Salary',
    description: 'Salary Northwind Logistics',
    cents: 385000,
    every: 14,
    day: 3,
  },
  {
    account: 'Everyday',
    category: 'Housing/Rent',
    description: 'Rent Harbourview Realty',
    cents: -245000,
    every: 0,
    day: 1,
  },
  {
    account: 'Everyday',
    category: 'Housing/Utilities',
    description: 'Bright Spark Energy',
    cents: -16540,
    every: 0,
    day: 12,
  },
  {
    account: 'Everyday',
    category: 'Housing/Internet',
    description: 'Lumen Fibre Internet',
    cents: -7900,
    every: 0,
    day: 18,
  },
  {
    account: 'Credit Card',
    category: 'Entertainment/Streaming',
    description: 'Reelhouse Streaming',
    cents: -1699,
    every: 0,
    day: 9,
  },
  {
    account: 'Credit Card',
    category: 'Health/Fitness',
    description: 'Ironbark Gym Membership',
    cents: -5900,
    every: 0,
    day: 5,
  },
  {
    account: 'Savings',
    category: 'Income/Interest',
    description: 'Interest Credit',
    cents: 2140,
    every: 0,
    day: 28,
  },
]

interface Spending {
  account: string
  /** Null for the uncategorized share. */
  category: string | null
  merchants: string[]
  /** Smallest and largest amount, in cents spent. */
  range: [number, number]
  weight: number
}

const SPENDING: Spending[] = [
  {
    account: 'Everyday',
    category: 'Food/Groceries',
    merchants: ['Greenleaf Market', 'Harbour Fresh Grocer', 'Corner Pantry'],
    range: [1800, 21000],
    weight: 18,
  },
  {
    account: 'Credit Card',
    category: 'Food/Dining Out',
    merchants: [
      'Little Lantern Noodle Bar',
      'The Copper Kettle',
      'Saltbush Kitchen',
    ],
    range: [2200, 14500],
    weight: 10,
  },
  {
    account: 'Everyday',
    category: 'Food/Coffee',
    merchants: ['Paper Plane Coffee', 'Bluegum Espresso'],
    range: [450, 1350],
    weight: 16,
  },
  {
    account: 'Everyday',
    category: 'Transport/Fuel',
    merchants: ['Southern Cross Fuel', 'Ridgeline Petroleum'],
    range: [4000, 9800],
    weight: 5,
  },
  {
    account: 'Everyday',
    category: 'Transport/Public Transport',
    merchants: ['Metro Card Top Up'],
    range: [1000, 5000],
    weight: 6,
  },
  {
    account: 'Credit Card',
    category: 'Transport/Rideshare',
    merchants: ['Hopalong Rides'],
    range: [1200, 4600],
    weight: 4,
  },
  {
    account: 'Credit Card',
    category: 'Shopping/Clothing',
    merchants: ['Wattle Lane Outfitters', 'Tidewater Threads'],
    range: [3500, 18000],
    weight: 3,
  },
  {
    account: 'Credit Card',
    category: 'Shopping/Electronics',
    merchants: ['Circuit Bay Electronics'],
    range: [2900, 89900],
    weight: 1,
  },
  {
    account: 'Everyday',
    category: 'Shopping/Household',
    merchants: ['Homestead Hardware', 'Kookaburra Homewares'],
    range: [900, 12000],
    weight: 5,
  },
  {
    account: 'Everyday',
    category: 'Health/Pharmacy',
    merchants: ['Riverside Pharmacy'],
    range: [800, 6500],
    weight: 3,
  },
  {
    account: 'Credit Card',
    category: 'Entertainment/Events',
    merchants: ['Starlight Cinema', 'Old Mill Theatre'],
    range: [1800, 9500],
    weight: 2,
  },
  {
    account: 'Travel Cash',
    category: 'Travel',
    merchants: [
      'Jade Garden Teahouse',
      'Lakeside Night Market',
      'Red Lantern Hostel',
    ],
    range: [3500, 68000],
    weight: 2,
  },
  {
    account: 'Everyday',
    category: null,
    merchants: [
      'Card Payment 4417',
      'EFTPOS Purchase',
      'Transfer Reference 2290',
    ],
    range: [500, 15000],
    weight: 3,
  },
]

const NOTES = ['split with flatmate', 'gift', 'reimbursable', 'deposit paid']

/** A small, fast, seeded generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY_MS = 86_400_000

export function generateLedger({
  seed = 1,
  end = new Date(),
  months = 18,
  transactions = 3000,
}: SeedOptions = {}): SeedLedger {
  const next = random(seed)
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)] as T
  const last = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  const first = Date.UTC(end.getFullYear(), end.getMonth() - months + 1, 1)
  // Days are counted as UTC midnights, so no time zone shifts a date.
  const day = (time: number) => new Date(time).toISOString().slice(0, 10)
  const rows: SeedTransaction[] = []

  for (const item of RECURRING) {
    for (let time = first + (item.day - 1) * DAY_MS; time <= last;) {
      rows.push({
        account: item.account,
        date: day(time),
        amountCents: item.cents,
        description: item.description,
        category: item.category,
        notes: '',
      })
      if (item.every > 0) {
        time += item.every * DAY_MS
      } else {
        const date = new Date(time)
        time = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, item.day)
      }
    }
  }

  const total = SPENDING.reduce((sum, item) => sum + item.weight, 0)
  const span = Math.floor((last - first) / DAY_MS) + 1
  while (rows.length < transactions) {
    let roll = next() * total
    const item =
      SPENDING.find((candidate) => (roll -= candidate.weight) < 0) ??
      (SPENDING.at(-1) as Spending)
    const [low, high] = item.range
    rows.push({
      account: item.account,
      date: day(first + Math.floor(next() * span) * DAY_MS),
      amountCents: -(low + Math.floor(next() * (high - low + 1))),
      description: pick(item.merchants),
      category: item.category,
      notes: next() < 0.04 ? pick(NOTES) : '',
    })
  }

  rows.sort((a, b) => a.date.localeCompare(b.date))
  return { accounts: ACCOUNTS, categories: CATEGORIES, transactions: rows }
}
