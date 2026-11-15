import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NeedleCounter } from '../support/memory'

describe('counting texts in memory read in chunks', () => {
  const needles = { long: Buffer.from('abcdef'), short: Buffer.from('cd') }
  const count = (...chunks: (string | null)[]) => {
    const counter = new NeedleCounter(needles)
    for (const chunk of chunks) {
      if (chunk === null) counter.gap()
      else counter.add(Buffer.from(chunk))
    }
    return counter.counts
  }

  it('counts a text split between two chunks', () => {
    expect(count('xxab', 'cdefxx')).toEqual({ long: 1, short: 1 })
  })

  it('counts a text at the end of a chunk once', () => {
    expect(count('xxabcdef', 'cdx', 'y')).toEqual({ long: 1, short: 2 })
  })

  it('leaves out copies inside a copy of a longer text', () => {
    const counter = new NeedleCounter(needles)
    counter.add(Buffer.from('abcdef cd abcdef'))
    expect(counter.counts).toEqual({ long: 2, short: 3 })
    expect(counter.own()).toEqual({ long: 2, short: 1 })
  })

  it('does not join chunks across a gap', () => {
    expect(count('xxabc', null, 'defxx')).toEqual({ long: 0, short: 0 })
  })

  it('agrees with a plain search on random bytes in random chunks', () => {
    // Needles that share prefixes and suffixes and contain one another.
    const words = ['aab', 'ab', 'abab', 'baa', 'b', 'bba', 'aaaa']
    const needles = Object.fromEntries(
      words.map((word) => [word, Buffer.from(word)]),
    )
    for (let round = 0; round < 50; round++) {
      const bytes = Buffer.from(
        Array.from({ length: 300 }, () => 'abc'.charCodeAt(randomInt(3))),
      )
      const counter = new NeedleCounter(needles)
      for (let at = 0; at < bytes.length;) {
        const end = Math.min(bytes.length, at + randomInt(1, 20))
        counter.add(bytes.subarray(at, end))
        at = end
      }
      const plain = Object.fromEntries(
        words.map((word) => {
          let found = 0
          for (let at = 0; at + word.length <= bytes.length; at++) {
            if (bytes.toString('latin1', at, at + word.length) === word) {
              found += 1
            }
          }
          return [word, found]
        }),
      )
      expect(counter.counts).toEqual(plain)
    }
  })
})
