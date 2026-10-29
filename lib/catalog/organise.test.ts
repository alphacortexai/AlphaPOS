import assert from 'node:assert/strict';
import test from 'node:test';
import { organisePrompt, parseOrganiseAssignments, planCategoryUpdates, readOrganiseRequest } from './organise';

const ids = ['sugar', 'rice', 'oil', 'soap', 'match', 'book', 'vague'];

test('maps a suggestion onto an existing category ignoring case', () => {
  const assignments = parseOrganiseAssignments({
    assignments: [
      { productId: 'sugar', category: 'groceries' },
      { productId: 'rice', category: 'GROCERIES' },
    ],
  }, ids, ['Groceries']);
  assert.deepEqual(assignments, [
    { productId: 'sugar', category: 'Groceries' },
    { productId: 'rice', category: 'Groceries' },
  ]);
});

test('drops an unknown product id', () => {
  const assignments = parseOrganiseAssignments({
    assignments: [
      { productId: 'missing', category: 'Groceries' },
      { productId: 'sugar', category: 'Groceries' },
    ],
  }, ids, ['Groceries']);
  assert.deepEqual(assignments, [{ productId: 'sugar', category: 'Groceries' }]);
});

test('trims a category to 40 characters and leaves an empty name blank', () => {
  const long = `Household ${'x'.repeat(40)}`;
  const assignments = parseOrganiseAssignments({
    assignments: [
      { productId: 'soap', category: `  ${long}  ` },
      { productId: 'match', category: `  ${long}  ` },
      { productId: 'vague', category: '   ' },
      { productId: 'book', category: 'None' },
    ],
  }, ids, []);
  assert.equal(assignments[0].category.length, 40);
  assert.equal(assignments[0].category, long.trim().slice(0, 40));
  assert.equal(assignments[1].category, assignments[0].category);
  assert.equal(assignments[2].category, '');
  assert.equal(assignments[3].category, '');
});

test('keeps a new category only when several products share it', () => {
  const assignments = parseOrganiseAssignments({
    assignments: [
      { productId: 'sugar', category: 'Food' },
      { productId: 'rice', category: 'food' },
      { productId: 'oil', category: 'Food' },
      { productId: 'soap', category: 'Toiletries' },
      { productId: 'match', category: 'General' },
    ],
  }, ids, []);
  assert.deepEqual(assignments, [
    { productId: 'sugar', category: 'Food' },
    { productId: 'rice', category: 'Food' },
    { productId: 'oil', category: 'Food' },
    { productId: 'soap', category: '' },
    { productId: 'match', category: '' },
  ]);
});

test('reuses an existing category even for a single product', () => {
  const assignments = parseOrganiseAssignments({
    assignments: [{ productId: 'book', category: 'stationery' }],
  }, ids, ['Stationery']);
  assert.deepEqual(assignments, [{ productId: 'book', category: 'Stationery' }]);
});

test('request keeps only name, id, branch, and category, and caps the list', () => {
  const products = Array.from({ length: 405 }, (_, index) => ({
    id: `p${index}`,
    name: `Item ${index}`,
    branchId: 'main',
    category: index === 1 ? 'Drinks' : '',
    salePrice: 1000,
    stock: 4,
    sku: 'SKU',
    barcode: '123',
  }));
  const request = readOrganiseRequest({ products, categories: [' drinks ', 'Drinks', ''] });
  assert.ok(!('error' in request));
  if ('error' in request) return;
  assert.equal(request.products.length, 400);
  assert.deepEqual(request.products[0], { id: 'p0', name: 'Item 0', branchId: 'main', category: '' });
  assert.deepEqual(Object.keys(request.products[0]).sort(), ['branchId', 'category', 'id', 'name']);
  assert.deepEqual(request.categories, ['drinks']);
});

test('confirm plan matches an existing category and skips unknown ids and unchanged rows', () => {
  const planned = planCategoryUpdates(
    [
      { id: 'sugar', category: '' },
      { id: 'rice', category: 'Groceries' },
      { id: 'soap', category: 'Household' },
    ],
    [
      { productId: 'missing', category: 'Groceries' },
      { productId: 'sugar', category: ' groceries ' },
      { productId: 'rice', category: 'Groceries' },
      { productId: 'soap', category: '' },
      { productId: 'sugar', category: 'Other' },
    ],
    ['Groceries'],
  );
  assert.deepEqual(planned, [
    { productId: 'sugar', category: 'Groceries' },
    { productId: 'soap', category: '' },
  ]);
});

test('prompt sends shelf fields and existing categories, not prices', () => {
  const prompt = organisePrompt(
    [{ id: 'sugar', name: 'Sugar', branchId: 'main', category: '' }],
    ['Groceries'],
  );
  assert.match(prompt, /Groceries/);
  assert.match(prompt, /Products: \[{"id":"sugar","name":"Sugar","branchId":"main","category":""}\]/);
  assert.match(prompt, /do not record a sale/i);
});
