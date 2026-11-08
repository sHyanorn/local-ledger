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
  /** Roughly how many transactions; scheduled ones come first. */
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
    openingBalanceCents: 500000,
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

/** Money that comes and goes on a schedule. */
interface Scheduled {
  account: string
  category: string | null
  description: string
  cents: number
  /** Days between occurrences; 0 means monthly on `day`. */
  every: number
  day: number
}

const SCHEDULED: Scheduled[] = [
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
  // A transfer appears in both accounts, uncategorized until M3 handles it.
  {
    account: 'Everyday',
    category: null,
    description: 'Transfer to Savings',
    cents: -100000,
    every: 0,
    day: 4,
  },
  {
    account: 'Savings',
    category: null,
    description: 'Transfer from Everyday',
    cents: 100000,
    every: 0,
    day: 4,
  },
]

/** Day-to-day spending, picked at random by weight. */
interface Spending {
  account: string
  /** Null for the uncategorized share. */
  category: string | null
  merchants: string[]
  /** Smallest and largest amount in cents; negative is money out. */
  range: [number, number]
  weight: number
}

const SPENDING: Spending[] = [
  {
    account: 'Everyday',
    category: 'Food/Groceries',
    merchants: ['Greenleaf Market', 'Harbour Fresh Grocer', 'Corner Pantry'],
    range: [-11000, -1800],
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
    range: [-9800, -2200],
    weight: 10,
  },
  {
    account: 'Everyday',
    category: 'Food/Coffee',
    merchants: ['Paper Plane Coffee', 'Bluegum Espresso'],
    range: [-1350, -450],
    weight: 16,
  },
  {
    account: 'Everyday',
    category: 'Transport/Fuel',
    merchants: ['Southern Cross Fuel', 'Ridgeline Petroleum'],
    range: [-9800, -4000],
    weight: 5,
  },
  {
    account: 'Everyday',
    category: 'Transport/Public Transport',
    merchants: ['Metro Card Top Up'],
    range: [-5000, -1000],
    weight: 6,
  },
  {
    account: 'Credit Card',
    category: 'Transport/Rideshare',
    merchants: ['Hopalong Rides'],
    range: [-4600, -1200],
    weight: 4,
  },
  {
    account: 'Credit Card',
    category: 'Shopping/Clothing',
    merchants: ['Wattle Lane Outfitters', 'Tidewater Threads'],
    range: [-18000, -3500],
    weight: 3,
  },
  {
    account: 'Credit Card',
    category: 'Shopping/Electronics',
    merchants: ['Circuit Bay Electronics'],
    range: [-60000, -2900],
    weight: 1,
  },
  {
    account: 'Everyday',
    category: 'Shopping/Household',
    merchants: ['Homestead Hardware', 'Kookaburra Homewares'],
    range: [-12000, -900],
    weight: 5,
  },
  {
    account: 'Everyday',
    category: 'Health/Pharmacy',
    merchants: ['Riverside Pharmacy'],
    range: [-6500, -800],
    weight: 3,
  },
  {
    account: 'Credit Card',
    category: 'Entertainment/Events',
    merchants: ['Starlight Cinema', 'Old Mill Theatre'],
    range: [-9500, -1800],
    weight: 2,
  },
  {
    account: 'Credit Card',
    category: 'Income/Refunds',
    merchants: ['Refund Tidewater Threads', 'Refund Circuit Bay Electronics'],
    range: [1500, 12000],
    weight: 1,
  },
  {
    account: 'Everyday',
    category: null,
    merchants: ['Card Payment 4417', 'EFTPOS Purchase', 'Direct Debit 2290'],
    range: [-15000, -500],
    weight: 3,
  },
]

/** One trip, spent from the travel cash account over two weeks. */
const TRIP = {
  account: 'Travel Cash',
  category: 'Travel',
  merchants: [
    'Jade Garden Teahouse',
    'Lakeside Night Market',
    'Red Lantern Hostel',
    'Old Town Ferry',
  ],
  range: [-45000, -2500] as [number, number],
  count: 16,
  days: 14,
  /** How many months before the end the trip starts. */
  monthsAgo: 5,
}

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
// Days are counted as UTC midnights, so no time zone shifts a date.
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10)

export function generateLedger({
  seed = 1,
  end = new Date(),
  months = 18,
  transactions = 1500,
}: SeedOptions = {}): SeedLedger {
  const next = random(seed)
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)] as T
  const between = ([low, high]: [number, number]) =>
    low + Math.floor(next() * (high - low + 1))
  const last = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  const first = Date.UTC(end.getFullYear(), end.getMonth() - months + 1, 1)
  const span = Math.floor((last - first) / DAY_MS) + 1
  const rows: SeedTransaction[] = []
  const add = (
    row: Omit<SeedTransaction, 'notes'> & { notes?: string },
  ): void => {
    rows.push({ notes: '', ...row })
  }

  for (const item of SCHEDULED) {
    for (let time = first + (item.day - 1) * DAY_MS; time <= last;) {
      add({ ...item, date: isoDay(time), amountCents: item.cents })
      if (item.every > 0) {
        time += item.every * DAY_MS
      } else {
        const date = new Date(time)
        time = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, item.day)
      }
    }
  }

  const tripStart = Date.UTC(
    end.getFullYear(),
    end.getMonth() - TRIP.monthsAgo,
    10,
  )
  for (let n = 0; n < TRIP.count && tripStart <= last; n++) {
    add({
      account: TRIP.account,
      category: TRIP.category,
      date: isoDay(tripStart + Math.floor(next() * TRIP.days) * DAY_MS),
      amountCents: between(TRIP.range),
      description: pick(TRIP.merchants),
    })
  }

  // Leave room for one card repayment a month, added below.
  const total = SPENDING.reduce((sum, item) => sum + item.weight, 0)
  while (rows.length + months * 2 < transactions) {
    let roll = next() * total
    const item =
      SPENDING.find((candidate) => (roll -= candidate.weight) < 0) ??
      (SPENDING.at(-1) as Spending)
    add({
      account: item.account,
      category: item.category,
      date: isoDay(first + Math.floor(next() * span) * DAY_MS),
      amountCents: between(item.range),
      description: pick(item.merchants),
      notes: next() < 0.04 ? pick(NOTES) : '',
    })
  }

  // The card is paid off on the 15th: last month's spending, from Everyday.
  const spent = rows.filter((row) => row.account === 'Credit Card')
  for (let month = 1; month < months; month++) {
    const firstOf = (offset: number) =>
      Date.UTC(end.getFullYear(), end.getMonth() - months + 1 + offset, 1)
    const due = firstOf(month) + 14 * DAY_MS
    if (due > last) break
    const from = isoDay(firstOf(month - 1))
    const until = isoDay(firstOf(month) - DAY_MS)
    const owed = -spent
      .filter((row) => row.date >= from && row.date <= until)
      .reduce((sum, row) => sum + row.amountCents, 0)
    if (owed <= 0) continue
    const date = isoDay(due)
    add({
      account: 'Everyday',
      category: null,
      date,
      amountCents: -owed,
      description: 'Card Repayment 4417',
    })
    add({
      account: 'Credit Card',
      category: null,
      date,
      amountCents: owed,
      description: 'Payment Received, Thank You',
    })
  }

  rows.sort((a, b) => a.date.localeCompare(b.date))
  return { accounts: ACCOUNTS, categories: CATEGORIES, transactions: rows }
}
