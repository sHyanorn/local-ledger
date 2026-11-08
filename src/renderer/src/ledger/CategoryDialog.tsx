import { useState } from 'react'
import type { FormEvent } from 'react'
import { Confirm, Dialog } from '../components/Dialog'
import { ErrorText } from '../components/ErrorText'
import { NAME_MAX } from '../../../shared/ledger'
import type { Category } from '../../../shared/ledger'
import { useLedger } from './store'
import { count } from './format'

const PROBLEMS: Record<string, string> = {
  duplicate: 'A category with this name already exists here.',
  'too-deep': 'Subcategories cannot have subcategories of their own.',
  'not-found': 'This category no longer exists.',
  failed: 'The category could not be saved.',
}

/** Creates a category, or with `category`, edits or deletes it. */
export function CategoryDialog({
  category,
  onClose,
}: {
  category?: Category
  onClose: () => void
}) {
  const categories = useLedger((store) => store.categories)
  const refresh = useLedger((store) => store.refresh)
  const [name, setName] = useState(category?.name ?? '')
  const [parentId, setParentId] = useState(category?.parentId ?? null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const children = category
    ? categories.filter((child) => child.parentId === category.id)
    : []
  // Two levels at most: a category with subcategories stays at the top,
  // and only top-level categories can take subcategories.
  const parents = categories.filter(
    (candidate) => candidate.parentId === null && candidate.id !== category?.id,
  )

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setProblem('Enter a name.')
    setBusy(true)
    try {
      const result = category
        ? await window.ledger.categories.update({
            id: category.id,
            name,
            parentId,
          })
        : await window.ledger.categories.create({ name, parentId })
      if (!result.ok) return setProblem(PROBLEMS[result.reason] ?? null)
      await refresh()
      onClose()
    } catch {
      setProblem(PROBLEMS.failed)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!category) return
    try {
      const result = await window.ledger.categories.delete(category.id)
      if (!result.ok) return setProblem(PROBLEMS[result.reason] ?? null)
      await refresh()
      onClose()
    } catch {
      setProblem('The category could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  if (deleting && category) {
    const affected =
      category.transactionCount +
      children.reduce((sum, child) => sum + child.transactionCount, 0)
    const subject =
      children.length > 0
        ? `“${category.name}” and its ${count(children.length, 'subcategory', 'subcategories')}`
        : `“${category.name}”`
    const rules =
      category.ruleCount +
      children.reduce((sum, child) => sum + child.ruleCount, 0)
    const effect = [
      affected > 0 &&
        ` ${count(affected, 'transaction')} will become uncategorized.`,
      rules > 0 && ` ${count(rules, 'rule')} for it will be deleted.`,
    ]
      .filter(Boolean)
      .join('')
    return (
      <Confirm
        title="Delete category?"
        message={`${subject} will be deleted.${effect} This cannot be undone.`}
        action="Delete"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      />
    )
  }

  return (
    <Dialog
      title={category ? 'Edit Category' : 'New Category'}
      onClose={onClose}
    >
      <form className="form" onSubmit={save} noValidate>
        <label>
          Name
          <input
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </label>
        <label>
          Parent
          <select
            value={parentId ?? ''}
            disabled={children.length > 0}
            onChange={(event) =>
              setParentId(
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          >
            <option value="">None</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </select>
        </label>
        <ErrorText message={problem} />
        <div className="actions">
          {category && (
            <button
              type="button"
              className="secondary destructive"
              onClick={() => setDeleting(true)}
            >
              Delete Category…
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {category ? 'Save' : 'Add Category'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
