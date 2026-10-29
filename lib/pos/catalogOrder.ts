export type CatalogSaleLine = {
  type?: string;
  itemName?: string;
  branchId?: string;
  qty?: number;
  productId?: string;
  itemId?: string;
  lines?: CatalogSaleLine[];
};

export type CatalogProductRef = {
  id: string;
  name: string;
  branchId: string;
  stock: number;
};

const productLines = (sales: readonly CatalogSaleLine[]): CatalogSaleLine[] => (
  sales.flatMap((sale) => (Array.isArray(sale.lines) && sale.lines.length > 0 ? sale.lines : [sale]))
);

const lineProductId = (line: CatalogSaleLine) => {
  if (typeof line.productId === 'string' && line.productId) return line.productId;
  if (typeof line.itemId === 'string' && line.itemId) return line.itemId;
  return '';
};

/** Net units sold for each product. Returns reduce the count because their quantities are negative. */
export const unitsSoldByProduct = (
  products: readonly { id: string; name: string; branchId: string }[],
  sales: readonly CatalogSaleLine[],
) => {
  const known = new Set(products.map((product) => product.id));
  const counts = new Map<string, number>();
  for (const line of productLines(sales)) {
    if (line.type !== 'product') continue;
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const explicitId = lineProductId(line);
    const matches = explicitId
      ? (known.has(explicitId) ? [explicitId] : [])
      : products
        .filter((product) => product.branchId === line.branchId && product.name === line.itemName)
        .map((product) => product.id);
    for (const productId of matches) {
      counts.set(productId, (counts.get(productId) || 0) + qty);
    }
  }
  return counts;
};

/** In-stock products first, most units sold inside that group, then name. Out of stock stays last. */
export const compareRegisterCatalog = <T extends CatalogProductRef>(sold: ReadonlyMap<string, number>) => (
  (a: T, b: T) => {
    const availability = Number(a.stock <= 0) - Number(b.stock <= 0);
    if (availability !== 0) return availability;
    const soldDelta = (sold.get(b.id) || 0) - (sold.get(a.id) || 0);
    if (soldDelta !== 0) return soldDelta;
    return a.name.localeCompare(b.name);
  }
);
