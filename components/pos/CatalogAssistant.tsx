'use client';

import { useRef, useState } from 'react';
import { matchCatalogProduct, type CatalogMode, type CatalogReading } from '../../lib/catalog/reading';
import { prepareCatalogPhoto } from '../../lib/catalog/preparePhoto';

type ShelfProduct = { id: string; name: string; branchId: string };
type Branch = { id: string; name: string };

export type CatalogCreateRow = {
  name: string;
  stock: number;
  purchasePrice: number;
  salePrice: number;
  category: string;
  branchId: string;
};

export type CatalogPriceRow = { productId: string; purchasePrice: number };

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

const moneyText = (value: number | null) => (value === null ? '' : String(value));

const rowsFromReading = (mode: CatalogMode, reading: CatalogReading, products: ShelfProduct[]): DraftRow[] => (
  reading.lines.map((line, index) => {
    const productId = mode === 'prices' ? matchCatalogProduct(line.name, products) : '';
    const already = mode === 'create' && products.some((product) => product.name.trim().toLowerCase() === line.name.trim().toLowerCase());
    return {
      key: `${index}-${line.name}`,
      include: mode === 'prices' ? Boolean(productId) : !already,
      name: line.name,
      quantity: moneyText(line.quantity),
      purchasePrice: moneyText(line.purchasePrice),
      salePrice: moneyText(line.salePrice),
      category: line.category || '',
      productId,
    };
  })
);

const numberOrNull = (value: string) => {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

export default function CatalogAssistant({
  products,
  branches,
  onCreate,
  onUpdatePrices,
  requestReading,
}: {
  products: ShelfProduct[];
  branches: Branch[];
  onCreate: (rows: CatalogCreateRow[]) => boolean;
  onUpdatePrices: (rows: CatalogPriceRow[], supplier: string) => boolean;
  requestReading: (mode: CatalogMode, photo: { mimeType: string; base64: string }) => Promise<CatalogReading>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<CatalogMode>('create');
  const [branchId, setBranchId] = useState(branches[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState('');
  const [supplier, setSupplier] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);

  const selectedBranch = branches.some((branch) => branch.id === branchId) ? branchId : (branches[0]?.id || '');

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
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

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
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
      if (salePrice === null) {
        setNotice(`Enter a selling price for ${row.name}. Use 0 only when it is free.`);
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
        salePrice,
        category: row.category.trim(),
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

  return (
    <section className="assistant-page">
      <div className="page-tools">
        <p className="muted-copy">Only the shop owner can use this. It adds products or updates purchase prices. It does not sell anything.</p>
      </div>
      <div className="pane-switch" role="tablist" aria-label="Assistant job">
        <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setRows([]); setNotice(''); }}>New products</button>
        <button type="button" className={mode === 'prices' ? 'active' : ''} onClick={() => { setMode('prices'); setRows([]); setNotice(''); }}>Purchase prices</button>
      </div>
      <p className="muted-copy assistant-lead">
        {mode === 'create'
          ? 'Photograph a list of names and quantities, or upload one. Review the rows, then add them.'
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
                        <td><input value={row.category} aria-label={`Category for ${row.name}`} onChange={(event) => updateRow(row.key, { category: event.target.value })} /></td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mode === 'prices' && rows.some((row) => !row.productId) && (
            <p className="muted-copy">A receipt line set to “Add as a new product” needs a selling price. Its quantity becomes opening stock.</p>
          )}
          <button type="button" className="primary" onClick={confirm}>{mode === 'create' ? 'Add these products' : 'Save purchase prices'}</button>
        </div>
      )}
    </section>
  );
}
