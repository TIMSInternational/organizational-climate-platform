import type { Department } from '../api/departments'

/**
 * The reporting structure, ordered as a tree.
 *
 * ## Why the list arrives flat and has to be re-shaped here
 *
 * `GET /admin/departments` returns one company's departments as a **flat array
 * ordered by name**, with `parentDepartmentId` as the only link between them.
 * Rendered in that order a child sits wherever the alphabet puts it, so a reader
 * cannot see the shape of the organisation at all — which is the one thing this
 * screen exists to show. The Parent column names a department's parent but does
 * not put it next to it.
 *
 * ## What it guarantees
 *
 * - Roots come first, in the order the server sent them; each root is immediately
 *   followed by its subtree, depth-first. Server order is preserved *within* every
 *   sibling group, so the alphabetical sort the API applies still holds level by
 *   level.
 * - `depth` is the distance from a root, which the table turns into indentation.
 * - Every input row appears **exactly once**. A row whose parent is not in
 *   `structure` is an orphan and is emitted as a root rather than dropped — a
 *   department that vanished from the screen because its parent was archived would
 *   be a far worse failure than one rendered at the wrong indent.
 * - A parent cycle cannot hang the walk or duplicate a row: `emitted` gates every
 *   push, so `A → B → A` yields two rows and terminates.
 *
 * ## Why `visible` and `structure` are two arguments
 *
 * The page filters (search, hide-inactive) but the hierarchy is a property of the
 * *company*, not of the filter. Computing depth from the filtered array alone
 * would re-root a child the moment its parent was typed out of view, so the tree
 * is always built from the full list and the filter only decides which of its rows
 * are emitted. Depth therefore stays stable while you type.
 *
 * That does mean a visible child of a hidden parent keeps its indent with no
 * parent above it. That is deliberate: the indent is telling the truth about the
 * org chart, and the Parent column still names the department that is missing.
 */
export interface DepartmentRow {
  department: Department
  /** Distance from a root. 0 for a root or an orphan. */
  depth: number
}

export function departmentRows(
  visible: readonly Department[],
  structure: readonly Department[] = visible,
): DepartmentRow[] {
  const byId = new Map(structure.map((department) => [department.id, department]))
  const childrenOf = new Map<string, Department[]>()
  const roots: Department[] = []

  for (const department of structure) {
    const parentId = department.parentDepartmentId
    // `byId.has` is what makes an orphan a root: a parent id pointing at a
    // department this company did not send is not a parent anyone can render.
    if (parentId && byId.has(parentId) && parentId !== department.id) {
      const siblings = childrenOf.get(parentId)
      if (siblings) siblings.push(department)
      else childrenOf.set(parentId, [department])
    } else {
      roots.push(department)
    }
  }

  const shown = new Set(visible.map((department) => department.id))
  const emitted = new Set<string>()
  const rows: DepartmentRow[] = []

  // An explicit stack rather than recursion: a hand-edited parent chain can be
  // arbitrarily deep, and a stack overflow on a data shape the server accepts is
  // not a failure mode worth having.
  const stack: DepartmentRow[] = roots
    .slice()
    .reverse()
    .map((department) => ({ department, depth: 0 }))

  while (stack.length > 0) {
    const row = stack.pop()!
    if (emitted.has(row.department.id)) continue
    emitted.add(row.department.id)
    if (shown.has(row.department.id)) rows.push(row)

    const children = childrenOf.get(row.department.id)
    if (!children) continue
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ department: children[index], depth: row.depth + 1 })
    }
  }

  // Anything a cycle kept off the stack still has to be rendered. Emitting it as a
  // root is the same call the orphan case makes, and for the same reason.
  for (const department of structure) {
    if (emitted.has(department.id)) continue
    emitted.add(department.id)
    if (shown.has(department.id)) rows.push({ department, depth: 0 })
  }

  // A row in `visible` that is absent from `structure` altogether: callers that
  // pass only one array never hit this, but a caller passing a stale structure
  // would otherwise lose rows.
  for (const department of visible) {
    if (emitted.has(department.id)) continue
    emitted.add(department.id)
    rows.push({ department, depth: 0 })
  }

  return rows
}
