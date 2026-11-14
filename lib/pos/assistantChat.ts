import { reorderLevel, stockIsLow, stockWorth } from './books';
import { businessDayKey, businessDayRange, instantInRange, recentBusinessDays, reportPeriodRange, shiftDayKey, summarizePeriod, type ReportPeriod, type ShopClock } from './reports';

export type ShopChatProduct = {
  id: string;
  name: string;
  branchId: string;
  stock: number;
  purchasePrice: number;
  salePrice: number;
  sku?: string;
  barcode?: string;
  category?: string;
  reorderPoint?: number;
  unit?: string;
  wholesalePrice?: number;
  variant?: string;
};

export type ShopChatService = {
  id: string;
  name: string;
  branchId: string;
  salePrice: number;
  directCost?: number;
  monthlySharedCost?: number;
};

export type ShopChatSale = {
  id: string;
  transactionId?: string;
  amount: number;
  cost: number;
  taxAmount?: number;
  createdAt: string;
  voidedAt?: string;
  type?: string;
  itemName?: string;
  qty?: number;
  branchId?: string;
  productId?: string;
};

export type ShopChatExpense = {
  title?: string;
  amount: number;
  createdAt: string;
  branchId?: string;
};

export type ShopChatBranch = { id: string; name: string };

export type ShopChatSnapshot = {
  shopName?: string;
  products: ShopChatProduct[];
  services: ShopChatService[];
  sales: ShopChatSale[];
  expenses: ShopChatExpense[];
  branches: ShopChatBranch[];
  clock: ShopClock;
};

export type ChatPeriodKind = 'today' | 'yesterday' | 'week' | 'last_week' | 'month' | 'last_month' | 'year' | 'last_year' | 'days' | 'day' | 'range';

export type ChatPeriod = {
  kind: ChatPeriodKind;
  label: string;
  start: Date;
  end: Date;
};

export type ChatTopic = 'help' | 'sales' | 'profit' | 'expenses' | 'products' | 'low_stock' | 'out_of_stock' | 'prices' | 'services' | 'stock' | 'bestsellers' | 'worth' | 'item';

export type ChatContext = {
  topic?: ChatTopic;
  period?: ChatPeriod;
  productId?: string;
  serviceId?: string;
};

export type ChatLine = { label: string; detail: string };

export type ChatReply = {
  text: string;
  lines: ChatLine[];
  topic: ChatTopic;
  period?: ChatPeriod;
  productId?: string;
  serviceId?: string;
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_WORD = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';

const STOP = new Set([
  'about', 'all', 'also', 'and', 'any', 'are', 'available', 'best', 'bestsellers', 'between', 'branch', 'branches',
  'can', 'cost', 'costs', 'count', 'daily', 'day', 'days', 'did', 'do', 'does', 'during', 'expense', 'expenses',
  'for', 'from', 'get', 'give', 'given', 'gross', 'have', 'hello', 'help', 'hey', 'how', 'inventory', 'is', 'item',
  'items', 'last', 'left', 'list', 'low', 'made', 'make', 'many', 'margin', 'margins', 'me', 'month', 'months',
  'most', 'much', 'net', 'number', 'of', 'on', 'our', 'out', 'past', 'period', 'please', 'previous', 'price',
  'prices', 'product', 'products', 'profit', 'profits', 'purchase', 'reorder', 'revenue', 'running', 'sale',
  'sales', 'same', 'sell', 'selling', 'seller', 'sellers', 'service', 'services', 'shop', 'show', 'since', 'sku',
  'skus', 'sold', 'some', 'spent', 'spending', 'stock', 'takings', 'tell', 'that', 'the', 'their', 'them', 'there',
  'these', 'this', 'those', 'through', 'today', 'top', 'until', 'us', 'value', 'was', 'we', 'week', 'weekly',
  'weeks', 'were', 'what', 'when', 'where', 'which', 'with', 'worth', 'year', 'yearly', 'years', 'yesterday', 'you',
  'your', ...WEEKDAYS, ...MONTHS, 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

const ALIASES: Record<string, string> = {
  pdts: 'products',
  pdt: 'product',
  prods: 'products',
  stk: 'stock',
  svcs: 'services',
  svc: 'service',
  prft: 'profit',
  sls: 'sales',
};

const LIST_CAP = 12;

const money = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;

const formatCount = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
};

const countPhrase = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

const prepareQuestion = (raw: string) => raw
  .toLowerCase()
  .replace(/[’']/g, ' ')
  .replace(/[^a-z0-9/.\-\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .split(' ')
  .filter(Boolean)
  .map((word) => ALIASES[word] || word)
  .join(' ');

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const phraseIn = (haystack: string, phrase: string) => phrase.length >= 2 && ` ${haystack} `.includes(` ${phrase} `);

const reservedName = (value: string) => !value || STOP.has(value);

const prettyDay = (key: string, withYear = true) => {
  const [year, month, day] = key.split('-').map(Number);
  const body = `${day} ${MONTH_SHORT[(month || 1) - 1]}`;
  return withYear ? `${body} ${year}` : body;
};

const monthTitle = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return `${MONTH_LONG[(month || 1) - 1]} ${year}`;
};

const spanText = (start: Date, end: Date, clock: ShopClock) => {
  const startKey = businessDayKey(start, clock);
  const endKey = businessDayKey(new Date(end.getTime() - 1), clock);
  if (startKey === endKey) return prettyDay(startKey);
  const sameYear = startKey.slice(0, 4) === endKey.slice(0, 4);
  return `${prettyDay(startKey, !sameYear)} – ${prettyDay(endKey)}`;
};

const periodFromReport = (kind: ChatPeriodKind, label: string, report: ReportPeriod, offset: number, now: Date, clock: ShopClock): ChatPeriod => {
  const range = reportPeriodRange(report, offset, now, clock);
  const startKey = businessDayKey(range.start, clock);
  let detail = spanText(range.start, range.end, clock);
  if (report === 'daily') detail = prettyDay(startKey);
  if (report === 'monthly') detail = monthTitle(startKey);
  if (report === 'yearly') detail = startKey.slice(0, 4);
  return { kind, label: `${label} (${detail})`, start: range.start, end: range.end };
};

const dayPeriod = (key: string, clock: ShopClock, kind: 'day' | 'today' | 'yesterday', label?: string): ChatPeriod => {
  const range = businessDayRange(key, clock);
  const end = businessDayRange(shiftDayKey(key, 1), clock).start;
  const pretty = prettyDay(key);
  return {
    kind,
    label: label ? `${label} (${pretty})` : `on ${pretty}`,
    start: range.start,
    end,
  };
};

const monthIndex = (word: string) => {
  const name = word.toLowerCase();
  if (name === 'may') return 4;
  if (name.length < 3) return -1;
  return MONTHS.findIndex((month) => month === name || month.startsWith(name));
};

const validKey = (year: number, month: number, day: number) => {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return '';
  const stamped = new Date(Date.UTC(year, month - 1, day));
  if (stamped.getUTCFullYear() !== year || stamped.getUTCMonth() !== month - 1 || stamped.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const fullYear = (year: number, fallback: number) => {
  if (!year) return fallback;
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
};

type DateHit = { key: string; start: number; end: number };

const pushHit = (hits: DateHit[], hit: DateHit | null) => {
  if (!hit) return;
  const clash = hits.findIndex((row) => hit.start < row.end && hit.end > row.start);
  if (clash === -1) {
    hits.push(hit);
    return;
  }
  if (hit.end - hit.start > hits[clash].end - hits[clash].start) hits[clash] = hit;
};

const collectDates = (text: string, todayKey: string): DateHit[] => {
  const yearNow = Number(todayKey.slice(0, 4));
  const hits: DateHit[] = [];
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  for (const match of text.matchAll(iso)) {
    const key = validKey(Number(match[1]), Number(match[2]), Number(match[3]));
    pushHit(hits, key ? { key, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length } : null);
  }
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?:\\s+(20\\d{2}))?\\b`, 'g');
  for (const match of text.matchAll(dayMonth)) {
    const key = validKey(fullYear(Number(match[3] || 0), yearNow), monthIndex(match[2]) + 1, Number(match[1]));
    pushHit(hits, key ? { key, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length } : null);
  }
  const monthDay = new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(20\\d{2}))?\\b`, 'g');
  for (const match of text.matchAll(monthDay)) {
    const key = validKey(fullYear(Number(match[3] || 0), yearNow), monthIndex(match[1]) + 1, Number(match[2]));
    pushHit(hits, key ? { key, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length } : null);
  }
  const numeric = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b|\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/g;
  for (const match of text.matchAll(numeric)) {
    const day = Number(match[1] || match[4]);
    const month = Number(match[2] || match[5]);
    const year = fullYear(Number(match[3] || match[6] || 0), yearNow);
    const key = validKey(year, month, day);
    pushHit(hits, key ? { key, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length } : null);
  }
  hits.sort((a, b) => a.start - b.start);
  return hits;
};

const rangePeriod = (startKey: string, endKey: string, clock: ShopClock): ChatPeriod | null => {
  const [from, to] = startKey <= endKey ? [startKey, endKey] : [endKey, startKey];
  const start = businessDayRange(from, clock).start;
  const end = businessDayRange(shiftDayKey(to, 1), clock).start;
  if (from === to) return dayPeriod(from, clock, 'day');
  return { kind: 'range', label: `from ${prettyDay(from)} to ${prettyDay(to)}`, start, end };
};

const triedToNameDays = (text: string) => (
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\b|\\b${MONTH_WORD}\\s+\\d{1,2}\\b|\\b\\d{1,2}[/.]\\d{1,2}\\b|\\b20\\d{2}-\\d{2}-\\d{2}\\b|\\b(?:on|for)\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)\\b|\\b(from|between|since|until|period)\\b`).test(text)
);

const resolvePeriod = (text: string, now: Date, clock: ShopClock): ChatPeriod | null => {
  const todayKey = businessDayKey(now, clock);
  const lastDays = text.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/);
  if (lastDays) {
    const count = Math.min(366, Math.max(1, Number(lastDays[1])));
    const keys = recentBusinessDays(count, now, clock);
    const start = businessDayRange(keys[0], clock).start;
    const end = businessDayRange(shiftDayKey(keys[keys.length - 1], 1), clock).start;
    return { kind: 'days', label: `the last ${count} ${count === 1 ? 'day' : 'days'} (${spanText(start, end, clock)})`, start, end };
  }

  const monthSpan = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|and|through|until|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?:\\s+(20\\d{2}))?\\b`));
  if (monthSpan) {
    const year = fullYear(Number(monthSpan[4] || 0), Number(todayKey.slice(0, 4)));
    const month = monthIndex(monthSpan[3]) + 1;
    const startKey = validKey(year, month, Number(monthSpan[1]));
    const endKey = validKey(year, month, Number(monthSpan[2]));
    if (startKey && endKey) return rangePeriod(startKey, endKey, clock);
  }

  const hits = collectDates(text, todayKey);
  if (hits.length >= 2) return rangePeriod(hits[0].key, hits[hits.length - 1].key, clock);
  if (hits.length === 1) return dayPeriod(hits[0].key, clock, 'day');

  const bare = text.match(/\b(?:from|between)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:to|and|through|until)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (bare && !new RegExp(MONTH_WORD).test(text)) {
    const [year, month] = todayKey.split('-').map(Number);
    const startKey = validKey(year, month, Number(bare[1]));
    let endKey = validKey(year, month, Number(bare[2]));
    if (startKey && endKey && endKey < startKey) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      endKey = validKey(nextYear, nextMonth, Number(bare[2]));
    }
    if (startKey && endKey) return rangePeriod(startKey, endKey, clock);
  }

  const weekday = WEEKDAYS.find((name) => new RegExp(`\\b${name}\\b`).test(text));
  if (weekday) {
    const todayIndex = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
    let delta = WEEKDAYS.indexOf(weekday) - todayIndex;
    const previous = new RegExp(`\\blast\\s+${weekday}\\b`).test(text);
    if (previous) {
      if (delta >= 0) delta -= 7;
    } else if (delta > 0) delta -= 7;
    return dayPeriod(shiftDayKey(todayKey, delta), clock, 'day');
  }

  const ordinal = text.match(/\b(?:on|for)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (ordinal) {
    const [year, month] = todayKey.split('-').map(Number);
    const key = validKey(year, month, Number(ordinal[1]));
    if (key) return dayPeriod(key, clock, 'day');
  }

  const relatives: { pattern: RegExp; kind: ChatPeriodKind; label: string; report: ReportPeriod; offset: number }[] = [
    { pattern: /\byesterday\b/, kind: 'yesterday', label: 'yesterday', report: 'daily', offset: 1 },
    { pattern: /\b(today|this day|the day|daily)\b/, kind: 'today', label: 'today', report: 'daily', offset: 0 },
    { pattern: /\b(last|past|previous) week\b/, kind: 'last_week', label: 'last week', report: 'weekly', offset: 1 },
    { pattern: /\b(this week|the week|weekly)\b/, kind: 'week', label: 'this week', report: 'weekly', offset: 0 },
    { pattern: /\b(last|past|previous) month\b/, kind: 'last_month', label: 'last month', report: 'monthly', offset: 1 },
    { pattern: /\b(this month|the month|monthly)\b/, kind: 'month', label: 'this month', report: 'monthly', offset: 0 },
    { pattern: /\b(last|past|previous) year\b/, kind: 'last_year', label: 'last year', report: 'yearly', offset: 1 },
    { pattern: /\b(this year|the year|yearly|annual)\b/, kind: 'year', label: 'this year', report: 'yearly', offset: 0 },
  ];
  const found = relatives
    .map((row) => ({ row, index: row.pattern.exec(text)?.index ?? -1 }))
    .filter((row) => row.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
  if (!found) return null;
  return periodFromReport(found.row.kind, found.row.label, found.row.report, found.row.offset, now, clock);
};

const tokensOf = (text: string) => text.split(' ').filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word));

const matchLabeled = <T>(items: T[], labelsFor: (item: T) => string[], text: string): T[] => {
  const haystack = normalize(text);
  const full: { item: T; length: number }[] = [];
  items.forEach((item) => {
    labelsFor(item).forEach((label) => {
      const name = normalize(label);
      if (!reservedName(name) && phraseIn(haystack, name)) full.push({ item, length: name.length });
    });
  });
  if (full.length) {
    const best = Math.max(...full.map((row) => row.length));
    return [...new Set(full.filter((row) => row.length === best).map((row) => row.item))];
  }
  const tokens = tokensOf(haystack);
  if (!tokens.length) return [];
  const needed = tokens.length === 1 ? 1 : Math.min(tokens.length, Math.max(2, tokens.length - 1));
  const scored = items.flatMap((item) => {
    const words = labelsFor(item).flatMap((label) => normalize(label).split(' ')).filter((word) => word && !reservedName(word));
    const score = tokens.filter((token) => words.some((word) => word === token || (token.length >= 4 && word.startsWith(token)))).length;
    return score >= needed ? [{ item, score }] : [];
  });
  if (!scored.length) return [];
  const best = Math.max(...scored.map((row) => row.score));
  return scored.filter((row) => row.score === best).map((row) => row.item);
};

const matchProducts = (text: string, products: ShopChatProduct[]) => matchLabeled(
  products,
  (product) => [product.name, product.sku || '', product.barcode || ''],
  text,
);

const matchServices = (text: string, services: ShopChatService[]) => matchLabeled(services, (service) => [service.name], text);

const matchBranch = (text: string, branches: ShopChatBranch[]) => {
  if (/\ball branches\b/.test(text)) return undefined;
  const hits = branches.flatMap((branch) => {
    const name = normalize(branch.name);
    return !reservedName(name) && phraseIn(normalize(text), name) ? [branch] : [];
  });
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0];
};

const matchCategory = (text: string, products: ShopChatProduct[]) => {
  const names = [...new Set(products.map((product) => product.category?.trim() || '').filter(Boolean))];
  const hits = names.filter((name) => {
    const normalized = normalize(name);
    return !reservedName(normalized) && phraseIn(normalize(text), normalized);
  });
  hits.sort((a, b) => b.length - a.length);
  return hits[0] || '';
};

const needsDates = (topic: ChatTopic) => topic === 'sales' || topic === 'profit' || topic === 'expenses' || topic === 'bestsellers' || topic === 'item';

const detectTopic = (text: string, products: ShopChatProduct[], services: ShopChatService[]): ChatTopic | undefined => {
  if (/^(hi|hello|hey|help)\b/.test(text) || /\bwhat can you\b|\bhow can you help\b|\bwhat do you know\b/.test(text)) return 'help';
  if (/\b(low on stock|low stock|running low|reorder list)\b/.test(text) || /^(reorder|reorders)$/.test(text) || (/\breorder\b/.test(text) && /\b(stock|products?|items?|what|which|list)\b/.test(text)) || (/\blow\b/.test(text) && /\b(stock|products?|items?|how many)\b/.test(text))) return 'low_stock';
  if (/\bout of stock\b|\bsold out\b|\bstock ?outs?\b/.test(text) || (/\bout\b/.test(text) && /\bstock\b/.test(text))) return 'out_of_stock';
  if (/\b(best sellers?|top sellers?|most sold|top products?|bestsellers?)\b/.test(text)) return 'bestsellers';
  if (/\b(stock worth|inventory value|stock value)\b/.test(text) || (/\bworth\b/.test(text) && /\bstock\b/.test(text))) return 'worth';
  if (/\b(profits?|margins?)\b/.test(text) || /\bhow much\b.*\b(make|made)\b/.test(text)) return 'profit';
  if (/\b(expenses?|spending)\b/.test(text) || /\bspent\b/.test(text)) return 'expenses';
  const soldWords = /\b(sold|sell|sales?|revenue|takings|turnover)\b/.test(text);
  if ((products.length || services.length) && soldWords) return 'item';
  if (soldWords || /\bhow much did we sell\b/.test(text)) return 'sales';
  if (/\bhow many\b/.test(text) && /\b(products?|items?|skus?)\b/.test(text) && products.length === 0) return 'products';
  if (/\b(number|count) of (products?|items?)\b/.test(text) || /\bproducts? we have\b/.test(text)) return 'products';
  if (products.length && (/\b(price|prices|cost)\b/.test(text) || /\bhow much\b/.test(text))) return 'prices';
  if (services.length && (/\bservices?\b/.test(text) || /\b(price|prices|cost|how much)\b/.test(text))) return 'services';
  if (/\bservices?\b/.test(text)) return 'services';
  if (/\b(prices?|price list)\b/.test(text)) return 'prices';
  if (products.length && (/\b(stock|left)\b/.test(text) || /\bhow many\b/.test(text) || /\bdo we have\b/.test(text))) return 'stock';
  if (products.length === 1 && text.split(' ').length <= 6) return 'stock';
  if (services.length && products.length === 0) return 'services';
  if (/\bproducts?\b/.test(text) && products.length === 0) return 'products';
  return undefined;
};

const HELP = 'Ask about this shop\'s records. For example: sales today, sales this week, sales from 1 Nov to 10 Nov, profit this month, how many products we have, what is low on stock, the price of an item, or which services are available.';

const clarifyDays = (): ChatReply => ({
  text: 'Say which days. For example: sales from 1 Nov to 10 Nov, profit this week, or sales yesterday.',
  lines: [],
  topic: 'help',
});

const helpReply = (): ChatReply => ({ text: HELP, lines: [], topic: 'help' });

const capLines = (lines: ChatLine[], cap = LIST_CAP) => ({ shown: lines.slice(0, cap), extra: Math.max(0, lines.length - cap) });

const productTitle = (product: ShopChatProduct) => (product.variant?.trim() ? `${product.name} (${product.variant.trim()})` : product.name);

const stockPhrase = (product: ShopChatProduct) => {
  if (!(product.stock > 0)) return 'out of stock';
  const unit = product.unit && product.unit !== 'piece' ? ` ${product.unit}` : '';
  return `${formatCount(product.stock)}${unit} in stock`;
};

const priceBits = (product: ShopChatProduct) => {
  const bits = [money(product.salePrice)];
  if (product.purchasePrice > 0) bits.push(`cost ${money(product.purchasePrice)}`);
  if ((product.wholesalePrice || 0) > 0) bits.push(`wholesale ${money(product.wholesalePrice || 0)}`);
  return bits.join(' · ');
};

const branchBit = (shop: ShopChatSnapshot, branch: ShopChatBranch | undefined, branchId: string) => {
  if (branch || shop.branches.length < 2) return '';
  const name = shop.branches.find((item) => item.id === branchId)?.name;
  return name ? ` · ${name}` : '';
};

const inPeriod = (shop: ShopChatSnapshot, period: ChatPeriod, branch?: ShopChatBranch) => {
  const sales = shop.sales.filter((sale) => !branch || sale.branchId === branch.id);
  const expenses = shop.expenses.filter((expense) => !branch || expense.branchId === branch.id);
  return {
    sales,
    expenses,
    totals: summarizePeriod(sales, expenses, period.start, period.end),
  };
};

const lineInPeriod = (sale: ShopChatSale, period: ChatPeriod) => !sale.voidedAt && instantInRange(sale.createdAt, period.start, period.end);

const placeOf = (branch?: ShopChatBranch) => (branch ? `At ${branch.name}, ` : '');

const atBranch = (branch: ShopChatBranch | undefined, sentence: string) => (
  branch ? `At ${branch.name}, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}` : sentence
);

const saleMatchesProduct = (sale: ShopChatSale, product: ShopChatProduct) => (
  (sale.productId && sale.productId === product.id) || normalize(sale.itemName || '') === normalize(product.name)
);

const answerShopQuestion = (question: string, shop: ShopChatSnapshot, options?: { now?: Date; context?: ChatContext }): ChatReply => {
  const now = options?.now ?? new Date();
  const context = options?.context;
  const text = prepareQuestion(question);
  if (!text) return helpReply();

  const branch = matchBranch(text, shop.branches);
  const period = resolvePeriod(text, now, shop.clock);
  const namedProducts = matchProducts(text, shop.products);
  const namedServices = matchServices(text, shop.services);
  let topic = detectTopic(text, namedProducts, namedServices);
  if (!topic && period) {
    if (context?.productId && (context.topic === 'stock' || context.topic === 'prices' || context.topic === 'item')) topic = 'item';
    else if (context?.serviceId && context.topic === 'services') topic = 'item';
    else if (context?.topic && needsDates(context.topic)) topic = context.topic;
    else topic = 'sales';
  }
  if (!topic && /^(and|also|what about|how about|same|same for)\b/.test(text) && context?.topic && context.topic !== 'help') topic = context.topic;
  if (!topic) return helpReply();
  if (topic === 'help') return helpReply();
  if (needsDates(topic) && !period && triedToNameDays(text)) return clarifyDays();

  const usedPeriod = needsDates(topic) ? (period ?? context?.period ?? periodFromReport('today', 'today', 'daily', 0, now, shop.clock)) : undefined;
  const products = shop.products.filter((product) => !branch || product.branchId === branch.id);
  const services = shop.services.filter((service) => !branch || service.branchId === branch.id);
  const category = namedProducts.length ? '' : matchCategory(text, products);
  const categorized = category ? products.filter((product) => normalize(product.category || '') === normalize(category)) : products;
  const where = placeOf(branch);

  if (topic === 'products') {
    const worth = stockWorth(categorized);
    const low = categorized.filter((product) => stockIsLow(product)).length;
    const out = categorized.filter((product) => !(product.stock > 0)).length;
    const attention = low + out === 0 ? 'Nothing is low or out.' : `${countPhrase(low, 'product')} ${low === 1 ? 'is' : 'are'} low and ${countPhrase(out, 'product')} ${out === 1 ? 'is' : 'are'} out.`;
    const opener = `${where}${category ? `${category} has` : where ? 'you have' : 'You have'}`;
    return {
      text: `${opener} ${countPhrase(categorized.length, 'product')} on the shelf, ${formatCount(worth.units)} in stock. ${attention} Worth ${money(worth.atCost)} at cost and ${money(worth.atSalePrice)} at selling price.`,
      lines: [],
      topic,
    };
  }

  if (topic === 'worth') {
    const worth = stockWorth(categorized);
    return {
      text: atBranch(branch, `Stock is worth ${money(worth.atCost)} at cost and ${money(worth.atSalePrice)} at selling price, with ${formatCount(worth.units)} on the shelf.`),
      lines: [],
      topic,
    };
  }

  if (topic === 'low_stock' || topic === 'out_of_stock') {
    const low = categorized.filter((product) => stockIsLow(product)).sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
    const out = categorized.filter((product) => !(product.stock > 0)).sort((a, b) => a.name.localeCompare(b.name));
    const rows = topic === 'out_of_stock' ? out : [...low, ...out];
    const listed = capLines(rows.map((product) => ({
      label: productTitle(product),
      detail: `${stockPhrase(product)} · reorder at ${reorderLevel(product)}${branchBit(shop, branch, product.branchId)}`,
    })));
    const lowSentence = low.length ? `${countPhrase(low.length, 'product')} ${low.length === 1 ? 'is' : 'are'} low on stock` : 'Nothing is low on stock';
    const outSentence = out.length ? `${countPhrase(out.length, 'product')} ${out.length === 1 ? 'is' : 'are'} out` : 'nothing is out';
    const text = topic === 'out_of_stock'
      ? atBranch(branch, `${out.length ? `${countPhrase(out.length, 'product')} ${out.length === 1 ? 'is' : 'are'} out of stock` : 'Nothing is out of stock'}.`)
      : atBranch(branch, `${lowSentence}, and ${outSentence}.`);
    const more = listed.extra ? ` Showing ${listed.shown.length} of ${rows.length}.` : '';
    return { text: `${text}${more}`, lines: listed.shown, topic };
  }

  if (topic === 'services' && namedServices.length === 0) {
    if (!services.length) return { text: atBranch(branch, 'No services are set up.'), lines: [], topic };
    const listed = capLines(services.slice().sort((a, b) => a.name.localeCompare(b.name)).map((service) => {
      const bits = [money(service.salePrice)];
      if ((service.directCost || 0) > 0) bits.push(`cost ${money(service.directCost || 0)}`);
      if ((service.monthlySharedCost || 0) > 0) bits.push(`shared ${money(service.monthlySharedCost || 0)} a month`);
      return { label: service.name, detail: `${bits.join(' · ')}${branchBit(shop, branch, service.branchId)}` };
    }));
    return {
      text: `${atBranch(branch, `${countPhrase(services.length, 'service')} ${services.length === 1 ? 'is' : 'are'} available.`)}${listed.extra ? ` Showing ${listed.shown.length} of ${services.length}.` : ''}`,
      lines: listed.shown,
      topic,
    };
  }

  if (topic === 'services' && namedServices.length) {
    const listed = namedServices.map((service) => ({
      label: service.name,
      detail: `${money(service.salePrice)}${branchBit(shop, branch, service.branchId)}`,
    }));
    const only = namedServices.length === 1 ? namedServices[0] : undefined;
    return {
      text: only ? `${only.name} is ${money(only.salePrice)}${branch ? ` at ${branch.name}` : ''}.` : `${namedServices.length} services match.`,
      lines: only ? [] : listed,
      topic,
      serviceId: only?.id,
    };
  }

  if (topic === 'prices' || topic === 'stock') {
    const chosen = namedProducts.length ? namedProducts.filter((product) => !branch || product.branchId === branch.id) : categorized;
    if (!chosen.length) {
      return { text: namedProducts.length ? atBranch(branch, 'That product is not on the shelf.') : atBranch(branch, 'No products are on the shelf.'), lines: [], topic };
    }
    if (chosen.length === 1) {
      const product = chosen[0];
      const lowNote = stockIsLow(product) ? ` It is low. Reorder at ${reorderLevel(product)}.` : '';
      const text = topic === 'prices'
        ? `${productTitle(product)} sells for ${priceBits(product)}, with ${stockPhrase(product)}${branchBit(shop, branch, product.branchId)}.${lowNote}`
        : product.stock > 0
          ? `${productTitle(product)} has ${stockPhrase(product)}${branchBit(shop, branch, product.branchId)}. Selling price ${priceBits(product)}.${lowNote}`
          : `${productTitle(product)} is out of stock${branchBit(shop, branch, product.branchId)}. Selling price ${priceBits(product)}.`;
      return { text, lines: [], topic, productId: product.id };
    }
    const listed = capLines(chosen.slice().sort((a, b) => a.name.localeCompare(b.name)).map((product) => ({
      label: productTitle(product),
      detail: topic === 'prices'
        ? `${priceBits(product)} · ${stockPhrase(product)}${branchBit(shop, branch, product.branchId)}`
        : `${stockPhrase(product)}${branchBit(shop, branch, product.branchId)}`,
    })), topic === 'prices' ? 20 : LIST_CAP);
    const lead = namedProducts.length
      ? `${chosen.length} products match.`
      : topic === 'prices'
        ? atBranch(branch, `Selling prices${category ? ` in ${category}` : ''}, ${countPhrase(chosen.length, 'product')}.`)
        : atBranch(branch, `${countPhrase(chosen.length, 'product')} on the shelf.`);
    const more = listed.extra ? ` Showing ${listed.shown.length} of ${chosen.length}.` : '';
    return { text: `${lead}${more}`, lines: listed.shown, topic };
  }

  if (!usedPeriod) return helpReply();
  const books = inPeriod(shop, usedPeriod, branch);

  if (topic === 'item') {
    const product = namedProducts[0] || (context?.productId ? shop.products.find((item) => item.id === context.productId) : undefined);
    const service = !product ? (namedServices[0] || (context?.serviceId ? shop.services.find((item) => item.id === context.serviceId) : undefined)) : undefined;
    const targets = namedProducts.length > 1 ? namedProducts : product ? [product] : [];
    if (targets.length) {
      const rows = targets.map((item) => {
        const lines = books.sales.filter((sale) => lineInPeriod(sale, usedPeriod) && saleMatchesProduct(sale, item));
        const qty = lines.reduce((sum, sale) => sum + (Number.isFinite(sale.qty) ? sale.qty || 0 : 0), 0);
        const revenue = lines.reduce((sum, sale) => sum + (Number.isFinite(sale.amount) ? sale.amount : 0), 0);
        return { item, qty, revenue };
      });
      if (rows.length === 1) {
        const row = rows[0];
        const text = row.qty === 0 && row.revenue === 0
          ? `${productTitle(row.item)} did not sell ${usedPeriod.label}.`
          : `${productTitle(row.item)} sold ${formatCount(row.qty)} ${usedPeriod.label}, for ${money(row.revenue)}.`;
        return { text, lines: [], topic, period: usedPeriod, productId: row.item.id };
      }
      const total = rows.reduce((sum, row) => sum + row.revenue, 0);
      return {
        text: `Sales for ${countPhrase(rows.length, 'product')} ${usedPeriod.label} are ${money(total)}.`,
        lines: rows.map((row) => ({ label: productTitle(row.item), detail: `${formatCount(row.qty)} sold · ${money(row.revenue)}` })),
        topic,
        period: usedPeriod,
      };
    }
    if (service) {
      const lines = books.sales.filter((sale) => lineInPeriod(sale, usedPeriod) && normalize(sale.itemName || '') === normalize(service.name));
      const revenue = lines.reduce((sum, sale) => sum + sale.amount, 0);
      const qty = lines.reduce((sum, sale) => sum + (sale.qty || 0), 0);
      const text = revenue === 0 && qty === 0
        ? `${service.name} did not sell ${usedPeriod.label}.`
        : `${service.name} sold ${formatCount(qty)} ${usedPeriod.label}, for ${money(revenue)}.`;
      return { text, lines: [], topic, period: usedPeriod, serviceId: service.id };
    }
    topic = 'sales';
  }

  if (topic === 'bestsellers') {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    books.sales.filter((sale) => lineInPeriod(sale, usedPeriod)).forEach((sale) => {
      const name = sale.itemName?.trim() || 'Item';
      const key = `${sale.type || ''}:${name.toLowerCase()}`;
      const row = map.get(key) || { name, qty: 0, revenue: 0 };
      row.qty += sale.qty || 0;
      row.revenue += sale.amount;
      map.set(key, row);
    });
    const ranked = [...map.values()].filter((row) => row.qty > 0 || row.revenue > 0).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 5);
    if (!ranked.length) return { text: atBranch(branch, `Nothing sold ${usedPeriod.label}.`), lines: [], topic, period: usedPeriod };
    return {
      text: atBranch(branch, `Best sellers ${usedPeriod.label}.`),
      lines: ranked.map((row) => ({ label: row.name, detail: `${formatCount(row.qty)} sold · ${money(row.revenue)}` })),
      topic,
      period: usedPeriod,
    };
  }

  if (topic === 'expenses') {
    const rows = books.expenses.filter((expense) => instantInRange(expense.createdAt, usedPeriod.start, usedPeriod.end));
    if (!rows.length) return { text: atBranch(branch, `No expenses ${usedPeriod.label}.`), lines: [], topic, period: usedPeriod };
    const listed = capLines(rows.map((expense) => ({ label: expense.title?.trim() || 'Expense', detail: money(expense.amount) })));
    return {
      text: `${atBranch(branch, `Expenses ${usedPeriod.label} are ${money(books.totals.expenseTotal)}.`)}${listed.extra ? ` Showing ${listed.shown.length} of ${rows.length}.` : ''}`,
      lines: listed.shown,
      topic,
      period: usedPeriod,
    };
  }

  if (topic === 'profit') {
    const focus = namedProducts.length === 1 ? namedProducts[0] : undefined;
    if (focus) {
      const lines = books.sales.filter((sale) => lineInPeriod(sale, usedPeriod) && saleMatchesProduct(sale, focus));
      const revenue = lines.reduce((sum, sale) => sum + sale.amount, 0);
      const tax = lines.reduce((sum, sale) => sum + (sale.taxAmount || 0), 0);
      const cost = lines.reduce((sum, sale) => sum + sale.cost, 0);
      const gross = revenue - tax - cost;
      return {
        text: `Profit on ${productTitle(focus)} ${usedPeriod.label} is ${money(gross)}. Sales ${money(revenue)}, tax ${money(tax)}, cost ${money(cost)}. Shop expenses are not included.`,
        lines: [],
        topic,
        period: usedPeriod,
        productId: focus.id,
      };
    }
    const { totals } = books;
    const lead = /\bgross\b/.test(text) && !/\bnet\b/.test(text) ? `Gross profit ${usedPeriod.label} is ${money(totals.grossProfit)}.` : `Profit ${usedPeriod.label} is ${money(totals.netProfit)}.`;
    return {
      text: `${atBranch(branch, lead)} Sales ${money(totals.revenue)}, tax ${money(totals.taxCollected)}, cost ${money(totals.cost)}, expenses ${money(totals.expenseTotal)}. Gross profit ${money(totals.grossProfit)}.`,
      lines: [],
      topic,
      period: usedPeriod,
    };
  }

  const { totals } = books;
  if (totals.receiptCount === 0) return { text: atBranch(branch, `No sales ${usedPeriod.label}.`), lines: [], topic: 'sales', period: usedPeriod };
  const posted = books.sales.filter((sale) => lineInPeriod(sale, usedPeriod));
  const productRevenue = posted.filter((sale) => sale.type === 'product').reduce((sum, sale) => sum + sale.amount, 0);
  const serviceRevenue = posted.filter((sale) => sale.type === 'service').reduce((sum, sale) => sum + sale.amount, 0);
  const split = productRevenue !== 0 && serviceRevenue !== 0 ? ` Products ${money(productRevenue)}. Services ${money(serviceRevenue)}.` : '';
  return {
    text: `${atBranch(branch, `Sales ${usedPeriod.label} are ${money(totals.revenue)}, from ${countPhrase(totals.receiptCount, 'receipt')}.`)}${split}`,
    lines: [],
    topic: 'sales',
    period: usedPeriod,
  };
};

export { answerShopQuestion };
