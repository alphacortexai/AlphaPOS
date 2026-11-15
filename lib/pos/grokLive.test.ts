import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { grokLinkId, newGrokToken } from './grokLink';
import { clearServiceTokenCache, loadLiveShop, readServiceAccount } from './grokLive';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const accountJson = () => JSON.stringify({
  client_email: 'grok@demo.iam.gserviceaccount.com',
  private_key: pem,
  project_id: 'demo',
});

const field = (value: string | number | boolean) => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  return { integerValue: String(value) };
};

const document = (path: string, fields: Record<string, unknown>) => ({
  name: `projects/demo/databases/(default)/documents/${path}`,
  fields,
});

test('a service account surrounded by blank lines still parses', () => {
  const raw = `\n${JSON.stringify({
    client_email: 'grok@demo.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    project_id: 'demo',
  })}\n`;
  const account = readServiceAccount(raw);
  assert.equal(account?.projectId, 'demo');
  assert.equal(account?.privateKey.includes('\n'), true);
  assert.throws(() => readServiceAccount('   not-json   '), /starts with \{/);
});

test('a live read uses saved sales and the latest stock while the page is closed', async () => {
  clearServiceTokenCache();
  const token = newGrokToken();
  const linkId = await grokLinkId(token);
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push(url);
    if (url.includes('oauth2.googleapis.com')) {
      assert.match(String(init?.body), /jwt-bearer/);
      return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
    }
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer ya29.test');
    if (url.includes(`/grokLinks/${linkId}`)) {
      return new Response(JSON.stringify(document(`grokLinks/${linkId}`, {
        ownerUid: field('owner-1'),
        linkId: field(linkId),
      })), { status: 200 });
    }
    if (url.includes('/pos/data/sales')) {
      return new Response(JSON.stringify({
        documents: [document('users/owner-1/pos/data/sales/s1', {
          id: field('s1'),
          amount: field(4000),
          cost: field(2000),
          createdAt: field('2026-11-15T08:00:00.000Z'),
          type: field('product'),
          itemName: field('Milk'),
          customerPhone: field('0700111222'),
        })],
      }), { status: 200 });
    }
    if (url.includes('/pos/data/expenses')) return new Response(JSON.stringify({ documents: [] }), { status: 200 });
    if (url.includes('/pos/data/stock')) {
      return new Response(JSON.stringify({
        documents: [document('users/owner-1/pos/data/stock/milk', { qty: field(9) })],
      }), { status: 200 });
    }
    if (url.includes('/pos/data')) {
      return new Response(JSON.stringify(document('users/owner-1/pos/data', {
        shopName: field('C & E Supplies'),
        ledgerSplit: field(true),
        shopTimeSettings: {
          mapValue: { fields: { timezoneOffsetMinutes: field(180), dayStartTime: field('00:00') } },
        },
        branches: { arrayValue: { values: [{ mapValue: { fields: { id: field('001'), name: field('001') } } }] } },
        products: { arrayValue: { values: [{ mapValue: { fields: {
          id: field('milk'),
          name: field('Milk'),
          branchId: field('001'),
          stock: field(1),
          purchasePrice: field(1000),
          salePrice: field(2000),
        } } }] } },
        services: { arrayValue: { values: [] } },
      })), { status: 200 });
    }
    return new Response('missing', { status: 404 });
  };

  const link = await loadLiveShop({
    serviceAccount: accountJson(),
    token,
    now: new Date('2026-11-15T12:00:00.000Z'),
    fetchImpl,
  });
  assert.equal(link?.live, true);
  assert.equal(link?.snapshot.shopName, 'C & E Supplies');
  assert.equal(link?.snapshot.products[0]?.stock, 9);
  assert.equal(link?.snapshot.sales[0]?.amount, 4000);
  assert.equal(JSON.stringify(link?.snapshot).includes('0700111222'), false);
  assert.equal(seen.some((url) => url.includes('apiKey') || url.includes('key=')), false);
});
