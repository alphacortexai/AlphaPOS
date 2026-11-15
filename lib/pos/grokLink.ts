import { answerShopQuestion, type ShopChatBranch, type ShopChatExpense, type ShopChatProduct, type ShopChatSale, type ShopChatService, type ShopChatSnapshot } from './assistantChat';
import { booksQuestion, formatShopBalances, type GrokBooks } from './grokBooks';
import type { ShopClock } from './reports';
import { decodeFirestoreDocument } from './shopRead';

export const GROK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const GROK_SNAPSHOT_BUDGET = 650_000;
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-03-26';

const INSTRUCTIONS = 'This connector reads one AlphaPOS shop. Use ask_shop for sales, profit, expenses, stock, prices, services, best sellers, account balances, what customers owe, and what the shop owes suppliers. A question about cash, mobile money, bank, float, or the drawer is a balance question, even when it names a day. shop_balances answers the same balance questions. Use shop_status to see when these figures were read. Do not claim a sale was recorded or a price was changed. Phone numbers are not available. Customer names are available only for balances owed.';

export type GrokSource = {
  shopName?: string;
  products: readonly GrokSourceProduct[];
  services: readonly GrokSourceService[];
  sales: readonly GrokSourceSale[];
  expenses: readonly GrokSourceExpense[];
  branches: readonly { id?: string; name?: string }[];
  clock: ShopClock;
};

type GrokSourceProduct = {
  id?: string;
  name?: string;
  branchId?: string;
  stock?: number;
  purchasePrice?: number;
  salePrice?: number;
  sku?: string;
  barcode?: string;
  category?: string;
  reorderPoint?: number;
  unit?: string;
  wholesalePrice?: number;
  variant?: string;
  image?: string;
};

type GrokSourceService = {
  id?: string;
  name?: string;
  branchId?: string;
  salePrice?: number;
  directCost?: number;
  monthlySharedCost?: number;
};

type GrokSourceSale = {
  id?: string;
  transactionId?: string;
  amount?: number;
  cost?: number;
  taxAmount?: number;
  createdAt?: string;
  voidedAt?: string;
  type?: string;
  itemName?: string;
  qty?: number;
  branchId?: string;
  productId?: string;
  customerName?: string;
  customerPhone?: string;
};

type GrokSourceExpense = {
  title?: string;
  amount?: number;
  createdAt?: string;
  branchId?: string;
  receiptImage?: string;
};

export type GrokShopLink = {
  snapshot: ShopChatSnapshot;
  updatedAt: string;
  salesTruncatedBefore: string;
  live?: boolean;
  books?: GrokBooks;
};

export class GrokLinkError extends Error {
  readonly kind: 'denied' | 'key' | 'unavailable';

  constructor(kind: 'denied' | 'key' | 'unavailable', detail?: string) {
    super(detail || kind);
    this.kind = kind;
  }
}

export const isGrokToken = (value: string) => GROK_TOKEN_PATTERN.test(value);

export const newGrokToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const grokLinkId = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const grokConnectionFromSecret = (data: Record<string, unknown> | undefined) => {
  if (!data || data.grokConnected === false) return { connected: false, token: '' };
  const token = typeof data.grokToken === 'string' ? data.grokToken.trim() : '';
  if (!isGrokToken(token)) return { connected: false, token: '' };
  return { connected: true, token };
};

export const grokConnectorUrl = (origin: string, token: string) => {
  const url = new URL('/api/mcp', origin);
  url.searchParams.set('token', token);
  return url.toString();
};

export const grokOriginIsPublic = (origin: string) => {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.local');
  } catch {
    return false;
  }
};

const clip = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : '';
};

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const clockFrom = (value: unknown): ShopClock => {
  const record = asRecord(value);
  const offset = record ? num(record.timezoneOffsetMinutes) : 0;
  const start = record ? clip(record.dayStartTime, 5) : '';
  return {
    timezoneOffsetMinutes: offset >= -12 * 60 && offset <= 14 * 60 ? offset : 0,
    dayStartTime: /^([01]?\d|2[0-3]):[0-5]\d$/.test(start) ? start : '00:00',
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const cleanProduct = (value: GrokSourceProduct): ShopChatProduct | null => {
  const id = clip(value.id, 80);
  const name = clip(value.name, 120);
  if (!id || !name) return null;
  const product: ShopChatProduct = {
    id,
    name,
    branchId: clip(value.branchId, 80),
    stock: num(value.stock),
    purchasePrice: Math.max(0, num(value.purchasePrice)),
    salePrice: Math.max(0, num(value.salePrice)),
  };
  const sku = clip(value.sku, 80);
  const barcode = clip(value.barcode, 80);
  const category = clip(value.category, 80);
  const variant = clip(value.variant, 80);
  const unit = clip(value.unit, 12);
  if (sku) product.sku = sku;
  if (barcode) product.barcode = barcode;
  if (category) product.category = category;
  if (variant) product.variant = variant;
  if (unit === 'piece' || unit === 'kg' || unit === 'litre') product.unit = unit;
  if (num(value.reorderPoint) > 0) product.reorderPoint = num(value.reorderPoint);
  if (num(value.wholesalePrice) > 0) product.wholesalePrice = num(value.wholesalePrice);
  return product;
};

const cleanService = (value: GrokSourceService): ShopChatService | null => {
  const id = clip(value.id, 80);
  const name = clip(value.name, 120);
  if (!id || !name) return null;
  const service: ShopChatService = {
    id,
    name,
    branchId: clip(value.branchId, 80),
    salePrice: Math.max(0, num(value.salePrice)),
  };
  if (num(value.directCost) > 0) service.directCost = num(value.directCost);
  if (num(value.monthlySharedCost) > 0) service.monthlySharedCost = num(value.monthlySharedCost);
  return service;
};

const cleanSale = (value: GrokSourceSale): ShopChatSale | null => {
  const id = clip(value.id, 80);
  const createdAt = clip(value.createdAt, 40);
  if (!id || !createdAt || value.voidedAt) return null;
  const sale: ShopChatSale = {
    id,
    amount: num(value.amount),
    cost: Math.max(0, num(value.cost)),
    createdAt,
  };
  const transactionId = clip(value.transactionId, 80);
  const itemName = clip(value.itemName, 120);
  const branchId = clip(value.branchId, 80);
  const productId = clip(value.productId, 80);
  const type = value.type === 'product' || value.type === 'service' ? value.type : '';
  if (transactionId) sale.transactionId = transactionId;
  if (itemName) sale.itemName = itemName;
  if (branchId) sale.branchId = branchId;
  if (productId) sale.productId = productId;
  if (type) sale.type = type;
  if (num(value.qty) > 0) sale.qty = num(value.qty);
  if (num(value.taxAmount) > 0) sale.taxAmount = num(value.taxAmount);
  return sale;
};

const cleanExpense = (value: GrokSourceExpense): ShopChatExpense | null => {
  const createdAt = clip(value.createdAt, 40);
  if (!createdAt) return null;
  const expense: ShopChatExpense = { amount: Math.max(0, num(value.amount)), createdAt };
  const title = clip(value.title, 120);
  const branchId = clip(value.branchId, 80);
  if (title) expense.title = title;
  if (branchId) expense.branchId = branchId;
  return expense;
};

const cleanBranch = (value: { id?: string; name?: string }): ShopChatBranch | null => {
  const id = clip(value.id, 80);
  const name = clip(value.name, 120);
  if (!id || !name) return null;
  return { id, name };
};

const snapshotWeight = (snapshot: ShopChatSnapshot) => JSON.stringify(snapshot).length;

export const buildGrokSnapshot = (source: GrokSource, options?: { now?: Date; budget?: number }) => {
  const now = options?.now ?? new Date();
  const budget = options?.budget ?? GROK_SNAPSHOT_BUDGET;
  const products = source.products.slice(0, 2000).flatMap((product) => {
    const clean = cleanProduct(product);
    return clean ? [clean] : [];
  });
  const services = source.services.slice(0, 400).flatMap((service) => {
    const clean = cleanService(service);
    return clean ? [clean] : [];
  });
  const expenses = source.expenses.slice(0, 400).flatMap((expense) => {
    const clean = cleanExpense(expense);
    return clean ? [clean] : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sales = source.sales.flatMap((sale) => {
    const clean = cleanSale(sale);
    return clean ? [clean] : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const branches = source.branches.slice(0, 50).flatMap((branch) => {
    const clean = cleanBranch(branch);
    return clean ? [clean] : [];
  });
  const shopName = clip(source.shopName, 80);
  const clock = clockFrom(source.clock);
  let keptSales = sales;
  let keptExpenses = expenses;
  let snapshot: ShopChatSnapshot = { ...(shopName ? { shopName } : {}), products, services, sales: keptSales, expenses: keptExpenses, branches, clock };
  while (snapshotWeight(snapshot) > budget && keptSales.length > 20) {
    keptSales = keptSales.slice(0, Math.max(20, Math.floor(keptSales.length * 0.75)));
    snapshot = { ...snapshot, sales: keptSales };
  }
  while (snapshotWeight(snapshot) > budget && keptExpenses.length > 10) {
    keptExpenses = keptExpenses.slice(0, Math.max(10, Math.floor(keptExpenses.length * 0.75)));
    snapshot = { ...snapshot, expenses: keptExpenses };
  }
  const salesTruncatedBefore = keptSales.length < sales.length ? (keptSales[keptSales.length - 1]?.createdAt || sales[keptSales.length]?.createdAt || '') : '';
  return {
    snapshot,
    updatedAt: now.toISOString(),
    salesTruncatedBefore,
  };
};

export const readGrokSnapshot = (value: unknown): ShopChatSnapshot | null => {
  const record = asRecord(value);
  if (!record) return null;
  const products = Array.isArray(record.products) ? record.products : [];
  const services = Array.isArray(record.services) ? record.services : [];
  const sales = Array.isArray(record.sales) ? record.sales : [];
  const expenses = Array.isArray(record.expenses) ? record.expenses : [];
  const branches = Array.isArray(record.branches) ? record.branches : [];
  return buildGrokSnapshot({
    shopName: clip(record.shopName, 80),
    products: products as GrokSourceProduct[],
    services: services as GrokSourceService[],
    sales: sales as GrokSourceSale[],
    expenses: expenses as GrokSourceExpense[],
    branches: branches as { id?: string; name?: string }[],
    clock: clockFrom(record.clock),
  }, { now: new Date(0), budget: Number.POSITIVE_INFINITY }).snapshot;
};

export const readGrokLink = (document: Record<string, unknown> | null): GrokShopLink | null => {
  if (!document) return null;
  const snapshot = readGrokSnapshot(document.snapshot);
  if (!snapshot) return null;
  return {
    snapshot,
    updatedAt: clip(document.updatedAt, 40),
    salesTruncatedBefore: clip(document.salesTruncatedBefore, 40),
  };
};

const failureKind = (status: number, detail: string): 'denied' | 'key' | 'unavailable' => {
  if (/referer|referrer|api key|api_key_invalid|browser key/i.test(detail)) return 'key';
  if (status === 401 || status === 403) return /insufficient permissions|permission denied/i.test(detail) ? 'denied' : 'key';
  return 'unavailable';
};

export const loadGrokLink = async (input: {
  projectId: string;
  apiKey: string;
  token: string;
  referer: string;
  fetchImpl?: typeof fetch;
}): Promise<GrokShopLink | null> => {
  if (!isGrokToken(input.token)) return null;
  const linkId = await grokLinkId(input.token);
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(input.projectId)}/databases/(default)/documents/grokLinks/${linkId}?key=${encodeURIComponent(input.apiKey)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Referer: input.referer }, cache: 'no-store' });
  } catch {
    throw new GrokLinkError('unavailable');
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GrokLinkError(failureKind(response.status, detail));
  }
  const body = await response.json() as unknown;
  return readGrokLink(decodeFirestoreDocument(body));
};

export const grokLinkFailureMessage = (kind: GrokLinkError['kind']) => {
  if (kind === 'denied') return 'Publish the latest Firestore rules so Grok can read this shop.';
  if (kind === 'key') return 'The Firebase key blocked Grok. Set GROK_MCP_REFERER to this shop’s public https address, or set FIREBASE_MCP_API_KEY to a server key that can read Firestore.';
  return 'The shop records could not be read just now. Ask again in a moment.';
};

export const formatShopTime = (iso: string, clock: ShopClock) => {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  const shifted = new Date(instant.getTime() + clock.timezoneOffsetMinutes * 60 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}, ${hour}:${minute}`;
};

const TOOLS = [
  {
    name: 'ask_shop',
    description: 'Answer one question about this shop from its own records. Covers sales, profit, expenses, stock on hand, low stock, out of stock, selling prices, services, best sellers, account balances (cash, mobile money, card, bank, float, and the open drawer), what customers owe, and what the shop owes suppliers. For sales, profit, or expenses, include the period, such as today, this week, this month, or from 1 Nov to 10 Nov, and the product or service name when the question is about one item. A question about balances is answered from the books even when it also names a day. Voided sales are excluded. A week starts on Monday. This does not record a sale or change a price.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question in plain language, including the period.' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'shop_balances',
    description: 'Account balances for cash, mobile money, card, bank, and any other account, plus what customers owe the shop and what the shop owes suppliers. Also reports expected cash when a drawer is open. This does not move money.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'accounts, customers, suppliers, or all. Omit this for all three.' },
        name: { type: 'string', description: 'Optional account, customer, or supplier name.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'shop_status',
    description: 'Report the shop name, when the register last sent these records, and how many products, services, branches, and sales lines are included.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const;

const toolText = (text: string, isError = false) => ({
  content: [{ type: 'text', text }],
  isError,
});

const statusText = (link: GrokShopLink, now: Date) => {
  const { snapshot } = link;
  const sent = link.updatedAt ? formatShopTime(link.updatedAt, snapshot.clock) : '';
  const age = link.updatedAt ? now.getTime() - new Date(link.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  const lines = [
    `Shop: ${snapshot.shopName || 'This shop'}`,
    link.live
      ? 'These figures were read from the shop just now. A sale shows up after the till saves it.'
      : (sent ? `Records sent from the register at ${sent} shop time.` : 'The register has not reported a send time.'),
    `Products: ${snapshot.products.length}`,
    `Services: ${snapshot.services.length}`,
    `Branches: ${snapshot.branches.map((branch) => branch.name).join(', ') || 'None'}`,
    `Sales lines in this connection: ${snapshot.sales.length}`,
    `Expenses in this connection: ${snapshot.expenses.length}`,
  ];
  if (link.salesTruncatedBefore) {
    const from = formatShopTime(link.salesTruncatedBefore, snapshot.clock);
    lines.push(from
      ? `Older sales before ${from} shop time are not in this connection, so a long period can be short.`
      : 'Older sales are not in this connection, so a long period can be short.');
  }
  if (!link.live && age > 12 * 60 * 60 * 1000) lines.push('Open AlphaPOS while signed in as the owner to refresh these records.');
  return lines.join('\n');
};

const askText = (link: GrokShopLink, question: string, now: Date) => {
  const reply = answerShopQuestion(question, link.snapshot, { now });
  const lines = reply.lines.map((line) => `${line.label}: ${line.detail}`);
  const text = [reply.text, ...lines].join('\n');
  const age = link.updatedAt ? now.getTime() - new Date(link.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  if (!link.live && age > 12 * 60 * 60 * 1000) {
    const sent = link.updatedAt ? formatShopTime(link.updatedAt, link.snapshot.clock) : '';
    return `${text}\n\nThese records were last sent from the register${sent ? ` at ${sent} shop time` : ''}. Open AlphaPOS while signed in as the owner to refresh them.`;
  }
  return text;
};

const callTool = (link: GrokShopLink, name: string, args: Record<string, unknown>, now: Date) => {
  if (name === 'shop_status') return toolText(statusText(link, now));
  if (name === 'ask_shop') {
    const question = clip(args.question, 500);
    if (!question) return toolText('Ask a question such as sales today, profit this month, what is low on stock, or the cash balance.', true);
    const booksAsk = booksQuestion(question);
    if (booksAsk) {
      if (!link.books) return toolText('Account balances, customer balances, and supplier balances are read with the shop. Ask again in a moment.');
      return toolText(formatShopBalances(link.books, booksAsk.kind));
    }
    return toolText(askText(link, question, now));
  }
  if (name === 'shop_balances') {
    if (!link.books) return toolText('Account balances, customer balances, and supplier balances are read with the shop. Ask again in a moment.');
    return toolText(formatShopBalances(link.books, clip(args.kind, 40), clip(args.name, 80)));
  }
  return null;
};

const argumentsOf = (params: unknown) => {
  const record = asRecord(params);
  const raw = record?.arguments ?? record?.args;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return asRecord(parsed) || {};
    } catch {
      return {};
    }
  }
  return asRecord(raw) || {};
};

type RpcBody = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } };

const rpcResult = (id: unknown, result: unknown): RpcBody => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string): RpcBody => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

const protocolOf = (params: unknown) => {
  const requested = asRecord(params)?.protocolVersion;
  return typeof requested === 'string' && PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
};

export const handleMcpMessage = (message: unknown, link: GrokShopLink, now: Date): { kind: 'accept' } | { kind: 'json'; body: RpcBody } => {
  const record = asRecord(message);
  if (!record || (record.jsonrpc !== undefined && record.jsonrpc !== '2.0') || typeof record.method !== 'string') {
    return { kind: 'json', body: rpcError(record?.id, -32600, 'Invalid request.') };
  }
  const method = record.method;
  const id = record.id;
  const notification = id === undefined || id === null;
  if (method.startsWith('notifications/') || (notification && method !== 'initialize')) return { kind: 'accept' };
  if (notification) return { kind: 'json', body: rpcError(null, -32600, 'Invalid request.') };
  if (method === 'initialize') {
    return {
      kind: 'json',
      body: rpcResult(id, {
        protocolVersion: protocolOf(record.params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'AlphaPOS', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      }),
    };
  }
  if (method === 'ping') return { kind: 'json', body: rpcResult(id, {}) };
  if (method === 'tools/list') return { kind: 'json', body: rpcResult(id, { tools: TOOLS }) };
  if (method === 'tools/call') {
    const params = asRecord(record.params);
    const name = typeof params?.name === 'string' ? params.name : '';
    const result = callTool(link, name, argumentsOf(record.params), now);
    if (!result) return { kind: 'json', body: rpcError(id, -32602, 'That shop tool is not available.') };
    return { kind: 'json', body: rpcResult(id, result) };
  }
  return { kind: 'json', body: rpcError(id, -32601, 'Method not found.') };
};

const tokenFromAuthorization = (header: string | null) => {
  if (!header) return '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = bearer ? bearer[1] : header.trim();
  return isGrokToken(token) ? token : '';
};

const tokenFromHeader = (header: string | null) => (header && isGrokToken(header.trim()) ? header.trim() : '');

export const tokenFromRequest = (input: { authorization: string | null; tokenHeader: string | null; queryToken: string | null }) => {
  const headerToken = tokenFromAuthorization(input.authorization) || tokenFromHeader(input.tokenHeader);
  const queryToken = input.queryToken && isGrokToken(input.queryToken) ? input.queryToken : '';
  if (headerToken && queryToken && headerToken !== queryToken) return '';
  return headerToken || queryToken;
};

const wantsEventStream = (accept: string | null) => {
  const value = accept || '';
  return value.includes('text/event-stream') && !value.includes('application/json');
};

const mcpHeaders = (protocol: string, extra?: Record<string, string>) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version, WWW-Authenticate',
  'Cache-Control': 'no-store',
  'MCP-Protocol-Version': protocol,
  ...extra,
});

export type McpHttpResult = { status: number; body: string; headers: Record<string, string> };

const httpResult = (status: number, payload: unknown, accept: string | null, protocol: string, extra?: Record<string, string>): McpHttpResult => {
  if (wantsEventStream(accept)) {
    return {
      status,
      body: `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
      headers: mcpHeaders(protocol, { 'Content-Type': 'text/event-stream', ...extra }),
    };
  }
  return {
    status,
    body: JSON.stringify(payload),
    headers: mcpHeaders(protocol, { 'Content-Type': 'application/json', ...extra }),
  };
};

const missingShop = (id: unknown) => rpcError(id, -32001, 'This shop is not connected. In AlphaPOS, open Settings, then Assistant, and connect Grok while signed in as the owner.');

export const respondToMcp = async (input: {
  authorization: string | null;
  tokenHeader: string | null;
  queryToken: string | null;
  accept: string | null;
  protocolHeader: string | null;
  body: string;
  projectId: string;
  apiKey: string;
  referer: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  loadLink?: (token: string) => Promise<GrokShopLink | null>;
}): Promise<McpHttpResult> => {
  const protocol = input.protocolHeader && PROTOCOLS.includes(input.protocolHeader) ? input.protocolHeader : DEFAULT_PROTOCOL;
  const token = tokenFromRequest(input);
  if (!token) {
    return httpResult(401, rpcError(null, -32001, 'Paste this shop’s Grok address from AlphaPOS Settings, under Assistant.'), input.accept, protocol, {
      'WWW-Authenticate': 'Bearer realm="AlphaPOS"',
    });
  }
  if (!input.loadLink && (!input.projectId || !input.apiKey)) {
    return httpResult(503, rpcError(null, -32000, 'Firebase is not configured, so Grok cannot read this shop yet.'), input.accept, protocol);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body) as unknown;
  } catch {
    return httpResult(400, rpcError(null, -32700, 'The request was not valid JSON.'), input.accept, protocol);
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (!messages.length) return httpResult(400, rpcError(null, -32600, 'Invalid request.'), input.accept, protocol);
  let link: GrokShopLink | null;
  try {
    link = input.loadLink
      ? await input.loadLink(token)
      : await loadGrokLink({
        projectId: input.projectId,
        apiKey: input.apiKey,
        token,
        referer: input.referer,
        fetchImpl: input.fetchImpl,
      });
  } catch (error) {
    const kind = error instanceof GrokLinkError ? error.kind : 'unavailable';
    const message = error instanceof GrokLinkError && error.message !== error.kind ? error.message : grokLinkFailureMessage(kind);
    const status = kind === 'unavailable' ? 502 : 503;
    return httpResult(status, rpcError(null, -32000, message), input.accept, protocol);
  }
  if (!link) {
    const onlyNotifications = messages.every((message) => {
      const record = asRecord(message);
      return record && typeof record.method === 'string' && (record.id === undefined || record.id === null);
    });
    if (onlyNotifications) return { status: 401, body: '', headers: mcpHeaders(protocol, { 'WWW-Authenticate': 'Bearer realm="AlphaPOS"' }) };
    const bodies = messages.map((message) => missingShop(asRecord(message)?.id ?? null));
    return httpResult(401, Array.isArray(parsed) ? bodies : bodies[0], input.accept, protocol, { 'WWW-Authenticate': 'Bearer realm="AlphaPOS"' });
  }
  const now = input.now ?? new Date();
  const bodies: RpcBody[] = [];
  for (const message of messages) {
    const handled = handleMcpMessage(message, link, now);
    if (handled.kind === 'json') bodies.push(handled.body);
  }
  if (!bodies.length) return { status: 202, body: '', headers: mcpHeaders(protocol) };
  return httpResult(200, Array.isArray(parsed) ? bodies : bodies[0], input.accept, protocol);
};

export const firebaseMcpConfig = () => ({
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '',
  apiKey: process.env.FIREBASE_MCP_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '',
  referer: process.env.GROK_MCP_REFERER || 'https://www.alphapos.store/',
  serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || '',
});
