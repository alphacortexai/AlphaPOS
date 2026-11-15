import { createSign } from 'node:crypto';
import { catalogRows, finiteAmount, overlayStock } from './shopMath';
import { decodeFirestoreDocument } from './shopRead';
import { buildGrokSnapshot, GrokLinkError, grokLinkId, isGrokToken, loadGrokLink, type GrokShopLink, type GrokSource } from './grokLink';

type ServiceAccount = {
  clientEmail: string;
  privateKey: string;
  projectId: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const amount = (value: unknown) => {
  const parsed = finiteAmount(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const readServiceAccount = (raw: string | undefined): ServiceAccount | null => {
  const trimmed = raw?.trim() || '';
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new GrokLinkError('key', 'The Firebase service account on the server could not be read. Paste the key again so the value starts with { and ends with }.');
  }
  const record = asRecord(parsed);
  const clientEmail = text(record?.client_email);
  let privateKey = text(record?.private_key);
  const projectId = text(record?.project_id);
  if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');
  if (!clientEmail || !projectId || !privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new GrokLinkError('key', 'The Firebase service account on the server is missing the project, email, or private key.');
  }
  return { clientEmail, privateKey, projectId };
};

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

const signJwt = (account: ServiceAccount, nowSeconds: number) => {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.privateKey);
  return `${unsigned}.${base64url(signature)}`;
};

let cachedToken: { email: string; token: string; exp: number } | null = null;

export const clearServiceTokenCache = () => {
  cachedToken = null;
};

const accessToken = async (account: ServiceAccount, fetchImpl: typeof fetch, now: Date) => {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (cachedToken && cachedToken.email === account.clientEmail && cachedToken.exp - 60 > nowSeconds) return cachedToken.token;
  const assertion = signJwt(account, nowSeconds);
  let response: Response;
  try {
    response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
  } catch {
    throw new GrokLinkError('unavailable');
  }
  if (!response.ok) {
    throw new GrokLinkError('key', 'The Firebase service account was rejected. Generate a new private key and replace FIREBASE_SERVICE_ACCOUNT.');
  }
  const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
  const token = text(body.access_token);
  if (!token) throw new GrokLinkError('key', 'The Firebase service account was rejected. Generate a new private key and replace FIREBASE_SERVICE_ACCOUNT.');
  const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
  cachedToken = { email: account.clientEmail, token, exp: nowSeconds + expiresIn };
  return token;
};

const firestoreError = async (response: Response) => {
  const detail = await response.text().catch(() => '');
  if (response.status === 401 || response.status === 403) {
    throw new GrokLinkError('key', 'The Firebase service account cannot read this shop. Use the key from Project settings, under Service accounts.');
  }
  if (/referer|api key/i.test(detail)) throw new GrokLinkError('key');
  throw new GrokLinkError('unavailable');
};

const documentUrl = (projectId: string, path: string) => (
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`
);

const getDocument = async (projectId: string, path: string, bearer: string, fetchImpl: typeof fetch) => {
  const response = await fetchImpl(documentUrl(projectId, path), {
    headers: { Authorization: `Bearer ${bearer}` },
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) await firestoreError(response);
  return decodeFirestoreDocument(await response.json()) ?? {};
};

const listDocuments = async (projectId: string, path: string, bearer: string, fetchImpl: typeof fetch) => {
  const rows: Record<string, unknown>[] = [];
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(documentUrl(projectId, path));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${bearer}` },
      cache: 'no-store',
    });
    if (response.status === 404) return rows;
    if (!response.ok) await firestoreError(response);
    const body = await response.json() as { documents?: unknown; nextPageToken?: unknown };
    const documents = Array.isArray(body.documents) ? body.documents : [];
    documents.forEach((entry) => {
      const record = asRecord(entry);
      const decoded = decodeFirestoreDocument(record) ?? {};
      const name = text(record?.name);
      const id = name.split('/').pop() || '';
      const rowId = text(decoded.id) || id;
      rows.push(rowId ? { ...decoded, id: rowId } : decoded);
    });
    pageToken = text(body.nextPageToken);
    if (!pageToken) break;
  }
  return rows;
};

const shopSource = (
  shop: Record<string, unknown>,
  sales: Record<string, unknown>[],
  expenses: Record<string, unknown>[],
  stock: Record<string, number>,
): GrokSource => {
  const clockRecord = asRecord(shop.shopTimeSettings);
  const products = overlayStock(
    catalogRows(shop.products).map((product) => ({ ...product, id: text(product.id), stock: amount(product.stock) })),
    stock,
  );
  return {
    shopName: text(shop.shopName),
    products,
    services: catalogRows(shop.services),
    sales: sales.length > 0 ? sales : catalogRows(shop.sales),
    expenses: expenses.length > 0 ? expenses : catalogRows(shop.expenses),
    branches: catalogRows(shop.branches),
    clock: {
      timezoneOffsetMinutes: amount(clockRecord?.timezoneOffsetMinutes),
      dayStartTime: text(clockRecord?.dayStartTime) || '00:00',
    },
  } as GrokSource;
};

export const loadLiveShop = async (input: {
  serviceAccount: string;
  token: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GrokShopLink | null> => {
  if (!isGrokToken(input.token)) return null;
  const account = readServiceAccount(input.serviceAccount);
  if (!account) return null;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const bearer = await accessToken(account, fetchImpl, now);
  const linkId = await grokLinkId(input.token);
  const link = await getDocument(account.projectId, `grokLinks/${linkId}`, bearer, fetchImpl);
  const ownerUid = text(link?.ownerUid);
  if (!ownerUid) return null;
  const shop = await getDocument(account.projectId, ['users', ownerUid, 'pos', 'data'].map(encodeURIComponent).join('/'), bearer, fetchImpl);
  if (!shop) return null;
  const split = shop.ledgerSplit === true;
  const base = ['users', ownerUid, 'pos', 'data'].map(encodeURIComponent).join('/');
  const [sales, expenses, stockRows] = split
    ? await Promise.all([
      listDocuments(account.projectId, `${base}/sales`, bearer, fetchImpl),
      listDocuments(account.projectId, `${base}/expenses`, bearer, fetchImpl),
      listDocuments(account.projectId, `${base}/stock`, bearer, fetchImpl),
    ])
    : [[], [], []] as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];
  const stock: Record<string, number> = {};
  stockRows.forEach((row) => {
    const id = text(row.id);
    if (id) stock[id] = amount(row.qty);
  });
  const built = buildGrokSnapshot(shopSource(shop, sales, expenses, stock), { now });
  return { ...built, live: true };
};

export const loadShopForToken = async (input: {
  token: string;
  serviceAccount: string;
  projectId: string;
  apiKey: string;
  referer: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GrokShopLink | null> => {
  if (input.serviceAccount.trim()) {
    return loadLiveShop({
      serviceAccount: input.serviceAccount,
      token: input.token,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
  }
  return loadGrokLink({
    projectId: input.projectId,
    apiKey: input.apiKey,
    token: input.token,
    referer: input.referer,
    fetchImpl: input.fetchImpl,
  });
};
