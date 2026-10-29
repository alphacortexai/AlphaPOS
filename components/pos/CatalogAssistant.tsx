'use client';

import { useMemo, useRef, useState } from 'react';
import { ORGANISE_PRODUCT_CAP, type OrganiseAssignment } from '../../lib/catalog/organise';
import { catalogCategory, matchCatalogProduct, type CatalogMode, type CatalogReading } from '../../lib/catalog/reading';
import { prepareCatalogPhoto } from '../../lib/catalog/preparePhoto';

type ShelfProduct = { id: string; name: string; branchId: string; category?: string };
type Branch = { id: string; name: string };
type AssistantJob = CatalogMode | 'organise';

export type CatalogCreateRow = {
  name: string;
  stock: number;
  purchasePrice: number;
  salePrice: number;
  category: string;
  branchId: string;
};

export type CatalogPriceRow = { productId: string; purchasePrice: number };

export type CatalogCategoryRow = { productId: string; category: string };

type DraftRow = {
  key: string;
  include: boolean;
  name: string;
  quantity: string;
  purchasePrice: string;
  salePrice: string;
  category: string;
  productId: string;
};

type CategoryDraft = {
  key: string;
  include: boolean;
  productId: string;
  name: string;
  branchId: string;
  current: string;
  category: string;
  custom: boolean;
};

const moneyText = (value: number | null, blank = '') => (value === null ? blank : String(value));

const rowsFromReading = (mode: CatalogMode, reading: CatalogReading, products: ShelfProduct[]): DraftRow[] => (
  reading.lines.map((line, index) => {
    const productId = mode === 'prices' ? matchCatalogProduct(line.name, products) : '';
    const already = mode === 'create' && products.some((product) => product.name.trim().toLowerCase() === line.name.trim().toLowerCase());
    return {
      key: `${index}-${line.name}`,
      include: mode === 'prices' ? Boolean(productId) : !already,
      name: line.name,
      quantity: moneyText(line.quantity),
      purchasePrice: moneyText(line.purchasePrice, '0'),
      salePrice: moneyText(line.salePrice, '0'),
      category: line.category || '',
      productId,
    };
  })
);

const categoryDrafts = (assignments: OrganiseAssignment[], products: ShelfProduct[]): CategoryDraft[] => {
  const byId = new Map(assignments.map((row) => [row.productId, row.category]));
  return products.slice(0, ORGANISE_PRODUCT_CAP).map((product) => {
    const explicit = byId.has(product.id);
    const current = product.category?.trim() || '';
    const category = explicit ? (byId.get(product.id) || '') : current;
    return {
      key: product.id,
      include: explicit && category.toLowerCase() !== current.toLowerCase(),
      productId: product.id,
      name: product.name,
      branchId: product.branchId,
      current,
      category,
      custom: false,
    };
  });
};

const numberOrNull = (value: string) => {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

export default function CatalogAssistant({
  products,
  branches,
  categories,
  onCreate,
  onUpdatePrices,
  onApplyCategories,
  requestReading,
  requestOrganise,
}: {
  products: ShelfProduct[];
  branches: Branch[];
  categories: string[];
  onCreate: (rows: CatalogCreateRow[]) => boolean;
  onUpdatePrices: (rows: CatalogPriceRow[], supplier: string) => boolean;
  onApplyCategories: (rows: CatalogCategoryRow[]) => boolean;
  requestReading: (mode: CatalogMode, photo: { mimeType: string; base64: string }) => Promise<CatalogReading>;
  requestOrganise: () => Promise<OrganiseAssignment[]>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<AssistantJob>('create');
  const [branchId, setBranchId] = useState(branches[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState('');
  const [supplier, setSupplier] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [categoryRows, setCategoryRows] = useState<CategoryDraft[]>([]);

  const mode: CatalogMode = job === 'prices' ? 'prices' : 'create';
  const selectedBranch = branches.some((branch) => branch.id === branchId) ? branchId : (branches[0]?.id || '');
  const categoryChoices = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const add = (value: string) => {
      const name = value.trim().slice(0, 40);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return;
      seen.add(key);
      names.push(name);
    };
    categories.forEach(add);
    categoryRows.forEach((row) => add(row.category));
    return names;
  }, [categories, categoryRows]);

  const switchJob = (next: AssistantJob) => {
    setJob(next);
    setRows([]);
    setCategoryRows([]);
    setNotice('');
    setPreview('');
    setSupplier('');
  };

  const readPhoto = async (file: File | undefined) => {
    if (!file || job === 'organise') return;
    setBusy(true);
    setNotice('');
    setRows([]);
    try {
      const photo = await prepareCatalogPhoto(file);
      setPreview(`data:${photo.mimeType};base64,${photo.base64}`);
      const reading = await requestReading(mode, photo);
      const next = rowsFromReading(mode, reading, products);
      setSupplier(reading.supplier || '');
      setRows(next);
      setNotice(next.length === 0 ? 'Nothing on that photo could be read as a product. Try a closer picture.' : 'Check this list. Nothing is saved until you confirm.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The photo could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const organise = async () => {
    setBusy(true);
    setNotice('');
    setCategoryRows([]);
    try {
      const assignments = await requestOrganise();
      setCategoryRows(categoryDrafts(assignments, products));
      const suggested = assignments.some((row) => row.category);
      setNotice(suggested
        ? 'Check this list. Nothing is saved until you confirm.'
        : 'No category was a clear fit. You can type one, or leave a product as it is. Nothing is saved until you confirm.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Categories could not be suggested.');
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const updateCategoryRow = (key: string, patch: Partial<CategoryDraft>) => {
    setCategoryRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const confirm = () => {
    const included = rows.filter((row) => row.include);
    if (included.length === 0) {
      setNotice('Choose at least one row.');
      return;
    }
    if (mode === 'create' || included.some((row) => !row.productId)) {
      if (!selectedBranch) {
        setNotice('Add a branch before creating products.');
        return;
      }
    }
    const creates: CatalogCreateRow[] = [];
    const prices: CatalogPriceRow[] = [];
    for (const row of included) {
      const purchasePrice = numberOrNull(row.purchasePrice);
      if (purchasePrice === null && row.purchasePrice.trim()) {
        setNotice(`Enter a valid purchase price for ${row.name}.`);
        return;
      }
      if (mode === 'prices' && row.productId) {
        if (purchasePrice === null) {
          setNotice(`Enter the purchase price for ${row.name}.`);
          return;
        }
        prices.push({ productId: row.productId, purchasePrice });
        continue;
      }
      const salePrice = numberOrNull(row.salePrice);
      const quantity = numberOrNull(row.quantity);
      if (!row.name.trim()) {
        setNotice('Every new product needs a name.');
        return;
      }
      if (quantity === null && row.quantity.trim()) {
        setNotice(`Enter a valid quantity for ${row.name}.`);
        return;
      }
      creates.push({
        name: row.name.trim(),
        stock: quantity ?? 0,
        purchasePrice: purchasePrice ?? 0,
        salePrice: salePrice ?? 0,
        category: catalogCategory(row.category),
        branchId: selectedBranch,
      });
    }
    const saved = creates.length > 0 ? onCreate(creates) : true;
    const priced = prices.length > 0 ? onUpdatePrices(prices, supplier) : true;
    if (saved && priced) {
      setRows([]);
      setPreview('');
      setSupplier('');
      setNotice(mode === 'prices' ? 'Purchase prices saved. Stock was left as it is.' : 'Products added.');
    }
  };

  const confirmCategories = () => {
    const included = categoryRows.filter((row) => row.include);
    if (included.length === 0) {
      setNotice('Choose at least one product.');
      return;
    }
    const saved = onApplyCategories(included.map((row) => ({ productId: row.productId, category: row.category })));
    if (saved) {
      setCategoryRows([]);
      setNotice('Categories saved.');
    }
  };

  return (
    <section className="assistant-page">
      <div className="page-tools">
        <p className="muted-copy">Only the shop owner can use this. It adds products, updates purchase prices, or suggests categories. It does not sell anything.</p>
      </div>
      <div className="pane-switch" role="tablist" aria-label="Assistant job">
        <button type="button" className={job === 'create' ? 'active' : ''} onClick={() => switchJob('create')}>New products</button>
        <button type="button" className={job === 'prices' ? 'active' : ''} onClick={() => switchJob('prices')}>Purchase prices</button>
        <button type="button" className={job === 'organise' ? 'active' : ''} onClick={() => switchJob('organise')}>Organise categories</button>
      </div>
      {job === 'organise' ? (
        <>
          <p className="muted-copy assistant-lead">
            Look at the products already on the shelf and suggest a few categories. A category the shop already uses is kept when it fits. Nothing is saved until you confirm. Names, prices, and stock stay as they are.
          </p>
          {products.length > ORGANISE_PRODUCT_CAP && (
            <p className="muted-copy">Only the first {ORGANISE_PRODUCT_CAP} products are included.</p>
          )}
          <div className="assistant-actions">
            <button type="button" className="primary" disabled={busy || products.length === 0} onClick={() => { void organise(); }}>
              {busy ? 'Organising…' : 'Organise categories'}
            </button>
          </div>
          {products.length === 0 && <p className="assistant-note">Add products on the shelf first.</p>}
          {notice && <p className="assistant-note">{notice}</p>}
          {categoryRows.length > 0 && (
            <div className="card assistant-review">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Use</th>
                      <th>Product</th>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryRows.map((row) => {
                      const branchName = branches.length > 1 ? branches.find((branch) => branch.id === row.branchId)?.name : '';
                      const selected = categoryChoices.find((name) => name.toLowerCase() === row.category.trim().toLowerCase()) || '';
                      const isNew = Boolean(row.category.trim()) && !categories.some((name) => name.toLowerCase() === row.category.trim().toLowerCase());
                      return (
                        <tr key={row.key}>
                          <td><input type="checkbox" checked={row.include} aria-label={`Use ${row.name}`} onChange={(event) => updateCategoryRow(row.key, { include: event.target.checked })} /></td>
                          <td>
                            {row.name}
                            <div className="muted-copy">{row.current ? `Now: ${row.current}` : 'No category yet'}{branchName ? ` · ${branchName}` : ''}</div>
                          </td>
                          <td>
                            <div className="assistant-category-edit">
                              <select
                                value={row.custom ? '__type__' : selected}
                                aria-label={`Category for ${row.name}`}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (value === '__type__') updateCategoryRow(row.key, { custom: true });
                                  else updateCategoryRow(row.key, { custom: false, category: value });
                                }}
                              >
                                <option value="">None</option>
                                {categoryChoices.map((name) => <option key={name} value={name}>{name}</option>)}
                                <option value="__type__">Type a new name</option>
                              </select>
                              {row.custom && (
                                <input
                                  value={row.category}
                                  maxLength={40}
                                  placeholder="Category name"
                                  aria-label={`New category for ${row.name}`}
                                  onChange={(event) => updateCategoryRow(row.key, { category: event.target.value.slice(0, 40) })}
                                />
                              )}
                              {isNew && <div className="muted-copy">New category</div>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" className="primary" onClick={confirmCategories}>Save categories</button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted-copy assistant-lead">
            {mode === 'create'
              ? 'Photograph a list of names and quantities, or upload one. A price that is not on the photo stays 0. A missing category stays none.'
              : 'Upload a supplier receipt. Matched products can take the printed purchase price. Stock is not changed.'}
          </p>
          <div className="assistant-actions">
            {preview && <img className="assistant-preview" src={preview} alt="" />}
            <button type="button" className="primary" disabled={busy} onClick={() => cameraRef.current?.click()}>{busy ? 'Reading…' : 'Take photo'}</button>
            <button type="button" className="edit-btn" disabled={busy} onClick={() => uploadRef.current?.click()}>Upload photo</button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void readPhoto(file); }} />
            <input ref={uploadRef} type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void readPhoto(file); }} />
          </div>
          {notice && <p className="assistant-note">{notice}</p>}
          {rows.length > 0 && (
            <div className="card assistant-review">
              {branches.length > 1 && rows.some((row) => !row.productId) && (
                <label className="field">
                  <span>Branch for new products</span>
                  <select value={selectedBranch} onChange={(event) => setBranchId(event.target.value)}>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
              )}
              {supplier && mode === 'prices' && <p className="muted-copy">Supplier on the receipt: {supplier}</p>}
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Use</th>
                      <th>{mode === 'prices' ? 'On the receipt' : 'Product'}</th>
                      {mode === 'prices' && <th>Shelf product</th>}
                      {mode === 'create' && <th>Quantity</th>}
                      <th>Purchase</th>
                      <th>Selling</th>
                      {mode === 'prices' && <th>Quantity</th>}
                      {mode === 'create' && <th>Category</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const existing = mode === 'create' && products.some((product) => product.name.trim().toLowerCase() === row.name.trim().toLowerCase());
                      const adding = mode === 'create' || !row.productId;
                      return (
                        <tr key={row.key}>
                          <td><input type="checkbox" checked={row.include} aria-label={`Use ${row.name}`} onChange={(event) => updateRow(row.key, { include: event.target.checked })} /></td>
                          <td>
                            {mode === 'create' ? (
                              <input value={row.name} aria-label="Product name" onChange={(event) => updateRow(row.key, { name: event.target.value })} />
                            ) : row.name}
                            {existing && <div className="assistant-warn">Already on the shelf</div>}
                          </td>
                          {mode === 'prices' && (
                            <td>
                              <select value={row.productId} aria-label={`Match ${row.name}`} onChange={(event) => updateRow(row.key, { productId: event.target.value })}>
                                <option value="">Add as a new product</option>
                                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                              </select>
                            </td>
                          )}
                          {mode === 'create' && (
                            <td><input type="number" min="0" value={row.quantity} aria-label={`Quantity for ${row.name}`} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} /></td>
                          )}
                          <td><input type="number" min="0" value={row.purchasePrice} aria-label={`Purchase price for ${row.name}`} onChange={(event) => updateRow(row.key, { purchasePrice: event.target.value })} /></td>
                          <td>
                            {adding ? (
                              <input type="number" min="0" value={row.salePrice} aria-label={`Selling price for ${row.name}`} onChange={(event) => updateRow(row.key, { salePrice: event.target.value })} />
                            ) : 'Unchanged'}
                          </td>
                          {mode === 'prices' && (
                            <td>
                              {adding ? (
                                <input type="number" min="0" value={row.quantity} aria-label={`Opening stock for ${row.name}`} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} />
                              ) : 'Stock unchanged'}
                            </td>
                          )}
                          {mode === 'create' && (
                            <td><input value={row.category} placeholder="None" aria-label={`Category for ${row.name}`} onChange={(event) => updateRow(row.key, { category: event.target.value })} /></td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {mode === 'prices' && rows.some((row) => !row.productId) && (
                <p className="muted-copy">A receipt line set to “Add as a new product” can keep a missing price at 0. Its quantity becomes opening stock.</p>
              )}
              <button type="button" className="primary" onClick={confirm}>{mode === 'create' ? 'Add these products' : 'Save purchase prices'}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
