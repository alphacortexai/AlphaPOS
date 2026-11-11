export const ONBOARDING_ROLES = ['cashier', 'manager', 'stock', 'admin'] as const;

export type OnboardingRole = typeof ONBOARDING_ROLES[number];

export type OnboardingStaff = {
  name: string;
  email: string;
  role: OnboardingRole;
};

const ACTIVITY_KEYS = [
  'products',
  'services',
  'sales',
  'expenses',
  'customers',
  'users',
  'suppliers',
  'heldTickets',
  'cashSessions',
  'customerPayments',
  'supplierBills',
  'supplierPayments',
] as const;

const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');

const collectionCount = (value: unknown) => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
};

const defaultShopName = (value: unknown) => {
  if (typeof value !== 'string') return true;
  const name = value.trim();
  return !name || name.toLowerCase() === 'my shop';
};

const branchNameOf = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('name' in value)) return '';
  return typeof value.name === 'string' ? value.name.trim() : '';
};

/**
 * First-time owners name the shop and its first branch.
 * Someone invited into another shop, and any shop that already has a name,
 * a chosen branch, or business records, goes straight to the counter.
 */
export const shopNeedsOnboarding = (
  data: Record<string, unknown> | null | undefined,
  ownsShop: boolean,
): boolean => {
  if (!ownsShop) return false;
  if (!data) return true;
  if (data.onboardingComplete === true) return false;
  if (data.onboardingComplete === false) return true;
  if (!defaultShopName(data.shopName)) return false;
  if (ACTIVITY_KEYS.some((key) => collectionCount(data[key]) > 0)) return false;
  const branches = Array.isArray(data.branches) ? data.branches : [];
  if (branches.length > 1) return false;
  const branchName = branchNameOf(branches[0]).toLowerCase();
  if (branchName && branchName !== 'main branch') return false;
  return true;
};

export const reviewShopName = (value: string) => {
  const shopName = tidy(value);
  if (!shopName) return { ok: false as const, error: 'Enter a shop name.' };
  if (shopName.length > 80) return { ok: false as const, error: 'Use a shorter shop name.' };
  return { ok: true as const, shopName };
};

export const reviewBranchName = (value: string, location: string) => {
  const branchName = tidy(value);
  const branchLocation = tidy(location);
  if (!branchName) return { ok: false as const, error: 'Enter a branch name.' };
  if (branchName.length > 80) return { ok: false as const, error: 'Use a shorter branch name.' };
  if (branchLocation.length > 80) return { ok: false as const, error: 'Use a shorter location.' };
  return { ok: true as const, branchName, branchLocation: branchLocation || branchName };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const reviewStaffInvite = (input: {
  name: string;
  email: string;
  role: string;
  ownerEmail?: string;
}) => {
  const name = tidy(input.name);
  const email = input.email.trim().toLowerCase();
  if (!name) return { ok: false as const, error: 'Enter their name, or skip this step.' };
  if (!EMAIL.test(email)) return { ok: false as const, error: 'Enter a valid email, or skip this step.' };
  const owner = input.ownerEmail?.trim().toLowerCase() || '';
  if (owner.includes('@') && email === owner) {
    return { ok: false as const, error: 'That email is your sign-in. Invite someone else, or skip this step.' };
  }
  const role: OnboardingRole = (ONBOARDING_ROLES as readonly string[]).includes(input.role)
    ? input.role as OnboardingRole
    : 'cashier';
  return { ok: true as const, staff: { name, email, role } };
};

/** Keep the first branch id and rename it. A shop with no branch gets the one just created. */
export const branchAfterOnboarding = <T extends { id: string; name: string; location: string }>(
  branches: readonly T[],
  name: string,
  location: string,
  created: T,
): T[] => {
  if (branches.length === 0) return [created];
  const [first, ...rest] = branches;
  return [{ ...first, name, location }, ...rest];
};
