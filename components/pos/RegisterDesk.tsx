'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reorderLevel } from '../../lib/pos/books';
import { compareRegisterCatalog, unitsSoldByProduct, type CatalogSaleLine } from '../../lib/pos/catalogOrder';
import type { CartDiscount, CashSession, Customer, PaymentMethod, Settlement, Tender } from '../../lib/pos/retail';
import { PAYMENT_METHOD_LABELS } from '../../lib/pos/retail';

export const REGISTER_PAGE_SIZE = 16;

export type RegisterProduct = {
  id: string;
  name: string;
  branchId: string;
  stock: number;
  salePrice: number;
  sku?: string;
  barcode?: string;
  category?: string;
  image?: string;
  reorderPoint?: number;
};

export type RegisterService = {
  id: string;
  name: string;
  branchId: string;
  salePrice: number;
};

export type RegisterCartItem = {
  itemId: string;
  itemType: 'product' | 'service';
  itemName: string;
  qty: number;
  unitPrice: number;
  branchId: string;
  maxQty?: number;
  discountMode?: 'none' | 'price' | 'percent';
  discountedUnitPrice?: number;
  discountPercent?: number;
};

export type HeldTicketView = {
  id: string;
  label: string;
  createdAt: string;
  itemCount: number;
  totalLabel: string;
};

type PaymentDraft = {
  split: boolean;
  method: PaymentMethod;
  secondMethod: PaymentMethod;
  cashTendered: string;
  secondAmount: string;
  reference: string;
};

const emptyPayment = (total: number): PaymentDraft => ({
  split: false,
  method: 'cash',
  secondMethod: 'mobile_money',
  cashTendered: String(total),
  secondAmount: '',
  reference: '',
});

export default function RegisterDesk({
  products,
  services,
  sales,
  cart,
  customers,
  heldTickets,
  branchNames,
  settlement,
  cartDiscount,
  taxLabel,
  customerName,
  customerPhone,
  cashSession,
  sessionExpected,
  suggestedFloat,
  showMargin,
  formatMoney,
  onAddProduct,
  onAddService,
  onChangeQty,
  onDiscountMode,
  onDiscountValue,
  onRemove,
  onCartDiscount,
  onCustomer,
  onSelectCustomer,
  onHold,
  onRecall,
  onOpenDrawer,
  onCloseDrawer,
  onClear,
  onPay,
  onCreateProduct,
}: {
  products: RegisterProduct[];
  services: RegisterService[];
  sales: CatalogSaleLine[];
  cart: RegisterCartItem[];
  customers: Customer[];
  heldTickets: HeldTicketView[];
  branchNames: Record<string, string>;
  settlement: Settlement;
  cartDiscount: CartDiscount;
  taxLabel: string;
  customerName: string;
  customerPhone: string;
  cashSession: CashSession | null;
  sessionExpected: number;
  suggestedFloat: number;
  showMargin: boolean;
  formatMoney: (value: number) => string;
  onAddProduct: (productId: string) => void;
  onAddService: (serviceId: string) => void;
  onChangeQty: (itemId: string, itemType: 'product' | 'service', qty: number) => void;
  onDiscountMode: (itemId: string, itemType: 'product' | 'service', mode: 'none' | 'price' | 'percent') => void;
  onDiscountValue: (itemId: string, itemType: 'product' | 'service', value: number) => void;
  onRemove: (itemId: string, itemType: 'product' | 'service') => void;
  onCartDiscount: (discount: CartDiscount) => void;
  onCustomer: (patch: { customerName?: string; customerPhone?: string }) => void;
  onSelectCustomer: (customer: Customer) => void;
  onHold: () => void;
  onRecall: (ticketId: string) => void;
  onOpenDrawer: (openingFloat: number) => void;
  onCloseDrawer: (countedCash: number, note: string) => void;
  onClear: () => void;
  onPay: (tenders: Tender[]) => boolean;
  onCreateProduct: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryStripRef = useRef<HTMLDivElement>(null);
  const paymentRef = useRef<HTMLDivElement>(null);
  const payLock = useRef(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [catalogPage, setCatalogPage] = useState(1);
  const [notice, setNotice] = useState<{ message: string; tone: 'ok' | 'warn' } | null>(null);
  const [addedId, setAddedId] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentDraft>(emptyPayment(0));
  const [drawerMode, setDrawerMode] = useState<'open' | 'close' | null>(null);
  const [floatAmount, setFloatAmount] = useState('0');
  const [countedCash, setCountedCash] = useState('');
  const [drawerNote, setDrawerNote] = useState('');
  const [pendingPay, setPendingPay] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);

  const categories = useMemo(() => {
    const names = new Set(products.map((product) => product.category?.trim()).filter((value): value is string => Boolean(value)));
    return ['All', ...Array.from(names).sort((a, b) => a.localeCompare(b)), ...(services.length > 0 ? ['Services'] : [])];
  }, [products, services]);
  const [categoryEnds, setCategoryEnds] = useState({ left: false, right: false });

  const measureCategories = useCallback(() => {
    const strip = categoryStripRef.current;
    if (!strip) return;
    const max = strip.scrollWidth - strip.clientWidth;
    const left = strip.scrollLeft > 1;
    const right = max - strip.scrollLeft > 1;
    setCategoryEnds((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);

  const revealCategory = useCallback((name: string) => {
    const strip = categoryStripRef.current;
    if (!strip) return;
    const button = strip.querySelector<HTMLButtonElement>(`[data-category="${CSS.escape(name)}"]`);
    if (!button) return;
    const pad = 28;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    const viewLeft = strip.scrollLeft + pad;
    const viewRight = strip.scrollLeft + strip.clientWidth - pad;
    let next = strip.scrollLeft;
    if (left < viewLeft) next = Math.max(0, left - pad);
    else if (right > viewRight) next = right - strip.clientWidth + pad;
    if (Math.abs(next - strip.scrollLeft) < 2) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    strip.scrollTo({ left: next, behavior });
  }, []);

  const nudgeCategories = (direction: -1 | 1) => {
    const strip = categoryStripRef.current;
    if (!strip) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    strip.scrollBy({ left: direction * Math.max(140, Math.round(strip.clientWidth * 0.72)), behavior });
  };

  const soldCounts = useMemo(() => unitsSoldByProduct(products, sales), [products, sales]);

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((product) => category === 'All' || category === product.category || (category !== 'Services' && !product.category && category === 'Uncategorized'))
      .filter(() => category !== 'Services')
      .filter((product) => !needle || [product.name, product.sku, product.barcode, product.category].some((value) => value?.toLowerCase().includes(needle)))
      .sort(compareRegisterCatalog(soldCounts));
  }, [category, products, query, soldCounts]);

  const visibleServices = useMemo(() => {
    if (category !== 'All' && category !== 'Services') return [];
    const needle = query.trim().toLowerCase();
    return services.filter((service) => !needle || service.name.toLowerCase().includes(needle));
  }, [category, query, services]);

  const registerPageSize = REGISTER_PAGE_SIZE;
  const catalogPages = Math.max(1, Math.ceil(visibleProducts.length / registerPageSize));
  const catalogPageSafe = Math.min(catalogPage, catalogPages);
  const pageStart = (catalogPageSafe - 1) * registerPageSize;
  const pageProducts = visibleProducts.slice(pageStart, pageStart + registerPageSize);
  const showServices = catalogPageSafe === catalogPages;

  useEffect(() => {
    setCatalogPage(1);
  }, [category, query]);

  useEffect(() => {
    const strip = categoryStripRef.current;
    if (!strip) return;
    measureCategories();
    revealCategory(category);
    const selected = strip.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (selected && strip.contains(document.activeElement) && document.activeElement !== selected) {
      selected.focus({ preventScroll: true });
    }
    const onScroll = () => measureCategories();
    strip.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const observer = new ResizeObserver(onScroll);
    observer.observe(strip);
    return () => {
      strip.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer.disconnect();
    };
  }, [categories, category, measureCategories, revealCategory]);

  useEffect(() => {
    if (catalogPage > catalogPages) setCatalogPage(catalogPages);
  }, [catalogPage, catalogPages]);

  const customerMatches = useMemo(() => {
    const needle = customerName.trim().toLowerCase();
    if (needle.length < 1) return customers.slice(0, 5);
    return customers.filter((customer) => customer.name.toLowerCase().includes(needle) || customer.phone?.includes(needle)).slice(0, 6);
  }, [customerName, customers]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!paymentOpen && !drawerMode && !heldOpen) return;
    if (paymentOpen) paymentRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (paymentOpen) setPaymentOpen(false);
      else if (drawerMode) { setDrawerMode(null); setPendingPay(false); }
      else setHeldOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paymentOpen, drawerMode, heldOpen]);

  useEffect(() => {
    if (pendingPay && cashSession) {
      setPayment(emptyPayment(settlement.total));
      setPaymentOpen(true);
      setPendingPay(false);
      setDrawerMode(null);
    }
  }, [cashSession, pendingPay, settlement.total]);

  const showNotice = (message: string, tone: 'ok' | 'warn' = 'ok') => {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice((current) => (current?.message === message ? null : current)), tone === 'ok' ? 1400 : 2400);
  };

  const confirmAdd = (id: string, name: string) => {
    setAddedId(id);
    showNotice(`Added ${name}`);
    window.setTimeout(() => setAddedId((current) => (current === id ? '' : current)), 420);
  };

  const searchKeyDown = (key: string) => {
    if (key !== 'Enter') return;
    const scanned = query.trim().toLowerCase();
    if (!scanned) return;
    const matches = products.filter((product) => product.stock > 0 && [product.sku, product.barcode].some((identifier) => identifier?.trim().toLowerCase() === scanned));
    if (matches.length === 1) {
      onAddProduct(matches[0].id);
      confirmAdd(matches[0].id, matches[0].name);
      setQuery('');
      return;
    }
    if (matches.length > 1) showNotice('More than one product uses this code.', 'warn');
  };

  const openPay = () => {
    if (cart.length === 0 || settlement.total < 0) return;
    if (!cashSession) {
      setFloatAmount(String(suggestedFloat || 0));
      setPendingPay(true);
      setDrawerMode('open');
      return;
    }
    setPayment(emptyPayment(settlement.total));
    setPaymentOpen(true);
  };

  const cashNumbers = ['1000', '2000', '5000', '10000', '20000', '50000'];
  const total = settlement.total;
  const marginAfterTax = total - settlement.tax - settlement.lines.reduce((sum, line) => sum + line.cost, 0);
  const secondValue = Number(payment.secondAmount);
  const primaryAmount = payment.split ? total - (Number.isFinite(secondValue) ? Math.round(secondValue) : 0) : total;
  const cashTendered = Math.round(Number(payment.cashTendered) || 0);
  const cashIsPrimary = payment.method === 'cash';
  const primaryCovers = payment.method === 'cash' ? cashTendered >= primaryAmount && primaryAmount >= 0 : primaryAmount >= 0;
  const splitValid = !payment.split || (secondValue > 0 && primaryAmount > 0 && primaryAmount + Math.round(secondValue) === total);
  const needsCustomer = payment.method === 'on_account' || (payment.split && payment.secondMethod === 'on_account');
  const canCharge = cart.length > 0 && primaryAmount >= 0 && primaryCovers && splitValid && (!needsCustomer || customerName.trim().length > 0);

  const buildTenders = (): Tender[] | null => {
    if (!canCharge) return null;
    const reference = payment.reference.trim();
    const primary: Tender = {
      method: payment.method,
      amount: primaryAmount,
      ...(reference && payment.method !== 'cash' ? { reference } : {}),
      ...(payment.method === 'cash' ? { tendered: cashTendered, change: cashTendered - primaryAmount } : {}),
    };
    if (!payment.split) return [primary];
    return [primary, {
      method: payment.secondMethod,
      amount: Math.round(secondValue),
      ...(reference && payment.secondMethod !== 'cash' ? { reference } : {}),
    }];
  };

  return (
    <section className="pos-register">
      <div className="pos-catalog">
        <div className="pos-toolbar">
          <label className="pos-search">
            <span>Scan or search</span>
            <input
              ref={searchRef}
              value={query}
              autoFocus
              placeholder="Barcode, SKU, or product name"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => searchKeyDown(event.key)}
            />
          </label>
          <div className="pos-session">
            {cashSession ? (
              <>
                <strong>Drawer open</strong>
                <span>Float {formatMoney(cashSession.openingFloat)}</span>
                <span>Expected {formatMoney(sessionExpected)}</span>
                <button type="button" className="edit-btn" onClick={() => { setCountedCash(String(sessionExpected)); setDrawerNote(''); setDrawerMode('close'); }}>Close drawer</button>
              </>
            ) : (
              <>
                <strong>Drawer closed</strong>
                <button type="button" className="edit-btn" onClick={() => { setFloatAmount(String(suggestedFloat || 0)); setPendingPay(false); setDrawerMode('open'); }}>Open drawer</button>
              </>
            )}
          </div>
        </div>
        <div className={`pos-category-rail${categoryEnds.left ? ' can-left' : ''}${categoryEnds.right ? ' can-right' : ''}`}>
          <button type="button" className="pos-category-nav is-prev" aria-label="Previous categories" hidden={!categoryEnds.left && !categoryEnds.right} disabled={!categoryEnds.left} onClick={() => nudgeCategories(-1)}>
            <CategoryChevron direction="left" />
          </button>
          <div
            className="pos-categories"
            ref={categoryStripRef}
            role="tablist"
            aria-label="Product categories"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              const index = categories.indexOf(category);
              const next = categories[index + (event.key === 'ArrowRight' ? 1 : -1)];
              if (!next) return;
              event.preventDefault();
              setCategory(next);
            }}
          >
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                data-category={item}
                aria-selected={item === category}
                tabIndex={item === category ? 0 : -1}
                className={item === category ? 'active' : ''}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <button type="button" className="pos-category-nav is-next" aria-label="Next categories" hidden={!categoryEnds.left && !categoryEnds.right} disabled={!categoryEnds.right} onClick={() => nudgeCategories(1)}>
            <CategoryChevron direction="right" />
          </button>
        </div>
        {notice && <div className={`pos-inline-notice${notice.tone === 'warn' ? ' is-warn' : ''}`} role="status">{notice.message}</div>}
        <div className="pos-grid">
          {pageProducts.map((product, index) => {
            const out = product.stock <= 0;
            const low = product.stock > 0 && product.stock < reorderLevel(product);
            const onTicket = cart.find((item) => item.itemType === 'product' && item.itemId === product.id)?.qty || 0;
            return (
              <button key={product.id} type="button" className={`pos-tile ${out ? 'is-out' : ''} ${onTicket ? 'is-in-cart' : ''} ${addedId === product.id ? 'is-just-added' : ''}`} style={{ '--enter-delay': `${Math.min(index, 15) * 18}ms` } as React.CSSProperties} disabled={out} onClick={() => { onAddProduct(product.id); confirmAdd(product.id, product.name); }}>
                <span className="pos-tile-motion">
                  <span className="pos-photo" aria-hidden="true">
                    {product.image ? <img src={product.image} alt="" /> : <span>{product.name.slice(0, 1).toUpperCase()}</span>}
                    {onTicket > 0 && <em className="pos-photo-qty">{onTicket}</em>}
                    {(out || low) && <em className={`pos-photo-flag${low ? ' is-low' : ''}`}>{out ? 'Out' : 'Low'}</em>}
                  </span>
                  <span className="pos-tile-copy">
                    <span className="pos-tile-name">{product.name}</span>
                    <span className="pos-tile-foot">
                      <strong>{formatMoney(product.salePrice)}</strong>
                      <em className={out ? 'is-out' : low ? 'is-low' : ''}>{out ? 'Out of stock' : low ? `${product.stock} low` : `${product.stock} in stock`}</em>
                    </span>
                    {Object.keys(branchNames).length > 1 && <span className="pos-tile-meta">{branchNames[product.branchId]}</span>}
                  </span>
                </span>
              </button>
            );
          })}
          {showServices && visibleServices.map((service, index) => {
            const onTicket = cart.find((item) => item.itemType === 'service' && item.itemId === service.id)?.qty || 0;
            return (
              <button key={service.id} type="button" className={`pos-tile is-service ${onTicket ? 'is-in-cart' : ''} ${addedId === service.id ? 'is-just-added' : ''}`} style={{ '--enter-delay': `${Math.min(pageProducts.length + index, 15) * 18}ms` } as React.CSSProperties} onClick={() => { onAddService(service.id); confirmAdd(service.id, service.name); }}>
                <span className="pos-tile-motion">
                  <span className="pos-photo" aria-hidden="true">
                    <span>S</span>
                    {onTicket > 0 && <em className="pos-photo-qty">{onTicket}</em>}
                  </span>
                  <span className="pos-tile-copy">
                    <span className="pos-tile-name">{service.name}</span>
                    <span className="pos-tile-meta">Service</span>
                    <span className="pos-tile-foot"><strong>{formatMoney(service.salePrice)}</strong></span>
                  </span>
                </span>
              </button>
            );
          })}
          {visibleProducts.length === 0 && visibleServices.length === 0 && (
            <div className="pos-empty">
              <h3>{products.length === 0 ? 'No products yet' : 'Nothing matches'}</h3>
              <p>{products.length === 0 ? 'Add a product with a price and opening stock, then sell it from this register.' : 'Try another category, name, SKU, or barcode.'}</p>
              {products.length === 0 && <button type="button" className="primary" onClick={onCreateProduct}>Add a product</button>}
            </div>
          )}
        </div>
        {visibleProducts.length > 0 && (
          <div className="pos-pager">
            <span>Showing {pageStart + 1}–{Math.min(pageStart + registerPageSize, visibleProducts.length)} of {visibleProducts.length}</span>
            <div className="pager-actions">
              <button type="button" className="edit-btn" disabled={catalogPageSafe <= 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}>Previous</button>
              <span>Page {catalogPageSafe} / {catalogPages}</span>
              <button type="button" className="edit-btn" disabled={catalogPageSafe >= catalogPages} onClick={() => setCatalogPage((page) => page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      <aside className="pos-ticket" aria-label="Current sale">
        <header className="pos-ticket-head">
          <div>
            <p>Current sale</p>
            <h2>{cart.length === 0 ? 'Nothing yet' : `${cart.length} item${cart.length === 1 ? '' : 's'}`}</h2>
          </div>
          <button type="button" className="edit-btn" onClick={() => setHeldOpen(true)}>Held ({heldTickets.length})</button>
        </header>

        <div className="pos-customer">
          <label>
            Customer
            <input
              value={customerName}
              placeholder="Walk-in customer"
              onFocus={() => setCustomerOpen(true)}
              onBlur={() => window.setTimeout(() => setCustomerOpen(false), 120)}
              onChange={(event) => { onCustomer({ customerName: event.target.value }); setCustomerOpen(true); }}
            />
          </label>
          <label>
            Phone
            <input value={customerPhone} inputMode="tel" placeholder="Optional" onChange={(event) => onCustomer({ customerPhone: event.target.value })} />
          </label>
          {customerOpen && customerMatches.length > 0 && (
            <div className="pos-customer-menu">
              {customerMatches.map((customer) => (
                <button key={customer.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelectCustomer(customer); setCustomerOpen(false); }}>
                  <strong>{customer.name}</strong>
                  <span>{customer.phone || 'No phone'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pos-lines">
          {cart.length === 0 ? (
            <div className="pos-ticket-empty">
              <h3>Empty ticket</h3>
              <p>Scan a barcode or tap a product. This ticket stays here until you hold it, clear it, or take payment.</p>
            </div>
          ) : cart.map((item) => {
            const lineImage = item.itemType === 'product' ? products.find((product) => product.id === item.itemId)?.image : undefined;
            return (
            <article key={`${item.itemType}-${item.itemId}`} className="pos-line">
              <div className="pos-line-top">
                <span className="pos-line-thumb" aria-hidden="true">
                  {lineImage ? <img src={lineImage} alt="" /> : <span>{item.itemType === 'service' ? 'S' : item.itemName.slice(0, 1).toUpperCase()}</span>}
                </span>
                <div>
                  <strong>{item.itemName}</strong>
                  <span>{item.itemType === 'service' ? 'Service' : branchNames[item.branchId] || 'Product'}</span>
                </div>
                <button type="button" className="delete-btn" onClick={() => onRemove(item.itemId, item.itemType)}>Remove</button>
              </div>
              <div className="pos-line-controls">
                <div className="pos-stepper">
                  <button type="button" onClick={() => onChangeQty(item.itemId, item.itemType, item.qty - 1)} aria-label={`Decrease ${item.itemName}`}>−</button>
                  <input aria-label={`${item.itemName} quantity`} type="number" min={1} step="1" value={item.qty} onChange={(event) => onChangeQty(item.itemId, item.itemType, Number(event.target.value))} />
                  <button type="button" onClick={() => onChangeQty(item.itemId, item.itemType, item.qty + 1)} aria-label={`Increase ${item.itemName}`}>+</button>
                </div>
                <strong>{formatMoney((settlement.lines.find((line) => line.key === `${item.itemType}:${item.itemId}`)?.amount) || 0)}</strong>
              </div>
              <div className="pos-line-discount">
                {(item.discountMode || 'none') === 'none' ? (
                  <button type="button" className="edit-btn" onClick={() => onDiscountMode(item.itemId, item.itemType, 'percent')}>Discount</button>
                ) : (
                  <>
                    <select value={item.discountMode || 'none'} aria-label={`${item.itemName} discount`} onChange={(event) => onDiscountMode(item.itemId, item.itemType, event.target.value as 'none' | 'price' | 'percent')}>
                      <option value="none">List {formatMoney(item.unitPrice)}</option>
                      <option value="price">Special price</option>
                      <option value="percent">Percent off</option>
                    </select>
                    {item.discountMode === 'price' && (
                      <input type="number" min={0} max={item.unitPrice} value={item.discountedUnitPrice ?? item.unitPrice} onChange={(event) => onDiscountValue(item.itemId, item.itemType, Number(event.target.value))} />
                    )}
                    {item.discountMode === 'percent' && (
                      <input type="number" min={0} max={100} value={item.discountPercent ?? 0} onChange={(event) => onDiscountValue(item.itemId, item.itemType, Number(event.target.value))} />
                    )}
                  </>
                )}
              </div>
            </article>
            );
          })}
        </div>

        <footer className="pos-ticket-foot">
          <div className="pos-cart-discount">
            {cartDiscount.mode === 'none' ? (
              <button type="button" className="edit-btn" onClick={() => onCartDiscount({ mode: 'percent', value: 0 })}>Sale discount</button>
            ) : (
              <>
                <select value={cartDiscount.mode} onChange={(event) => onCartDiscount({ mode: event.target.value as CartDiscount['mode'], value: cartDiscount.value })}>
                  <option value="none">No sale discount</option>
                  <option value="amount">Amount off</option>
                  <option value="percent">Percent off</option>
                </select>
                <input type="number" min={0} max={cartDiscount.mode === 'percent' ? 100 : undefined} value={cartDiscount.value} onChange={(event) => onCartDiscount({ ...cartDiscount, value: Number(event.target.value) })} />
              </>
            )}
          </div>
          <div className="pos-total-row"><span>Subtotal</span><span>{formatMoney(settlement.subtotal)}</span></div>
          {settlement.discount > 0 && <div className="pos-total-row"><span>Discount</span><span>− {formatMoney(settlement.discount)}</span></div>}
          <div className="pos-total-row"><span>{taxLabel}</span><span>{formatMoney(settlement.tax)}</span></div>
          {showMargin && <div className={`pos-total-row is-muted${marginAfterTax < 0 ? ' is-negative' : ''}`}><span>Margin after tax</span><span>{formatMoney(marginAfterTax)}</span></div>}
          <div className="pos-total-row is-due"><span>Total due</span><strong>{formatMoney(settlement.total)}</strong></div>
          <div className="pos-actions">
            <button type="button" className="edit-btn" disabled={cart.length === 0} onClick={onClear}>Clear</button>
            <button type="button" className="edit-btn" disabled={cart.length === 0} onClick={onHold}>Hold</button>
            <button type="button" className="primary pos-pay" disabled={cart.length === 0} onClick={openPay}>Pay {formatMoney(settlement.total)}</button>
          </div>
        </footer>
      </aside>

      <div className={`pos-sale-bar${cart.length === 0 ? ' is-empty' : ''}`}>
        <button
          type="button"
          className="pos-sale-jump"
          onClick={() => {
            const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
            document.querySelector('.pos-ticket')?.scrollIntoView({ behavior, block: 'start' });
          }}
        >
          <span>{cart.length === 0 ? 'Nothing yet' : `${cart.length} item${cart.length === 1 ? '' : 's'}`}</span>
          <strong>{formatMoney(settlement.total)}</strong>
        </button>
        <button type="button" className="primary pos-pay" disabled={cart.length === 0} onClick={openPay}>Pay</button>
      </div>

      {paymentOpen && (
        <div className="pos-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentOpen(false); }}>
          <div className="pos-sheet" role="dialog" aria-modal="true" aria-labelledby="payment-title" tabIndex={-1} ref={paymentRef}>
            <header>
              <div>
                <p>Amount due</p>
                <h3 id="payment-title">{formatMoney(total)}</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => setPaymentOpen(false)} aria-label="Close payment">×</button>
            </header>
            <div className="pos-pay-layout">
            <div className="pos-pay-main">
            <div className="pos-methods">
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
                <button key={method} type="button" className={payment.method === method ? 'active' : ''} aria-pressed={payment.method === method} onClick={() => setPayment((prev) => ({ ...prev, method, cashTendered: method === 'cash' ? String(total) : prev.cashTendered }))}>
                  {payment.method === method && <span className="pos-method-mark" aria-hidden="true">✓</span>}
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>
            <label className="pos-check">
              <input type="checkbox" checked={payment.split} onChange={(event) => setPayment((prev) => ({ ...prev, split: event.target.checked, secondAmount: '', secondMethod: prev.method === 'mobile_money' ? 'card_terminal' : 'mobile_money' }))} />
              Split this payment
            </label>
            {payment.split && (
              <div className="pos-split">
                <label>
                  Second method
                  <select value={payment.secondMethod} onChange={(event) => setPayment((prev) => ({ ...prev, secondMethod: event.target.value as PaymentMethod }))}>
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).filter((method) => method !== payment.method && method !== 'cash').map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
                  </select>
                </label>
                <label>
                  Second amount
                  <input className={payment.secondAmount !== '' && !splitValid ? 'is-invalid' : ''} aria-invalid={payment.secondAmount !== '' && !splitValid} type="number" min={1} max={total - 1} value={payment.secondAmount} onChange={(event) => setPayment((prev) => ({ ...prev, secondAmount: event.target.value }))} />
                  {payment.secondAmount !== '' && !splitValid && <span className="field-error">The two amounts have to add up to {formatMoney(total)}.</span>}
                </label>
                <p>{PAYMENT_METHOD_LABELS[payment.method]} takes {formatMoney(Math.max(0, primaryAmount))}.</p>
              </div>
            )}
            {needsCustomer && (
              <label className="pos-account-customer">
                Customer name
                <input
                  className={customerName.trim() ? '' : 'is-invalid'}
                  value={customerName}
                  aria-invalid={!customerName.trim()}
                  aria-describedby={customerName.trim() ? undefined : 'account-name-error'}
                  placeholder="Who is this account for?"
                  onChange={(event) => onCustomer({ customerName: event.target.value })}
                />
                {!customerName.trim() && <span className="field-error" id="account-name-error">Enter the customer name before putting this sale on account.</span>}
              </label>
            )}
            {cashIsPrimary && (
              <div className={`pos-due-readout${cashTendered >= primaryAmount ? '' : ' is-short'}`}>
                <span>Cash received</span>
                <strong>{formatMoney(cashTendered)}</strong>
                <em>{cashTendered >= primaryAmount ? `Change ${formatMoney(cashTendered - primaryAmount)}` : `Still short ${formatMoney(primaryAmount - cashTendered)}`}</em>
              </div>
            )}
            {payment.method !== 'cash' && (
              <label className="pos-reference">
                Reference (optional, recorded only)
                <input value={payment.reference} maxLength={80} placeholder="Approval or transaction code" onChange={(event) => setPayment((prev) => ({ ...prev, reference: event.target.value }))} />
              </label>
            )}
            <p className="pos-pay-note">Card, mobile money, and bank payments are saved on the sale. AlphaPOS does not charge the customer’s account or card.</p>
            </div>
            {cashIsPrimary && (
              <div className="pos-cashbox">
                <div className="pos-quick-cash">
                  <button type="button" onClick={() => setPayment((prev) => ({ ...prev, cashTendered: String(primaryAmount) }))}>Exact</button>
                  {cashNumbers.map((note) => <button key={note} type="button" onClick={() => setPayment((prev) => ({ ...prev, cashTendered: String(Number(prev.cashTendered || 0) + Number(note)) }))}>{formatMoney(Number(note))}</button>)}
                </div>
                <div className="pos-numpad">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '00', '←'].map((key) => (
                    <button key={key} type="button" aria-label={key === '←' ? 'Delete last digit' : undefined} onClick={() => setPayment((prev) => {
                      if (key === '←') return { ...prev, cashTendered: prev.cashTendered.slice(0, -1) };
                      return { ...prev, cashTendered: `${prev.cashTendered === '0' ? '' : prev.cashTendered}${key}`.slice(0, 9) };
                    })}>{key === '←' ? 'Del' : key}</button>
                  ))}
                </div>
              </div>
            )}
            </div>
            <button type="button" className="primary pos-charge" disabled={!canCharge} onClick={() => {
              if (payLock.current) return;
              const tenders = buildTenders();
              if (!tenders) return;
              payLock.current = true;
              const completed = onPay(tenders);
              payLock.current = false;
              if (completed) setPaymentOpen(false);
            }}>Charge {formatMoney(total)}</button>
          </div>
        </div>
      )}

      {drawerMode && (
        <div className="pos-overlay">
          <form className="pos-sheet pos-sheet-small" onSubmit={(event) => {
            event.preventDefault();
            if (drawerMode === 'open') {
              const opening = Math.max(0, Math.round(Number(floatAmount) || 0));
              onOpenDrawer(opening);
              if (!pendingPay) setDrawerMode(null);
              return;
            }
            onCloseDrawer(Math.max(0, Math.round(Number(countedCash) || 0)), drawerNote);
            setDrawerMode(null);
          }}>
            <header>
              <div>
                <p>{drawerMode === 'open' ? 'Start a shift' : 'Count the drawer'}</p>
                <h3>{drawerMode === 'open' ? 'Open drawer' : 'Close drawer'}</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => { setDrawerMode(null); setPendingPay(false); }} aria-label="Close drawer dialog">×</button>
            </header>
            {drawerMode === 'open' ? (
              <>
                <label>
                  Opening float
                  <input type="number" min={0} value={floatAmount} onChange={(event) => setFloatAmount(event.target.value)} />
                </label>
                {suggestedFloat > 0 && <p className="pos-pay-note">Filled from the last close. Change it if the till is different.</p>}
              </>
            ) : (
              <>
                <div className="pos-close-stats">
                  <span>Opening float</span><strong>{formatMoney(cashSession?.openingFloat || 0)}</strong>
                  <span>Expected in drawer</span><strong>{formatMoney(sessionExpected)}</strong>
                </div>
                <label>
                  Counted cash
                  <input type="number" min={0} value={countedCash} onChange={(event) => setCountedCash(event.target.value)} required />
                </label>
                <label>
                  Note
                  <input value={drawerNote} maxLength={160} onChange={(event) => setDrawerNote(event.target.value)} />
                </label>
                <p className="pos-pay-note">Expected is the opening float, plus cash taken and cash paid onto customer accounts, minus cash refunds and cash expenses on this shift.</p>
              </>
            )}
            <button type="submit" className="primary pos-charge">{drawerMode === 'open' ? 'Open drawer' : 'Close and save'}</button>
          </form>
        </div>
      )}

      {heldOpen && (
        <div className="pos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setHeldOpen(false); }}>
          <div className="pos-sheet pos-sheet-small" role="dialog" aria-modal="true" aria-labelledby="held-title">
            <header>
              <div>
                <p>Parked tickets</p>
                <h3 id="held-title">Held sales</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => setHeldOpen(false)} aria-label="Close held sales">×</button>
            </header>
            {heldTickets.length === 0 ? <p className="pos-pay-note">No sales are on hold.</p> : (
              <div className="pos-held-list">
                {heldTickets.map((ticket) => (
                  <button key={ticket.id} type="button" onClick={() => { onRecall(ticket.id); setHeldOpen(false); }}>
                    <strong>{ticket.label}</strong>
                    <span>{ticket.itemCount} items · {ticket.totalLabel}</span>
                    <em>{new Date(ticket.createdAt).toLocaleTimeString()}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function CategoryChevron({ direction }: { direction: 'left' | 'right' }) {
  const pointsLeft = direction === 'left';
  return (
    <svg width="9" height="14" viewBox="0 0 9 14" aria-hidden="true" focusable="false">
      <path
        d={pointsLeft ? 'M7 1.5 2 7l5 5.5' : 'M2 1.5 7 7l-5 5.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
