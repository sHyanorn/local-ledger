import { categoryTree, useLedger } from './store'

/** Every category as an <option>, a subcategory written "Parent › Child". */
export function CategoryOptions() {
  const categories = useLedger((store) => store.categories)
  return categoryTree(categories).flatMap(({ category, children }) => [
    <option key={category.id} value={category.id}>
      {category.name}
    </option>,
    ...children.map((child) => (
      <option key={child.id} value={child.id}>
        {`${category.name} › ${child.name}`}
      </option>
    )),
  ])
}
