export type CatalogCategory = {
  id: string;
  name: string;
  parentId?: string;
};

export const LOW_STOCK_UNITS = 10;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

export const normalizeCategories = (value: unknown): CatalogCategory[] => {
  if (!Array.isArray(value)) return [];
  const rows = value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== 'string' || typeof record.name !== 'string' || !record.name.trim()) return [];
    const parentId = typeof record.parentId === 'string' && record.parentId && record.parentId !== record.id ? record.parentId : '';
    return [{ id: record.id, name: record.name.trim().slice(0, 60), ...(parentId ? { parentId } : {}) }];
  });
  const ids = new Set(rows.map((row) => row.id));
  return rows.map((row) => (row.parentId && ids.has(row.parentId) ? row : { id: row.id, name: row.name }));
};

export const categoryDescendantIds = (categories: CatalogCategory[], id: string) => {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    categories.forEach((category) => {
      if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        grew = true;
      }
    });
  }
  return ids;
};

export const parentWouldCycle = (categories: CatalogCategory[], id: string, parentId: string) => {
  if (!parentId) return false;
  return categoryDescendantIds(categories, id).has(parentId);
};

export const categoryPath = (categories: CatalogCategory[], id: string | undefined) => {
  if (!id) return '';
  const byId = new Map(categories.map((category) => [category.id, category]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ');
};

export const categoryTree = (categories: CatalogCategory[]) => {
  const children = new Map<string, CatalogCategory[]>();
  categories.forEach((category) => {
    const key = category.parentId && categories.some((item) => item.id === category.parentId) ? category.parentId : '';
    children.set(key, [...(children.get(key) || []), category]);
  });
  children.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
  const ordered: { category: CatalogCategory; depth: number; label: string }[] = [];
  const walk = (parentId: string, depth: number) => {
    (children.get(parentId) || []).forEach((category) => {
      ordered.push({ category, depth, label: categoryPath(categories, category.id) });
      walk(category.id, depth + 1);
    });
  };
  walk('', 0);
  return ordered;
};

export const categoryIncludes = (categories: CatalogCategory[], selectedId: string, itemCategoryId?: string) => {
  if (!selectedId || selectedId === 'all') return true;
  if (selectedId === 'none') return !itemCategoryId;
  if (!itemCategoryId) return false;
  return categoryDescendantIds(categories, selectedId).has(itemCategoryId);
};

const skuStem = (name: string) => {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters.slice(0, 4) || 'ITEM').padEnd(3, 'X').slice(0, 4);
};

export const reservedProductCodes = (
  products: { id?: string; sku?: string; barcode?: string }[],
  exceptId = '',
  extra: string[] = [],
) => products.flatMap((product) => (
  exceptId && product.id === exceptId ? [] : [product.sku, product.barcode]
)).concat(extra).flatMap((code) => (code?.trim() ? [code.trim()] : []));

export const nextSku = (name: string, taken: Iterable<string>) => {
  const used = new Set(Array.from(taken, (sku) => sku.trim().toUpperCase()).filter(Boolean));
  const stem = skuStem(name.trim() || 'Item');
  const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let sequence = 0;
  used.forEach((sku) => {
    const match = sku.match(pattern);
    if (match) sequence = Math.max(sequence, Number(match[1]));
  });
  let candidate = '';
  do {
    sequence += 1;
    candidate = `${stem}-${String(sequence).padStart(4, '0')}`;
  } while (used.has(candidate));
  return candidate;
};

export type ProductImportRow = {
  line: number;
  name: string;
  sku: string;
  barcode: string;
  categoryPath: string;
  stock: number;
  purchasePrice: number;
  salePrice: number;
  branchName: string;
};

const splitCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

const headerKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z]/g, '');

export const parseProductCsv = (text: string) => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const errors: string[] = [];
  if (lines.length === 0) return { rows: [] as ProductImportRow[], errors: ['The file is empty.'] };
  const headers = splitCsvLine(lines[0]).map(headerKey);
  const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const nameIndex = indexOf('name', 'product', 'productname');
  if (nameIndex < 0) return { rows: [] as ProductImportRow[], errors: ['The first row needs a name column.'] };
  const column = (cells: string[], ...names: string[]) => {
    const index = indexOf(...names);
    return index >= 0 ? (cells[index] || '').trim() : '';
  };
  const amount = (value: string) => {
    const number = Number(value.replace(/,/g, ''));
    return Number.isFinite(number) ? number : 0;
  };
  const rows: ProductImportRow[] = [];
  lines.slice(1).forEach((line, offset) => {
    const cells = splitCsvLine(line);
    const name = (cells[nameIndex] || '').trim();
    if (!name) {
      errors.push(`Row ${offset + 2} has no product name.`);
      return;
    }
    rows.push({
      line: offset + 2,
      name: name.slice(0, 120),
      sku: column(cells, 'sku').toUpperCase().slice(0, 40),
      barcode: column(cells, 'barcode').slice(0, 40),
      categoryPath: column(cells, 'category', 'categorypath').replace(/\s*[>/]\s*/g, ' / ').slice(0, 180),
      stock: Math.max(0, amount(column(cells, 'stock', 'qty', 'quantity'))),
      purchasePrice: Math.max(0, amount(column(cells, 'purchase', 'purchaseprice', 'cost'))),
      salePrice: Math.max(0, amount(column(cells, 'sale', 'saleprice', 'price'))),
      branchName: column(cells, 'branch').slice(0, 80),
    });
  });
  return { rows, errors };
};

export const ensureCategoryPath = (categories: CatalogCategory[], path: string) => {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean).slice(0, 6);
  let next = categories.slice();
  let parentId = '';
  parts.forEach((part) => {
    const existing = next.find((category) => category.name.toLowerCase() === part.toLowerCase() && (category.parentId || '') === parentId);
    if (existing) {
      parentId = existing.id;
      return;
    }
    const created = { id: crypto.randomUUID(), name: part.slice(0, 60), ...(parentId ? { parentId } : {}) };
    next = [...next, created];
    parentId = created.id;
  });
  return { categories: next, id: parentId };
};

type CatalogItem = { categoryId?: string; category?: string };

export const prepareShopCatalog = <ProductItem extends CatalogItem, ServiceItem extends CatalogItem>(
  rawCategories: unknown,
  products: ProductItem[],
  services: ServiceItem[],
) => {
  let categories = normalizeCategories(rawCategories);
  const legacyNames = [...products, ...services].flatMap((item) => (!item.categoryId && item.category?.trim() ? [item.category.trim()] : []));
  if (categories.length === 0) {
    const seen = new Set<string>();
    legacyNames.forEach((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      categories = [...categories, { id: crypto.randomUUID(), name: name.slice(0, 60) }];
    });
  }
  const byName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id]));
  const withMatch = <Item extends CatalogItem>(item: Item): Item => {
    if (item.categoryId && categories.some((category) => category.id === item.categoryId)) return item;
    const match = item.category ? byName.get(item.category.trim().toLowerCase()) : undefined;
    return match ? { ...item, categoryId: match } : item;
  };
  return {
    categories,
    products: products.map(withMatch),
    services: services.map(withMatch),
  };
};
