import { describe, it, expect } from 'vitest'
import { departmentRows } from './departmentHierarchy'
import type { Department } from '../api/departments'

function department(id: string, parentDepartmentId: string | null = null): Department {
  return {
    id,
    companyId: 'company-1',
    name: id,
    description: null,
    parentDepartmentId,
    isActive: true,
    employeeCount: 10,
  }
}

/** `id@depth` for every emitted row, in order. */
function shape(rows: ReturnType<typeof departmentRows>): string[] {
  return rows.map((row) => `${row.department.id}@${row.depth}`)
}

describe('departmentRows', () => {
  it('puts each subtree immediately under its parent, not in the flat order it arrived in', () => {
    // The order the server sends: alphabetical, so a child can precede its parent.
    const flat = [
      department('alpha'),
      department('alpha-child', 'alpha'),
      department('beta'),
      department('beta-child', 'beta'),
    ]

    expect(shape(departmentRows([flat[1], flat[3], flat[0], flat[2]], flat))).toEqual([
      'alpha@0',
      'alpha-child@1',
      'beta@0',
      'beta-child@1',
    ])
  })

  it('measures depth from the root, however deep the chain goes', () => {
    const flat = [
      department('root'),
      department('mid', 'root'),
      department('leaf', 'mid'),
      department('deep', 'leaf'),
    ]

    expect(shape(departmentRows(flat, flat))).toEqual(['root@0', 'mid@1', 'leaf@2', 'deep@3'])
  })

  it('keeps the order the server sent within each group of siblings', () => {
    // The API orders by name, and that order has to survive the re-shaping level
    // by level — otherwise the tree fixes one problem and creates another.
    const flat = [
      department('root'),
      department('a', 'root'),
      department('b', 'root'),
      department('c', 'root'),
    ]

    expect(shape(departmentRows(flat, flat))).toEqual(['root@0', 'a@1', 'b@1', 'c@1'])
  })

  it('emits a department whose parent is not in the company as a root, in place', () => {
    // A parent id pointing at a department this company did not send is not a
    // parent anyone can render. The row keeps its position among the roots rather
    // than being swept to the bottom of the table — and it is certainly not
    // dropped, which is what happens to anything filed under a parent that is
    // never walked.
    const flat = [
      department('first'),
      department('orphan', 'archived-elsewhere'),
      department('last'),
    ]

    expect(shape(departmentRows(flat, flat))).toEqual(['first@0', 'orphan@0', 'last@0'])
  })

  it('takes depth from the whole company, not from the filtered rows', () => {
    // The parent is filtered out of view; the child is still a child, and
    // re-rooting it the moment its parent was typed out of the list would make the
    // indent jump around while you searched.
    const flat = [department('parent'), department('child', 'parent')]

    expect(shape(departmentRows([flat[1]], flat))).toEqual(['child@1'])
  })

  it('renders every row exactly once even when the parent chain is a cycle', () => {
    // Nothing stops the API returning A→B→A. A walk without a visited set either
    // hangs or duplicates rows; both are worse than an indent being wrong.
    const flat = [department('a', 'b'), department('b', 'a')]

    const rows = departmentRows(flat, flat)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.department.id).sort()).toEqual(['a', 'b'])
  })

  it('ignores a department that claims to be its own parent', () => {
    const flat = [department('self', 'self')]

    expect(shape(departmentRows(flat, flat))).toEqual(['self@0'])
  })

  it('returns every visible row and no others', () => {
    const flat = [department('a'), department('b', 'a'), department('c')]

    expect(shape(departmentRows([flat[0], flat[2]], flat))).toEqual(['a@0', 'c@0'])
  })

  it('defaults the structure to the visible rows', () => {
    const flat = [department('a'), department('b', 'a')]

    expect(shape(departmentRows(flat))).toEqual(['a@0', 'b@1'])
  })
})
