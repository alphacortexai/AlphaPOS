import { finiteAmount } from './shopMath';

export type StockFileRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  branch: string;
  category: string;
  variant: string;
  unit: 'piece' | 'kg' | 'litre';
  stock: number;
  cost?: number;
  salePrice?: number;
  wholesalePrice?: number;
  reorderPoint?: number;
  expiry: string;
};

export type ShelfBranch = { id: string; name: string; location: string; createdAt?: string };

export type ShelfProduct = {
  id: string;
  name: string;
  branchId: string;
  stock: number;
  purchasePrice: number;
  salePrice: number;
  sku?: string;
  barcode?: string;
  category?: string;
  variant?: string;
  unit?: 'piece' | 'kg' | 'litre';
  wholesalePrice?: number;
  reorderPoint?: number;
  expiryDate?: string;
};

const HEADERS = [
  'id',
  'name',
  'sku',
  'barcode',
  'branch',
  'category',
  'variant',
  'unit',
  'stock',
  'cost',
  'sale price',
  'wholesale price',
  'reorder point',
  'expiry',
] as const;

const HEADER_ALIASES: Record<string, (typeof HEADERS)[number]> = {
  id: 'id',
  name: 'name',
  product: 'name',
  'product name': 'name',
  item: 'name',
  sku: 'sku',
  code: 'sku',
  'item code': 'sku',
  barcode: 'barcode',
  'bar code': 'barcode',
  branch: 'branch',
  location: 'branch',
  category: 'category',
  variant: 'variant',
  size: 'variant',
  unit: 'unit',
  stock: 'stock',
  qty: 'stock',
  quantity: 'stock',
  'on hand': 'stock',
  cost: 'cost',
  'purchase price': 'cost',
  'buy price': 'cost',
  'sale price': 'sale price',
  'selling price': 'sale price',
  price: 'sale price',
  'wholesale price': 'wholesale price',
  wholesale: 'wholesale price',
  'reorder point': 'reorder point',
  reorder: 'reorder point',
  expiry: 'expiry',
  'expiry date': 'expiry',
  expires: 'expiry',
};

const cell = (value: string | number) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const roundQty = (value: number) => Math.round(value * 1000) / 1000;

const unitOf = (value: string): StockFileRow['unit'] => {
  const text = value.trim().toLowerCase();
  if (text === 'kg' || text === 'kilogram' || text === 'kilograms') return 'kg';
  if (text === 'litre' || text === 'liter' || text === 'litres' || text === 'liters' || text === 'l') return 'litre';
  return 'piece';
};

const codeKey = (value: string) => value.trim().toUpperCase();

/** A spreadsheet another shop system can open: one row per product, with the quantity on hand. */
export const stockFileCsv = (rows: StockFileRow[]) => {
  const lines = [
    HEADERS.join(','),
    ...rows.map((row) => HEADERS.map((header) => {
      if (header === 'sale price') return cell(row.salePrice ?? '');
      if (header === 'wholesale price') return cell(row.wholesalePrice ?? '');
      if (header === 'reorder point') return cell(row.reorderPoint ?? '');
      if (header === 'cost') return cell(row.cost ?? '');
      return cell(row[header]);
    }).join(',')),
  ];
  return `\uFEFF${lines.join('\n')}\n`;
};

const parseGrid = (text: string) => {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = source.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((line) => line.some((entry) => entry.trim()));
};

const headerIndex = (headers: string[]) => {
  const index = new Map<(typeof HEADERS)[number], number>();
  headers.forEach((header, position) => {
    const canonical = HEADER_ALIASES[header.trim().toLowerCase()];
    if (canonical && !index.has(canonical)) index.set(canonical, position);
  });
  return index;
};

const readCell = (row: string[], index: Map<(typeof HEADERS)[number], number>, header: (typeof HEADERS)[number]) => {
  const position = index.get(header);
  return position === undefined ? '' : (row[position] || '').trim();
};

const readAmount = (value: string) => {
  if (!value) return undefined;
  const amount = finiteAmount(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) ? amount : Number.NaN;
};

/** Read a stock spreadsheet. A row with a bad quantity is reported and left out. */
export const parseStockFile = (text: string): { rows: StockFileRow[]; errors: string[] } => {
  const grid = parseGrid(text);
  if (grid.length === 0) return { rows: [], errors: ['The file is empty.'] };
  const columns = headerIndex(grid[0]);
  if (!columns.has('name') || !columns.has('stock')) {
    return { rows: [], errors: ['The file needs a name column and a stock column.'] };
  }
  const rows: StockFileRow[] = [];
  const errors: string[] = [];
  grid.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2;
    const name = readCell(line, columns, 'name');
    if (!name) {
      errors.push(`Row ${lineNumber} has no product name.`);
      return;
    }
    const stock = readAmount(readCell(line, columns, 'stock'));
    if (stock === undefined || !Number.isFinite(stock) || stock < 0) {
      errors.push(`Row ${lineNumber} (${name}) needs a stock quantity of zero or more.`);
      return;
    }
    const cost = readAmount(readCell(line, columns, 'cost'));
    const salePrice = readAmount(readCell(line, columns, 'sale price'));
    const wholesale = readAmount(readCell(line, columns, 'wholesale price'));
    const reorder = readAmount(readCell(line, columns, 'reorder point'));
    if ([cost, salePrice, wholesale, reorder].some((value) => value !== undefined && !Number.isFinite(value))) {
      errors.push(`Row ${lineNumber} (${name}) has a price that is not a number.`);
      return;
    }
    if ((cost !== undefined && cost < 0) || (salePrice !== undefined && salePrice < 0) || (wholesale !== undefined && wholesale < 0)) {
      errors.push(`Row ${lineNumber} (${name}) has a price below zero.`);
      return;
    }
    rows.push({
      id: readCell(line, columns, 'id'),
      name: name.slice(0, 120),
      sku: readCell(line, columns, 'sku').slice(0, 40),
      barcode: readCell(line, columns, 'barcode').slice(0, 40),
      branch: readCell(line, columns, 'branch').slice(0, 80),
      category: readCell(line, columns, 'category').slice(0, 60),
      variant: readCell(line, columns, 'variant').slice(0, 60),
      unit: unitOf(readCell(line, columns, 'unit')),
      stock: roundQty(stock),
      ...(cost !== undefined ? { cost } : {}),
      ...(salePrice !== undefined ? { salePrice } : {}),
      ...(wholesale !== undefined ? { wholesalePrice: wholesale } : {}),
      ...(reorder !== undefined ? { reorderPoint: reorder } : {}),
      expiry: readCell(line, columns, 'expiry').slice(0, 20),
    });
  });
  return { rows, errors };
};

const branchIdFor = (branches: ShelfBranch[], name: string, newId: () => string) => {
  const trimmed = name.trim();
  if (!trimmed) return branches[0]?.id || '';
  const found = branches.find((branch) => branch.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (found) return found.id;
  const id = newId();
  branches.push({ id, name: trimmed, location: '', createdAt: new Date().toISOString() });
  return id;
};

/**
 * Match a row to a product by id, then sku, then barcode, then name on the same branch.
 * A new name is added. Products missing from the file stay on the shelf.
 */
export const applyStockFile = <T extends ShelfProduct>(
  current: T[],
  currentBranches: ShelfBranch[],
  rows: StockFileRow[],
  newId: () => string,
) => {
  const products = current.map((product) => ({ ...product }));
  const branches = currentBranches.map((branch) => ({ ...branch }));
  const byId = new Map(products.map((product, index) => [product.id, index]));
  const bySku = new Map<string, number>();
  const byBarcode = new Map<string, number>();
  const byName = new Map<string, number>();
  const remember = (product: T, index: number) => {
    if (product.sku?.trim()) bySku.set(codeKey(product.sku), index);
    if (product.barcode?.trim()) byBarcode.set(codeKey(product.barcode), index);
    byName.set(`${product.branchId}::${product.name.trim().toLowerCase()}`, index);
  };
  products.forEach(remember);
  let updated = 0;
  let added = 0;
  const stockWrites: { id: string; qty: number }[] = [];
  rows.forEach((row) => {
    let branchId = branchIdFor(branches, row.branch, newId);
    if (!branchId) {
      branchId = newId();
      branches.push({ id: branchId, name: row.branch.trim() || 'Main Branch', location: '', createdAt: new Date().toISOString() });
    }
    const nameKey = `${branchId}::${row.name.trim().toLowerCase()}`;
    const index = [
      row.id ? byId.get(row.id) : undefined,
      row.sku ? bySku.get(codeKey(row.sku)) : undefined,
      row.barcode ? byBarcode.get(codeKey(row.barcode)) : undefined,
      byName.get(nameKey),
    ].find((value) => value !== undefined);
    if (index !== undefined) {
      const product = products[index];
      products[index] = {
        ...product,
        name: row.name,
        branchId,
        stock: row.stock,
        purchasePrice: row.cost === undefined ? product.purchasePrice : row.cost,
        salePrice: row.salePrice === undefined ? product.salePrice : row.salePrice,
        sku: row.sku || product.sku,
        barcode: row.barcode || product.barcode,
        category: row.category || product.category,
        variant: row.variant || product.variant,
        unit: row.unit,
        wholesalePrice: row.wholesalePrice === undefined ? product.wholesalePrice : row.wholesalePrice,
        reorderPoint: row.reorderPoint === undefined ? product.reorderPoint : row.reorderPoint,
        expiryDate: row.expiry || product.expiryDate,
      };
      updated += 1;
      stockWrites.push({ id: product.id, qty: row.stock });
      remember(products[index], index);
      return;
    }
    const id = newId();
    const product = {
      id,
      name: row.name,
      branchId,
      stock: row.stock,
      purchasePrice: row.cost ?? 0,
      salePrice: row.salePrice ?? 0,
      ...(row.sku ? { sku: row.sku } : {}),
      ...(row.barcode ? { barcode: row.barcode } : {}),
      ...(row.category ? { category: row.category } : {}),
      ...(row.variant ? { variant: row.variant } : {}),
      unit: row.unit,
      ...(row.wholesalePrice !== undefined ? { wholesalePrice: row.wholesalePrice } : {}),
      ...(row.reorderPoint !== undefined ? { reorderPoint: row.reorderPoint } : {}),
      ...(row.expiry ? { expiryDate: row.expiry } : {}),
    } as T;
    products.push(product);
    added += 1;
    stockWrites.push({ id, qty: row.stock });
    byId.set(id, products.length - 1);
    remember(product, products.length - 1);
  });
  return { products, branches, updated, added, stockWrites };
};
