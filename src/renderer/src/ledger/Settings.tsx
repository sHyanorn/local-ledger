import { useState } from 'react'
import type { Category } from '../../../shared/ledger'
import { ChangePassword } from '../screens/ChangePassword'
import { BackupDialog } from './BackupDialog'
import { CategoryDialog } from './CategoryDialog'
import { GeneralSection } from './GeneralSection'
import { ImportHistory } from './ImportHistory'
import { RulesSection } from './RulesSection'
import { categoryTree, useLedger } from './store'

type Editing = { category?: Category; parentId?: number | null } | null

export function Settings() {
  const categories = useLedger((store) => store.categories)
  const [editing, setEditing] = useState<Editing>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [backedUp, setBackedUp] = useState(false)

  if (changingPassword) {
    return <ChangePassword onCancel={() => setChangingPassword(false)} />
  }

  // A top-level category counts its subcategories' transactions too, as
  // filtering by it does.
  const row = (category: Category, transactions: number, child = false) => (
    <li key={category.id} className={child ? 'child' : undefined}>
      <button
        type="button"
        className="list-item"
        onClick={() => setEditing({ category })}
      >
        <span className="name">{category.name}</span>
        <span className="muted">{transactions.toLocaleString('en-AU')}</span>
      </button>
    </li>
  )

  return (
    <div className="content">
      <header className="toolbar">
        <h1>Settings</h1>
      </header>
      <div className="scroll">
        <div className="settings">
          <GeneralSection />
          <section aria-labelledby="categories-heading">
            <div className="section-heading">
              <h2 id="categories-heading">Categories</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing({})}
              >
                Add Category…
              </button>
            </div>
            <ul className="list">
              {categoryTree(categories).flatMap(({ category, children }) => [
                row(
                  category,
                  children.reduce(
                    (sum, child) => sum + child.transactionCount,
                    category.transactionCount,
                  ),
                ),
                ...children.map((child) =>
                  row(child, child.transactionCount, true),
                ),
              ])}
            </ul>
          </section>
          <RulesSection />
          <ImportHistory />
          <section aria-labelledby="security-heading">
            <h2 id="security-heading">Security</h2>
            <div className="actions start">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setBackedUp(false)
                  setBackingUp(true)
                }}
              >
                Back Up…
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setChangingPassword(true)}
              >
                Change Master Password…
              </button>
            </div>
            <p className="muted" role="status">
              {backedUp ? 'Backup saved.' : ''}
            </p>
          </section>
        </div>
      </div>
      {backingUp && (
        <BackupDialog
          onDone={(saved) => {
            setBackingUp(false)
            setBackedUp(saved)
          }}
        />
      )}
      {editing && (
        <CategoryDialog {...editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
