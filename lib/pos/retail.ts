export type PaymentMethod = 'cash' | 'mobile_money' | 'card_terminal' | 'bank_transfer' | 'on_account' | 'other';

export type TaxSettings = {
  enabled: boolean;
  name: string;
  ratePercent: number;
  pricesIncludeTax: boolean;
};

export type ReceiptSettings = {
  header: string;
  footer: string;
  showTax: boolean;
  phone: string;
  address: string;
};

export type CartDiscount = {
  mode: 'none' | 'amount' | 'percent';
  value: number;
};

export type Tender = {
  method: PaymentMethod;
  amount: number;
  reference?: string;
  tendered?: number;
  change?: number;
};

export type Customer = {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  createdAt: string;
};

export type CashSession = {
  id: string;
  openedAt: string;
  openedByEmail: string;
  openingFloat: number;
  status: 'open' | 'closed';
  closedAt?: string;
  closedByEmail?: string;
  cashTaken?: number;
  expectedCash?: number;
  countedCash?: number;
  variance?: number;
  note?: string;
};

export type PricedLine = {
  key: string;
  unitPrice: number;
  qty: number;
  effectiveUnitPrice: number;
  unitCost: number;
};

export type SettledLine = {
  key: string;
  qty: number;
  amount: number;
  cost: number;
  taxAmount: number;
  discountAmount: number;
  netAmount: number;
};

export type Settlement = {
  lines: SettledLine[];
  listSubtotal: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  card_terminal: 'Card terminal',
  bank_transfer: 'Bank transfer',
  on_account: 'On account',
  other: 'Other',
};

export const defaultTaxSettings: TaxSettings = {
  enabled: false,
  name: 'VAT',
  ratePercent: 18,
  pricesIncludeTax: true,
};

export const defaultReceiptSettings: ReceiptSettings = {
  header: '',
  footer: 'Thank you. Please come again.',
  showTax: true,
  phone: '',
  address: '',
};

export const roundMoney = (value: number) => Math.round(Number.isFinite(value) ? value : 0);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

export const normalizeTaxSettings = (value: unknown): TaxSettings => {
  const record = asRecord(value);
  const rate = Number(record?.ratePercent);
  return {
    enabled: record?.enabled === true,
    name: typeof record?.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 40) : defaultTaxSettings.name,
    ratePercent: Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : defaultTaxSettings.ratePercent,
    pricesIncludeTax: record?.pricesIncludeTax !== false,
  };
};

export const normalizeReceiptSettings = (value: unknown): ReceiptSettings => {
  const record = asRecord(value);
  return {
    header: typeof record?.header === 'string' ? record.header.slice(0, 180) : '',
    footer: typeof record?.footer === 'string' ? record.footer.slice(0, 180) : defaultReceiptSettings.footer,
    showTax: record?.showTax !== false,
    phone: typeof record?.phone === 'string' ? record.phone.slice(0, 40) : '',
    address: typeof record?.address === 'string' ? record.address.slice(0, 180) : '',
  };
};

export const normalizeCustomers = (value: unknown): Customer[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== 'string' || typeof record.name !== 'string' || !record.name.trim()) return [];
    return [{
      id: record.id,
      name: record.name.trim().slice(0, 100),
      ...(typeof record.phone === 'string' && record.phone.trim() ? { phone: record.phone.trim().slice(0, 40) } : {}),
      ...(typeof record.notes === 'string' && record.notes.trim() ? { notes: record.notes.trim().slice(0, 240) } : {}),
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    }];
  });
};

export const normalizeCashSessions = (value: unknown): CashSession[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== 'string') return [];
    const openingFloat = Number(record.openingFloat);
    return [{
      id: record.id,
      openedAt: typeof record.openedAt === 'string' ? record.openedAt : new Date().toISOString(),
      openedByEmail: typeof record.openedByEmail === 'string' ? record.openedByEmail : 'unknown',
      openingFloat: Number.isFinite(openingFloat) ? Math.max(0, roundMoney(openingFloat)) : 0,
      status: record.status === 'closed' ? 'closed' : 'open',
      ...(typeof record.closedAt === 'string' ? { closedAt: record.closedAt } : {}),
      ...(typeof record.closedByEmail === 'string' ? { closedByEmail: record.closedByEmail } : {}),
      ...(Number.isFinite(Number(record.cashTaken)) ? { cashTaken: roundMoney(Number(record.cashTaken)) } : {}),
      ...(Number.isFinite(Number(record.expectedCash)) ? { expectedCash: roundMoney(Number(record.expectedCash)) } : {}),
      ...(Number.isFinite(Number(record.countedCash)) ? { countedCash: roundMoney(Number(record.countedCash)) } : {}),
      ...(Number.isFinite(Number(record.variance)) ? { variance: roundMoney(Number(record.variance)) } : {}),
      ...(typeof record.note === 'string' && record.note.trim() ? { note: record.note.trim().slice(0, 180) } : {}),
    }];
  });
};

export const applyTax = (amount: number, tax: TaxSettings) => {
  const base = Math.max(0, amount);
  if (!tax.enabled || tax.ratePercent <= 0 || base === 0) {
    return { net: base, tax: 0, total: base };
  }
  const rate = tax.ratePercent / 100;
  if (tax.pricesIncludeTax) {
    const net = base / (1 + rate);
    return { net, tax: base - net, total: base };
  }
  const taxAmount = base * rate;
  return { net: base, tax: taxAmount, total: base + taxAmount };
};

export const settleCart = (lines: PricedLine[], cartDiscount: CartDiscount, tax: TaxSettings): Settlement => {
  const prepared = lines.filter((line) => line.qty > 0).map((line) => {
    const list = Math.max(0, line.unitPrice) * line.qty;
    const gross = Math.max(0, Math.min(line.unitPrice, line.effectiveUnitPrice)) * line.qty;
    return { ...line, list, gross };
  });
  const listSubtotal = prepared.reduce((sum, line) => sum + line.list, 0);
  const subtotal = prepared.reduce((sum, line) => sum + line.gross, 0);
  const requestedDiscount = cartDiscount.mode === 'percent'
    ? subtotal * (Math.min(100, Math.max(0, cartDiscount.value)) / 100)
    : cartDiscount.mode === 'amount'
      ? Math.max(0, cartDiscount.value)
      : 0;
  const discount = Math.min(subtotal, requestedDiscount);

  const exact = prepared.map((line) => {
    const share = subtotal > 0 ? line.gross / subtotal : 0;
    const afterDiscount = line.gross - discount * share;
    const taxed = applyTax(afterDiscount, tax);
    return {
      key: line.key,
      qty: line.qty,
      exactTotal: taxed.total,
      exactTax: taxed.tax,
      exactNet: taxed.net,
      cost: line.unitCost * line.qty,
      discountAmount: Math.max(0, line.list - afterDiscount),
    };
  });

  const settled = exact.map((line) => ({
    key: line.key,
    qty: line.qty,
    amount: roundMoney(line.exactTotal),
    cost: roundMoney(line.cost),
    taxAmount: roundMoney(line.exactTax),
    discountAmount: roundMoney(line.discountAmount),
    netAmount: roundMoney(line.exactNet),
  }));

  if (settled.length > 0) {
    const exactTotal = roundMoney(exact.reduce((sum, line) => sum + line.exactTotal, 0));
    const roundedTotal = settled.reduce((sum, line) => sum + line.amount, 0);
    settled[settled.length - 1].amount += exactTotal - roundedTotal;
    const exactTax = roundMoney(exact.reduce((sum, line) => sum + line.exactTax, 0));
    const roundedTax = settled.reduce((sum, line) => sum + line.taxAmount, 0);
    settled[settled.length - 1].taxAmount += exactTax - roundedTax;
    settled[settled.length - 1].netAmount = settled[settled.length - 1].amount - settled[settled.length - 1].taxAmount;
  }

  return {
    lines: settled,
    listSubtotal: roundMoney(listSubtotal),
    subtotal: roundMoney(subtotal),
    discount: roundMoney(discount),
    tax: settled.reduce((sum, line) => sum + line.taxAmount, 0),
    total: settled.reduce((sum, line) => sum + line.amount, 0),
  };
};

export const cashPortion = (tenders: Tender[]) => tenders.filter((tender) => tender.method === 'cash').reduce((sum, tender) => sum + tender.amount, 0);

export const tendersCoverTotal = (tenders: Tender[], total: number) => {
  if (tenders.length === 0 || tenders.some((tender) => !Number.isFinite(tender.amount) || tender.amount === 0)) return false;
  return tenders.reduce((sum, tender) => sum + tender.amount, 0) === total;
};

export const cashChange = (tenders: Tender[]) => tenders.reduce((sum, tender) => sum + (tender.method === 'cash' ? tender.change || 0 : 0), 0);

type SaleLike = {
  id: string;
  transactionId?: string;
  itemName: string;
  type: string;
  qty: number;
  amount: number;
  createdAt: string;
  saleKind?: 'sale' | 'return';
  returnOfTransactionId?: string;
  paymentMethod?: PaymentMethod;
  tenders?: Tender[];
  cashSessionId?: string;
};

export const transactionKey = (sale: { id: string; transactionId?: string }) => sale.transactionId || sale.id;

export const returnableQuantity = (sales: SaleLike[], transactionId: string, itemName: string, type: string) => {
  const sold = sales
    .filter((sale) => transactionKey(sale) === transactionId && sale.itemName === itemName && sale.type === type && sale.saleKind !== 'return' && sale.qty > 0)
    .reduce((sum, sale) => sum + sale.qty, 0);
  const returned = sales
    .filter((sale) => sale.returnOfTransactionId === transactionId && sale.itemName === itemName && sale.type === type && sale.saleKind === 'return')
    .reduce((sum, sale) => sum + Math.abs(sale.qty), 0);
  return Math.max(0, sold - returned);
};

export const nextDocumentNumber = (sales: { receiptNumber?: string; saleKind?: 'sale' | 'return' }[], prefix: string) => {
  const sequences = sales
    .filter((sale) => sale.receiptNumber?.startsWith(prefix))
    .map((sale) => Number(sale.receiptNumber?.slice(prefix.length)))
    .filter((value) => Number.isFinite(value));
  const next = (sequences.length > 0 ? Math.max(...sequences) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
};

export const receiptPrefix = (date: Date, kind: 'sale' | 'return') => {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `${kind === 'return' ? 'C' : 'R'}${day}-`;
};

export const sessionCashTaken = (sales: SaleLike[], sessionId: string) => sales
  .filter((sale) => sale.cashSessionId === sessionId)
  .reduce((sum, sale) => {
    if (sale.tenders && sale.tenders.length > 0) return sum + cashPortion(sale.tenders);
    if ((sale.paymentMethod || 'cash') === 'cash') return sum + sale.amount;
    return sum;
  }, 0);

export const customerAccountBalance = (sales: SaleLike[], customerName: string, customerPhone?: string) => {
  const name = customerName.trim().toLowerCase();
  const phone = customerPhone?.trim();
  return sales.reduce((sum, sale) => {
    const saleRecord = sale as SaleLike & { customerName?: string; customerPhone?: string };
    const sameName = saleRecord.customerName?.trim().toLowerCase() === name;
    const samePhone = phone && saleRecord.customerPhone?.trim() === phone;
    if (!sameName && !samePhone) return sum;
    if (sale.tenders && sale.tenders.length > 0) {
      return sum + sale.tenders.filter((tender) => tender.method === 'on_account').reduce((tenderSum, tender) => tenderSum + tender.amount, 0);
    }
    return sale.paymentMethod === 'on_account' ? sum + sale.amount : sum;
  }, 0);
};

export type ReceiptLine = {
  name: string;
  qty: number;
  amount: number;
};

export type ReceiptModel = {
  kind: 'sale' | 'return';
  receiptNumber: string;
  createdAt: string;
  shopName: string;
  address?: string;
  phone?: string;
  footer?: string;
  cashier: string;
  customerName?: string;
  customerPhone?: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount: number;
  tax: number;
  taxName: string;
  total: number;
  tenders: { label: string; amount: number; reference?: string; tendered?: number; change?: number }[];
  showTax: boolean;
  note: string;
};

export const receiptHtml = (receipt: ReceiptModel, formatMoney: (value: number) => string) => {
  const rows = receipt.lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.name)}<div class="muted">× ${line.qty}</div></td>
      <td class="right">${escapeHtml(formatMoney(line.amount))}</td>
    </tr>`).join('');
  const tenders = receipt.tenders.map((tender) => `
    <div class="row"><span>${escapeHtml(tender.label)}</span><span>${escapeHtml(formatMoney(tender.amount))}</span></div>
    ${tender.tendered ? `<div class="row muted"><span>Tendered</span><span>${escapeHtml(formatMoney(tender.tendered))}</span></div>` : ''}
    ${tender.change ? `<div class="row"><span>Change</span><span>${escapeHtml(formatMoney(tender.change))}</span></div>` : ''}
    ${tender.reference ? `<div class="muted">Ref ${escapeHtml(tender.reference)}</div>` : ''}`).join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(receipt.receiptNumber)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; color: #17261e; }
    .paper { width: 80mm; padding: 8mm 6mm; }
    h1 { font-size: 16px; margin: 0; letter-spacing: -0.03em; }
    p, td, div { font-size: 12px; }
    .center { text-align: center; }
    .muted { color: #66756a; font-size: 11px; }
    .row, table { width: 100%; }
    .row { display: flex; justify-content: space-between; gap: 12px; margin: 2px 0; }
    table { border-collapse: collapse; margin: 10px 0; }
    td { vertical-align: top; padding: 4px 0; border-top: 1px dashed #d5e0d7; }
    .right { text-align: right; white-space: nowrap; }
    .total { font-size: 16px; font-weight: 800; margin-top: 8px; }
    .note { margin-top: 10px; }
  </style>
</head>
<body>
  <div class="paper">
    <div class="center">
      <h1>${escapeHtml(receipt.shopName)}</h1>
      ${receipt.address ? `<p class="muted">${escapeHtml(receipt.address)}</p>` : ''}
      ${receipt.phone ? `<p class="muted">${escapeHtml(receipt.phone)}</p>` : ''}
      <p><strong>${receipt.kind === 'return' ? 'Credit note' : 'Receipt'}</strong> ${escapeHtml(receipt.receiptNumber)}</p>
      <p class="muted">${escapeHtml(new Date(receipt.createdAt).toLocaleString())}<br />${escapeHtml(receipt.cashier)}</p>
      ${receipt.customerName ? `<p>${escapeHtml(receipt.customerName)}${receipt.customerPhone ? ` · ${escapeHtml(receipt.customerPhone)}` : ''}</p>` : ''}
    </div>
    <table>${rows}</table>
    <div class="row"><span>Subtotal</span><span>${escapeHtml(formatMoney(receipt.subtotal))}</span></div>
    ${receipt.discount > 0 ? `<div class="row"><span>Discount</span><span>− ${escapeHtml(formatMoney(receipt.discount))}</span></div>` : ''}
    ${receipt.showTax ? `<div class="row"><span>${escapeHtml(receipt.taxName)}</span><span>${escapeHtml(formatMoney(receipt.tax))}</span></div>` : ''}
    <div class="row total"><span>Total</span><span>${escapeHtml(formatMoney(receipt.total))}</span></div>
    ${tenders}
    <p class="note muted">${escapeHtml(receipt.note)}</p>
    ${receipt.footer ? `<p class="center">${escapeHtml(receipt.footer)}</p>` : ''}
  </div>
</body>
</html>`;
};

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export const printReceipt = (receipt: ReceiptModel, formatMoney: (value: number) => string) => {
  const popup = window.open('', 'alphapos-receipt', 'width=440,height=760');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(receiptHtml(receipt, formatMoney));
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 180);
  return true;
};
