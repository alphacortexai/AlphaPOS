/** A shop that was never named. The counter used to open with these defaults. */
const UNTITLED_SHOP = 'my shop';
const UNTITLED_BRANCH = 'main branch';
const UNTITLED_LOCATIONS = new Set(['hq', 'counter']);

const count = (value: unknown) => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const ONBOARDING_ROLES = ['cashier', 'manager', 'stock', 'admin'] as const;

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

export const ONBOARDING_ROLE_LABELS: Record<OnboardingRole, string> = {
  cashier: 'Cashier',
  manager: 'Manager',
  stock: 'Stock',
  admin: 'Admin',
};

/**
 * The owner of a shop that has never been set up. An invited person, a shop
 * that already has a name, or a shop that already has work in it skips this.
 */
export const needsOwnerOnboarding = (input: {
  ownsShop: boolean;
  shop: Record<string, unknown> | null | undefined;
}) => {
  if (!input.ownsShop) return false;
  const shop = input.shop;
  if (!shop) return true;
  if (shop.onboardingComplete === true) return false;
  if (
    count(shop.products) > 0
    || count(shop.services) > 0
    || count(shop.sales) > 0
    || count(shop.expenses) > 0
    || count(shop.users) > 0
    || count(shop.customers) > 0
    || count(shop.suppliers) > 0
  ) return false;
  const name = text(shop.shopName);
  if (name && name.toLowerCase() !== UNTITLED_SHOP) return false;
  const branches = Array.isArray(shop.branches)
    ? shop.branches
    : shop.branches && typeof shop.branches === 'object'
      ? Object.values(shop.branches as Record<string, unknown>)
      : [];
  if (branches.length > 1) return false;
  if (branches.length === 1 && branches[0] && typeof branches[0] === 'object') {
    const branch = branches[0] as { name?: unknown; location?: unknown };
    const branchName = text(branch.name);
    const location = text(branch.location);
    if (branchName && branchName.toLowerCase() !== UNTITLED_BRANCH) return false;
    if (location && !UNTITLED_LOCATIONS.has(location.toLowerCase())) return false;
  }
  return true;
};

export const onboardShopError = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter the shop name.';
  if (trimmed.length > 80) return 'Use 80 characters or fewer for the shop name.';
  return '';
};

export const onboardBranchError = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter the branch name.';
  if (trimmed.length > 80) return 'Use 80 characters or fewer for the branch name.';
  return '';
};

export const onboardLocationError = (location: string) => (
  location.trim().length > 80 ? 'Use 80 characters or fewer for the location.' : ''
);

/** Empty fields mean this step was not used. A partial invite has to be finished or skipped. */
export const onboardStaffError = (input: { name: string; email: string; ownerEmail?: string | null }) => {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return 'Enter their name, or skip this step.';
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : '';
  const domain = at > 0 ? email.slice(at + 1) : '';
  if (!local || !domain.includes('.')) return 'Enter their email, or skip this step.';
  const owner = input.ownerEmail?.trim().toLowerCase() || '';
  if (owner && email === owner) return 'That is your email. Invite someone else, or skip this step.';
  return '';
};
