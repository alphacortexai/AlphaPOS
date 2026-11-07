import { openedRole, type ShopAccessRole } from './shopAccess';

/** Functions the shop owner can turn on or off for each person. Settings, backup, and the assistant stay with the owner. */
export const STAFF_PERMISSIONS = [
  'sell',
  'salesHistory',
  'customers',
  'products',
  'editCatalog',
  'seeCost',
  'expenses',
  'reports',
  'accounts',
  'activity',
  'manageStaff',
  'allBranches',
] as const;

export type StaffPermission = typeof STAFF_PERMISSIONS[number];

export const PERMISSION_LABELS: Record<StaffPermission, string> = {
  sell: 'Make a sale',
  salesHistory: 'See past sales',
  customers: 'Customers and what they owe',
  products: 'See products and stock',
  editCatalog: 'Change products, services, and stock',
  seeCost: 'See cost and profit',
  expenses: 'Record and see expenses',
  reports: 'Reports and close of day',
  accounts: 'See account balances',
  activity: 'See the activity log',
  manageStaff: 'See who works here',
  allBranches: 'Every branch, not only their own',
};

const PRESETS: Record<Exclude<ShopAccessRole, 'shop_owner'>, readonly StaffPermission[]> = {
  cashier: ['sell', 'salesHistory', 'customers', 'products', 'allBranches'],
  stock: ['products', 'editCatalog', 'seeCost', 'allBranches'],
  manager: ['sell', 'salesHistory', 'customers', 'products', 'editCatalog', 'seeCost', 'expenses', 'reports', 'accounts', 'activity', 'allBranches'],
  admin: ['sell', 'salesHistory', 'customers', 'products', 'editCatalog', 'seeCost', 'expenses', 'reports', 'accounts', 'activity', 'manageStaff', 'allBranches'],
};

const ALLOWED = new Set<string>(STAFF_PERMISSIONS);

export const normalizePermissions = (value: unknown): StaffPermission[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const picked: StaffPermission[] = [];
  value.forEach((item) => {
    if (typeof item === 'string' && ALLOWED.has(item) && !picked.includes(item as StaffPermission)) picked.push(item as StaffPermission);
  });
  return picked;
};

/** A saved list, including an empty one, is intentional. A missing list uses the role. */
export const permissionsFor = (role: ShopAccessRole, custom?: StaffPermission[]): StaffPermission[] => {
  if (role === 'shop_owner') return [...STAFF_PERMISSIONS];
  if (custom) return custom;
  return [...(PRESETS[role] ?? PRESETS.cashier)];
};

export const permissionsMatchPreset = (role: ShopAccessRole, custom: readonly StaffPermission[]) => {
  if (role === 'shop_owner') return false;
  const preset = PRESETS[role];
  return preset.length === custom.length && preset.every((key) => custom.includes(key));
};

export type StaffAccess = {
  role: ShopAccessRole;
  permissions: StaffPermission[];
  branchId: string;
};

/** The invite grant wins. A row inside the shop document cannot raise someone to owner. */
export const resolveStaffAccess = (input: {
  userUid: string;
  shopOwnerUid: string;
  membershipRole?: unknown;
  membershipPermissions?: unknown;
  membershipBranchId?: unknown;
  staffRole?: unknown;
  staffBranchId?: unknown;
}): StaffAccess => {
  const role = openedRole({
    userUid: input.userUid,
    shopOwnerUid: input.shopOwnerUid,
    membershipRole: input.membershipRole as ShopAccessRole | undefined,
    staffRole: input.staffRole,
  });
  const custom = normalizePermissions(input.membershipPermissions);
  const branchSource = typeof input.membershipBranchId === 'string' && input.membershipBranchId
    ? input.membershipBranchId
    : input.staffBranchId;
  return {
    role,
    permissions: permissionsFor(role, custom),
    branchId: role === 'shop_owner' || typeof branchSource !== 'string' ? '' : branchSource,
  };
};

export type BookReads = {
  sales: boolean;
  expenses: boolean;
  payments: boolean;
  supplierBills: boolean;
  supplierPayments: boolean;
  stock: boolean;
  activity: boolean;
  migrate: boolean;
};

export const booksForPermissions = (permissions: readonly StaffPermission[], ownsShop: boolean): BookReads => {
  const has = (key: StaffPermission) => ownsShop || permissions.includes(key);
  return {
    sales: has('salesHistory') || has('sell') || has('reports'),
    expenses: has('expenses') || has('reports'),
    payments: has('customers'),
    supplierBills: has('editCatalog') || has('seeCost'),
    supplierPayments: has('expenses') || has('accounts'),
    stock: has('products') || has('sell') || has('editCatalog'),
    activity: has('activity'),
    migrate: ownsShop,
  };
};

/** Remote rows win when this person may read them. Otherwise the copy kept on the shop document stays hidden. */
export const recordsForAccess = <T extends { id: string }>(allowed: boolean, embedded: T[], remote: T[]) => {
  if (!allowed) return [];
  if (remote.length === 0) return embedded;
  const map = new Map(embedded.map((item) => [item.id, item]));
  remote.forEach((item) => map.set(item.id, item));
  return [...map.values()];
};

/** The register and the product shelf show every product. A branch on the person must not hide the catalog. */
export const registerCatalog = <T,>(products: T[]): T[] => products;

/** An invited person is not the owner of that shop. */
export const seesInvitedShelf = (userUid: string, shopOwnerUid: string) => (
  Boolean(userUid && shopOwnerUid && userUid !== shopOwnerUid)
);

/** Products and branches stay visible for an invite, even when other switches are off. */
export const canViewShelf = (invited: boolean, permissions: readonly StaffPermission[]) => (
  invited || permissions.some((key) => key === 'products' || key === 'sell' || key === 'editCatalog')
);

/** Every branch and every product of the invited shop. The person's branch does not remove any. */
export const shelfForInvite = <P, B, S>(catalog: { products: readonly P[]; branches: readonly B[]; services?: readonly S[] }) => ({
  products: registerCatalog([...catalog.products]),
  branches: [...catalog.branches],
  services: [...(catalog.services ?? [])],
});

/** Sales and expenses can follow a branch. A branch with no rows still shows the whole list, so the screen is not blank. */
export const rowsForBranch = <T extends { branchId?: string }>(rows: T[], branchId: string, branchCount: number): T[] => {
  if (!branchId || branchCount < 2) return rows;
  const own = rows.filter((row) => !row.branchId || row.branchId === branchId);
  return own.length > 0 ? own : rows;
};

const CATALOG_FIELDS = new Set(['products', 'services', 'suppliers', 'expenseGroups']);
const TILL_FIELDS = new Set(['customers', 'heldTickets', 'cashSessions']);

/** Staff never write the owner's settings, staff list, balances, or shop name. */
export const staffMayWriteShopField = (field: string, permissions: readonly StaffPermission[], ownsShop: boolean) => {
  if (ownsShop) return true;
  if (field === 'revision' || field === 'updatedAt' || field === 'ledgerSplit') return true;
  if (CATALOG_FIELDS.has(field)) return permissions.includes('editCatalog');
  if (TILL_FIELDS.has(field)) return permissions.includes('sell') || permissions.includes('customers');
  return false;
};
