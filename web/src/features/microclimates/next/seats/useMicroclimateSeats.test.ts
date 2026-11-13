import { describe, it, expect } from 'vitest'
import { seatsCase } from './useMicroclimateSeats'

const seats = (overrides: Partial<Parameters<typeof seatsCase>[0]>) => ({
  licensed: true,
  status: 'active',
  seatsTotal: 10,
  seatsUsed: 4,
  seatsRemaining: 6,
  ...overrides,
})

describe('which sentence the seats deserve', () => {
  it('names an unlicensed company unmetered, whatever the counts say', () => {
    expect(seatsCase(seats({ licensed: false, seatsRemaining: 0 }))).toBe('unmetered')
  })
  it('puts a suspension before the count', () => {
    expect(seatsCase(seats({ status: 'suspended' }))).toBe('suspended')
  })
  it('calls zero remaining exhausted, and anything above it available', () => {
    expect(seatsCase(seats({ seatsUsed: 10, seatsRemaining: 0 }))).toBe('exhausted')
    expect(seatsCase(seats({}))).toBe('available')
  })
})
