import { categoryTree, type CatalogCategory } from '../../lib/pos/catalog';

export default function CategorySelect({
  categories,
  value,
  onChange,
  emptyLabel = 'No category',
  noneLabel,
}: {
  categories: CatalogCategory[];
  value: string;
  onChange: (categoryId: string) => void;
  emptyLabel?: string;
  noneLabel?: string;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      {noneLabel && <option value="none">{noneLabel}</option>}
      {categoryTree(categories).map((item) => (
        <option key={item.category.id} value={item.category.id}>{item.label}</option>
      ))}
    </select>
  );
}
