// Categories nest at most two levels: a top-level category and its
// subcategories.
import type { Created, Outcome } from '../../shared/ipc'
import type { Category, CategoryFields } from '../../shared/ledger'
import type { Db } from '../vault/database'
import { found, orDuplicate } from './errors'

export function listCategories(db: Db): Category[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.parent_id AS parentId,
         count(t.id) AS transactionCount,
         (SELECT count(*) FROM rules r WHERE r.category_id = c.id) AS ruleCount
       FROM categories c LEFT JOIN transactions t ON t.category_id = c.id
       GROUP BY c.id
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all() as Category[]
}

/** Why a category cannot sit under this parent, if it cannot. */
function parentProblem(
  db: Db,
  parentId: number | null,
  id?: number,
): 'not-found' | 'too-deep' | null {
  if (parentId === null) return null
  if (parentId === id) return 'too-deep'
  const parent = db
    .prepare('SELECT parent_id AS parentId FROM categories WHERE id = ?')
    .get(parentId) as { parentId: number | null } | undefined
  if (!parent) return 'not-found'
  if (parent.parentId !== null) return 'too-deep'
  if (id === undefined) return null
  const hasChildren = db
    .prepare('SELECT 1 FROM categories WHERE parent_id = ?')
    .get(id)
  return hasChildren ? 'too-deep' : null
}

export function createCategory(
  db: Db,
  fields: CategoryFields,
): Created<'duplicate' | 'not-found' | 'too-deep'> {
  return db.transaction((): ReturnType<typeof createCategory> => {
    const problem = parentProblem(db, fields.parentId)
    if (problem) return { ok: false, reason: problem }
    return orDuplicate(() => {
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO categories (name, parent_id) VALUES (@name, @parentId)',
        )
        .run(fields)
      return { ok: true, id: Number(lastInsertRowid) }
    })
  })()
}

export function updateCategory(
  db: Db,
  { id, ...fields }: CategoryFields & { id: number },
): Outcome<'duplicate' | 'not-found' | 'too-deep'> {
  return db.transaction((): ReturnType<typeof updateCategory> => {
    const exists = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)
    if (!exists) return { ok: false, reason: 'not-found' }
    const problem = parentProblem(db, fields.parentId, id)
    if (problem) return { ok: false, reason: problem }
    return orDuplicate(() => {
      db.prepare(
        'UPDATE categories SET name = @name, parent_id = @parentId WHERE id = @id',
      ).run({ id, ...fields })
      return { ok: true }
    })
  })()
}

/**
 * Deletes the category with its subcategories. Their transactions become
 * uncategorized, and their budgets and rules go with them.
 */
export function deleteCategory(db: Db, id: number): Outcome<'not-found'> {
  return db.transaction((): ReturnType<typeof deleteCategory> => {
    db.prepare('DELETE FROM categories WHERE parent_id = ?').run(id)
    const { changes } = db
      .prepare('DELETE FROM categories WHERE id = ?')
      .run(id)
    return found(changes)
  })()
}
