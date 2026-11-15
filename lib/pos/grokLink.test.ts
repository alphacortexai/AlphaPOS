import assert from 'node:assert/strict';
import test from 'node:test';
import { answerShopQuestion } from './assistantChat';
import {
  buildGrokSnapshot,
  firebaseMcpConfig,
  grokConnectionFromSecret,
  grokConnectorUrl,
  grokLinkId,
  grokOriginIsPublic,
  handleMcpMessage,
  isGrokToken,
  newGrokToken,
  readGrokSnapshot,
  respondToMcp,
  type GrokShopLink,
} from './grokLink';

const clock = { timezoneOffsetMinutes: 180, dayStartTime: '00:00' };
const now = new Date('2026-11-15T12:00:00.000Z');

const source = () => ({
  shopName: 'Kiosk',
  clock,
  branches: [{ id: 'main', name: 'Main' }],
  products: [
    { id: 'milk', name: 'Milk', branchId: 'main', stock: 4, purchasePrice: 1000, salePrice: 2000, image: 'data:image/png;base64,aaaa', reorderPoint: 2 },
  ],
  services: [{ id: 'print', name: 'Printing', branchId: 'main', salePrice: 500 }],
  sales: [
    { id: 's1', transactionId: 't1', type: 'product' as const, itemName: 'Milk', productId: 'milk', qty: 2, amount: 4000, cost: 2000, taxAmount: 0, branchId: 'main', createdAt: '2026-11-15T08:00:00.000Z', customerName: 'Amina', customerPhone: '0700111222' },
    { id: 'void', type: 'product' as const, itemName: 'Milk', qty: 9, amount: 90000, cost: 0, branchId: 'main', createdAt: '2026-11-15T09:00:00.000Z', voidedAt: '2026-11-15T09:05:00.000Z' },
  ],
  expenses: [{ title: 'Rent', amount: 1000, branchId: 'main', createdAt: '2026-11-15T07:00:00.000Z', receiptImage: 'data:image/jpeg;base64,bbbb' }],
});

test('a new token is a url-safe secret and its link id is the hash', async () => {
  const token = newGrokToken();
  assert.equal(isGrokToken(token), true);
  assert.equal(token.includes('+'), false);
  assert.equal(token.includes('/'), false);
  const linkId = await grokLinkId(token);
  assert.match(linkId, /^[a-f0-9]{64}$/);
  assert.equal(linkId === token, false);
  assert.equal(await grokLinkId(token), linkId);
});

test('the snapshot keeps shop figures and leaves out customers, photos, and voided sales', () => {
  const built = buildGrokSnapshot(source(), { now });
  const packed = JSON.stringify(built.snapshot);
  assert.equal(packed.includes('0700111222'), false);
  assert.equal(packed.includes('Amina'), false);
  assert.equal(packed.includes('base64'), false);
  assert.equal(packed.includes('90000'), false);
  assert.equal(built.snapshot.sales.length, 1);
  assert.equal(built.salesTruncatedBefore, '');
  const reply = answerShopQuestion('sales today', built.snapshot, { now });
  assert.match(reply.text, /UGX 4,000/);
});

test('a small budget keeps the newest sales and records the cutoff', () => {
  const sales = Array.from({ length: 40 }, (_, index) => ({
    id: `s${index}`,
    amount: 100,
    cost: 0,
    createdAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T08:00:00.000Z`,
    itemName: `Item ${index} ${'x'.repeat(80)}`,
  }));
  const built = buildGrokSnapshot({ ...source(), sales }, { now, budget: 2500 });
  assert.equal(built.snapshot.sales.length < sales.length, true);
  assert.equal(built.salesTruncatedBefore.length > 0, true);
  const oldestKept = built.snapshot.sales[built.snapshot.sales.length - 1]?.createdAt || '';
  assert.equal(oldestKept >= built.salesTruncatedBefore || oldestKept === built.salesTruncatedBefore, true);
});

test('a stored snapshot drops customer fields before a tool can see them', () => {
  const dirty = {
    shopName: 'Kiosk',
    clock,
    products: [],
    services: [],
    expenses: [],
    branches: [],
    sales: [{ id: 's1', amount: 10, cost: 0, createdAt: '2026-11-15T08:00:00.000Z', customerPhone: '0700111222', customerName: 'Amina' }],
  };
  const snapshot = readGrokSnapshot(dirty);
  assert.equal(JSON.stringify(snapshot).includes('0700111222'), false);
  assert.equal(JSON.stringify(snapshot).includes('Amina'), false);
});

test('secrets decide whether the shop is connected', () => {
  assert.deepEqual(grokConnectionFromSecret(undefined), { connected: false, token: '' });
  assert.deepEqual(grokConnectionFromSecret({ grokConnected: false, grokToken: newGrokToken() }), { connected: false, token: '' });
  const token = newGrokToken();
  assert.deepEqual(grokConnectionFromSecret({ grokConnected: true, grokToken: token }), { connected: true, token });
  assert.equal(grokConnectorUrl('https://www.alphapos.store', token), `https://www.alphapos.store/api/mcp?token=${token}`);
  assert.equal(grokOriginIsPublic('https://www.alphapos.store'), true);
  assert.equal(grokOriginIsPublic('http://localhost:3000'), false);
});

const linkFor = (): GrokShopLink => {
  const built = buildGrokSnapshot(source(), { now });
  return { snapshot: built.snapshot, updatedAt: built.updatedAt, salesTruncatedBefore: '' };
};

test('initialize and ask_shop answer from the shop records', () => {
  const link = linkFor();
  const hello = handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, link, now);
  assert.equal(hello.kind, 'json');
  if (hello.kind !== 'json') return;
  const result = hello.body.result as { serverInfo: { name: string }; protocolVersion: string };
  assert.equal(result.serverInfo.name, 'AlphaPOS');
  assert.equal(result.protocolVersion, '2025-03-26');

  const tools = handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, link, now);
  assert.equal(tools.kind, 'json');
  if (tools.kind !== 'json') return;
  const names = (tools.body.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
  assert.deepEqual(names, ['ask_shop', 'shop_balances', 'shop_status']);

  const answer = handleMcpMessage({
    jsonrpc: '2.0',
    id: 'q',
    method: 'tools/call',
    params: { name: 'ask_shop', arguments: { question: 'sales today' } },
  }, link, now);
  assert.equal(answer.kind, 'json');
  if (answer.kind !== 'json') return;
  const text = (answer.body.result as { content: { text: string }[] }).content[0].text;
  assert.match(text, /UGX 4,000/);
  assert.equal(text.includes('0700111222'), false);

  const note = handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, link, now);
  assert.equal(note.kind, 'accept');

  const waiting = handleMcpMessage({
    jsonrpc: '2.0',
    id: 'b',
    method: 'tools/call',
    params: { name: 'shop_balances', arguments: { kind: 'accounts' } },
  }, link, now);
  assert.equal(waiting.kind, 'json');
  if (waiting.kind !== 'json') return;
  assert.match((waiting.body.result as { content: { text: string }[] }).content[0].text, /Ask again in a moment/);

  const withBooks = handleMcpMessage({
    jsonrpc: '2.0',
    id: 'c',
    method: 'tools/call',
    params: { name: 'shop_balances', arguments: { kind: 'accounts', name: 'cash' } },
  }, { ...link, books: { accounts: [{ name: 'CASH', balance: 15500 }], customers: [], suppliers: [] } }, now);
  assert.equal(withBooks.kind, 'json');
  if (withBooks.kind !== 'json') return;
  assert.match((withBooks.body.result as { content: { text: string }[] }).content[0].text, /CASH: UGX 15,500/);

  const throughAsk = handleMcpMessage({
    jsonrpc: '2.0',
    id: 'd',
    method: 'tools/call',
    params: { name: 'ask_shop', arguments: { question: 'cash, mobile money, bank and float balances on 15 Nov 2026' } },
  }, { ...link, books: { accounts: [{ name: 'CASH', balance: 15500 }, { name: 'Bank', balance: 8000 }], customers: [], suppliers: [], drawer: { expectedCash: 25500 } } }, now);
  assert.equal(throughAsk.kind, 'json');
  if (throughAsk.kind !== 'json') return;
  const balanceText = (throughAsk.body.result as { content: { text: string }[] }).content[0].text;
  assert.match(balanceText, /CASH: UGX 15,500/);
  assert.match(balanceText, /Bank: UGX 8,000/);
  assert.match(balanceText, /Expected cash in the drawer is UGX 25,500/);
  assert.equal(balanceText.includes('No sales'), false);
});

const firestoreLink = (tokenHash: string) => ({
  name: `projects/demo/databases/(default)/documents/grokLinks/${tokenHash}`,
  fields: {
    updatedAt: { stringValue: '2026-11-15T12:00:00.000Z' },
    salesTruncatedBefore: { stringValue: '' },
    snapshot: {
      mapValue: {
        fields: {
          shopName: { stringValue: 'Kiosk' },
          clock: { mapValue: { fields: { timezoneOffsetMinutes: { integerValue: '180' }, dayStartTime: { stringValue: '00:00' } } } },
          branches: { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'main' }, name: { stringValue: 'Main' } } } }] } },
          products: { arrayValue: { values: [{ mapValue: { fields: {
            id: { stringValue: 'milk' },
            name: { stringValue: 'Milk' },
            branchId: { stringValue: 'main' },
            stock: { integerValue: '4' },
            purchasePrice: { integerValue: '1000' },
            salePrice: { integerValue: '2000' },
          } } }] } },
          services: { arrayValue: { values: [] } },
          sales: { arrayValue: { values: [{ mapValue: { fields: {
            id: { stringValue: 's1' },
            amount: { integerValue: '4000' },
            cost: { integerValue: '2000' },
            createdAt: { stringValue: '2026-11-15T08:00:00.000Z' },
            type: { stringValue: 'product' },
            itemName: { stringValue: 'Milk' },
            customerPhone: { stringValue: '0700111222' },
          } } }] } },
          expenses: { arrayValue: { values: [] } },
        },
      },
    },
  },
});

test('a bearer token reads the shop and answers a question', async () => {
  const token = newGrokToken();
  const linkId = await grokLinkId(token);
  let seen = '';
  const fetchImpl: typeof fetch = async (url) => {
    seen = String(url);
    assert.equal(seen.includes(token), false);
    assert.equal(seen.includes(linkId), true);
    return new Response(JSON.stringify(firestoreLink(linkId)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const response = await respondToMcp({
    authorization: `Bearer ${token}`,
    tokenHeader: null,
    queryToken: null,
    accept: 'application/json, text/event-stream',
    protocolHeader: null,
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'ask_shop', arguments: { question: 'sales today' } } }),
    projectId: 'demo',
    apiKey: 'key',
    referer: 'https://www.alphapos.store/',
    now,
    fetchImpl,
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body) as { result: { content: { text: string }[] } };
  assert.match(payload.result.content[0].text, /UGX 4,000/);
  assert.equal(payload.result.content[0].text.includes('0700111222'), false);
});

test('a missing token is refused before Firestore is called', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response('', { status: 500 });
  };
  const response = await respondToMcp({
    authorization: null,
    tokenHeader: null,
    queryToken: 'not-a-token',
    accept: 'application/json',
    protocolHeader: null,
    body: '{}',
    projectId: 'demo',
    apiKey: 'key',
    referer: 'https://www.alphapos.store/',
    fetchImpl,
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  assert.match(response.headers['WWW-Authenticate'], /Bearer/);
});

test('firestore rules that are not published return a setup message', async () => {
  const token = newGrokToken();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } }), { status: 403 });
  const response = await respondToMcp({
    authorization: null,
    tokenHeader: token,
    queryToken: token,
    accept: 'application/json',
    protocolHeader: '2025-06-18',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    projectId: 'demo',
    apiKey: 'key',
    referer: 'https://www.alphapos.store/',
    fetchImpl,
  });
  assert.equal(response.status, 503);
  const payload = JSON.parse(response.body) as { error: { message: string } };
  assert.match(payload.error.message, /Firestore rules/);
});

test('firebase config prefers the server key and referer', () => {
  const previousKey = process.env.FIREBASE_MCP_API_KEY;
  const previousReferer = process.env.GROK_MCP_REFERER;
  process.env.FIREBASE_MCP_API_KEY = 'server-key';
  process.env.GROK_MCP_REFERER = 'https://shop.example/';
  const config = firebaseMcpConfig();
  assert.equal(config.apiKey, 'server-key');
  assert.equal(config.referer, 'https://shop.example/');
  if (previousKey === undefined) delete process.env.FIREBASE_MCP_API_KEY;
  else process.env.FIREBASE_MCP_API_KEY = previousKey;
  if (previousReferer === undefined) delete process.env.GROK_MCP_REFERER;
  else process.env.GROK_MCP_REFERER = previousReferer;
});
