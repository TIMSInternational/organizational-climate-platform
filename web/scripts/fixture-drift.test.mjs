import { describe, expect, it } from 'vitest'
import { flatten, shapeOf } from './e2e-harness.mjs'

/**
 * `flatten` is where this tool got its answer wrong twice: once reporting forty lines of
 * empty-array noise, and once comparing a healthy response against an outage fixture.
 * Both were failures to distinguish "the shapes differ" from "one side said nothing".
 */
describe('flatten', () => {
  it('renders a leaf as path plus type, which is the whole comparison', () => {
    expect(flatten(shapeOf({ id: 'x' }))).toEqual(['id: string'])
  })

  it('marks an empty array as a bare prefix — the signal that a side said nothing', () => {
    expect(flatten(shapeOf({ rows: [] }))).toEqual(['rows[]'])
  })

  it('descends into a populated array through a [] segment', () => {
    expect(flatten(shapeOf({ rows: [{ id: 'x' }] }))).toEqual(['rows[].id: string'])
  })

  // The finding this tool exists to produce: a nullable the fixtures always populate.
  // These two MUST differ, or the drift is invisible.
  it('distinguishes a null from a value at the same key', () => {
    expect(flatten(shapeOf({ departmentId: null })))
      .not.toEqual(flatten(shapeOf({ departmentId: 'd1' })))
    expect(flatten(shapeOf({ departmentId: null }))).toEqual(['departmentId: null'])
  })

  it('walks nested objects', () => {
    expect(flatten(shapeOf({ a: { b: 1 } }))).toEqual(['a.b: number'])
  })
})
