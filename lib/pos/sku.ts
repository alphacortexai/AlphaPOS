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
