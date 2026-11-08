import { describe, expect, it } from 'vitest'
import { channels, type Channel } from '../../src/shared/ipc'

const id = '00000000-0000-4000-8000-000000000000'
const mapping = {
  header: false,
  date: 0,
  dateOrder: 'dmy',
  description: [2],
  amount: { kind: 'signed', column: 1, negate: false },
}
const request = {
  id,
  encoding: 'utf-8',
  mapping,
  targets: [{ key: '', accountId: 1 }],
}

// Each channel added in M3, with a valid payload and payloads it refuses.
const cases: [Channel, unknown, unknown[]][] = [
  ['import:open', undefined, [{}, '/etc/passwd', { path: '/etc/passwd' }]],
  [
    'import:preview',
    request,
    [
      { ...request, id: 'not-a-uuid' },
      { ...request, encoding: 'utf-32' },
      { ...request, path: '/tmp/x.csv' },
      { ...request, targets: [] },
      { ...request, targets: Array(51).fill({ key: '', accountId: 1 }) },
      { ...request, targets: [{ key: 'x'.repeat(65), accountId: 1 }] },
      { ...request, mapping: { ...mapping, date: 64 } },
      { ...request, mapping: { ...mapping, date: -1 } },
      { ...request, mapping: { ...mapping, description: [] } },
      { ...request, mapping: { ...mapping, description: [1, 2, 3, 4] } },
      { ...request, mapping: { ...mapping, dateOrder: 'ydm' } },
      {
        ...request,
        mapping: { ...mapping, amount: { kind: 'split', debit: 1 } },
      },
      { ...request, mapping: { ...mapping, extra: true } },
    ],
  ],
  [
    'import:commit',
    { ...request, selected: [0, 1] },
    [
      request,
      { ...request, selected: [-1] },
      { ...request, selected: [1.5] },
      { ...request, selected: Array(50_001).fill(0) },
    ],
  ],
  ['import:discard', { id }, [{ id: 'x' }, {}]],
  ['import:batches', undefined, [{}]],
  ['import:undo', { id: 1 }, [{ id: 0 }, { id: '1' }]],
  ['rules:list', undefined, [{}]],
  [
    'rules:create',
    { pattern: 'Fake', match: 'contains', categoryId: 1, apply: true },
    [
      { pattern: 'Fake', match: 'regex', categoryId: 1, apply: true },
      { pattern: '', match: 'is', categoryId: 1, apply: true },
      { pattern: 'x'.repeat(101), match: 'is', categoryId: 1, apply: true },
      { pattern: 'Fake', match: 'is', categoryId: 1 },
    ],
  ],
  [
    'rules:update',
    { id: 1, pattern: 'Fake', match: 'is', categoryId: 1 },
    [{ id: 1, pattern: 'Fake', match: 'is' }],
  ],
  ['rules:delete', { id: 1 }, [{ id: -1 }]],
  [
    'rules:move',
    { id: 1, offset: -1 },
    [
      { id: 1, offset: 2 },
      { id: 1, offset: 0 },
    ],
  ],
  [
    'rules:reach',
    { pattern: 'Fake', match: 'starts-with' },
    [{ pattern: 'Fake', match: 'starts-with', categoryId: 1 }],
  ],
  ['rules:suggest', { id: 1 }, [{ id: 'x' }]],
  [
    'rules:decline',
    { pattern: 'Fake' },
    [{ pattern: '' }, { pattern: 'x'.repeat(501) }],
  ],
  ['transfers:possible', undefined, [{}]],
  ['transfers:count', undefined, [{}]],
  ['transfers:choices', { id: 1 }, [{}]],
  ['transfers:link', { id: 1, otherId: 2 }, [{ id: 1 }, { id: 1, otherId: 0 }]],
  ['transfers:unlink', { id: 1 }, [{ id: 1, otherId: 2 }]],
  [
    'transfers:reject',
    { outId: 1, inId: 2 },
    [{ outId: 1 }, { outId: 1, inId: 2, status: 'confirmed' }],
  ],
]

describe('M3 channels', () => {
  it.each(cases)(
    '%s accepts a valid payload and refuses bad ones',
    (channel, valid, invalid) => {
      expect(channels[channel].safeParse(valid).success).toBe(true)
      for (const payload of invalid) {
        expect(
          channels[channel].safeParse(payload).success,
          JSON.stringify(payload)?.slice(0, 80),
        ).toBe(false)
      }
    },
  )
})
