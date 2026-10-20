import type { TaxSettings } from './retail';

export type BusinessModel = 'retail' | 'supermarket' | 'restaurant' | 'salon' | 'services' | 'other';
export type OutletPlan = 'single' | 'multiple';
export type SalesMix = 'products' | 'services' | 'both';
export type OnboardingStepId = 'business' | 'configure' | 'catalogue' | 'outlet' | 'staff' | 'payments' | 'practice';
export type ChecklistStatus = 'not_started' | 'in_progress' | 'complete' | 'action_required';

export type BusinessProfile = {
  legalName: string;
  displayName: string;
  countryCode: string;
  currency: string;
  timezone: string;
  address: string;
  city: string;
  phone: string;
  ownerName: string;
  email: string;
  taxId: string;
};

export type BusinessSetup = {
  model: BusinessModel;
  outlets: OutletPlan;
  sells: SalesMix;
  trackInventory: boolean;
  bookings: boolean;
  customers: boolean;
  taxEnabled: boolean;
  taxRate: number;
  taxName: string;
  taxAcknowledged: boolean;
};

export type OnboardingProgress = {
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  step: OnboardingStepId;
  skipped: OnboardingStepId[];
  practiceSaleId?: string;
};

export type CountryDefault = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  offset: number;
  taxName: string;
  taxRate: number;
};

export const BUSINESS_COUNTRIES: CountryDefault[] = [
  { code: 'UG', name: 'Uganda', currency: 'UGX', timezone: 'Africa/Kampala', offset: 180, taxName: 'VAT', taxRate: 18 },
  { code: 'KE', name: 'Kenya', currency: 'KES', timezone: 'Africa/Nairobi', offset: 180, taxName: 'VAT', taxRate: 16 },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', offset: 180, taxName: 'VAT', taxRate: 18 },
  { code: 'RW', name: 'Rwanda', currency: 'RWF', timezone: 'Africa/Kigali', offset: 120, taxName: 'VAT', taxRate: 18 },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', timezone: 'Africa/Lagos', offset: 60, taxName: 'VAT', taxRate: 7.5 },
  { code: 'GH', name: 'Ghana', currency: 'GHS', timezone: 'Africa/Accra', offset: 0, taxName: 'VAT', taxRate: 15 },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', timezone: 'Africa/Johannesburg', offset: 120, taxName: 'VAT', taxRate: 15 },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London', offset: 0, taxName: 'VAT', taxRate: 20 },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York', offset: -300, taxName: 'Sales tax', taxRate: 0 },
];

export const BUSINESS_MODELS: { id: BusinessModel; label: string; detail: string }[] = [
  { id: 'retail', label: 'Retail shop', detail: 'Products on the shelf, with stock counts.' },
  { id: 'supermarket', label: 'Supermarket', detail: 'A larger product catalogue and stock counts.' },
  { id: 'restaurant', label: 'Restaurant or cafe', detail: 'Food and drinks. Stock can track what you sell.' },
  { id: 'salon', label: 'Salon or spa', detail: 'Appointments and services. Stock is optional.' },
  { id: 'services', label: 'Services', detail: 'Work you sell, without a stock count.' },
  { id: 'other', label: 'Other', detail: 'Choose products, services, and stock yourself.' },
];

export const ONBOARDING_STEPS: { id: OnboardingStepId; title: string; required: boolean }[] = [
  { id: 'business', title: 'Business', required: true },
  { id: 'configure', title: 'How you sell', required: true },
  { id: 'catalogue', title: 'Catalogue', required: false },
  { id: 'outlet', title: 'Outlet', required: true },
  { id: 'staff', title: 'Staff', required: false },
  { id: 'payments', title: 'Payments and receipts', required: true },
  { id: 'practice', title: 'Practice sale', required: false },
];

const ZERO_DECIMAL = new Set(['UGX', 'RWF', 'JPY', 'KRW']);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const PLACEHOLDER_EMAILS = new Set(['counter@this-device']);

const cleanEmail = (value: string) => (PLACEHOLDER_EMAILS.has(value.toLowerCase()) ? '' : value);

export const countryByCode = (code: string) => BUSINESS_COUNTRIES.find((country) => country.code === code) || BUSINESS_COUNTRIES[0];

export const detectedCountry = () => {
  const offset = -new Date().getTimezoneOffset();
  const matches = BUSINESS_COUNTRIES.filter((country) => country.offset === offset);
  return matches.length === 1 ? matches[0] : BUSINESS_COUNTRIES[0];
};

export const defaultBusinessProfile = (ownerName = '', email = ''): BusinessProfile => {
  const country = BUSINESS_COUNTRIES[0];
  return {
    legalName: '',
    displayName: '',
    countryCode: country.code,
    currency: country.currency,
    timezone: country.timezone,
    address: '',
    city: '',
    phone: '',
    ownerName: ownerName.trim().slice(0, 80),
    email: cleanEmail(email.trim().slice(0, 120)),
    taxId: '',
  };
};

export const defaultBusinessSetup = (profile: BusinessProfile = defaultBusinessProfile()): BusinessSetup => {
  const country = countryByCode(profile.countryCode);
  return {
    model: 'retail',
    outlets: 'single',
    sells: 'products',
    trackInventory: true,
    bookings: false,
    customers: true,
    taxEnabled: false,
    taxRate: country.taxRate,
    taxName: country.taxName,
    taxAcknowledged: false,
  };
};

export const defaultOnboardingProgress = (): OnboardingProgress => ({
  step: 'business',
  skipped: [],
});

export const presetForModel = (model: BusinessModel): Pick<BusinessSetup, 'sells' | 'trackInventory' | 'bookings' | 'customers'> => {
  if (model === 'supermarket') return { sells: 'products', trackInventory: true, bookings: false, customers: false };
  if (model === 'restaurant') return { sells: 'both', trackInventory: true, bookings: false, customers: true };
  if (model === 'salon' || model === 'services') return { sells: 'services', trackInventory: false, bookings: true, customers: true };
  if (model === 'other') return { sells: 'both', trackInventory: true, bookings: false, customers: true };
  return { sells: 'products', trackInventory: true, bookings: false, customers: true };
};

export const normalizeBusinessProfile = (value: unknown, shopName = '', ownerName = '', email = ''): BusinessProfile => {
  const fallback = defaultBusinessProfile(ownerName, email);
  const record = asRecord(value);
  if (!record) {
    return { ...fallback, displayName: shopName && shopName !== 'My Shop' ? shopName : '' };
  }
  const country = countryByCode(text(record.countryCode, 2) || fallback.countryCode);
  const currency = text(record.currency, 8).toUpperCase() || country.currency;
  return {
    legalName: text(record.legalName, 120),
    displayName: text(record.displayName, 80) || (shopName && shopName !== 'My Shop' ? shopName : ''),
    countryCode: country.code,
    currency,
    timezone: text(record.timezone, 60) || country.timezone,
    address: text(record.address, 180),
    city: text(record.city, 80),
    phone: text(record.phone, 40),
    ownerName: text(record.ownerName, 80) || fallback.ownerName,
    email: cleanEmail(text(record.email, 120) || fallback.email),
    taxId: text(record.taxId, 40),
  };
};

export const normalizeBusinessSetup = (value: unknown, profile?: BusinessProfile): BusinessSetup => {
  const fallback = defaultBusinessSetup(profile);
  const record = asRecord(value);
  if (!record) return fallback;
  const model = BUSINESS_MODELS.some((item) => item.id === record.model) ? record.model as BusinessModel : fallback.model;
  const sells = record.sells === 'services' || record.sells === 'both' || record.sells === 'products' ? record.sells : fallback.sells;
  const rate = Number(record.taxRate);
  return {
    model,
    outlets: record.outlets === 'multiple' ? 'multiple' : 'single',
    sells,
    trackInventory: record.trackInventory === true,
    bookings: record.bookings === true,
    customers: record.customers !== false,
    taxEnabled: record.taxEnabled === true,
    taxRate: Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : fallback.taxRate,
    taxName: text(record.taxName, 40) || fallback.taxName,
    taxAcknowledged: record.taxAcknowledged === true,
  };
};

export const normalizeOnboardingProgress = (value: unknown): OnboardingProgress => {
  const record = asRecord(value);
  const step = ONBOARDING_STEPS.some((item) => item.id === record?.step) ? record?.step as OnboardingStepId : 'business';
  const skipped = Array.isArray(record?.skipped)
    ? record.skipped.filter((item): item is OnboardingStepId => ONBOARDING_STEPS.some((stepItem) => stepItem.id === item))
    : [];
  return {
    step,
    skipped,
    ...(typeof record?.startedAt === 'string' ? { startedAt: record.startedAt } : {}),
    ...(typeof record?.pausedAt === 'string' ? { pausedAt: record.pausedAt } : {}),
    ...(typeof record?.completedAt === 'string' ? { completedAt: record.completedAt } : {}),
    ...(typeof record?.practiceSaleId === 'string' ? { practiceSaleId: record.practiceSaleId } : {}),
  };
};

export const taxSettingsFromSetup = (setup: BusinessSetup): TaxSettings => ({
  enabled: setup.taxEnabled,
  name: setup.taxName || 'VAT',
  ratePercent: setup.taxRate,
  pricesIncludeTax: true,
});

export const formatShopMoney = (value: number, currency: string) => {
  const code = (currency || 'UGX').toUpperCase();
  const digits = ZERO_DECIMAL.has(code) ? 0 : 2;
  const amount = digits === 0 ? Math.round(value) : value;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${code} ${digits === 0 ? Math.round(value) : value.toFixed(2)}`;
  }
};

export type ShopCounts = { products: number; services: number; sales: number };

export const shouldAutoOpenOnboarding = (progress: OnboardingProgress, counts: ShopCounts) => {
  if (progress.completedAt || progress.pausedAt) return false;
  if (!progress.startedAt && (counts.products > 0 || counts.services > 0 || counts.sales > 0)) return false;
  return true;
};

export type ChecklistItem = {
  id: OnboardingStepId;
  title: string;
  detail: string;
  status: ChecklistStatus;
  required: boolean;
};

export const buildChecklist = (
  profile: BusinessProfile,
  setup: BusinessSetup,
  progress: OnboardingProgress,
  counts: ShopCounts & { branches: number; staff: number; practice: boolean },
): ChecklistItem[] => {
  const skipped = new Set(progress.skipped);
  const catalogueReady = setup.sells === 'services' ? counts.services > 0 : setup.sells === 'products' ? counts.products > 0 : counts.products + counts.services > 0;
  const outletsReady = setup.outlets === 'multiple' ? counts.branches > 1 : counts.branches > 0;
  return [
    {
      id: 'business',
      title: 'Business profile',
      detail: profile.displayName ? `${profile.displayName} · ${profile.currency} · ${countryByCode(profile.countryCode).name}` : 'Add the name customers should see, plus country and currency.',
      status: profile.displayName && profile.countryCode ? 'complete' : progress.startedAt ? 'in_progress' : 'not_started',
      required: true,
    },
    {
      id: 'catalogue',
      title: setup.sells === 'services' ? 'Services' : setup.sells === 'both' ? 'Products and services' : 'Products',
      detail: catalogueReady ? 'The register has something to sell.' : skipped.has('catalogue') ? 'Skipped for now. Add items before a real sale.' : 'Add one item, or import a CSV, then add the rest later.',
      status: catalogueReady ? 'complete' : skipped.has('catalogue') ? 'action_required' : 'not_started',
      required: false,
    },
    {
      id: 'outlet',
      title: 'Outlet',
      detail: setup.outlets === 'multiple'
        ? (outletsReady ? `${counts.branches} outlets. Reports can stay per outlet.` : 'Add the second outlet. You can add more later.')
        : (counts.branches > 0 ? 'One outlet is ready. More branches can be added later.' : 'Name the counter or shop.'),
      status: outletsReady ? 'complete' : 'action_required',
      required: true,
    },
    {
      id: 'staff',
      title: 'Staff',
      detail: counts.staff > 0 ? `${counts.staff} staff record${counts.staff === 1 ? '' : 's'}. Each person should use their own sign-in.` : 'Optional. Invite a cashier later. Do not share the owner sign-in.',
      status: counts.staff > 0 ? 'complete' : skipped.has('staff') ? 'not_started' : 'not_started',
      required: false,
    },
    {
      id: 'payments',
      title: 'Payments and receipts',
      detail: setup.taxAcknowledged
        ? 'Cash is recorded in the till. Card, mobile money, and bank payments are written on the sale only. No provider is connected.'
        : 'Confirm how tax and receipts should read. No payment provider is connected yet.',
      status: setup.taxAcknowledged ? 'complete' : 'action_required',
      required: true,
    },
    {
      id: 'practice',
      title: 'Practice sale',
      detail: counts.practice ? 'A practice sale is on file. It is excluded from sales totals and no money was collected.' : 'Run one practice sale before you call the shop open.',
      status: counts.practice ? 'complete' : skipped.has('practice') ? 'action_required' : 'not_started',
      required: false,
    },
  ];
};

export const goLiveIssues = (items: ChecklistItem[]) => items.filter((item) => item.required && item.status !== 'complete').map((item) => item.title);

export const validateBusinessStep = (profile: BusinessProfile) => {
  const errors: Record<string, string> = {};
  if (!profile.displayName.trim()) errors.displayName = 'Enter the name customers should see.';
  if (profile.displayName.trim().length > 80) errors.displayName = 'Use 80 characters or fewer.';
  if (!profile.countryCode) errors.countryCode = 'Choose a country.';
  if (!/^[A-Z]{3}$/.test(profile.currency.trim().toUpperCase())) errors.currency = 'Use a 3-letter currency code, such as UGX.';
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) errors.email = 'Enter a valid email, or leave it blank on this counter.';
  return errors;
};

export const validateCatalogueItem = (item: { name: string; price: number; cost: number; stock: number }, sellsServices: boolean) => {
  const errors: Record<string, string> = {};
  if (!item.name.trim()) errors.name = sellsServices ? 'Enter the service name.' : 'Enter the product name.';
  if (!Number.isFinite(item.price) || item.price <= 0) errors.price = 'Enter a selling price above zero.';
  if (!Number.isFinite(item.cost) || item.cost < 0) errors.cost = 'Cost cannot be negative.';
  if (!sellsServices && (!Number.isFinite(item.stock) || item.stock < 0)) errors.stock = 'Opening stock cannot be negative.';
  return errors;
};

export const validateOutlet = (name: string) => {
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.branchName = 'Name this outlet.';
  return errors;
};

export type ImportIssue = { line: number; message: string };

export const reviewImportRows = (
  rows: { line: number; name: string; sku: string; barcode: string; salePrice: number }[],
  existingCodes: string[],
) => {
  const seen = new Set(existingCodes.map((code) => code.trim().toUpperCase()).filter(Boolean));
  const issues: ImportIssue[] = [];
  rows.forEach((row) => {
    if (!row.name.trim()) issues.push({ line: row.line, message: 'Product name is missing.' });
    if (!Number.isFinite(row.salePrice) || row.salePrice < 0) issues.push({ line: row.line, message: 'Selling price is not a number.' });
    const sku = row.sku.trim().toUpperCase();
    const barcode = row.barcode.trim().toUpperCase();
    if (sku && seen.has(sku)) issues.push({ line: row.line, message: `SKU ${sku} is already used.` });
    if (barcode && seen.has(barcode)) issues.push({ line: row.line, message: `Barcode ${barcode} is already used.` });
    if (sku && barcode && sku === barcode) issues.push({ line: row.line, message: 'SKU and barcode need to be different.' });
    if (sku) seen.add(sku);
    if (barcode) seen.add(barcode);
  });
  return issues;
};

export const importReportText = (issues: ImportIssue[]) => (
  issues.length === 0 ? 'No problems found.' : issues.map((issue) => `Row ${issue.line}: ${issue.message}`).join('\n')
);
