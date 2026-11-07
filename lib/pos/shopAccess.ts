export type ShopAccessRole = 'shop_owner' | 'admin' | 'manager' | 'cashier' | 'stock';

export type ShopAccess = {
  ownerUid: string;
  shopName: string;
  role: ShopAccessRole;
};

const STAFF_ROLES = new Set<ShopAccessRole>(['admin', 'manager', 'cashier', 'stock']);

const catalogCount = (value: unknown) => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
};

export const staffRole = (value: unknown): ShopAccessRole => (
  STAFF_ROLES.has(value as ShopAccessRole) ? value as ShopAccessRole : 'cashier'
);

/** A person invited to someone else's shop does not also get an empty shop of their own. */
export const shopsForSignedInUser = (input: {
  userUid: string;
  ownShopExists: boolean;
  ownShopName?: string;
  memberships: { ownerUid?: unknown; shopName?: unknown; role?: unknown }[];
}): ShopAccess[] => {
  const linked: ShopAccess[] = [];
  input.memberships.forEach((membership) => {
    const ownerUid = typeof membership.ownerUid === 'string' ? membership.ownerUid : '';
    if (!ownerUid || ownerUid === input.userUid || linked.some((shop) => shop.ownerUid === ownerUid)) return;
    const shopName = typeof membership.shopName === 'string' && membership.shopName.trim() ? membership.shopName.trim() : 'Linked shop';
    linked.push({ ownerUid, shopName, role: staffRole(membership.role) });
  });
  const shopName = input.ownShopName?.trim() || 'My Shop';
  const own: ShopAccess = { ownerUid: input.userUid, shopName, role: 'shop_owner' };
  if (!input.ownShopExists && linked.length > 0) return linked;
  if (linked.length > 0) return [...linked, own];
  return [own];
};

/** A name copied from an invite is not a business. Products, services, or sales are. */
export const ownShopIsReal = (data: Record<string, unknown> | undefined) => {
  if (!data) return false;
  return catalogCount(data.products) > 0 || catalogCount(data.services) > 0 || catalogCount(data.sales) > 0;
};

export const chooseShopId = (
  shops: ShopAccess[],
  preferred: { invited?: string; remembered?: string; active?: string },
) => {
  const has = (id?: string) => Boolean(id && shops.some((shop) => shop.ownerUid === id));
  if (has(preferred.invited)) return preferred.invited as string;
  if (has(preferred.remembered)) return preferred.remembered as string;
  if (has(preferred.active)) return preferred.active as string;
  return shops[0]?.ownerUid || '';
};

export const accessDenied = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
  const message = error instanceof Error ? error.message : '';
  return code.includes('permission-denied') || /permission/i.test(message);
};

/** The shop document's saved role belongs to whoever last saved it. The invite grant decides, and it never makes a guest the owner. */
export const openedRole = (input: {
  userUid: string;
  shopOwnerUid: string;
  membershipRole?: ShopAccessRole;
  staffRole?: unknown;
}): ShopAccessRole => {
  if (input.userUid && input.shopOwnerUid === input.userUid) return 'shop_owner';
  if (input.membershipRole && STAFF_ROLES.has(input.membershipRole)) return input.membershipRole;
  if (STAFF_ROLES.has(input.staffRole as ShopAccessRole)) return input.staffRole as ShopAccessRole;
  return 'cashier';
};
