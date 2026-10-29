'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore';
import CatalogAssistant, { type CatalogCreateRow, type CatalogPriceRow } from '../components/pos/CatalogAssistant';
import RegisterDesk from '../components/pos/RegisterDesk';
import ReceiptDialog from '../components/pos/ReceiptDialog';
import ReturnDialog, { type ReturnableLine } from '../components/pos/ReturnDialog';
import { ACTIVITY_KEEP, readLocalActivity, trimActivity, writeLocalActivity } from '../lib/pos/activityLog';
import { computeAccountBalances, DEFAULT_REORDER_POINT, normalizeCustomerPayments, normalizeSuppliers, paymentMatchesCustomer, sessionCashAdjustments, stockIsLow, withTenderAccounts, type CustomerPaymentRecord, type SupplierRecord } from '../lib/pos/books';
import { parseCatalogReading, type CatalogMode } from '../lib/catalog/reading';
import { catalogKeyError, readOwnerCatalogKey, writeOwnerCatalogKey } from '../lib/catalog/ownerKey';
import { LOCAL_OPERATOR_ID, readLocalShop, writeLocalShop } from '../lib/pos/localShop';
import { nextSku, reservedProductCodes } from '../lib/pos/sku';
import { attachProductImages, compressProductPhoto, imageMapChars, isProductImage, PRODUCT_IMAGE_DOC_MAX_CHARS, readLocalProductImages, splitProductImages, writeLocalProductImages } from '../lib/pos/productImage';
import { beginSalesEmailSend, buildSalesDigest, defaultSalesEmailSettings, finishSalesEmailSend, normalizeSalesEmailSettings, previousSalesPeriod, type SalesDigest, type SalesEmailSettings } from '../lib/pos/salesEmail';
import { completeEmailLinkSignIn, createStaffInviteLink, rememberInviteFromUrl, staffSignInError, takeInvitedShopId } from '../lib/pos/staffInvite';
import {
  customerAccountBalance,
  defaultReceiptSettings,
  defaultTaxSettings,
  nextDocumentNumber,
  normalizeCashSessions,
  normalizeCustomers,
  normalizeReceiptSettings,
  normalizeTaxSettings,
  PAYMENT_METHOD_LABELS,
  receiptPrefix,
  returnableQuantity,
  roundMoney,
  sessionCashTaken,
  settleCart,
  tendersCoverTotal,
  transactionKey,
  type CartDiscount,
  type CashSession,
  type Customer,
  type PaymentMethod,
  type ReceiptModel,
  type ReceiptSettings,
  type TaxSettings,
  type Tender,
} from '../lib/pos/retail';

type SessionUser = { uid: string; email: string | null; displayName: string | null };
type Role = 'shop_owner' | 'admin' | 'manager' | 'cashier' | 'stock';
type View = 'dashboard' | 'sales_history' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports' | 'settings' | 'accounts' | 'profile' | 'activity_logs' | 'customers' | 'assistant';
type DashboardPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
type InsightTrendRange = 7 | 14 | 30 | 60 | 100;
type ExpenseChartRange = 'day' | '7days' | '14days' | 'month' | '3months' | '6months' | '1year';
type ShopTimeSettings = { timezoneOffsetMinutes: number; dayStartTime: string };
type Account = { id: string; name: string; openingBalance: number; isDefault?: boolean } & AuditStamp;

type Branch = { id: string; name: string; location: string; createdAt?: string };
type AuditStamp = {
  createdAt: string;
  createdByUid: string;
  createdByEmail: string;
  updatedAt?: string;
  updatedByUid?: string;
  updatedByEmail?: string;
};

type Product = { id: string; name: string; branchId: string; stock: number; purchasePrice: number; salePrice: number; sku?: string; barcode?: string; category?: string; image?: string; reorderPoint?: number } & AuditStamp;
type ServiceType = 'direct_cost' | 'shared_cost';
type Service = { id: string; name: string; branchId: string; salePrice: number; serviceType: ServiceType; directCost: number; monthlySharedCost: number; expenseGroupId?: string } & AuditStamp;
type Sale = {
  id: string;
  type: 'product' | 'service';
  itemName: string;
  branchId: string;
  qty: number;
  amount: number;
  cost: number;
  accountId?: string;
  transactionId?: string;
  customerName?: string;
  customerPhone?: string;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  taxAmount?: number;
  discountAmount?: number;
  receiptNumber?: string;
  saleKind?: 'sale' | 'return';
  returnOfTransactionId?: string;
  tenders?: Tender[];
  cashSessionId?: string;
} & AuditStamp;
type ExpenseGroup = { id: string; name: string } & AuditStamp;
type Expense = { id: string; title: string; branchId: string; amount: number; expenseGroupId?: string; accountId?: string; cashSessionId?: string } & AuditStamp;
type Supplier = SupplierRecord;
type CustomerPayment = CustomerPaymentRecord;
type StaffUser = { id: string; name: string; email: string; role: Role; branchId: string } & AuditStamp;
type ShopMembership = { ownerUid: string; shopName: string; role: Role };
type HeldTicket = {
  id: string;
  label: string;
  cart: CartItem[];
  cartDiscount: CartDiscount;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  createdByEmail: string;
};
type ShopBackupPayload = {
  app: 'AlphaPOS';
  version: 1 | 2;
  exportedAt: string;
  shopName: string;
  sourceOwnerUid: string;
  data: {
    branches: Branch[];
    products: Product[];
    services: Service[];
    sales: Sale[];
    expenses: Expense[];
    expenseGroups: ExpenseGroup[];
    users: StaffUser[];
    activityLogs: ActivityLog[];
    shopTimeSettings: ShopTimeSettings;
    accounts: Account[];
    customers?: Customer[];
    suppliers?: Supplier[];
    customerPayments?: CustomerPayment[];
    heldTickets?: HeldTicket[];
    cashSessions?: CashSession[];
    taxSettings?: TaxSettings;
    receiptSettings?: ReceiptSettings;
    salesEmailSettings?: SalesEmailSettings;
  };
};
type StockMovementReason = 'sale' | 'opening_stock' | 'restock' | 'count_correction' | 'damaged' | 'customer_return' | 'branch_transfer' | 'product_removed';
type StockMovementAudit = {
  productId: string;
  productName: string;
  branchId: string;
  quantityDelta: number;
  reason: StockMovementReason;
  fromBranchId?: string;
  toBranchId?: string;
  supplierName?: string;
  reference?: string;
  unitCost?: number;
  note?: string;
};
type ActivityLog = {
  id: string;
  action: string;
  details: string;
  role: Role;
  userEmail: string;
  createdAt: string;
  stockMovement?: StockMovementAudit;
};
type CartDiscountMode = 'none' | 'price' | 'percent';
type CartItem = {
  itemId: string;
  itemType: 'product' | 'service';
  itemName: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  branchId: string;
  maxQty?: number;
  discountMode?: CartDiscountMode;
  discountedUnitPrice?: number;
  discountPercent?: number;
};

const periodStart = (period: 'day' | 'week' | 'month' | 'year', date: Date = new Date()) => {
  const d = new Date(date);
  if (period === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), 0, 1);
};

const blankProductForm = (branchId = '') => ({
  id: '',
  name: '',
  branchId,
  stock: 0,
  purchasePrice: 0,
  salePrice: 0,
  sku: '',
  barcode: '',
  category: '',
  image: '',
  reorderPoint: DEFAULT_REORDER_POINT,
});

type StockReceiptLine = { productId: string; quantity: string; unitCost: string };

const emptyStockForm = () => ({
  productId: '',
  direction: 'add' as 'add' | 'remove',
  quantity: 1,
  reason: 'restock' as Exclude<StockMovementReason, 'sale' | 'opening_stock' | 'branch_transfer' | 'product_removed'>,
  note: '',
  supplierName: '',
  reference: '',
  unitCost: '',
  lines: null as StockReceiptLine[] | null,
});

const removeUndefinedDeep = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, removeUndefinedDeep(v)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
};

const emptyCheckout = { customerName: '', customerPhone: '', paymentMethod: 'cash' as PaymentMethod, paymentReference: '' };
const roleLabels: Record<Role, string> = { shop_owner: 'Owner', admin: 'Admin', manager: 'Manager', cashier: 'Cashier', stock: 'Stock' };
const OPENED_SHOP_KEY = 'alphapos.openedShop';

const readOpenedShop = (uid: string) => {
  if (typeof window === 'undefined') return '';
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(OPENED_SHOP_KEY) || '') as { uid?: string; ownerUid?: string };
    return parsed.uid === uid && parsed.ownerUid ? parsed.ownerUid : '';
  } catch {
    return '';
  }
};

const writeOpenedShop = (uid: string, ownerUid: string) => {
  window.sessionStorage.setItem(OPENED_SHOP_KEY, JSON.stringify({ uid, ownerUid }));
};

const clearOpenedShop = () => {
  window.sessionStorage.removeItem(OPENED_SHOP_KEY);
};

const normalizeHeldTickets = (value: unknown): HeldTicket[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Partial<HeldTicket>;
    if (!record.id || !Array.isArray(record.cart)) return [];
    const discount = record.cartDiscount;
    return [{
      id: record.id,
      label: record.label || 'Held sale',
      cart: record.cart,
      cartDiscount: discount && (discount.mode === 'amount' || discount.mode === 'percent') ? discount : { mode: 'none', value: 0 },
      customerName: record.customerName || '',
      customerPhone: record.customerPhone || '',
      createdAt: record.createdAt || new Date().toISOString(),
      createdByEmail: record.createdByEmail || 'unknown',
    }];
  });
};

export default function Page() {
  const [authUser, setAuthUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role>('shop_owner');
  const [activeShopOwnerUid, setActiveShopOwnerUid] = useState('');
  const [availableShops, setAvailableShops] = useState<ShopMembership[]>([]);
  const [awaitingShopChoice, setAwaitingShopChoice] = useState(false);
  const [shopsResolved, setShopsResolved] = useState(false);
  const [shopSwitchTarget, setShopSwitchTarget] = useState('');
  const [view, setView] = useState<View>('sales');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [status, setStatus] = useState('Welcome to AlphaPOS Pro.');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const hasLoadedUserDataRef = useRef(false);
  const isSwitchingShopRef = useRef(false);
  const shopRevisionRef = useRef(0);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseGroups, setExpenseGroups] = useState<ExpenseGroup[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customerPayments, setCustomerPayments] = useState<CustomerPayment[]>([]);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentDraft, setPaymentDraft] = useState({ amount: '', method: 'cash' as CustomerPayment['method'] });
  const [heldTickets, setHeldTickets] = useState<HeldTicket[]>([]);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [taxSettings, setTaxSettings] = useState<TaxSettings>(defaultTaxSettings);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(defaultReceiptSettings);
  const [cartDiscount, setCartDiscount] = useState<CartDiscount>({ mode: 'none', value: 0 });
  const [activeReceipt, setActiveReceipt] = useState<ReceiptModel | null>(null);
  const [returnTransactionId, setReturnTransactionId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');

  // Modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [showStockAdjustmentModal, setShowStockAdjustmentModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBranchFormModal, setShowBranchFormModal] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);

  // Filters
  const [salesDateFilter, setSalesDateFilter] = useState(new Date().toISOString().split('T')[0]);
  const [salesHistoryViewMode, setSalesHistoryViewMode] = useState<'day' | 'week' | 'month' | 'range'>('day');
  const [salesRangeStart, setSalesRangeStart] = useState(new Date().toISOString().split('T')[0]);
  const [salesRangeEnd, setSalesRangeEnd] = useState(new Date().toISOString().split('T')[0]);
  const [salesHistoryPage, setSalesHistoryPage] = useState(1);
  const [productsPage, setProductsPage] = useState(1);
  const [servicesPage, setServicesPage] = useState(1);
  const [expensesPage, setExpensesPage] = useState(1);
  const [expensesViewMode, setExpensesViewMode] = useState<'all' | 'day'>('all');
  const [expensesDayFilter, setExpensesDayFilter] = useState(new Date().toISOString().split('T')[0]);
  const [usersPage, setUsersPage] = useState(1);
  const [activityLogsPage, setActivityLogsPage] = useState(1);
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('daily');
  const [insightTrendRange, setInsightTrendRange] = useState<InsightTrendRange>(7);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productBranchFilter, setProductBranchFilter] = useState('');
  const [productStockFilter, setProductStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [productPane, setProductPane] = useState<'shelf' | 'movements'>('shelf');
  const [expensePane, setExpensePane] = useState<'list' | 'groups'>('list');
  const [showServiceModal, setShowServiceModal] = useState(false);

  const [branchForm, setBranchForm] = useState({ name: '', location: '', id: '' });
  const [productForm, setProductForm] = useState(blankProductForm());
  const [productPhotoBusy, setProductPhotoBusy] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [skuManual, setSkuManual] = useState(false);
  const productPhotoRef = useRef<HTMLInputElement>(null);
  const [stockAdjustmentForm, setStockAdjustmentForm] = useState(emptyStockForm);
  const [serviceForm, setServiceForm] = useState({ name: '', branchId: '', amount: 0, serviceType: 'direct_cost' as ServiceType, directCost: 0, monthlySharedCost: 0, expenseGroupId: '' });
  const [saleForm, setSaleForm] = useState({ productId: '', qty: 1 });
  const [checkoutDetails, setCheckoutDetails] = useState({ customerName: '', customerPhone: '', paymentMethod: 'cash' as PaymentMethod, paymentReference: '' });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedBranchForSale, setSelectedBranchForSale] = useState('');
  const [expenseForm, setExpenseForm] = useState({ id: '', title: '', branchId: '', amount: 0, expenseGroupId: '', accountId: '' });
  const [accountForm, setAccountForm] = useState({ name: '', openingBalance: 0 });
  const [saleAccountId, setSaleAccountId] = useState('');
  const [accountTopUpForm, setAccountTopUpForm] = useState({ accountId: '', amount: 0 });
  const [expenseGroupForm, setExpenseGroupForm] = useState({ name: '' });
  const [transferExpenseGroupId, setTransferExpenseGroupId] = useState('');
  const [editingExpenseGroupId, setEditingExpenseGroupId] = useState('');
  const [editingExpenseGroupName, setEditingExpenseGroupName] = useState('');
  const [expenseChartRange, setExpenseChartRange] = useState<ExpenseChartRange>('month');
  const [userForm, setUserForm] = useState({ id: '', name: '', email: '', role: 'cashier' as Role, branchId: '' });
  const [shopNameForm, setShopNameForm] = useState('');
  const [settingsTab, setSettingsTab] = useState<'shop' | 'branches' | 'time' | 'backup' | 'tax' | 'receipt' | 'email' | 'assistant'>('shop');
  const [salesEmailSettings, setSalesEmailSettings] = useState<SalesEmailSettings>(defaultSalesEmailSettings);
  const [signInNotice, setSignInNotice] = useState('');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [sendingSalesEmail, setSendingSalesEmail] = useState(false);
  const [recipientDraft, setRecipientDraft] = useState('');
  const recipientInputRef = useRef<HTMLInputElement>(null);
  const [shopTimeSettings, setShopTimeSettings] = useState<ShopTimeSettings>({ timezoneOffsetMinutes: 0, dayStartTime: '00:00' });
  const [catalogKey, setCatalogKey] = useState('');
  const [catalogKeyDraft, setCatalogKeyDraft] = useState('');
  const [showCatalogKey, setShowCatalogKey] = useState(false);

  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const getEffectiveUnitPrice = useCallback((item: CartItem) => {
    if (item.discountMode === 'price' && typeof item.discountedUnitPrice === 'number' && Number.isFinite(item.discountedUnitPrice)) {
      return Math.max(0, Math.min(item.unitPrice, item.discountedUnitPrice));
    }
    if (item.discountMode === 'percent' && typeof item.discountPercent === 'number' && Number.isFinite(item.discountPercent)) {
      const safePercent = Math.max(0, Math.min(100, item.discountPercent));
      return item.unitPrice * (1 - safePercent / 100);
    }
    return item.unitPrice;
  }, []);
  const db = firebaseApp ? getFirestore(firebaseApp) : null;
  const formatUGX = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;
  const ensureDefaultCashAccount = useCallback((existingAccounts: Account[]) => (
    withTenderAccounts(existingAccounts, () => ({
      createdAt: new Date().toISOString(),
      createdByUid: authUser?.uid || 'unknown',
      createdByEmail: authUser?.email || 'unknown',
    }))
  ), [authUser]);
  const currentShop = availableShops.find((s) => s.ownerUid === activeShopOwnerUid);
  const isShopOwner = activeShopOwnerUid === authUser?.uid;
  const seesBooks = role === 'shop_owner' || role === 'admin' || role === 'manager';
  const seesCost = seesBooks || role === 'stock';
  const canOpenView = useCallback((next: View) => {
    if (next === 'profile' || next === 'sales' || next === 'dashboard' || next === 'products' || next === 'services') return true;
    if (next === 'sales_history' || next === 'customers') return role !== 'stock';
    if (next === 'expenses' || next === 'reports' || next === 'accounts') return seesBooks;
    if (next === 'users' || next === 'activity_logs') return seesBooks;
    if (next === 'settings' || next === 'branches' || next === 'assistant') return isShopOwner;
    return false;
  }, [isShopOwner, role, seesBooks]);
  useEffect(() => {
    if (!authUser) return;
    if (!canOpenView(view)) setView(role === 'stock' ? 'products' : 'sales');
  }, [authUser, canOpenView, role, view]);

  useEffect(() => {
    if (!authUser || authUser.uid !== activeShopOwnerUid) {
      setCatalogKey('');
      return;
    }
    const localKey = readOwnerCatalogKey(authUser.uid);
    setCatalogKey(localKey);
    if (!db || authUser.uid === LOCAL_OPERATOR_ID) return;
    let cancelled = false;
    void getDoc(doc(db, 'users', authUser.uid, 'pos', 'secrets')).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const remote = typeof snap.data().geminiApiKey === 'string' ? snap.data().geminiApiKey.trim() : '';
      if (!remote) return;
      writeOwnerCatalogKey(authUser.uid, remote);
      setCatalogKey(remote);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeShopOwnerUid, authUser, db]);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info', duration: number = 3000) => {
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    setNotification({ message, type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, duration);
  };
  const showNotificationRef = useRef(showNotification);
  showNotificationRef.current = showNotification;

  useEffect(() => {
    const emailFromLink = new URLSearchParams(window.location.search).get('email') || '';
    if (emailFromLink.includes('@')) setInvitedEmail(emailFromLink.trim().toLowerCase());
  }, []);

  // Firebase Auth Setup
  useEffect(() => {
    const app = firebaseApp;
    if (!app) {
      setLoading(false);
      return;
    }

    const auth = getAuth(app);
    let unsubscribe = () => {};
    let cancelled = false;
    void (async () => {
      rememberInviteFromUrl();
      try {
        await completeEmailLinkSignIn(auth);
      } catch (error) {
        if (!cancelled) setSignInNotice(staffSignInError(error));
      }
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null);
      setLoading(false);
      hasLoadedUserDataRef.current = false;
      if (!user) {
        clearOpenedShop();
        setAwaitingShopChoice(false);
        setShopsResolved(false);
        setShopSwitchTarget('');
        setActiveShopOwnerUid('');
        setAvailableShops([]);
        setBranches([]);
        setProducts([]);
        setServices([]);
        setSales([]);
        setExpenses([]);
        setAccounts([]);
        setUsers([]);
        setCustomers([]);
        setSuppliers([]);
        setCustomerPayments([]);
        setHeldTickets([]);
        setCashSessions([]);
        setTaxSettings(defaultTaxSettings);
        setReceiptSettings(defaultReceiptSettings);
        setSalesEmailSettings(defaultSalesEmailSettings);
      }
    });
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const loadUserData = useCallback(async () => {
      if (!authUser) return false;
      const applyRetailCollections = (data?: Record<string, unknown>) => {
        setCustomers(normalizeCustomers(data?.customers));
        setHeldTickets(normalizeHeldTickets(data?.heldTickets));
        setCashSessions(normalizeCashSessions(data?.cashSessions));
        setTaxSettings(normalizeTaxSettings(data?.taxSettings));
        setReceiptSettings(normalizeReceiptSettings(data?.receiptSettings));
        setSalesEmailSettings(normalizeSalesEmailSettings(data?.salesEmailSettings));
      };
      if (authUser.uid === LOCAL_OPERATOR_ID) {
        try {
          const data = readLocalShop();
          const shopName = typeof data?.shopName === 'string' && data.shopName.trim() ? data.shopName.trim() : 'My Shop';
          setAvailableShops([{ ownerUid: LOCAL_OPERATOR_ID, shopName, role: 'shop_owner' }]);
          if (!activeShopOwnerUid) setActiveShopOwnerUid(LOCAL_OPERATOR_ID);
          if (!data) {
            setBranches([{ id: crypto.randomUUID(), name: 'Main Branch', location: 'Counter', createdAt: new Date().toISOString() }]);
            setProducts([]);
            setServices([]);
            setSales([]);
            setExpenses([]);
            setExpenseGroups([]);
            setUsers([]);
            setActivityLogs([]);
            setSuppliers([]);
            setCustomerPayments([]);
            shopRevisionRef.current = 0;
            setAccounts(ensureDefaultCashAccount([]));
            setShopTimeSettings({ timezoneOffsetMinutes: 0, dayStartTime: '00:00' });
            applyRetailCollections();
            setSalesEmailSettings(defaultSalesEmailSettings);
          } else {
            setBranches(Array.isArray(data.branches) ? data.branches as Branch[] : []);
            setProducts(attachProductImages(Array.isArray(data.products) ? data.products as Product[] : [], readLocalProductImages()));
            setServices(Array.isArray(data.services) ? data.services as Service[] : []);
            setSales(Array.isArray(data.sales) ? data.sales as Sale[] : []);
            setExpenses(Array.isArray(data.expenses) ? data.expenses as Expense[] : []);
            setExpenseGroups(Array.isArray(data.expenseGroups) ? data.expenseGroups as ExpenseGroup[] : []);
            setUsers(Array.isArray(data.users) ? data.users as StaffUser[] : []);
            const localActivity = readLocalActivity();
            setActivityLogs(trimActivity(Array.isArray(localActivity) ? localActivity as ActivityLog[] : (Array.isArray(data.activityLogs) ? data.activityLogs as ActivityLog[] : [])));
            setSuppliers(normalizeSuppliers(data.suppliers));
            setCustomerPayments(normalizeCustomerPayments(data.customerPayments));
            shopRevisionRef.current = Number(data.revision) || 0;
            setAccounts(ensureDefaultCashAccount(Array.isArray(data.accounts) ? data.accounts as Account[] : []));
            const time = data.shopTimeSettings as Partial<ShopTimeSettings> | undefined;
            setShopTimeSettings({
              timezoneOffsetMinutes: typeof time?.timezoneOffsetMinutes === 'number' ? time.timezoneOffsetMinutes : 0,
              dayStartTime: typeof time?.dayStartTime === 'string' ? time.dayStartTime : '00:00',
            });
            applyRetailCollections(data);
          }
          setRole('shop_owner');
          setAwaitingShopChoice(false);
          setShopsResolved(true);
          hasLoadedUserDataRef.current = true;
          isSwitchingShopRef.current = false;
          setStatus(`Counter ready at ${shopName}. Records stay on this device.`);
          return true;
        } catch (error) {
          setShopsResolved(true);
          setStatus(`Could not open the on-device counter: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return false;
        }
      }
      if (!db) {
        setShopsResolved(true);
        return false;
      }
      try {
        const normalizedEmail = authUser.email?.toLowerCase().trim();
        const memberships: ShopMembership[] = [{ ownerUid: authUser.uid, shopName: 'My Shop', role: 'shop_owner' }];
        if (normalizedEmail) {
          const membershipsQuery = query(collection(db, 'shopMemberships'), where('email', '==', normalizedEmail));
          const membershipSnap = await getDocs(membershipsQuery);
          membershipSnap.forEach((m) => {
            const data = m.data();
            if (data.ownerUid && data.ownerUid !== authUser.uid) {
              memberships.push({
                ownerUid: data.ownerUid as string,
                shopName: (data.shopName as string) || 'Linked Shop',
                role: (data.role as Role) || 'cashier',
              });
            }
          });
        }
        const invitedShop = takeInvitedShopId();
        const namedMemberships = memberships.length > 1 ? await Promise.all(memberships.map(async (shop) => {
          try {
            const nameSnap = await getDoc(doc(db, 'users', shop.ownerUid, 'pos', 'data'));
            const storedName = nameSnap.exists() && typeof nameSnap.data().shopName === 'string' ? nameSnap.data().shopName.trim() : '';
            return storedName ? { ...shop, shopName: storedName } : shop;
          } catch {
            return shop;
          }
        })) : memberships;
        setAvailableShops(namedMemberships);
        const rememberedShop = readOpenedShop(authUser.uid);
        const remembered = rememberedShop && namedMemberships.some((shop) => shop.ownerUid === rememberedShop) ? rememberedShop : '';
        if (namedMemberships.length > 1 && !invitedShop && !remembered && !activeShopOwnerUid) {
          setAwaitingShopChoice(true);
          setShopsResolved(true);
          hasLoadedUserDataRef.current = false;
          isSwitchingShopRef.current = false;
          return true;
        }
        setAwaitingShopChoice(false);
        setShopsResolved(true);
        const selectedShopOwnerUid = (invitedShop && namedMemberships.some((shop) => shop.ownerUid === invitedShop) ? invitedShop : '') || remembered || activeShopOwnerUid || namedMemberships[0].ownerUid;
        if (!activeShopOwnerUid) setActiveShopOwnerUid(selectedShopOwnerUid);
        const selectedShop = namedMemberships.find((s) => s.ownerUid === selectedShopOwnerUid);
        const userDataRef = doc(db, 'users', selectedShopOwnerUid, 'pos', 'data');
        const imageRef = doc(db, 'users', selectedShopOwnerUid, 'pos', 'images');
        const activityRef = doc(db, 'users', selectedShopOwnerUid, 'pos', 'activity');
        const [snap, imageSnap, activitySnap] = await Promise.all([getDoc(userDataRef), getDoc(imageRef), getDoc(activityRef)]);
        if (!snap.exists()) {
          const defaultBranch = { id: crypto.randomUUID(), name: 'Main Branch', location: 'HQ', createdAt: new Date().toISOString() };
          setBranches([defaultBranch]);
          const defaultCashAccount = ensureDefaultCashAccount([]);
          setAccounts(defaultCashAccount);
          setExpenseGroups([]);
          setUsers([]);
          setActivityLogs([]);
          setSuppliers([]);
          setCustomerPayments([]);
          shopRevisionRef.current = 0;
          applyRetailCollections();
          setRole(selectedShop?.role || 'shop_owner');
          hasLoadedUserDataRef.current = true;
          isSwitchingShopRef.current = false;
          setStatus(`Viewing ${selectedShop?.shopName || 'selected shop'} as ${roleLabels[selectedShop?.role || role]}.`);
          return true;
        }
        const data = snap.data();
        setBranches(Array.isArray(data.branches) ? data.branches : []);
        setProducts(attachProductImages(Array.isArray(data.products) ? data.products : [], imageSnap.exists() ? imageSnap.data().images : {}));
        setServices(Array.isArray(data.services) ? data.services : []);
        setSales(Array.isArray(data.sales) ? data.sales : []);
        setExpenses(Array.isArray(data.expenses) ? data.expenses : []);
        setAccounts(ensureDefaultCashAccount(Array.isArray(data.accounts) ? data.accounts : []));
        setExpenseGroups(Array.isArray(data.expenseGroups) ? data.expenseGroups : []);
        setUsers(Array.isArray(data.users) ? data.users : []);
        setSuppliers(normalizeSuppliers(data.suppliers));
        setCustomerPayments(normalizeCustomerPayments(data.customerPayments));
        shopRevisionRef.current = Number(data.revision) || 0;
        setRole(selectedShop?.role || (data.role as Role) || 'shop_owner');
        setShopTimeSettings({
          timezoneOffsetMinutes: typeof data?.shopTimeSettings?.timezoneOffsetMinutes === 'number' ? data.shopTimeSettings.timezoneOffsetMinutes : 0,
          dayStartTime: typeof data?.shopTimeSettings?.dayStartTime === 'string' ? data.shopTimeSettings.dayStartTime : '00:00',
        });
        const inlineLogs = Array.isArray(data.activityLogs) ? data.activityLogs as ActivityLog[] : [];
        const sideLogs = activitySnap.exists()
          ? (Array.isArray(activitySnap.data().activityLogs) ? activitySnap.data().activityLogs as ActivityLog[] : [])
          : null;
        setActivityLogs(trimActivity(sideLogs ?? inlineLogs));
        applyRetailCollections(data as Record<string, unknown>);
        const storedShopName = typeof data.shopName === 'string' ? data.shopName.trim() : '';
        if (storedShopName && selectedShopOwnerUid === authUser.uid) {
          setAvailableShops(namedMemberships.map((shop) => shop.ownerUid === authUser.uid ? { ...shop, shopName: storedShopName } : shop));
        }
        hasLoadedUserDataRef.current = true;
        isSwitchingShopRef.current = false;
        setStatus(`Viewing ${selectedShop?.shopName || 'selected shop'} as ${roleLabels[selectedShop?.role || role]}.`);
        return true;
      } catch (error) {
        setShopsResolved(true);
        setStatus(`Failed to load your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
      }
    }, [activeShopOwnerUid, authUser, db, role]);

  useEffect(() => {
    void loadUserData();
  }, [loadUserData]);

  useEffect(() => {
    const saveUserData = async () => {
      if (!authUser || !hasLoadedUserDataRef.current || !activeShopOwnerUid || isSwitchingShopRef.current) return;
      if (authUser.uid !== LOCAL_OPERATOR_ID && !db) return;
      try {
        const stored = splitProductImages(products);
        if (imageMapChars(stored.images) > PRODUCT_IMAGE_DOC_MAX_CHARS) {
          setStatus('Product photos are too large to save. Remove a photo and try again.');
          return;
        }
        const trimmedLogs = trimActivity(activityLogs);
        const shopPayload = {
          role,
          shopName: currentShop?.shopName || 'My Shop',
          branches,
          products: stored.products,
          services,
          sales,
          expenses,
          expenseGroups,
          users,
          activityLogs: [] as ActivityLog[],
          shopTimeSettings,
          accounts,
          customers,
          suppliers,
          customerPayments,
          heldTickets,
          cashSessions,
          taxSettings,
          receiptSettings,
          salesEmailSettings,
        };
        if (authUser.uid === LOCAL_OPERATOR_ID) {
          const nextRevision = (shopRevisionRef.current || 0) + 1;
          writeLocalActivity(trimmedLogs);
          writeLocalShop(removeUndefinedDeep({ ...shopPayload, revision: nextRevision }));
          writeLocalProductImages(stored.images);
          shopRevisionRef.current = nextRevision;
          return;
        }
        if (!db) return;
        const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');
        const activityDocRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'activity');
        let nextRevision = shopRevisionRef.current;
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(userDataRef);
          const remoteRevision = snap.exists() ? Number(snap.data().revision) || 0 : 0;
          if (snap.exists() && remoteRevision !== shopRevisionRef.current) throw new Error('SHOP_CONFLICT');
          nextRevision = remoteRevision + 1;
          transaction.set(userDataRef, {
            ...removeUndefinedDeep({ ...shopPayload, revision: nextRevision }),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          transaction.set(activityDocRef, {
            activityLogs: removeUndefinedDeep(trimmedLogs),
            updatedAt: serverTimestamp(),
          });
        });
        shopRevisionRef.current = nextRevision;
        await setDoc(doc(db, 'users', activeShopOwnerUid, 'pos', 'images'), {
          images: stored.images,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'SHOP_CONFLICT') {
          hasLoadedUserDataRef.current = false;
          showNotificationRef.current('Another till saved this shop. Reloading so nothing is overwritten.', 'info', 6000);
          void loadUserData();
          return;
        }
        setStatus(`Failed to auto-save your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    void saveUserData();
  }, [activeShopOwnerUid, authUser, customerPayments, db, loadUserData, role, branches, products, services, sales, expenses, expenseGroups, users, activityLogs, shopTimeSettings, accounts, customers, suppliers, heldTickets, cashSessions, taxSettings, receiptSettings, salesEmailSettings, currentShop?.shopName]);

  const startLocalCounter = () => {
    hasLoadedUserDataRef.current = false;
    setAuthUser({ uid: LOCAL_OPERATOR_ID, email: 'counter@this-device', displayName: 'Counter' });
    setActiveShopOwnerUid(LOCAL_OPERATOR_ID);
    setRole('shop_owner');
    setView('sales');
  };

  const handleLogin = async () => {
    if (!firebaseApp) return;
    const auth = getAuth(firebaseApp);
    const provider = new GoogleAuthProvider();
    if (invitedEmail) provider.setCustomParameters({ login_hint: invitedEmail });
    try {
      await signInWithPopup(auth, provider);
      setStatus('Logged in successfully!');
    } catch (error) {
      setStatus(`Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleLogout = async () => {
    clearOpenedShop();
    setAwaitingShopChoice(false);
    setShopsResolved(false);
    setShopSwitchTarget('');
    if (authUser?.uid === LOCAL_OPERATOR_ID) {
      hasLoadedUserDataRef.current = false;
      setAuthUser(null);
      setActiveShopOwnerUid('');
      setStatus('Counter closed on this device.');
      return;
    }
    if (!firebaseApp) return;
    const auth = getAuth(firebaseApp);
    try {
      await signOut(auth);
      setStatus('Logged out successfully!');
    } catch (error) {
      setStatus(`Logout failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const resetShopScopedState = () => {
    setBranches([]);
    setProducts([]);
    setServices([]);
    setSales([]);
    setExpenses([]);
    setAccounts([]);
    setExpenseGroups([]);
    setUsers([]);
    setActivityLogs([]);
    setSuppliers([]);
    setCustomerPayments([]);
    shopRevisionRef.current = 0;
    setCustomers([]);
    setHeldTickets([]);
    setCashSessions([]);
    setTaxSettings(defaultTaxSettings);
    setReceiptSettings(defaultReceiptSettings);
    setCartDiscount({ mode: 'none', value: 0 });
    setBranchForm({ name: '', location: '', id: '' });
    setProductForm(blankProductForm());
    setStockAdjustmentForm(emptyStockForm());
    setShowStockAdjustmentModal(false);
    setServiceForm({ name: '', branchId: '', amount: 0, serviceType: 'direct_cost', directCost: 0, monthlySharedCost: 0, expenseGroupId: '' });
    setSaleForm({ productId: '', qty: 1 });
    setCheckoutDetails({ customerName: '', customerPhone: '', paymentMethod: 'cash', paymentReference: '' });
    setCart([]);
    setSaleAccountId('');
    setExpenseForm({ id: '', title: '', branchId: '', amount: 0, expenseGroupId: '', accountId: '' });
    setUserForm({ id: '', name: '', email: '', role: 'cashier', branchId: '' });
  };

  const handleShopSwitch = (nextOwnerUid: string) => {
    if (!nextOwnerUid || nextOwnerUid === activeShopOwnerUid) return;
    isSwitchingShopRef.current = true;
    hasLoadedUserDataRef.current = false;
    resetShopScopedState();
    setShopSwitchTarget('');
    setActiveShopOwnerUid(nextOwnerUid);
    setStatus('Switching shop...');
  };

  const openChosenShop = (ownerUid: string) => {
    if (!authUser || !ownerUid) return;
    writeOpenedShop(authUser.uid, ownerUid);
    setAwaitingShopChoice(false);
    setShopSwitchTarget('');
    if (ownerUid !== activeShopOwnerUid) handleShopSwitch(ownerUid);
    setView('sales');
  };

  // Enhanced Metric Calculation Utilities
  const getSharedServiceCostForRange = (periodSales: Sale[]) => {
    const sharedServices = services.filter((service) => service.serviceType === 'shared_cost');
    if (sharedServices.length === 0 || periodSales.length === 0) return 0;

    const sharedCostByService = new Map(
      sharedServices.map((service) => [
        `${service.branchId}::${service.name.trim().toLowerCase()}`,
        service.monthlySharedCost / 30,
      ])
    );

    const activeServiceDays = new Set<string>();

    periodSales
      .filter((sale) => sale.type === 'service')
      .forEach((sale) => {
        const serviceKey = `${sale.branchId}::${sale.itemName.trim().toLowerCase()}`;
        if (!sharedCostByService.has(serviceKey)) return;
        const saleDay = new Date(sale.createdAt).toISOString().slice(0, 10);
        activeServiceDays.add(`${serviceKey}::${saleDay}`);
      });

    let allocatedSharedCost = 0;
    activeServiceDays.forEach((activeDayKey) => {
      const [serviceKey] = activeDayKey.split('::', 2);
      allocatedSharedCost += sharedCostByService.get(serviceKey) ?? 0;
    });

    return allocatedSharedCost;
  };

  const getBusinessDayRange = useCallback((reference: Date, offsetDays: number = 0) => {
    const [startHourStr, startMinuteStr] = shopTimeSettings.dayStartTime.split(':');
    const startHour = Number(startHourStr || 0);
    const startMinute = Number(startMinuteStr || 0);
    const tzOffsetMs = shopTimeSettings.timezoneOffsetMinutes * 60 * 1000;
    const dayStartMs = (startHour * 60 + startMinute) * 60 * 1000;
    const referenceInShopTz = new Date(reference.getTime() + tzOffsetMs);
    const businessBase = new Date(Date.UTC(referenceInShopTz.getUTCFullYear(), referenceInShopTz.getUTCMonth(), referenceInShopTz.getUTCDate()));
    const startInShopTzMs = businessBase.getTime() + dayStartMs - offsetDays * 24 * 60 * 60 * 1000;
    const start = new Date(startInShopTzMs - tzOffsetMs);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }, [shopTimeSettings.dayStartTime, shopTimeSettings.timezoneOffsetMinutes]);

  const getMetricsForPeriod = (period: DashboardPeriod, offset: number = 0) => {
    const now = new Date();
    let start: Date, end: Date;

    if (period === 'daily') {
      const range = getBusinessDayRange(now, offset);
      start = range.start;
      end = range.end;
    } else if (period === 'weekly') {
      const currentWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
      start = new Date(currentWeekStart.getTime() - offset * 7 * 24 * 60 * 60 * 1000);
      end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'monthly') {
      start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
    } else {
      start = new Date(now.getFullYear() - offset, 0, 1);
      end = new Date(now.getFullYear() - offset + 1, 0, 1);
    }

    const periodSales = sales.filter(s => {
      const d = new Date(s.createdAt);
      return d >= start && d < end;
    });
    const periodExpenses = expenses.filter(e => {
      const d = new Date(e.createdAt);
      return d >= start && d < end;
    });

    const revenue = periodSales.reduce((a, s) => a + s.amount, 0);
    const taxCollected = periodSales.reduce((a, s) => a + (s.taxAmount || 0), 0);
    const cost = periodSales.reduce((a, s) => a + s.cost, 0);
    const expenseTotal = periodExpenses.reduce((a, e) => a + e.amount, 0);
    const sharedServiceCost = getSharedServiceCostForRange(periodSales);
    const grossProfit = revenue - taxCollected - cost - sharedServiceCost;
    const netProfit = grossProfit - expenseTotal;

    const receiptCount = new Set(periodSales.map((sale) => transactionKey(sale))).size;
    return { revenue, taxCollected, cost: cost + sharedServiceCost, expenseTotal, grossProfit, netProfit, salesCount: periodSales.length, receiptCount };
  };

  const getMetrics = (period: 'day' | 'week' | 'month', offset: number = 0) => {
    const periodMap: Record<'day' | 'week' | 'month', DashboardPeriod> = {
      day: 'daily',
      week: 'weekly',
      month: 'monthly',
    };
    return getMetricsForPeriod(periodMap[period], offset);
  };

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  // Dynamic dashboard metrics based on selected period
  const dashboardMetrics = useMemo(() => {
    const current = getMetricsForPeriod(dashboardPeriod, 0);
    const previous = getMetricsForPeriod(dashboardPeriod, 1);

    return {
      sales: {
        value: current.revenue,
        change: calculateChange(current.revenue, previous.revenue),
        period: dashboardPeriod
      },
      expenses: {
        value: current.expenseTotal,
        change: calculateChange(current.expenseTotal, previous.expenseTotal),
        period: dashboardPeriod
      },
      products: products.length,
      profits: {
        value: current.netProfit,
        change: calculateChange(current.netProfit, previous.netProfit),
        period: dashboardPeriod
      },
      grossProfit: {
        value: current.grossProfit,
        change: calculateChange(current.grossProfit, previous.grossProfit),
        period: dashboardPeriod
      },
      netProfit: {
        value: current.netProfit,
        change: calculateChange(current.netProfit, previous.netProfit),
        period: dashboardPeriod
      },
      tax: {
        value: current.taxCollected,
        change: calculateChange(current.taxCollected, previous.taxCollected),
        period: dashboardPeriod
      },
      receipts: current.receiptCount,
    };
  }, [sales, expenses, products, dashboardPeriod, services, getBusinessDayRange]);

  // Product & Service Chart Data
  const chartData = useMemo(() => {
    const productSales = sales.filter(s => s.type === 'product');
    const serviceSales = sales.filter(s => s.type === 'service');

    // Group by item name
    const productMap: { [key: string]: { qty: number; revenue: number; count: number } } = {};
    productSales.forEach(s => {
      if (!productMap[s.itemName]) {
        productMap[s.itemName] = { qty: 0, revenue: 0, count: 0 };
      }
      productMap[s.itemName].qty += s.qty;
      productMap[s.itemName].revenue += s.amount;
      productMap[s.itemName].count += 1;
    });

    const serviceMap: { [key: string]: { revenue: number; count: number } } = {};
    serviceSales.forEach(s => {
      if (!serviceMap[s.itemName]) {
        serviceMap[s.itemName] = { revenue: 0, count: 0 };
      }
      serviceMap[s.itemName].revenue += s.amount;
      serviceMap[s.itemName].count += 1;
    });

    return { productMap, serviceMap };
  }, [sales]);

  const dashboardInsights = useMemo(() => {
    const itemMap = new Map<string, { name: string; type: 'product' | 'service'; qty: number; revenue: number }>();

    sales.forEach((sale) => {
      const key = `${sale.type}:${sale.itemName}`;
      if (!itemMap.has(key)) {
        itemMap.set(key, { name: sale.itemName, type: sale.type, qty: 0, revenue: 0 });
      }
      const item = itemMap.get(key)!;
      item.qty += sale.qty;
      item.revenue += sale.amount;
    });

    const ranked = Array.from(itemMap.values());
    const mostSold = ranked.sort((a, b) => b.qty - a.qty).slice(0, 3);
    const topRevenue = ranked.sort((a, b) => b.revenue - a.revenue).slice(0, 3);

    const today = new Date();
    const trendDays = Array.from({ length: insightTrendRange }, (_, idx) => {
      const d = new Date(today);
      d.setHours(12, 0, 0, 0);
      d.setDate(today.getDate() - (insightTrendRange - 1 - idx));
      const key = d.toISOString().slice(0, 10);
      return { date: key, revenue: 0, expense: 0 };
    });
    const trendMap = new Map(trendDays.map((item) => [item.date, item]));

    sales.forEach((sale) => {
      const key = new Date(sale.createdAt).toISOString().slice(0, 10);
      const bucket = trendMap.get(key);
      if (bucket) bucket.revenue += sale.amount;
    });
    expenses.forEach((expense) => {
      const key = new Date(expense.createdAt).toISOString().slice(0, 10);
      const bucket = trendMap.get(key);
      if (bucket) bucket.expense += expense.amount;
    });

    const maxRevenue = trendDays.reduce((max, day) => Math.max(max, day.revenue), 0);
    const chartMax = trendDays.reduce((max, day) => Math.max(max, day.revenue, day.expense), 0);
    const totalRevenue = trendDays.reduce((acc, day) => acc + day.revenue, 0);
    const totalExpense = trendDays.reduce((acc, day) => acc + day.expense, 0);
    const averageRevenue = trendDays.length > 0 ? totalRevenue / trendDays.length : 0;

    return { mostSold, topRevenue, trendDays, maxRevenue, chartMax, totalRevenue, totalExpense, averageRevenue };
  }, [insightTrendRange, sales, expenses]);

  // Filtered products for inventory
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const query = productSearchQuery.trim().toLowerCase();
      const matchesSearch = [p.name, p.sku, p.barcode, p.category].some((value) => value?.toLowerCase().includes(query));
      const matchesBranch = !productBranchFilter || p.branchId === productBranchFilter;
      const matchesStock = 
        productStockFilter === 'all' ? true :
        productStockFilter === 'low' ? stockIsLow(p) :
        p.stock === 0;
      return matchesSearch && matchesBranch && matchesStock;
    });
  }, [products, productSearchQuery, productBranchFilter, productStockFilter]);

  const productCategories = useMemo(() => {
    const names = new Set(products.map((product) => product.category?.trim()).filter((value): value is string => Boolean(value)));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const recentStockMovements = useMemo(() => activityLogs
    .filter((log): log is ActivityLog & { stockMovement: StockMovementAudit } => Boolean(log.stockMovement))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 400), [activityLogs]);

  const currentAuditStamp = () => ({
    createdAt: new Date().toISOString(),
    createdByUid: authUser?.uid || 'unknown',
    createdByEmail: authUser?.email || 'unknown',
  });

  const updatedAuditStamp = () => ({
    updatedAt: new Date().toISOString(),
    updatedByUid: authUser?.uid || 'unknown',
    updatedByEmail: authUser?.email || 'unknown',
  });

  useEffect(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const sharedCostServices = services.filter((service) => service.serviceType === 'shared_cost' && service.monthlySharedCost > 0);
    if (sharedCostServices.length === 0) return;

    setExpenses((prev) => {
      const existingAutoExpenseKeys = new Set(
        prev
          .filter((expense) => expense.id.startsWith('auto-shared-cost::'))
          .map((expense) => expense.id)
      );

      const newAutoExpenses: Expense[] = [];
      sharedCostServices.forEach((service) => {
        const autoExpenseId = `auto-shared-cost::${todayKey}::${service.branchId}::${service.id}`;
        if (existingAutoExpenseKeys.has(autoExpenseId)) return;

        newAutoExpenses.push({
          id: autoExpenseId,
          title: `Shared Cost (${todayKey}) - ${service.name}`,
          branchId: service.branchId,
          amount: service.monthlySharedCost / 30,
          expenseGroupId: service.expenseGroupId || undefined,
          ...currentAuditStamp(),
        });
      });

      if (newAutoExpenses.length === 0) return prev;
      return [...newAutoExpenses, ...prev];
    });
  }, [services]);

  const logActivity = (action: string, details: string, stockMovement?: StockMovementAudit) => {
    setActivityLogs((prev) => [{
      id: crypto.randomUUID(),
      action,
      details,
      role,
      userEmail: authUser?.email || 'unknown',
      createdAt: new Date().toISOString(),
      ...(stockMovement ? { stockMovement } : {}),
    }, ...prev].slice(0, ACTIVITY_KEEP));
  };

  const logStockMovement = (
    product: Product,
    quantityDelta: number,
    reason: StockMovementReason,
    note?: string,
    branchTransfer?: { fromBranchId: string; toBranchId: string },
    receiptMetadata?: Pick<StockMovementAudit, 'supplierName' | 'reference' | 'unitCost'>
  ) => {
    if (quantityDelta === 0 && reason !== 'branch_transfer') return;
    const stockMovement: StockMovementAudit = {
      productId: product.id,
      productName: product.name,
      branchId: branchTransfer?.toBranchId || product.branchId,
      quantityDelta,
      reason,
      ...(branchTransfer ? branchTransfer : {}),
      ...(receiptMetadata ? receiptMetadata : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
    const quantityLabel = quantityDelta > 0 ? `+${quantityDelta}` : `${quantityDelta}`;
    const details = reason === 'branch_transfer'
      ? `${product.stock} units of "${product.name}" moved between branches.`
      : `${quantityLabel} units of "${product.name}" (${reason.replaceAll('_', ' ')}).${note?.trim() ? ` ${note.trim()}` : ''}`;
    logActivity(`stock_${reason}`, details, stockMovement);
  };

  const createCheckoutMetadata = () => ({
    transactionId: crypto.randomUUID(),
    ...(checkoutDetails.customerName.trim() ? { customerName: checkoutDetails.customerName.trim() } : {}),
    ...(checkoutDetails.customerPhone.trim() ? { customerPhone: checkoutDetails.customerPhone.trim() } : {}),
    paymentMethod: checkoutDetails.paymentMethod,
    ...(
      checkoutDetails.paymentMethod !== 'cash' && checkoutDetails.paymentMethod !== 'on_account' && checkoutDetails.paymentReference.trim()
        ? { paymentReference: checkoutDetails.paymentReference.trim() }
        : {}
    ),
  });

  const renderCheckoutDetailsFields = () => (
    <>
      <div className="form" style={{ marginTop: '0.85rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <label className="field">
          <span>Customer name (optional)</span>
          <input value={checkoutDetails.customerName} onChange={(e) => setCheckoutDetails((prev) => ({ ...prev, customerName: e.target.value }))} maxLength={100} autoComplete="name" />
        </label>
        <label className="field">
          <span>Customer phone (optional)</span>
          <input value={checkoutDetails.customerPhone} onChange={(e) => setCheckoutDetails((prev) => ({ ...prev, customerPhone: e.target.value }))} maxLength={40} inputMode="tel" autoComplete="tel" />
        </label>
        <label className="field">
          <span>Payment method</span>
          <select value={checkoutDetails.paymentMethod} onChange={(e) => {
            const paymentMethod = e.target.value as PaymentMethod;
            setCheckoutDetails((prev) => ({ ...prev, paymentMethod, paymentReference: paymentMethod === 'cash' || paymentMethod === 'on_account' ? '' : prev.paymentReference }));
          }}>
            <option value="cash">Cash</option>
            <option value="mobile_money">Mobile money (record only)</option>
            <option value="card_terminal">Card terminal (record only)</option>
            <option value="bank_transfer">Bank transfer (record only)</option>
            <option value="on_account">On account</option>
            <option value="other">Other (record only)</option>
          </select>
        </label>
        {checkoutDetails.paymentMethod !== 'cash' && checkoutDetails.paymentMethod !== 'on_account' && (
          <label className="field">
            <span>Payment reference (optional)</span>
            <input value={checkoutDetails.paymentReference} onChange={(e) => setCheckoutDetails((prev) => ({ ...prev, paymentReference: e.target.value }))} maxLength={100} />
          </label>
        )}
      </div>
      <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
        Non-cash tenders are recorded for the sale only; AlphaPOS does not process the payment.
      </p>
    </>
  );

  const chooseProductPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProductPhotoBusy(true);
    try {
      const image = await compressProductPhoto(file);
      const next = splitProductImages(products.filter((product) => product.id !== productForm.id)).images;
      next[productForm.id || 'draft'] = image;
      if (imageMapChars(next) > PRODUCT_IMAGE_DOC_MAX_CHARS) {
        showNotification('This shop has as many photos as it can keep. Remove a photo from another product first.', 'error', 5000);
        return;
      }
      setProductForm((prev) => ({ ...prev, image }));
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Could not use that photo.', 'error');
    } finally {
      setProductPhotoBusy(false);
    }
  };

  const canEditSku = role === 'shop_owner' || role === 'admin' || role === 'manager' || role === 'stock';

  const suggestSku = (name: string, barcode: string, exceptId = '') => (
    nextSku(name || 'Item', reservedProductCodes(products, exceptId, barcode.trim() ? [barcode] : []))
  );

  const openProductForm = (form: ReturnType<typeof blankProductForm>) => {
    const typed = form.category.trim();
    const known = productCategories.some((name) => name.toLowerCase() === typed.toLowerCase());
    const editing = Boolean(form.id);
    setSkuManual(editing);
    setProductForm(editing ? form : { ...form, sku: suggestSku(form.name, form.barcode) });
    setNewCategoryOpen(typed ? !known : productCategories.length === 0);
    setShowProductModal(true);
  };

  const saveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const name = productForm.name.trim();
    const barcode = productForm.barcode.trim();
    const previousProduct = products.find((product) => product.id === productForm.id);
    let sku = canEditSku ? productForm.sku.trim().toUpperCase() : (previousProduct?.sku || '');
    if (!sku) sku = nextSku(name, reservedProductCodes(products, productForm.id, barcode ? [barcode] : []));
    if (barcode && sku.toLowerCase() === barcode.toLowerCase()) {
      showNotification('The SKU and barcode need to be different.', 'error');
      return;
    }
    if (!name || !productForm.branchId) return;
    if (!Number.isFinite(productForm.stock) || productForm.stock < 0 || !Number.isFinite(productForm.purchasePrice) || productForm.purchasePrice < 0 || !Number.isFinite(productForm.salePrice) || productForm.salePrice < 0) {
      showNotification('Enter valid non-negative stock and price values.', 'error');
      return;
    }
    const identifiers = [sku, barcode].filter(Boolean).map((identifier) => identifier.toLowerCase());
    const duplicateIdentifier = products.some((product) => product.id !== productForm.id && [product.sku, product.barcode].some((identifier) => identifier && identifiers.includes(identifier.trim().toLowerCase())));
    if (duplicateIdentifier) {
      showNotification('That SKU or barcode is already assigned to another product.', 'error');
      return;
    }
    const image = isProductImage(productForm.image) ? productForm.image : undefined;
    const typedCategory = productForm.category.trim().slice(0, 40);
    const category = productCategories.find((item) => item.toLowerCase() === typedCategory.toLowerCase()) || typedCategory || undefined;
    const purchasePrice = !seesCost && previousProduct ? previousProduct.purchasePrice : productForm.purchasePrice;
    const reorderPoint = !seesCost && previousProduct
      ? (previousProduct.reorderPoint ?? DEFAULT_REORDER_POINT)
      : (Number.isFinite(productForm.reorderPoint) && productForm.reorderPoint >= 0 ? productForm.reorderPoint : DEFAULT_REORDER_POINT);
    const productDetails = { ...productForm, name, sku: sku || undefined, barcode: barcode || undefined, category, image, purchasePrice, reorderPoint };
    if (productForm.id) {
      setProducts((prev) => prev.map((p) => (p.id === productForm.id ? { ...p, ...productDetails, ...updatedAuditStamp() } : p)));
      if (previousProduct) {
        const updatedProduct = { ...previousProduct, ...productDetails };
        if (previousProduct.branchId !== updatedProduct.branchId && previousProduct.stock > 0) {
          logStockMovement(previousProduct, 0, 'branch_transfer', undefined, { fromBranchId: previousProduct.branchId, toBranchId: updatedProduct.branchId });
        }
        const quantityDelta = updatedProduct.stock - previousProduct.stock;
        if (quantityDelta !== 0) logStockMovement(updatedProduct, quantityDelta, 'count_correction');
      }
      setStatus('Product updated.');
      logActivity('edit_inventory', `Updated product "${name}"`);
    } else {
      const newProduct: Product = { ...productDetails, id: crypto.randomUUID(), ...currentAuditStamp() };
      setProducts((prev) => [...prev, newProduct]);
      if (newProduct.stock > 0) logStockMovement(newProduct, newProduct.stock, 'opening_stock');
      setStatus('Product added.');
      logActivity('add_inventory', `Added product "${name}"`);
    }
    setProductForm(blankProductForm());
    setShowProductModal(false);
  };

  const saveService = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceForm.name || !serviceForm.branchId || serviceForm.amount <= 0) return;
    if (serviceForm.serviceType === 'direct_cost' && serviceForm.directCost < 0) return;
    if (serviceForm.serviceType === 'shared_cost' && serviceForm.monthlySharedCost <= 0) return;

    setServices((prev) => {
      const existing = prev.find((service) => service.name.toLowerCase() === serviceForm.name.trim().toLowerCase() && service.branchId === serviceForm.branchId);
      if (existing) {
        return prev.map((service) =>
          service.id === existing.id
            ? {
                ...service,
                name: serviceForm.name.trim(),
                salePrice: serviceForm.amount,
                serviceType: serviceForm.serviceType,
                directCost: serviceForm.serviceType === 'direct_cost' ? serviceForm.directCost : 0,
                monthlySharedCost: serviceForm.serviceType === 'shared_cost' ? serviceForm.monthlySharedCost : 0,
                expenseGroupId: serviceForm.serviceType === 'shared_cost' ? (serviceForm.expenseGroupId || undefined) : undefined,
                ...updatedAuditStamp()
              }
            : service
        );
      }
      return [...prev, {
        id: crypto.randomUUID(),
        name: serviceForm.name.trim(),
        branchId: serviceForm.branchId,
        salePrice: serviceForm.amount,
        serviceType: serviceForm.serviceType,
        directCost: serviceForm.serviceType === 'direct_cost' ? serviceForm.directCost : 0,
        monthlySharedCost: serviceForm.serviceType === 'shared_cost' ? serviceForm.monthlySharedCost : 0,
        expenseGroupId: serviceForm.serviceType === 'shared_cost' ? (serviceForm.expenseGroupId || undefined) : undefined,
        ...currentAuditStamp()
      }];
    });

    showNotification('Service saved successfully!', 'success');
    setServiceForm({ name: '', branchId: '', amount: 0, serviceType: 'direct_cost', directCost: 0, monthlySharedCost: 0, expenseGroupId: '' });
    setShowServiceModal(false);
  };

  const expenseGroupMap = useMemo(() => Object.fromEntries(expenseGroups.map((g) => [g.id, g.name])), [expenseGroups]);
  const defaultAccount = useMemo(() => accounts.find((account) => account.isDefault) || accounts[0], [accounts]);
  const selectedSaleAccountId = useMemo(() => {
    if (saleAccountId && accounts.some((account) => account.id === saleAccountId)) return saleAccountId;
    return defaultAccount?.id;
  }, [accounts, defaultAccount?.id, saleAccountId]);
  const accountMap = useMemo(() => Object.fromEntries(accounts.map((account) => [account.id, account.name])), [accounts]);
  const accountBalances = useMemo(
    () => computeAccountBalances(accounts, sales, expenses, customerPayments),
    [accounts, customerPayments, expenses, sales],
  );
  const openCashSession = useMemo(() => cashSessions.find((session) => session.status === 'open') || null, [cashSessions]);
  const sessionExpectedCash = openCashSession
    ? openCashSession.openingFloat + sessionCashTaken(sales, openCashSession.id) + sessionCashAdjustments(expenses, customerPayments, openCashSession.id)
    : 0;
  const suggestedFloat = useMemo(() => {
    const latestClose = cashSessions
      .filter((session) => session.status === 'closed' && typeof session.countedCash === 'number')
      .sort((a, b) => new Date(b.closedAt || 0).getTime() - new Date(a.closedAt || 0).getTime())[0];
    return latestClose?.countedCash || 0;
  }, [cashSessions]);
  const recentClosedShifts = useMemo(() => cashSessions
    .filter((session) => session.status === 'closed')
    .sort((a, b) => new Date(b.closedAt || 0).getTime() - new Date(a.closedAt || 0).getTime())
    .slice(0, 5), [cashSessions]);
  const customerBalance = (name: string, phone?: string) => (
    customerAccountBalance(sales, name, phone) - customerPayments.filter((payment) => paymentMatchesCustomer(payment, name, phone)).reduce((sum, payment) => sum + payment.amount, 0)
  );
  const recordCustomerPayment = (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentCustomer) return;
    const amount = roundMoney(Number(paymentDraft.amount));
    const owed = customerBalance(paymentCustomer.name, paymentCustomer.phone);
    if (!Number.isFinite(amount) || amount <= 0) {
      showNotification('Enter an amount greater than zero.', 'error');
      return;
    }
    if (amount > owed) {
      showNotification('That is more than this customer owes.', 'error');
      return;
    }
    const payment: CustomerPayment = {
      id: crypto.randomUUID(),
      customerName: paymentCustomer.name,
      ...(paymentCustomer.phone ? { customerPhone: paymentCustomer.phone } : {}),
      amount,
      method: paymentDraft.method,
      createdAt: new Date().toISOString(),
      ...(paymentDraft.method === 'cash' && openCashSession ? { cashSessionId: openCashSession.id } : {}),
    };
    setCustomerPayments((prev) => [payment, ...prev]);
    logActivity('customer_payment', `${paymentCustomer.name} paid ${formatUGX(amount)} by ${PAYMENT_METHOD_LABELS[payment.method]}.`);
    showNotification('Payment recorded.', 'success');
    setPaymentCustomer(null);
  };
  const showRegisterMargin = role === 'shop_owner' || role === 'admin' || role === 'manager';

  const createExpenseGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const name = expenseGroupForm.name.trim();
    if (!name) return;
    const exists = expenseGroups.some((group) => group.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      showNotification('Expense group already exists', 'error');
      return;
    }
    const newGroup: ExpenseGroup = { id: crypto.randomUUID(), name, ...currentAuditStamp() };
    setExpenseGroups((prev) => [newGroup, ...prev]);
    setExpenseGroupForm({ name: '' });
    setStatus(`Expense group "${name}" created.`);
  };
  const createAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const name = accountForm.name.trim();
    if (!name) return;
    const exists = accounts.some((account) => account.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      showNotification('Account already exists', 'error');
      return;
    }
    const newAccount: Account = {
      id: crypto.randomUUID(),
      name,
      openingBalance: Number(accountForm.openingBalance) || 0,
      isDefault: false,
      ...currentAuditStamp(),
    };
    setAccounts((prev) => [...prev, newAccount]);
    setAccountForm({ name: '', openingBalance: 0 });
    showNotification(`Account "${name}" created`, 'success');
  };
  const requestDoubleAccountConfirmation = (actionLabel: string) => {
    const initialConfirmation = window.confirm(`Are you sure you want to ${actionLabel}?`);
    if (!initialConfirmation) return false;
    return window.confirm(`Please confirm again: are you absolutely sure you want to ${actionLabel}?`);
  };

  const topUpAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(isShopOwner || role === 'admin')) {
      showNotification('Only admin or shop owner can top up accounts.', 'error');
      return;
    }
    const selectedAccountId = accountTopUpForm.accountId || defaultAccount?.id;
    const amount = Number(accountTopUpForm.amount);
    if (!selectedAccountId || amount <= 0) {
      showNotification('Choose account and enter an amount greater than 0.', 'error');
      return;
    }
    const accountName = accountMap[selectedAccountId] || 'account';
    if (!requestDoubleAccountConfirmation(`top up ${accountName} by ${formatUGX(amount)}`)) {
      showNotification('Top up cancelled.', 'info');
      return;
    }
    setAccounts((prev) => prev.map((account) => account.id === selectedAccountId
      ? { ...account, openingBalance: (account.openingBalance || 0) + amount, ...updatedAuditStamp() }
      : account));
    setAccountTopUpForm({ accountId: selectedAccountId, amount: 0 });
    logActivity('account_top_up', `Topped up ${formatUGX(amount)} to "${accountName}"`);
    showNotification(`Top up completed for ${accountName}`, 'success');
  };

  const editAccountOpeningBalance = (accountId: string) => {
    if (!(isShopOwner || role === 'admin')) {
      showNotification('Only admin or shop owner can edit account values.', 'error');
      return;
    }
    const targetAccount = accounts.find((account) => account.id === accountId);
    if (!targetAccount) return;
    const currentValue = targetAccount.openingBalance || 0;
    const input = window.prompt(`Enter new opening balance for ${targetAccount.name}`, String(currentValue));
    if (input === null) return;
    const nextValue = Number(input);
    if (!Number.isFinite(nextValue)) {
      showNotification('Please enter a valid number.', 'error');
      return;
    }
    if (!requestDoubleAccountConfirmation(`set ${targetAccount.name} opening balance to ${formatUGX(nextValue)}`)) {
      showNotification('Account update cancelled.', 'info');
      return;
    }
    setAccounts((prev) => prev.map((account) => account.id === accountId
      ? { ...account, openingBalance: nextValue, ...updatedAuditStamp() }
      : account));
    logActivity('edit_account', `Changed opening balance for "${targetAccount.name}" to ${formatUGX(nextValue)}`);
    showNotification(`Updated ${targetAccount.name} opening balance.`, 'success');
  };

  const transferUngroupedExpenses = () => {
    if (!transferExpenseGroupId) return;
    setExpenses((prev) => prev.map((expense) => (!expense.expenseGroupId ? { ...expense, expenseGroupId: transferExpenseGroupId, ...updatedAuditStamp() } : expense)));
    setStatus('Ungrouped expenses transferred successfully.');
    setTransferExpenseGroupId('');
  };

  const saveExpenseGroupEdit = (groupId: string) => {
    const trimmed = editingExpenseGroupName.trim();
    if (!trimmed) return;
    const duplicate = expenseGroups.some((group) => group.id !== groupId && group.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      showNotification('Expense group name already exists', 'error');
      return;
    }
    setExpenseGroups((prev) => prev.map((group) => group.id === groupId ? { ...group, name: trimmed, ...updatedAuditStamp() } : group));
    setEditingExpenseGroupId('');
    setEditingExpenseGroupName('');
    showNotification('Expense group updated', 'success');
  };

  const expenseChartData = useMemo(() => {
    const now = new Date();
    const rangeStart = new Date(now);
    if (expenseChartRange === 'day') rangeStart.setTime(getBusinessDayRange(now, 0).start.getTime());
    if (expenseChartRange === '7days') rangeStart.setDate(now.getDate() - 7);
    if (expenseChartRange === '14days') rangeStart.setDate(now.getDate() - 14);
    if (expenseChartRange === 'month') rangeStart.setMonth(now.getMonth() - 1);
    if (expenseChartRange === '3months') rangeStart.setMonth(now.getMonth() - 3);
    if (expenseChartRange === '6months') rangeStart.setMonth(now.getMonth() - 6);
    if (expenseChartRange === '1year') rangeStart.setFullYear(now.getFullYear() - 1);
    const filtered = expenses.filter((expense) => new Date(expense.createdAt) >= rangeStart);
    const grouped = new Map<string, number>();
    filtered.forEach((expense) => {
      const groupName = expense.expenseGroupId ? (expenseGroupMap[expense.expenseGroupId] || 'Unknown group') : 'Ungrouped';
      grouped.set(groupName, (grouped.get(groupName) || 0) + expense.amount);
    });
    const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
    const colors = ['#1f6feb', '#7eb6ff', '#123a73', '#5b8def', '#9ec5ff', '#3d5a80', '#4cc9f0', '#90e0ef'];
    const segments = [...grouped.entries()].map(([name, amount], idx) => ({
      name, amount, percentage: total > 0 ? (amount / total) * 100 : 0, color: colors[idx % colors.length]
    })).sort((a, b) => b.amount - a.amount);
    return { total, segments };
  }, [expenseChartRange, expenseGroupMap, expenses, getBusinessDayRange]);

  const saveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.title || !expenseForm.branchId || expenseForm.amount <= 0) return;
    const selectedAccountId = expenseForm.accountId || defaultAccount?.id;
    if (!selectedAccountId) {
      showNotification('Please create an account first (CASH is created by default).', 'error');
      return;
    }
    if (expenseForm.id) {
      setExpenses((prev) => prev.map((ex) => (ex.id === expenseForm.id ? { ...ex, ...expenseForm, accountId: selectedAccountId, ...updatedAuditStamp() } : ex)));
      setStatus('Expense updated.');
      logActivity('edit_expense', `Updated expense "${expenseForm.title}"`);
    } else {
      const cashSessionId = selectedAccountId === defaultAccount?.id && openCashSession ? openCashSession.id : undefined;
      setExpenses((prev) => [...prev, { ...expenseForm, accountId: selectedAccountId, ...(cashSessionId ? { cashSessionId } : {}), id: crypto.randomUUID(), ...currentAuditStamp() }]);
      setStatus('Expense recorded.');
      logActivity('add_expense', `Added expense "${expenseForm.title}"`);
    }
    setExpenseForm({ id: '', title: '', branchId: '', amount: 0, expenseGroupId: '', accountId: defaultAccount?.id || '' });
    setShowExpenseModal(false);
  };

  const saveShopMembership = async (email: string, staffRole: Role) => {
    if (!db || !activeShopOwnerUid) return;
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return;
    const shopMembershipRef = doc(db, 'shopMemberships', `${activeShopOwnerUid}_${normalizedEmail}`);
    await setDoc(shopMembershipRef, {
      ownerUid: activeShopOwnerUid,
      email: normalizedEmail,
      shopName: availableShops.find(s => s.ownerUid === activeShopOwnerUid)?.shopName || 'My Shop',
      role: staffRole,
      invitedAt: serverTimestamp(),
    }, { merge: true });
  };

  const emailStaffSignInLink = async (email: string, staffRole: Role) => {
    await saveShopMembership(email, staffRole);
    if (!firebaseApp || !authUser || authUser.uid === LOCAL_OPERATOR_ID) {
      throw new Error('Sign in with Firebase before emailing a staff link. This browser-only counter cannot send email.');
    }
    const shopName = availableShops.find((shop) => shop.ownerUid === activeShopOwnerUid)?.shopName || 'My Shop';
    const idToken = await getAuth(firebaseApp).currentUser?.getIdToken();
    if (!idToken) throw new Error('Sign in again before sending email.');
    const inviteLink = await createStaffInviteLink(email, activeShopOwnerUid);
    const response = await fetch('/api/email/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        email,
        roleLabel: roleLabels[staffRole],
        shopName,
        link: inviteLink.link,
        directSignIn: inviteLink.directSignIn,
      }),
    });
    const raw = await response.text();
    let payload: { ok?: boolean; reason?: string; error?: string } = {};
    try {
      payload = raw ? JSON.parse(raw) as { ok?: boolean; reason?: string; error?: string } : {};
    } catch {
      payload = { error: 'The invite server failed before it could answer. Try again in a moment.' };
    }
    if (!response.ok || !payload.ok) {
      if (payload.reason === 'not_configured') {
        throw new Error('Staff email is not set up on the server yet. Add RESEND_API_KEY and EMAIL_FROM, then try again.');
      }
      throw new Error(payload.error || 'The invite email could not be sent.');
    }
    const message = inviteLink.directSignIn
      ? `Sign-in email sent to ${email}. They open the link to enter as ${roleLabels[staffRole]}.`
      : `Invite emailed to ${email}. They open the link and sign in with Google using that address as ${roleLabels[staffRole]}.`;
    setStatus(message);
    showNotification(message, 'success', 6000);
  };

  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.email || !userForm.name || !userForm.branchId) return;
    const email = userForm.email.trim();

    if (userForm.id) {
      const previous = users.find((user) => user.id === userForm.id);
      setUsers((prev) => prev.map((u) => (u.id === userForm.id ? { ...u, ...userForm, email, ...updatedAuditStamp() } : u)));
      if (db && previous && previous.email.toLowerCase().trim() !== email.toLowerCase()) {
        await deleteDoc(doc(db, 'shopMemberships', `${activeShopOwnerUid}_${previous.email.toLowerCase().trim()}`)).catch(() => undefined);
      }
      await saveShopMembership(email, userForm.role).catch((error) => {
        showNotification(error instanceof Error ? error.message : 'Could not update shop access.', 'error');
      });
      setStatus('User updated.');
      logActivity('edit_user', `Updated user "${email}"`);
    } else {
      const newUser: StaffUser = {
        id: crypto.randomUUID(),
        name: userForm.name,
        email,
        role: userForm.role,
        branchId: userForm.branchId,
        ...currentAuditStamp(),
      };
      setUsers((prev) => [...prev, newUser]);
      logActivity('add_user', `Added user "${email}" with role "${userForm.role}"`);
      try {
        await emailStaffSignInLink(email, userForm.role);
      } catch (error) {
        const message = `Staff saved, but the sign-in email was not sent. ${staffSignInError(error)}`;
        setStatus(message);
        showNotification(message, 'error', 7000);
      }
    }
    setUserForm({ id: '', name: '', email: '', role: 'cashier', branchId: '' });
    setShowUserModal(false);
  };

  const deliverSalesReport = useCallback(async (manual: boolean) => {
    const notify = (message: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) => {
      showNotificationRef.current(message, type, duration);
    };
    if (salesEmailSettings.cadence === 'off') {
      if (manual) notify('Choose daily, weekly, or monthly first.', 'info');
      return;
    }
    if (!manual && !hasLoadedUserDataRef.current) return;
    if (!firebaseApp || !authUser || authUser.uid === LOCAL_OPERATOR_ID) {
      if (manual) notify('Sign in with Firebase before emailing a sales report. This browser-only counter cannot send email.', 'error', 6000);
      return;
    }
    if (!(isShopOwner || role === 'admin')) return;
    const period = previousSalesPeriod(salesEmailSettings.cadence, new Date(), shopTimeSettings.timezoneOffsetMinutes);
    if (!manual && salesEmailSettings.lastSentKey === period.key) return;
    const claimKey = `${activeShopOwnerUid}:${period.key}`;
    if (!beginSalesEmailSend(claimKey, manual)) return;
    setSendingSalesEmail(true);
    const stop = (result: 'sent' | 'blocked' | 'failed') => finishSalesEmailSend(claimKey, result);
    try {
      const digest: SalesDigest = buildSalesDigest(currentShop?.shopName || 'My Shop', salesEmailSettings.cadence, period, sales, expenses);
      const idToken = await getAuth(firebaseApp).currentUser?.getIdToken();
      if (!idToken) throw new Error('Sign in again before sending email.');
      const response = await fetch('/api/email/sales-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, recipients: salesEmailSettings.recipients, digest }),
      });
      const raw = await response.text();
      let payload: { ok?: boolean; reason?: string; error?: string } = {};
      try {
        payload = raw ? JSON.parse(raw) as { ok?: boolean; reason?: string; error?: string } : {};
      } catch {
        payload = { error: 'The sales email server failed before it could answer. Try again in a moment.' };
      }
      if (payload.ok) {
        setSalesEmailSettings((prev) => ({ ...prev, lastSentKey: period.key }));
        stop('sent');
        const message = `Sales email sent for ${period.label}.`;
        setStatus(message);
        if (manual) notify(message, 'success', 5000);
        return;
      }
      stop(manual ? 'failed' : 'blocked');
      if (!manual) return;
      if (payload.reason === 'not_configured') {
        notify('Sales email is not set up on the server yet. Add RESEND_API_KEY and EMAIL_FROM, then try again.', 'error', 7000);
        return;
      }
      notify(payload.error || 'The sales email could not be sent.', 'error', 8000);
    } catch (error) {
      stop(manual ? 'failed' : 'blocked');
      if (manual) notify(error instanceof Error ? error.message : 'The sales email could not be sent.', 'error', 6000);
    } finally {
      setSendingSalesEmail(false);
    }
  }, [activeShopOwnerUid, authUser, currentShop?.shopName, expenses, isShopOwner, role, sales, salesEmailSettings, shopTimeSettings.timezoneOffsetMinutes]);

  const deliverSalesReportRef = useRef(deliverSalesReport);
  deliverSalesReportRef.current = deliverSalesReport;

  useEffect(() => {
    if (document.activeElement === recipientInputRef.current) return;
    setRecipientDraft(salesEmailSettings.recipients.join(', '));
  }, [salesEmailSettings.recipients]);

  useEffect(() => {
    if (salesEmailSettings.cadence === 'off') return;
    void deliverSalesReportRef.current(false);
  }, [salesEmailSettings.cadence, salesEmailSettings.lastSentKey, authUser, activeShopOwnerUid, role, isShopOwner, shopTimeSettings.timezoneOffsetMinutes]);

  const addProductToCart = (productId: string, silent = false) => {
    const product = products.find(p => p.id === productId);
    if (!product) {
      showNotification('Product not found', 'error');
      return;
    }
    if (product.stock <= 0) {
      showNotification('Product out of stock', 'error');
      return;
    }
    const existingItem = cart.find(item => item.itemType === 'product' && item.itemId === productId);
    if (existingItem) {
      if (existingItem.qty + 1 > product.stock) {
        showNotification('Insufficient stock for this quantity', 'error');
        return;
      }
      setCart(prev => prev.map(item => 
        item.itemType === 'product' && item.itemId === productId ? { ...item, qty: item.qty + 1 } : item
      ));
    } else {
      setCart(prev => [...prev, {
        itemId: product.id,
        itemType: 'product',
        itemName: product.name,
        qty: 1,
        unitPrice: product.salePrice,
        unitCost: product.purchasePrice,
        branchId: product.branchId,
        maxQty: product.stock
      }]);
    }
    if (!silent) showNotification(`${product.name} added to cart`, 'success', 2000);
  };

  const addServiceToCart = (serviceId: string, silent = false) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) {
      showNotification('Service not found', 'error');
      return;
    }
    const existingItem = cart.find((item) => item.itemType === 'service' && item.itemId === serviceId);
    if (existingItem) {
      setCart((prev) => prev.map((item) => item.itemType === 'service' && item.itemId === serviceId ? { ...item, qty: item.qty + 1 } : item));
    } else {
      setCart((prev) => [...prev, {
        itemId: service.id,
        itemType: 'service',
        itemName: service.name,
        qty: 1,
        unitPrice: service.salePrice,
        unitCost: service.serviceType === 'direct_cost' ? service.directCost : 0,
        branchId: service.branchId,
      }]);
    }
    if (!silent) showNotification(`${service.name} added to cart`, 'success', 2000);
  };

  const updateCartItemQty = (itemId: string, itemType: 'product' | 'service', qty: number) => {
    if (!Number.isFinite(qty) || qty <= 0) {
      removeFromCart(itemId, itemType);
      return;
    }
    const cartItem = cart.find((item) => item.itemId === itemId && item.itemType === itemType);
    if (!cartItem) return;
    if (itemType === 'product' && cartItem.maxQty && qty > cartItem.maxQty) {
      showNotification(`Only ${cartItem.maxQty} units available`, 'error');
      return;
    }
    setCart(prev => prev.map(item => 
      item.itemId === itemId && item.itemType === itemType ? { ...item, qty } : item
    ));
  };

  const removeFromCart = (itemId: string, itemType: 'product' | 'service') => {
    setCart(prev => prev.filter(item => !(item.itemId === itemId && item.itemType === itemType)));
    showNotification('Item removed from cart', 'info', 1500);
  };

  const updateCartItemDiscountMode = (itemId: string, itemType: 'product' | 'service', discountMode: CartDiscountMode) => {
    setCart((prev) => prev.map((item) => {
      if (item.itemId !== itemId || item.itemType !== itemType) return item;
      if (discountMode === 'price') return { ...item, discountMode, discountedUnitPrice: item.unitPrice, discountPercent: undefined };
      if (discountMode === 'percent') return { ...item, discountMode, discountPercent: 0, discountedUnitPrice: undefined };
      return { ...item, discountMode: 'none', discountedUnitPrice: undefined, discountPercent: undefined };
    }));
  };

  const updateCartItemDiscountValue = (itemId: string, itemType: 'product' | 'service', rawValue: number) => {
    setCart((prev) => prev.map((item) => {
      if (item.itemId !== itemId || item.itemType !== itemType) return item;
      if (!Number.isFinite(rawValue)) return item;
      if (item.discountMode === 'price') {
        return { ...item, discountedUnitPrice: Math.max(0, Math.min(item.unitPrice, rawValue)) };
      }
      if (item.discountMode === 'percent') {
        return { ...item, discountPercent: Math.max(0, Math.min(100, rawValue)) };
      }
      return item;
    }));
  };

  const registerQuote = useMemo(() => settleCart(cart.map((item) => ({
    key: `${item.itemType}:${item.itemId}`,
    unitPrice: item.unitPrice,
    qty: item.qty,
    effectiveUnitPrice: getEffectiveUnitPrice(item),
    unitCost: item.unitCost,
  })), cartDiscount, taxSettings), [cart, cartDiscount, getEffectiveUnitPrice, taxSettings]);

  const rememberCustomer = (name: string, phone: string) => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName && !trimmedPhone) return;
    setCustomers((prev) => {
      const existing = prev.find((customer) => (trimmedPhone && customer.phone === trimmedPhone) || customer.name.toLowerCase() === trimmedName.toLowerCase());
      if (existing) {
        return prev.map((customer) => customer.id === existing.id ? { ...customer, name: trimmedName || customer.name, ...(trimmedPhone ? { phone: trimmedPhone } : {}) } : customer);
      }
      return [{ id: crypto.randomUUID(), name: trimmedName || 'Customer', ...(trimmedPhone ? { phone: trimmedPhone } : {}), createdAt: new Date().toISOString() }, ...prev];
    });
  };

  const receiptFromSaleLines = (lines: Sale[], kind: 'sale' | 'return' = lines.some((line) => line.saleKind === 'return') ? 'return' : 'sale'): ReceiptModel => {
    const first = lines[0];
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    const tax = lines.reduce((sum, line) => sum + (line.taxAmount || 0), 0);
    const discount = lines.reduce((sum, line) => sum + Math.abs(line.discountAmount || 0), 0);
    const tenders = (first?.tenders && first.tenders.length > 0 ? first.tenders : [{
      method: first?.paymentMethod || 'cash',
      amount: total,
      ...(first?.paymentReference ? { reference: first.paymentReference } : {}),
    }]).map((tender) => ({
      label: PAYMENT_METHOD_LABELS[tender.method],
      amount: tender.amount,
      ...(tender.reference ? { reference: tender.reference } : {}),
      ...(typeof tender.tendered === 'number' ? { tendered: tender.tendered } : {}),
      ...(typeof tender.change === 'number' ? { change: tender.change } : {}),
    }));
    return {
      kind,
      receiptNumber: first?.receiptNumber || (first?.transactionId ? `#${first.transactionId.slice(0, 8)}` : 'Receipt'),
      createdAt: first?.createdAt || new Date().toISOString(),
      shopName: currentShop?.shopName || 'My Shop',
      ...(receiptSettings.address ? { address: receiptSettings.address } : {}),
      ...(receiptSettings.phone ? { phone: receiptSettings.phone } : {}),
      ...(receiptSettings.footer ? { footer: receiptSettings.footer } : {}),
      cashier: authUser?.email || 'Cashier',
      ...(first?.customerName ? { customerName: first.customerName } : {}),
      ...(first?.customerPhone ? { customerPhone: first.customerPhone } : {}),
      lines: lines.map((line) => ({ name: line.itemName, qty: line.qty, amount: line.amount })),
      subtotal: kind === 'return' ? total : total - tax + discount,
      discount,
      tax,
      taxName: taxSettings.enabled ? taxSettings.name : 'Tax',
      total,
      tenders,
      showTax: receiptSettings.showTax && (taxSettings.enabled || tax !== 0),
      note: kind === 'return'
        ? 'Credit note. The original sale was not changed.'
        : 'Non-cash tenders are recorded only and were not processed by AlphaPOS.',
    };
  };

  const clearRegister = () => {
    setCart([]);
    setCartDiscount({ mode: 'none', value: 0 });
    setCheckoutDetails(emptyCheckout);
  };

  const openDrawer = (openingFloat: number) => {
    if (openCashSession) {
      showNotification('A drawer is already open.', 'info');
      return;
    }
    const session: CashSession = {
      id: crypto.randomUUID(),
      openedAt: new Date().toISOString(),
      openedByEmail: authUser?.email || 'unknown',
      openingFloat: Math.max(0, roundMoney(openingFloat)),
      status: 'open',
    };
    setCashSessions((prev) => [session, ...prev]);
    logActivity('open_drawer', `Opened the drawer with ${formatUGX(session.openingFloat)}.`);
    showNotification('Drawer opened.', 'success');
  };

  const closeDrawer = (countedCash: number, note: string) => {
    if (!openCashSession) return;
    const expected = sessionExpectedCash;
    const counted = Math.max(0, roundMoney(countedCash));
    const variance = counted - expected;
    setCashSessions((prev) => prev.map((session) => session.id === openCashSession.id ? {
      ...session,
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedByEmail: authUser?.email || 'unknown',
      cashTaken: sessionCashTaken(sales, session.id),
      expectedCash: expected,
      countedCash: counted,
      variance,
      ...(note.trim() ? { note: note.trim() } : {}),
    } : session));
    logActivity('close_drawer', `Closed the drawer. Expected ${formatUGX(expected)}, counted ${formatUGX(counted)}, variance ${formatUGX(variance)}.`);
    showNotification(variance === 0 ? 'Drawer closed. Cash matched.' : `Drawer closed. Variance ${formatUGX(variance)}.`, variance === 0 ? 'success' : 'info', 5000);
  };

  const holdRegisterSale = () => {
    if (cart.length === 0) return;
    if (heldTickets.length >= 20) {
      showNotification('Hold list is full. Recall a ticket first.', 'error');
      return;
    }
    const label = checkoutDetails.customerName.trim() || `Ticket ${heldTickets.length + 1}`;
    setHeldTickets((prev) => [{
      id: crypto.randomUUID(),
      label,
      cart,
      cartDiscount,
      customerName: checkoutDetails.customerName,
      customerPhone: checkoutDetails.customerPhone,
      createdAt: new Date().toISOString(),
      createdByEmail: authUser?.email || 'unknown',
    }, ...prev]);
    clearRegister();
    showNotification(`${label} held.`, 'success');
  };

  const recallHeldSale = (ticketId: string) => {
    const ticket = heldTickets.find((item) => item.id === ticketId);
    if (!ticket) return;
    if (cart.length > 0 && !window.confirm('Replace the current sale with this held ticket?')) return;
    setCart(ticket.cart.map((item) => {
      if (item.itemType !== 'product') return item;
      const product = products.find((record) => record.id === item.itemId);
      return product ? { ...item, maxQty: product.stock, unitPrice: item.unitPrice } : item;
    }));
    setCartDiscount(ticket.cartDiscount);
    setCheckoutDetails({ ...emptyCheckout, customerName: ticket.customerName, customerPhone: ticket.customerPhone });
    setHeldTickets((prev) => prev.filter((item) => item.id !== ticketId));
  };

  const completeRegisterSale = (tenders: Tender[]) => {
    if (cart.length === 0) {
      showNotification('Cart is empty', 'error');
      return;
    }
    if (!openCashSession) {
      showNotification('Open the drawer before taking payment.', 'error');
      return;
    }
    if (cart.some((item) => !Number.isFinite(item.qty) || item.qty <= 0)) {
      showNotification('Sale quantities must be greater than zero.', 'error');
      return;
    }
    if (!selectedSaleAccountId) {
      showNotification('Please create an account first (CASH is created by default).', 'error');
      return;
    }
    if (!tendersCoverTotal(tenders, registerQuote.total)) {
      showNotification('The payment does not match the amount due.', 'error');
      return;
    }
    if (tenders.some((tender) => tender.method === 'on_account') && !checkoutDetails.customerName.trim()) {
      showNotification('Enter a customer name for an on-account sale.', 'error');
      return;
    }
    const insufficientItem = cart.find((item) => item.itemType === 'product' && (products.find((product) => product.id === item.itemId)?.stock ?? 0) < item.qty);
    if (insufficientItem) {
      showNotification(`Not enough stock for "${insufficientItem.itemName}".`, 'error');
      return;
    }
    const soldAt = new Date();
    const receiptNumber = nextDocumentNumber(sales, receiptPrefix(soldAt, 'sale'));
    const transactionId = crypto.randomUUID();
    const primaryTender = [...tenders].sort((a, b) => b.amount - a.amount)[0];
    const customerName = checkoutDetails.customerName.trim();
    const customerPhone = checkoutDetails.customerPhone.trim();
    const newSales: Sale[] = registerQuote.lines.flatMap((line) => {
      const item = cart.find((cartItem) => `${cartItem.itemType}:${cartItem.itemId}` === line.key);
      if (!item) return [];
      return [{
        id: crypto.randomUUID(),
        type: item.itemType,
        itemName: item.itemName,
        branchId: item.branchId,
        qty: line.qty,
        amount: line.amount,
        cost: line.cost,
        taxAmount: line.taxAmount,
        discountAmount: line.discountAmount,
        accountId: selectedSaleAccountId,
        transactionId,
        receiptNumber,
        saleKind: 'sale' as const,
        paymentMethod: primaryTender.method,
        ...(primaryTender.reference ? { paymentReference: primaryTender.reference } : {}),
        tenders,
        cashSessionId: openCashSession.id,
        ...(customerName ? { customerName } : {}),
        ...(customerPhone ? { customerPhone } : {}),
        ...currentAuditStamp(),
      }];
    });
    setSales((prev) => [...newSales, ...prev]);
    setProducts((prev) => prev.map((product) => {
      const cartItem = cart.find((item) => item.itemType === 'product' && item.itemId === product.id);
      return cartItem ? { ...product, stock: product.stock - cartItem.qty } : product;
    }));
    cart.forEach((item) => {
      if (item.itemType !== 'product') return;
      const product = products.find((record) => record.id === item.itemId);
      if (product) logStockMovement(product, -item.qty, 'sale', `Receipt ${receiptNumber}`);
    });
    rememberCustomer(customerName, customerPhone);
    const saleMargin = roundMoney(registerQuote.total - registerQuote.tax - registerQuote.lines.reduce((sum, line) => sum + line.cost, 0));
    logActivity('sale', `Completed ${receiptNumber} for ${formatUGX(registerQuote.total)} (${cart.length} item(s)).`);
    setActiveReceipt(receiptFromSaleLines(newSales, 'sale'));
    clearRegister();
    if (showRegisterMargin && saleMargin < 0) {
      showNotification(`${receiptNumber} is below cost. Margin ${formatUGX(saleMargin)}.`, 'error', 6000);
    } else {
      showNotification(`${receiptNumber} completed.`, 'success');
    }
  };

  const issueReturn = (quantities: Record<string, number>, method: PaymentMethod, reference: string) => {
    if (!openCashSession) {
      showNotification('Open the drawer before refunding.', 'error');
      return;
    }
    const originalLines = sales.filter((sale) => transactionKey(sale) === returnTransactionId && sale.saleKind !== 'return' && sale.qty > 0);
    const selected = originalLines.filter((sale) => (quantities[sale.id] || 0) > 0);
    if (selected.length === 0) return;
    const tooMany = selected.find((sale) => (quantities[sale.id] || 0) > returnableQuantity(sales, returnTransactionId, sale.itemName, sale.type));
    if (tooMany) {
      showNotification(`Only the unsold remainder of ${tooMany.itemName} can be returned.`, 'error');
      return;
    }
    const returnedAt = new Date();
    const receiptNumber = nextDocumentNumber(sales, receiptPrefix(returnedAt, 'return'));
    const transactionId = crypto.randomUUID();
    const stockChanges: { product: Product; qty: number }[] = [];
    const creditLines: Sale[] = selected.map((sale) => {
      const qty = quantities[sale.id] || 0;
      const ratio = qty / sale.qty;
      const amount = -roundMoney(sale.amount * ratio);
      if (sale.type === 'product') {
        const product = products.find((item) => item.branchId === sale.branchId && item.name === sale.itemName);
        if (product) stockChanges.push({ product, qty });
      }
      return {
        id: crypto.randomUUID(),
        type: sale.type,
        itemName: sale.itemName,
        branchId: sale.branchId,
        qty: -qty,
        amount,
        cost: -roundMoney(sale.cost * ratio),
        taxAmount: -roundMoney((sale.taxAmount || 0) * ratio),
        accountId: sale.accountId || selectedSaleAccountId,
        transactionId,
        receiptNumber,
        saleKind: 'return',
        returnOfTransactionId: returnTransactionId,
        paymentMethod: method,
        ...(reference.trim() ? { paymentReference: reference.trim() } : {}),
        tenders: [{ method, amount, ...(reference.trim() ? { reference: reference.trim() } : {}) }],
        cashSessionId: openCashSession.id,
        ...(sale.customerName ? { customerName: sale.customerName } : {}),
        ...(sale.customerPhone ? { customerPhone: sale.customerPhone } : {}),
        ...currentAuditStamp(),
      };
    });
    if (stockChanges.length !== selected.filter((sale) => sale.type === 'product').length) {
      showNotification('A returned product is no longer in inventory, so its stock was not added back.', 'info', 5000);
    }
    setProducts((prev) => prev.map((product) => {
      const change = stockChanges.find((item) => item.product.id === product.id);
      return change ? { ...product, stock: product.stock + change.qty } : product;
    }));
    stockChanges.forEach((change) => logStockMovement(change.product, change.qty, 'customer_return', `Credit ${receiptNumber}`));
    setSales((prev) => [...creditLines, ...prev]);
    logActivity('return', `Issued ${receiptNumber} for ${formatUGX(creditLines.reduce((sum, line) => sum + line.amount, 0))}.`);
    setReturnTransactionId('');
    setActiveReceipt(receiptFromSaleLines(creditLines, 'return'));
    showNotification(`${receiptNumber} issued.`, 'success');
  };

  const makeProductSale = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaleAccountId) {
      showNotification('Please create an account first (CASH is created by default).', 'error');
      return false;
    }
    const p = products.find((x) => x.id === saleForm.productId);
    if (!p || !Number.isFinite(saleForm.qty) || saleForm.qty <= 0 || p.stock < saleForm.qty) {
      showNotification('Invalid sale or insufficient stock.', 'error');
      return false;
    }
    const quickQuote = settleCart([{
      key: p.id,
      unitPrice: p.salePrice,
      qty: saleForm.qty,
      effectiveUnitPrice: p.salePrice,
      unitCost: p.purchasePrice,
    }], { mode: 'none', value: 0 }, taxSettings);
    const quickLine = quickQuote.lines[0];
    const newSale: Sale = {
      id: crypto.randomUUID(),
      type: 'product',
      itemName: p.name,
      branchId: p.branchId,
      qty: saleForm.qty,
      amount: quickLine?.amount ?? p.salePrice * saleForm.qty,
      cost: quickLine?.cost ?? p.purchasePrice * saleForm.qty,
      taxAmount: quickLine?.taxAmount,
      accountId: selectedSaleAccountId,
      receiptNumber: nextDocumentNumber(sales, receiptPrefix(new Date(), 'sale')),
      saleKind: 'sale',
      ...(openCashSession ? { cashSessionId: openCashSession.id } : {}),
      ...createCheckoutMetadata(),
      ...currentAuditStamp(),
    };
    setSales((prev) => [newSale, ...prev]);
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, stock: x.stock - saleForm.qty } : x)));
    logStockMovement(p, -saleForm.qty, 'sale', `Sale ${newSale.id.slice(0, 8)}`);
    logActivity('sale', `Sold ${saleForm.qty} of "${p.name}"`);
    setSaleForm({ productId: '', qty: 1 });
    setCheckoutDetails({ customerName: '', customerPhone: '', paymentMethod: 'cash', paymentReference: '' });
    setStatus('Sale recorded.');
    return true;
  };


  const restockProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      showNotification('Product not found', 'error');
      return;
    }
    setStockAdjustmentForm({ ...emptyStockForm(), productId, lines: null });
    setShowStockAdjustmentModal(true);
  };

  const rememberSupplier = (name: string) => {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed || suppliers.some((supplier) => supplier.name.toLowerCase() === trimmed.toLowerCase())) return;
    setSuppliers((prev) => [...prev, { id: crypto.randomUUID(), name: trimmed }]);
  };

  const readCatalogPhoto = async (mode: CatalogMode, photo: { mimeType: string; base64: string }) => {
    if (!isShopOwner) throw new Error('Only the shop owner can use the product assistant.');
    const idToken = firebaseApp && authUser?.uid !== LOCAL_OPERATOR_ID ? await getAuth(firebaseApp).currentUser?.getIdToken() : '';
    const response = await fetch('/api/catalog/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        mimeType: photo.mimeType,
        image: photo.base64,
        productNames: products.map((product) => product.name).slice(0, 200),
        shopOwnerUid: activeShopOwnerUid,
        ...(catalogKey ? { geminiKey: catalogKey } : {}),
        ...(idToken ? { idToken } : { localCounter: true }),
      }),
    });
    const payload = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'The photo could not be read.');
    return parseCatalogReading(payload);
  };

  const saveCatalogKey = async () => {
    if (!isShopOwner || !authUser) return;
    const next = catalogKeyDraft.trim();
    if (!next) {
      showNotification('Paste a Gemini API key first.', 'error');
      return;
    }
    const problem = catalogKeyError(next);
    if (problem) {
      showNotification(problem, 'error');
      return;
    }
    await storeCatalogKey(next);
  };

  const removeCatalogKey = async () => {
    if (!isShopOwner || !authUser) return;
    setCatalogKeyDraft('');
    await storeCatalogKey('');
  };

  const storeCatalogKey = async (next: string) => {
    if (!authUser) return;
    writeOwnerCatalogKey(authUser.uid, next);
    setCatalogKey(next);
    setCatalogKeyDraft('');
    setShowCatalogKey(false);
    if (db && authUser.uid !== LOCAL_OPERATOR_ID) {
      try {
        await setDoc(doc(db, 'users', authUser.uid, 'pos', 'secrets'), { geminiApiKey: next }, { merge: true });
      } catch {
        showNotification(next ? 'Saved on this device. It will reach your account when the connection succeeds.' : 'Removed on this device.', 'info');
        return;
      }
    }
    logActivity('catalog_key', next ? 'Saved the product assistant key.' : 'Removed the product assistant key.');
    showNotification(next ? 'Assistant key saved.' : 'Assistant key removed.', 'success');
  };

  const addProductsFromAssistant = (rows: CatalogCreateRow[]) => {
    if (!isShopOwner) return false;
    const branchIds = new Set(branches.map((branch) => branch.id));
    const created: Product[] = [];
    const taken = reservedProductCodes(products);
    rows.forEach((row) => {
      const name = row.name.trim().slice(0, 80);
      if (!name || !branchIds.has(row.branchId)) return;
      if ([row.stock, row.purchasePrice, row.salePrice].some((value) => !Number.isFinite(value) || value < 0)) return;
      const duplicate = products.concat(created).some((product) => product.branchId === row.branchId && product.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) return;
      const categoryName = row.category.trim().slice(0, 40);
      const category = productCategories.find((item) => item.toLowerCase() === categoryName.toLowerCase()) || categoryName || undefined;
      const sku = nextSku(name, taken);
      taken.push(sku);
      created.push({
        id: crypto.randomUUID(),
        name,
        branchId: row.branchId,
        stock: row.stock,
        purchasePrice: roundMoney(row.purchasePrice),
        salePrice: roundMoney(row.salePrice),
        sku,
        ...(category ? { category } : {}),
        reorderPoint: DEFAULT_REORDER_POINT,
        ...currentAuditStamp(),
      });
    });
    if (created.length === 0) {
      showNotification('Nothing new was added.', 'info');
      return false;
    }
    setProducts((prev) => [...prev, ...created]);
    created.forEach((product) => {
      if (product.stock > 0) logStockMovement(product, product.stock, 'opening_stock', 'Added from a photo');
    });
    logActivity('catalog_create', `Added ${created.length} product(s) from a photo.`);
    showNotification(`${created.length} product${created.length === 1 ? '' : 's'} added.`, 'success');
    return true;
  };

  const updatePurchasePricesFromAssistant = (rows: CatalogPriceRow[], supplierName: string) => {
    if (!isShopOwner) return false;
    const updates = rows.filter((row) => products.some((product) => product.id === row.productId) && Number.isFinite(row.purchasePrice) && row.purchasePrice >= 0);
    if (updates.length === 0) {
      showNotification('No purchase prices were changed.', 'info');
      return false;
    }
    const byId = new Map(updates.map((row) => [row.productId, roundMoney(row.purchasePrice)]));
    setProducts((prev) => prev.map((product) => {
      const purchasePrice = byId.get(product.id);
      return purchasePrice === undefined ? product : { ...product, purchasePrice, ...updatedAuditStamp() };
    }));
    rememberSupplier(supplierName);
    logActivity('catalog_cost', `Updated purchase prices for ${updates.length} product(s) from a receipt.`);
    showNotification(`Purchase prices updated for ${updates.length} product${updates.length === 1 ? '' : 's'}.`, 'success');
    return true;
  };

  const saveStockAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    const supplierName = stockAdjustmentForm.supplierName.trim();
    const reference = stockAdjustmentForm.reference.trim();
    if (stockAdjustmentForm.lines) {
      const prepared = stockAdjustmentForm.lines.map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        unitCost: line.unitCost.trim() ? Number(line.unitCost) : undefined,
      })).filter((line) => line.productId);
      if (prepared.length === 0 || prepared.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
        showNotification('Choose a product and enter a quantity greater than zero on each line.', 'error');
        return;
      }
      if (prepared.some((line) => line.unitCost !== undefined && (!Number.isFinite(line.unitCost) || line.unitCost < 0))) {
        showNotification('Enter a valid non-negative unit cost.', 'error');
        return;
      }
      const grouped = new Map<string, { qty: number; unitCost?: number }>();
      prepared.forEach((line) => {
        const current = grouped.get(line.productId) || { qty: 0 };
        grouped.set(line.productId, { qty: current.qty + line.quantity, unitCost: line.unitCost !== undefined ? line.unitCost : current.unitCost });
      });
      if ([...grouped.keys()].some((productId) => !products.some((product) => product.id === productId))) {
        showNotification('One of those products is no longer on the shelf.', 'error');
        return;
      }
      setProducts((prev) => prev.map((item) => {
        const change = grouped.get(item.id);
        if (!change) return item;
        return { ...item, stock: item.stock + change.qty, ...(change.unitCost !== undefined ? { purchasePrice: change.unitCost } : {}), ...updatedAuditStamp() };
      }));
      prepared.forEach((line) => {
        const product = products.find((item) => item.id === line.productId);
        if (!product) return;
        const receiptNote = [supplierName ? `Supplier: ${supplierName}` : '', reference ? `Reference: ${reference}` : '', line.unitCost !== undefined ? `Unit cost: ${formatUGX(line.unitCost)}` : ''].filter(Boolean).join(' · ');
        logStockMovement(product, line.quantity, 'restock', [stockAdjustmentForm.note.trim(), receiptNote].filter(Boolean).join(' | '), undefined, {
          ...(supplierName ? { supplierName } : {}),
          ...(reference ? { reference } : {}),
          ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
        });
      });
      rememberSupplier(supplierName);
      setStatus(`Received ${prepared.length} line${prepared.length === 1 ? '' : 's'}.`);
      showNotification('Stock received.', 'success');
      setShowStockAdjustmentModal(false);
      setStockAdjustmentForm(emptyStockForm());
      return;
    }
    const product = products.find((item) => item.id === stockAdjustmentForm.productId);
    const quantity = Number(stockAdjustmentForm.quantity);
    const unitCostInput = stockAdjustmentForm.unitCost.trim();
    const unitCost = unitCostInput ? Number(unitCostInput) : undefined;
    if (!product || !Number.isFinite(quantity) || quantity <= 0) {
      showNotification('Choose a product and enter a quantity greater than zero.', 'error');
      return;
    }
    if (stockAdjustmentForm.reason === 'restock' && unitCostInput && (!Number.isFinite(unitCost) || (unitCost ?? -1) < 0)) {
      showNotification('Enter a valid non-negative unit cost.', 'error');
      return;
    }
    if (stockAdjustmentForm.reason === 'damaged' && stockAdjustmentForm.direction !== 'remove') {
      showNotification('Damaged or expired stock must be removed from inventory.', 'error');
      return;
    }
    if (stockAdjustmentForm.reason === 'restock' && stockAdjustmentForm.direction !== 'add') {
      showNotification('Restock entries must add stock. Use a count correction to remove stock.', 'error');
      return;
    }
    if (stockAdjustmentForm.reason === 'customer_return' && stockAdjustmentForm.direction !== 'add') {
      showNotification('Customer returns must be added back into inventory.', 'error');
      return;
    }
    const quantityDelta = stockAdjustmentForm.direction === 'add' ? quantity : -quantity;
    if (product.stock + quantityDelta < 0) {
      showNotification(`Only ${product.stock} units are available to remove.`, 'error');
      return;
    }
    const receiptMetadata: Pick<StockMovementAudit, 'supplierName' | 'reference' | 'unitCost'> | undefined = stockAdjustmentForm.reason === 'restock' ? {
      ...(supplierName ? { supplierName } : {}),
      ...(reference ? { reference } : {}),
      ...(unitCost !== undefined ? { unitCost } : {}),
    } : undefined;
    const receiptNote = stockAdjustmentForm.reason === 'restock' ? [
      supplierName ? `Supplier: ${supplierName}` : '',
      reference ? `Reference: ${reference}` : '',
      unitCost !== undefined ? `Unit cost: ${formatUGX(unitCost)}` : '',
    ].filter(Boolean).join(' · ') : '';
    const movementNote = [stockAdjustmentForm.note.trim(), receiptNote].filter(Boolean).join(' | ');
    setProducts((prev) => prev.map((item) => item.id === product.id ? {
      ...item,
      stock: item.stock + quantityDelta,
      ...(stockAdjustmentForm.reason === 'restock' && unitCost !== undefined ? { purchasePrice: unitCost } : {}),
      ...updatedAuditStamp(),
    } : item));
    if (stockAdjustmentForm.reason === 'restock') rememberSupplier(supplierName);
    logStockMovement(product, quantityDelta, stockAdjustmentForm.reason, movementNote, undefined, receiptMetadata);
    setStatus(`Stock adjusted for ${product.name}.`);
    showNotification(`${product.name}: ${quantityDelta > 0 ? '+' : ''}${quantityDelta} units recorded.`, 'success');
    setShowStockAdjustmentModal(false);
    setStockAdjustmentForm(emptyStockForm());
  };

  const filteredSales = useMemo(() => {
    const baseDate = salesDateFilter ? new Date(`${salesDateFilter}T00:00:00`) : new Date();

    const startOfWeek = (date: Date) => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    return sales.filter((sale) => {
      const saleDate = new Date(sale.createdAt);
      if (Number.isNaN(saleDate.getTime())) return false;

      if (salesHistoryViewMode === 'day') {
        return saleDate.toISOString().slice(0, 10) === salesDateFilter;
      }

      if (salesHistoryViewMode === 'week') {
        const start = startOfWeek(baseDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return saleDate >= start && saleDate < end;
      }

      if (salesHistoryViewMode === 'month') {
        return saleDate.getFullYear() === baseDate.getFullYear() && saleDate.getMonth() === baseDate.getMonth();
      }

      if (!salesRangeStart || !salesRangeEnd) return true;
      const rangeStart = new Date(`${salesRangeStart}T00:00:00`);
      const rangeEnd = new Date(`${salesRangeEnd}T23:59:59`);
      return saleDate >= rangeStart && saleDate <= rangeEnd;
    });
  }, [sales, salesDateFilter, salesHistoryViewMode, salesRangeEnd, salesRangeStart]);

  const salesHistoryPageSize = 8;
  const sharedTablePageSize = 10;
  const shelfPageSize = 4;
  const groupedSales = useMemo(() => {
    const groups = new Map<string, Sale[]>();
    filteredSales.forEach((sale) => {
      const key = transactionKey(sale);
      groups.set(key, [...(groups.get(key) || []), sale]);
    });
    return Array.from(groups.entries()).map(([id, lines]) => ({
      id,
      lines: [...lines].sort((a, b) => a.itemName.localeCompare(b.itemName)),
      createdAt: lines.reduce((latest, line) => line.createdAt > latest ? line.createdAt : latest, lines[0].createdAt),
      total: lines.reduce((sum, line) => sum + line.amount, 0),
      profit: lines.reduce((sum, line) => sum + line.amount - (line.taxAmount || 0) - line.cost, 0),
      receiptNumber: lines.find((line) => line.receiptNumber)?.receiptNumber,
      customerName: lines.find((line) => line.customerName)?.customerName,
      paymentMethod: lines[0].paymentMethod,
      saleKind: lines.some((line) => line.saleKind === 'return') ? 'return' as const : 'sale' as const,
    })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [filteredSales]);
  const salesHistoryTotalPages = Math.max(1, Math.ceil(groupedSales.length / salesHistoryPageSize));
  const paginatedSales = useMemo(() => {
    const safePage = Math.min(salesHistoryPage, salesHistoryTotalPages);
    const start = (safePage - 1) * salesHistoryPageSize;
    return groupedSales.slice(start, start + salesHistoryPageSize);
  }, [groupedSales, salesHistoryPage, salesHistoryTotalPages]);

  useEffect(() => {
    setSalesHistoryPage(1);
  }, [salesHistoryViewMode, salesDateFilter, salesRangeStart, salesRangeEnd]);

  useEffect(() => {
    if (salesHistoryPage > salesHistoryTotalPages) {
      setSalesHistoryPage(salesHistoryTotalPages);
    }
  }, [salesHistoryPage, salesHistoryTotalPages]);

  const paginateData = <T,>(items: T[], page: number, setPage: Dispatch<SetStateAction<number>>, pageSize: number = sharedTablePageSize) => {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const safePage = Math.min(page, totalPages);
    if (page > totalPages) setPage(totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      totalPages,
      pageSize,
      safePage,
      start,
      end: Math.min(start + pageSize, items.length),
      rows: items.slice(start, start + pageSize),
    };
  };

  const filteredExpenses = useMemo(() => {
    if (expensesViewMode === 'all') return expenses;
    return expenses.filter((expense) => {
      const expenseDate = new Date(expense.createdAt);
      const selectedDay = new Date(`${expensesDayFilter}T00:00:00`);
      return expenseDate.toDateString() === selectedDay.toDateString();
    });
  }, [expenses, expensesDayFilter, expensesViewMode]);

  useEffect(() => {
    setExpensesPage(1);
  }, [expensesViewMode, expensesDayFilter]);

  useEffect(() => {
    setProductsPage(1);
  }, [productSearchQuery, productBranchFilter, productStockFilter]);

  const productsPagination = paginateData(filteredProducts, productsPage, setProductsPage, shelfPageSize);
  const servicesPagination = paginateData(services, servicesPage, setServicesPage);
  const expensesPagination = paginateData(filteredExpenses, expensesPage, setExpensesPage);
  const usersPagination = paginateData(users, usersPage, setUsersPage);
  const activityLogsPagination = paginateData(activityLogs, activityLogsPage, setActivityLogsPage);

  const PaginationControls = ({ totalItems, totalPages, page, start, end, onPrevious, onNext, className = '' }: { totalItems: number; totalPages: number; page: number; start: number; end: number; onPrevious: () => void; onNext: () => void; className?: string }) => (
    <div className={`pager ${className}`.trim()}>
      <span>Showing {totalItems === 0 ? 0 : start + 1}–{end} of {totalItems}</span>
      <div className="pager-actions">
        <button className="edit-btn" disabled={page <= 1} onClick={onPrevious}>Previous</button>
        <span>Page {page} / {totalPages}</span>
        <button className="edit-btn" disabled={page >= totalPages} onClick={onNext}>Next</button>
      </div>
    </div>
  );

  const canManageUsers = (role === 'shop_owner' || role === 'admin') && activeShopOwnerUid === authUser?.uid;
  const canManageSalesAndExpenses = role === 'shop_owner' || role === 'admin' || role === 'manager';

  const deleteTransaction = (ids: string[]) => {
    if (!canManageSalesAndExpenses) {
      setStatus('Only the shop owner or admin can delete sales.');
      return;
    }
    const lines = sales.filter((sale) => ids.includes(sale.id));
    if (lines.length === 0) return;
    if (!window.confirm('Delete this receipt? Stock from its product lines will be reversed.')) return;
    const deltas = new Map<string, number>();
    const missing: string[] = [];
    lines.forEach((line) => {
      if (line.type !== 'product') return;
      const product = products.find((item) => item.branchId === line.branchId && item.name === line.itemName);
      if (!product) {
        if (!missing.includes(line.itemName)) missing.push(line.itemName);
        return;
      }
      deltas.set(product.id, (deltas.get(product.id) || 0) + line.qty);
    });
    const short = [...deltas.entries()].find(([productId, delta]) => {
      const product = products.find((item) => item.id === productId);
      return Boolean(product && product.stock + delta < 0);
    });
    if (short) {
      showNotification('Not enough stock to reverse a return on this receipt.', 'error');
      return;
    }
    setProducts((prev) => prev.map((product) => {
      const delta = deltas.get(product.id);
      return delta ? { ...product, stock: product.stock + delta, ...updatedAuditStamp() } : product;
    }));
    deltas.forEach((delta, productId) => {
      const product = products.find((item) => item.id === productId);
      if (product && delta !== 0) logStockMovement(product, delta, 'count_correction', 'Receipt deleted');
    });
    setSales((prev) => prev.filter((sale) => !ids.includes(sale.id)));
    const missingNote = missing.length > 0 ? ` Could not find ${missing.join(', ')}.` : '';
    logActivity('delete_sale', `Deleted a receipt and reversed its stock.${missingNote}`);
    showNotification(
      missing.length > 0 ? `Receipt deleted. Stock was put back, except ${missing.join(', ')}.` : 'Receipt deleted. Stock was put back.',
      missing.length > 0 ? 'info' : 'success',
      missing.length > 0 ? 5000 : 3000,
    );
  };

  const editExpense = (expense: Expense) => {
    if (!canManageSalesAndExpenses) {
      setStatus('Only the shop owner or admin can edit expenses.');
      return;
    }
    setExpenseForm({ id: expense.id, title: expense.title, branchId: expense.branchId, amount: expense.amount, expenseGroupId: expense.expenseGroupId || '', accountId: expense.accountId || defaultAccount?.id || '' });
    setShowExpenseModal(true);
  };

  const deleteExpense = (id: string) => {
    if (!canManageSalesAndExpenses) {
      setStatus('Only the shop owner or admin can delete expenses.');
      return;
    }
    setExpenses((prev) => prev.filter((expense) => expense.id !== id));
    logActivity('delete_expense', `Deleted expense id "${id}"`);
    showNotification('Expense deleted successfully!', 'success');
  };
  const canChangeRole = activeShopOwnerUid === authUser?.uid;

  const saveShopName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopNameForm.trim() || !activeShopOwnerUid) {
      setStatus('Please enter a valid shop name.');
      return;
    }
    if (!db || authUser?.uid === LOCAL_OPERATOR_ID) {
      setAvailableShops((prev) => prev.map((shop) => shop.ownerUid === activeShopOwnerUid ? { ...shop, shopName: shopNameForm.trim() } : shop));
      setShowSettingsModal(false);
      showNotification(`Shop name updated to "${shopNameForm.trim()}"!`, 'success');
      return;
    }

    try {
      // Update the shop name in the user's data document
      const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');
      await setDoc(userDataRef, { shopName: shopNameForm.trim(), updatedAt: serverTimestamp() }, { merge: true });

      // Update all shop memberships for this shop
      const membershipsQuery = query(collection(db, 'shopMemberships'), where('ownerUid', '==', activeShopOwnerUid));
      const membershipSnap = await getDocs(membershipsQuery);
      const updatePromises = membershipSnap.docs.map((doc) =>
        setDoc(doc.ref, { shopName: shopNameForm.trim(), updatedAt: serverTimestamp() }, { merge: true })
      );
      await Promise.all(updatePromises);

      // Update the local state
      setAvailableShops((prev) =>
        prev.map((s) => (s.ownerUid === activeShopOwnerUid ? { ...s, shopName: shopNameForm.trim() } : s))
      );

      showNotification(`Shop name updated to "${shopNameForm.trim()}"!`, 'success');
      setShowSettingsModal(false);
      setShopNameForm('');
    } catch (error) {
      showNotification(`Failed to update shop name: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  const saveBranch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchForm.name || !branchForm.location) return;
    if (branchForm.id) {
      setBranches((prev) => prev.map((b) => (b.id === branchForm.id ? { ...b, name: branchForm.name, location: branchForm.location } : b)));
      showNotification('Branch updated successfully!', 'success');
      logActivity('edit_branch', `Updated branch "${branchForm.name}"`);
    } else {
      setBranches((prev) => [...prev, { id: crypto.randomUUID(), name: branchForm.name, location: branchForm.location, createdAt: new Date().toISOString() }]);
      showNotification('Branch added successfully!', 'success');
      logActivity('add_branch', `Added branch "${branchForm.name}"`);
    }
    setBranchForm({ name: '', location: '', id: '' });
    setShowBranchFormModal(false);
  };

  const deleteBranch = (id: string) => {
    if (branches.length === 1) {
      showNotification('You must have at least one branch!', 'error');
      return;
    }
    setBranches((prev) => prev.filter((b) => b.id !== id));
    logActivity('delete_branch', `Deleted branch id "${id}"`);
    showNotification('Branch deleted successfully!', 'success');
  };

  const buildShopBackupPayload = (): ShopBackupPayload => ({
    app: 'AlphaPOS',
    version: 2,
    exportedAt: new Date().toISOString(),
    shopName: currentShop?.shopName || 'My Shop',
    sourceOwnerUid: activeShopOwnerUid,
    data: {
      branches,
      products,
      services,
      sales,
      expenses,
      expenseGroups,
      users,
      activityLogs,
      shopTimeSettings,
      accounts,
      customers,
      suppliers,
      customerPayments,
      heldTickets,
      cashSessions,
      taxSettings,
      receiptSettings,
      salesEmailSettings,
    },
  });

  const downloadShopBackup = () => {
    if (!activeShopOwnerUid) {
      showNotification('Open a shop before creating a backup.', 'error');
      return;
    }

    const backup = buildShopBackupPayload();
    const blob = new Blob([JSON.stringify(removeUndefinedDeep(backup), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeShopName = backup.shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'shop';
    link.href = url;
    link.download = `alphapos-${safeShopName}-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    logActivity('backup_export', `Downloaded full shop backup for "${backup.shopName}"`);
    showNotification('Shop backup downloaded. Keep this file somewhere safe.', 'success');
    setStatus('Full shop backup exported successfully.');
  };

  const restoreShopBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!authUser || !db || !activeShopOwnerUid) {
      showNotification('Please sign in and open the shop you want to restore into.', 'error');
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as Partial<ShopBackupPayload>;
      if (parsed.app !== 'AlphaPOS' || (parsed.version !== 1 && parsed.version !== 2) || !parsed.data) {
        throw new Error('This is not a valid AlphaPOS backup file.');
      }

      const restoredBranches = Array.isArray(parsed.data.branches) ? parsed.data.branches : [];
      const restoredSplit = splitProductImages(Array.isArray(parsed.data.products) ? parsed.data.products as Product[] : []);
      const restoredProducts = attachProductImages(restoredSplit.products, restoredSplit.images);
      const restoredServices = Array.isArray(parsed.data.services) ? parsed.data.services : [];
      const restoredSales = Array.isArray(parsed.data.sales) ? parsed.data.sales : [];
      const restoredExpenses = Array.isArray(parsed.data.expenses) ? parsed.data.expenses : [];
      const restoredExpenseGroups = Array.isArray(parsed.data.expenseGroups) ? parsed.data.expenseGroups : [];
      const restoredUsers = Array.isArray(parsed.data.users) ? parsed.data.users : [];
      const restoredActivityLogs = Array.isArray(parsed.data.activityLogs) ? parsed.data.activityLogs as ActivityLog[] : [];
      const restoredSuppliers = normalizeSuppliers(parsed.data.suppliers);
      const restoredCustomerPayments = normalizeCustomerPayments(parsed.data.customerPayments);
      const restoredShopTimeSettings = parsed.data.shopTimeSettings && typeof parsed.data.shopTimeSettings.dayStartTime === 'string'
        ? parsed.data.shopTimeSettings
        : { timezoneOffsetMinutes: 0, dayStartTime: '00:00' };
      const restoredAccounts = ensureDefaultCashAccount(Array.isArray(parsed.data.accounts) ? parsed.data.accounts : []);
      const restoredCustomers = normalizeCustomers(parsed.data.customers);
      const restoredHeldTickets = normalizeHeldTickets(parsed.data.heldTickets);
      const restoredCashSessions = normalizeCashSessions(parsed.data.cashSessions);
      const restoredTaxSettings = normalizeTaxSettings(parsed.data.taxSettings);
      const restoredReceiptSettings = normalizeReceiptSettings(parsed.data.receiptSettings);
      const restoredSalesEmailSettings = normalizeSalesEmailSettings(parsed.data.salesEmailSettings);
      const restoredShopName = parsed.shopName?.trim() || currentShop?.shopName || 'Restored Shop';

      const restoredLog: ActivityLog = {
        id: crypto.randomUUID(),
        action: 'backup_restore',
        details: `Restored full shop backup from ${file.name}`,
        role,
        userEmail: authUser.email || 'Unknown user',
        createdAt: new Date().toISOString(),
      };
      const nextActivityLogs = trimActivity([restoredLog, ...restoredActivityLogs]);
      const nextRevision = (shopRevisionRef.current || 0) + 1;
      const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');

      await setDoc(userDataRef, {
        ...removeUndefinedDeep({
          role: 'shop_owner' as Role,
          shopName: restoredShopName,
          branches: restoredBranches,
          products: restoredSplit.products,
          services: restoredServices,
          sales: restoredSales,
          expenses: restoredExpenses,
          expenseGroups: restoredExpenseGroups,
          users: restoredUsers,
          activityLogs: [] as ActivityLog[],
          shopTimeSettings: restoredShopTimeSettings,
          accounts: restoredAccounts,
          customers: restoredCustomers,
          suppliers: restoredSuppliers,
          customerPayments: restoredCustomerPayments,
          revision: nextRevision,
          heldTickets: restoredHeldTickets,
          cashSessions: restoredCashSessions,
          taxSettings: restoredTaxSettings,
          receiptSettings: restoredReceiptSettings,
          salesEmailSettings: restoredSalesEmailSettings,
        }),
        restoredFromBackupAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await setDoc(doc(db, 'users', activeShopOwnerUid, 'pos', 'activity'), {
        activityLogs: removeUndefinedDeep(nextActivityLogs),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'users', activeShopOwnerUid, 'pos', 'images'), {
        images: restoredSplit.images,
        updatedAt: serverTimestamp(),
      });
      shopRevisionRef.current = nextRevision;

      await Promise.all(restoredUsers.map((staffUser) => {
        const normalizedEmail = staffUser.email?.toLowerCase().trim();
        if (!normalizedEmail) return Promise.resolve();
        const shopMembershipRef = doc(db, 'shopMemberships', `${activeShopOwnerUid}_${normalizedEmail}`);
        return setDoc(shopMembershipRef, {
          ownerUid: activeShopOwnerUid,
          email: normalizedEmail,
          shopName: restoredShopName,
          role: staffUser.role,
          restoredAt: serverTimestamp(),
        }, { merge: true });
      }));

      setBranches(restoredBranches);
      setProducts(restoredProducts);
      setServices(restoredServices);
      setSales(restoredSales);
      setExpenses(restoredExpenses);
      setExpenseGroups(restoredExpenseGroups);
      setUsers(restoredUsers);
      setActivityLogs(nextActivityLogs);
      setShopTimeSettings(restoredShopTimeSettings);
      setAccounts(restoredAccounts);
      setCustomers(restoredCustomers);
      setSuppliers(restoredSuppliers);
      setCustomerPayments(restoredCustomerPayments);
      setHeldTickets(restoredHeldTickets);
      setCashSessions(restoredCashSessions);
      setTaxSettings(restoredTaxSettings);
      setReceiptSettings(restoredReceiptSettings);
      setSalesEmailSettings(restoredSalesEmailSettings);
      setRole('shop_owner');
      setAvailableShops((prev) => prev.map((shop) => shop.ownerUid === activeShopOwnerUid ? { ...shop, shopName: restoredShopName, role: 'shop_owner' } : shop));
      showNotification('Backup restored successfully. Your POS data has been reuploaded.', 'success');
      setStatus(`Restored ${restoredProducts.length} products, ${restoredSales.length} sales, and ${restoredExpenses.length} expenses from backup.`);
    } catch (error) {
      showNotification(`Backup restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error', 6000);
      setStatus('Backup restore failed. Please check the file and try again.');
    }
  };

  const Badge = ({ value }: { value: number }) => (
    value === 0 ? null : (
      <span className={`badge ${value >= 0 ? 'badge-success' : 'badge-danger'}`}>
        {value >= 0 ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
      </span>
    )
  );


  if (loading || !authUser) {
    return (
      <div className="auth-container">
        <div className="auth-glow auth-glow-a" aria-hidden="true" />
        <div className="auth-glow auth-glow-b" aria-hidden="true" />
        <div className="auth-glow auth-glow-c" aria-hidden="true" />
        {loading ? (
          <p className="auth-loading">Opening AlphaPOS</p>
        ) : (
          <div className="auth-layout">
            <div className="auth-copy">
              <p className="auth-kicker">AlphaPOS</p>
              <h1>The counter, ready when the shop opens.</h1>
              <p>Sell, take payment, and keep the books in one place.</p>
            </div>
            <section className="auth-card" aria-label="Sign in">
              <span className="brand-mark" aria-hidden="true">A</span>
              <h2>Sign in</h2>
              <p className="auth-lede">{firebaseApp ? 'Use the Google account for this shop.' : 'This browser keeps the shop on this device.'}</p>
              {signInNotice && <p className="auth-local-note">{signInNotice}</p>}
              {invitedEmail && <p className="auth-local-note">This invite is for {invitedEmail}. Sign in with Google using that address.</p>}
              {firebaseApp ? (
                <>
                  <button className="auth-action" type="button" onClick={handleLogin}>Sign in with Google</button>
                  <p className="auth-fine">Staff open the link in their invite, or sign in with the same email.</p>
                </>
              ) : (
                <button className="auth-action" type="button" onClick={startLocalCounter}>Open the counter</button>
              )}
            </section>
          </div>
        )}
      </div>
    );
  }

  if (authUser && authUser.uid !== LOCAL_OPERATOR_ID && !shopsResolved) {
    return (
      <div className="auth-container">
        <div className="auth-glow auth-glow-a" aria-hidden="true" />
        <div className="auth-glow auth-glow-b" aria-hidden="true" />
        <div className="auth-glow auth-glow-c" aria-hidden="true" />
        <p className="auth-loading">Opening AlphaPOS</p>
      </div>
    );
  }

  if (awaitingShopChoice) {
    return (
      <div className="auth-container">
        <div className="auth-glow auth-glow-a" aria-hidden="true" />
        <div className="auth-glow auth-glow-b" aria-hidden="true" />
        <div className="auth-glow auth-glow-c" aria-hidden="true" />
        <div className="auth-layout">
          <div className="auth-copy">
            <p className="auth-kicker">AlphaPOS</p>
            <h1>Which shop are you opening?</h1>
            <p>Sales, stock, and expenses stay in the shop you choose. You can change it later from your profile or from Settings.</p>
          </div>
          <section className="auth-card" aria-label="Choose a shop">
            <span className="brand-mark" aria-hidden="true">A</span>
            <h2>Your shops</h2>
            <p className="auth-lede">Open one shop. The next sale is recorded there.</p>
            <div className="shop-choice-list">
              {availableShops.map((shop) => (
                <button key={shop.ownerUid} type="button" className="shop-choice" onClick={() => openChosenShop(shop.ownerUid)}>
                  <strong>{shop.shopName}</strong>
                  <span>{roleLabels[shop.role]}</span>
                </button>
              ))}
            </div>
            <button type="button" className="shop-choice-leave" onClick={handleLogout}>Sign out</button>
          </section>
        </div>
      </div>
    );
  }

  const targetShop = availableShops.find((shop) => shop.ownerUid === shopSwitchTarget);
  const shopSwitchPanel = availableShops.length > 1 ? (
    <div className="shop-switch">
      <h3>Open a different shop</h3>
      <p className="muted-copy">You are in {currentShop?.shopName || 'this shop'} as {roleLabels[role]}. Choosing another shop is a separate step, so a sale is not recorded in the wrong place.</p>
      <div className="shop-switch-list">
        {availableShops.map((shop) => {
          const open = shop.ownerUid === activeShopOwnerUid;
          return (
            <div key={shop.ownerUid} className={`shop-switch-row${open ? ' is-open' : ''}`}>
              <div>
                <strong>{shop.shopName}</strong>
                <span>{roleLabels[shop.role]}</span>
              </div>
              {open ? <em>Open now</em> : (
                <button type="button" className="edit-btn" onClick={() => setShopSwitchTarget(shop.ownerUid)}>Switch</button>
              )}
            </div>
          );
        })}
      </div>
      {targetShop && (
        <div className="shop-confirm">
          <p>Leave {currentShop?.shopName || 'this shop'} and open {targetShop.shopName}?{cart.length > 0 ? ' The items on this register will be cleared.' : ''}</p>
          <div className="shop-confirm-actions">
            <button type="button" className="edit-btn" onClick={() => setShopSwitchTarget('')}>Stay here</button>
            <button type="button" className="primary" onClick={() => openChosenShop(targetShop.ownerUid)}>Open {targetShop.shopName}</button>
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="app">
      <div className={`sidebar-overlay ${isSidebarOpen ? 'show' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2><span className="brand-mark" aria-hidden="true">A</span> AlphaPOS</h2>
          <p className="rail-shop">
            <strong>{currentShop?.shopName || 'My Shop'}</strong>
            <span>{roleLabels[role]}</span>
          </p>
          {availableShops.length > 1 && (
            <button type="button" className="rail-change" onClick={() => { setView('profile'); setIsSidebarOpen(false); }}>Change shop</button>
          )}
        </div>

        <button type="button" className={`sell-launch${view === 'sales' ? ' active' : ''}`} onClick={() => { setView('sales'); setIsSidebarOpen(false); }}>
          <span>Register</span>
          <small>{openCashSession ? 'Drawer open' : 'Open a sale'}</small>
        </button>

        <nav className="sidebar-nav" aria-label="Shop">
          <div className="nav-group">
            <div className="nav-group-label">Today</div>
            <button className={`nav-button ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }}>Today</button>
            {role !== 'stock' && <button className={`nav-button ${view === 'sales_history' ? 'active' : ''}`} onClick={() => { setView('sales_history'); setIsSidebarOpen(false); }}>Sales</button>}
            {role !== 'stock' && <button className={`nav-button ${view === 'customers' ? 'active' : ''}`} onClick={() => { setView('customers'); setIsSidebarOpen(false); }}>Customers</button>}
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Items</div>
            <button className={`nav-button ${view === 'products' ? 'active' : ''}`} onClick={() => { setView('products'); setIsSidebarOpen(false); }}>Products</button>
            <button className={`nav-button ${view === 'services' ? 'active' : ''}`} onClick={() => { setView('services'); setIsSidebarOpen(false); }}>Services</button>
          </div>

          {seesBooks && (
            <div className="nav-group">
              <div className="nav-group-label">Money</div>
              <button className={`nav-button ${view === 'expenses' ? 'active' : ''}`} onClick={() => { setView('expenses'); setIsSidebarOpen(false); }}>Expenses</button>
              <button className={`nav-button ${view === 'reports' ? 'active' : ''}`} onClick={() => { setView('reports'); setIsSidebarOpen(false); }}>Reports</button>
              <button className={`nav-button ${view === 'accounts' ? 'active' : ''}`} onClick={() => { setView('accounts'); setIsSidebarOpen(false); }}>Balances</button>
            </div>
          )}

          {(seesBooks || isShopOwner) && (
            <div className="nav-group">
              <div className="nav-group-label">Shop</div>
              {seesBooks && <button className={`nav-button ${view === 'users' ? 'active' : ''}`} onClick={() => { setView('users'); setIsSidebarOpen(false); }}>Staff</button>}
              {seesBooks && <button className={`nav-button ${view === 'activity_logs' ? 'active' : ''}`} onClick={() => { setView('activity_logs'); setIsSidebarOpen(false); }}>Activity</button>}
              {isShopOwner && <button className={`nav-button ${view === 'assistant' ? 'active' : ''}`} onClick={() => { setView('assistant'); setIsSidebarOpen(false); }}>Assistant</button>}
              {isShopOwner && <button className={`nav-button ${view === 'settings' ? 'active' : ''}`} onClick={() => { setView('settings'); setIsSidebarOpen(false); }}>Settings</button>}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="user-chip" onClick={() => setView('profile')}>
            <span className="user-avatar" aria-hidden="true">{(authUser.displayName || authUser.email || 'U').trim().charAt(0).toUpperCase()}</span>
            <span className="user-chip-text">
              <strong>{authUser.email === 'counter@this-device' ? 'This counter' : authUser.displayName}</strong>
              <small>{authUser.email === 'counter@this-device' ? 'Saved in this browser' : authUser.email}</small>
            </span>
          </button>
          <button className="logout-button" onClick={handleLogout}>Sign Out</button>
        </div>

        {notification && (
          <div className={`notification-toast ${notification.type}`}>
            <div className="notification-content">
              <span className={`notification-icon ${notification.type}`} aria-hidden="true" />
              <span className="notification-message">{notification.message}</span>
            </div>
            <button className="notification-close" onClick={() => setNotification(null)}>✕</button>
          </div>
        )}
      </aside>

      <main className={`main${view === 'sales' ? ' main-register' : ''}`}>
        <header className="main-header">
          <div className="header-title">
            <button className="mobile-menu-toggle" onClick={() => setIsSidebarOpen(true)} aria-label="Open menu">Menu</button>
            <div>
              <h1>
                {view === 'dashboard' ? 'Today' :
                 view === 'sales' ? 'Register' :
                 view === 'sales_history' ? 'Sales' :
                 view === 'customers' ? 'Customers' :
                 view === 'products' ? 'Products' :
                 view === 'services' ? 'Services' :
                 view === 'expenses' ? 'Expenses' :
                 view === 'users' ? 'Staff' :
                 view === 'activity_logs' ? 'Activity' :
                 view === 'reports' ? 'Reports' :
                 view === 'accounts' ? 'Balances' :
                 view === 'settings' ? 'Settings' :
                 view === 'assistant' ? 'Assistant' :
                 'Profile'}
              </h1>
              <p className="header-kicker"><strong>{currentShop?.shopName || 'My Shop'}</strong> · {roleLabels[role]}</p>
            </div>
          </div>
          {status && /fail|error|could not/i.test(status) && (
            <div className="status-container">
              <span className="status">{status}</span>
            </div>
          )}
        </header>

        {view === 'dashboard' && (
          <section className="today-board">
            {(() => {
              const hour = new Date().getHours();
              const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
              const named = authUser.displayName && authUser.displayName !== 'Counter' && authUser.email !== 'counter@this-device' ? authUser.displayName.split(' ')[0] : '';
              const periodNoun = dashboardPeriod === 'daily' ? 'today' : dashboardPeriod === 'weekly' ? 'this week' : dashboardPeriod === 'monthly' ? 'this month' : 'this year';
              const lowStock = products.filter((product) => stockIsLow(product)).sort((a, b) => a.stock - b.stock).slice(0, 3);
              return (
                <>
                  <div className="studio-top">
                    <h2>{named ? `${greeting}, ${named}` : greeting}</h2>
                    <div className="studio-controls">
                      <select aria-label="Period" value={dashboardPeriod} onChange={(e) => setDashboardPeriod(e.target.value as DashboardPeriod)}>
                        <option value="daily">Today</option>
                        <option value="weekly">This week</option>
                        <option value="monthly">This month</option>
                        <option value="yearly">This year</option>
                      </select>
                      <button className="primary" onClick={() => setView('sales')}>Register</button>
                    </div>
                  </div>
                  <div className="today-numbers">
                    <article className="stat-card">
                      <p>Sales {periodNoun}</p>
                      <strong>{formatUGX(dashboardMetrics.sales.value)}</strong>
                      <span className="stat-note">{dashboardMetrics.receipts} receipt{dashboardMetrics.receipts === 1 ? '' : 's'}</span>
                    </article>
                    <article className="stat-card">
                      <p>Left after costs</p>
                      <strong className={dashboardMetrics.netProfit.value >= 0 ? 'is-positive' : 'is-negative'}>{formatUGX(dashboardMetrics.netProfit.value)}</strong>
                      <span className="stat-note">After tax, cost, and expenses</span>
                    </article>
                  </div>
                  <div className="today-actions">
                    <article className="card">
                      <h3>{openCashSession ? 'Drawer open' : 'Drawer closed'}</h3>
                      <strong className="today-figure">{openCashSession ? formatUGX(sessionExpectedCash) : '—'}</strong>
                      <p className="muted-copy">{openCashSession ? 'Expected in the till.' : 'Open the drawer on the register before taking cash.'}</p>
                    </article>
                    <article className="card">
                      <div className="insight-header-row">
                        <h3>Low stock</h3>
                        <button type="button" className="edit-btn" onClick={() => { setProductPane('shelf'); setProductStockFilter('low'); setView('products'); }}>Products</button>
                      </div>
                      {lowStock.length > 0 ? (
                        <ul className="attention-list">
                          {lowStock.map((product) => (
                            <li key={product.id}>
                              <span>{product.name}</span>
                              <b className={product.stock === 0 ? 'is-negative' : ''}>{product.stock === 0 ? 'Out' : `${product.stock} left`}</b>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="muted-copy">Nothing is running low.</p>}
                    </article>
                    {recentClosedShifts.length > 0 && (
                      <article className="card today-shifts">
                        <h3>Closed shifts</h3>
                        <ul className="shift-list">
                          {recentClosedShifts.map((session) => (
                            <li key={session.id}>
                              <strong>{session.closedAt ? new Date(session.closedAt).toLocaleString() : 'Closed shift'}</strong>
                              <span>Expected {formatUGX(session.expectedCash || 0)} · Counted {formatUGX(session.countedCash || 0)} · Variance {formatUGX(session.variance || 0)}</span>
                            </li>
                          ))}
                        </ul>
                      </article>
                    )}
                  </div>
                  {seesBooks && <button type="button" className="edit-btn today-more" onClick={() => setView('reports')}>Open reports</button>}
                </>
              );
            })()}
          </section>
        )}

        {view === 'assistant' && isShopOwner && (
          <CatalogAssistant
            products={products}
            branches={branches}
            onCreate={addProductsFromAssistant}
            onUpdatePrices={updatePurchasePricesFromAssistant}
            requestReading={readCatalogPhoto}
          />
        )}

        {view === 'products' && (
          <section className={productPane === 'shelf' ? 'shelf-page' : undefined}>
            <div className="page-tools">
              <div className="pane-switch" role="tablist" aria-label="Products">
                <button type="button" className={productPane === 'shelf' ? 'active' : ''} onClick={() => setProductPane('shelf')}>Shelf</button>
                <button type="button" className={productPane === 'movements' ? 'active' : ''} onClick={() => setProductPane('movements')}>Movements</button>
              </div>
              {productPane === 'shelf' && (
                <div className="page-tools-actions">
                  <button className="edit-btn" disabled={products.length === 0} onClick={() => {
                    setStockAdjustmentForm({ ...emptyStockForm(), lines: [{ productId: '', quantity: '', unitCost: '' }] });
                    setShowStockAdjustmentModal(true);
                  }}>Receive stock</button>
                  <button className="primary" onClick={() => openProductForm(blankProductForm(branches[0]?.id || ''))}>
                    Add product
                  </button>
                </div>
              )}
            </div>

            {productPane === 'shelf' && (
            <>
            <div className="filter-bar inventory-filter-bar">
              <div className="filter-group">
                <label>Search</label>
                <input
                  type="text"
                  placeholder="Name, SKU, or barcode"
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                />
              </div>
              {branches.length > 1 && (
                <div className="filter-group">
                  <label>Branch</label>
                  <select value={productBranchFilter} onChange={(e) => setProductBranchFilter(e.target.value)}>
                    <option value="">All branches</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="pane-switch" role="tablist" aria-label="Stock">
                <button type="button" className={productStockFilter === 'all' ? 'active' : ''} onClick={() => setProductStockFilter('all')}>All</button>
                <button type="button" className={productStockFilter === 'low' ? 'active' : ''} onClick={() => setProductStockFilter('low')}>Low</button>
                <button type="button" className={productStockFilter === 'out' ? 'active' : ''} onClick={() => setProductStockFilter('out')}>Out</button>
              </div>
            </div>

            {filteredProducts.length > 0 ? (
              <div className="shelf-grid">
                {productsPagination.rows.map((p) => {
                  return (
                  <article key={p.id} className={`shelf-card${p.stock === 0 ? ' is-out' : ''}`}>
                    <div className="shelf-photo" aria-hidden="true">
                      {p.image ? <img src={p.image} alt="" /> : <span>{p.name.slice(0, 1).toUpperCase()}</span>}
                      {p.stock === 0 && <em className="shelf-flag">Out</em>}
                      {stockIsLow(p) && <em className="shelf-flag is-low">Low</em>}
                    </div>
                    <div className="shelf-body">
                      <h3>{p.name}</h3>
                      {p.category && <p className="shelf-meta">{p.category}</p>}
                      <div className="shelf-prices">
                        <strong>{formatUGX(p.salePrice)}</strong>
                        <span>{p.stock === 0 ? 'Out' : p.stock}</span>
                      </div>
                      {seesCost && p.purchasePrice > 0 && <p className="shelf-cost">Cost {formatUGX(p.purchasePrice)}</p>}
                    </div>
                    <div className="shelf-actions">
                      <button className="edit-btn" onClick={() => openProductForm({ ...blankProductForm(p.branchId), ...p, sku: p.sku || '', barcode: p.barcode || '', category: p.category || '', image: p.image || '', reorderPoint: p.reorderPoint ?? DEFAULT_REORDER_POINT })}>Edit</button>
                      <button className="edit-btn" onClick={() => restockProduct(p.id)}>Stock</button>
                      <button className="delete-btn" onClick={() => {
                        if (p.stock > 0) logStockMovement(p, -p.stock, 'product_removed', 'Product removed from inventory');
                        setProducts(prev => prev.filter(x => x.id !== p.id));
                        logActivity('delete_inventory', `Deleted product "${p.name}"`);
                      }}>Delete</button>
                    </div>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="shelf-empty">
                <h3>{products.length === 0 ? 'No products yet' : 'Nothing matches'}</h3>
                <p>{products.length === 0 ? 'Add a product, with a photo if you have one, then sell it from the register.' : 'Try another name, SKU, or stock filter.'}</p>
              </div>
            )}
            <PaginationControls
              className="shelf-pager"
              totalItems={filteredProducts.length}
              totalPages={productsPagination.totalPages}
              page={productsPagination.safePage}
              start={productsPagination.start}
              end={productsPagination.end}
              onPrevious={() => setProductsPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setProductsPage((prev) => Math.min(productsPagination.totalPages, prev + 1))}
            />
            </>
            )}
            {productPane === 'movements' && (
            <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Branch</th>
                      <th>Reason</th>
                      <th>Units</th>
                      <th>Recorded by</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentStockMovements.length > 0 ? recentStockMovements.map((log) => {
                      const movement = log.stockMovement;
                      const reasonLabels: Record<StockMovementReason, string> = {
                        sale: 'Sale',
                        opening_stock: 'Opening stock',
                        restock: 'Restock',
                        count_correction: 'Count correction',
                        damaged: 'Damaged / expired',
                        customer_return: 'Customer return',
                        branch_transfer: 'Branch transfer',
                        product_removed: 'Product removed',
                      };
                      const branchLabel = movement.reason === 'branch_transfer'
                        ? `${branchMap[movement.fromBranchId || ''] || 'Branch'} → ${branchMap[movement.toBranchId || ''] || 'Branch'}`
                        : branchMap[movement.branchId] || '—';
                      return (
                        <tr key={log.id}>
                          <td>{new Date(log.createdAt).toLocaleString()}</td>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>{movement.productName}</td>
                          <td>{branchLabel}</td>
                          <td>{reasonLabels[movement.reason]}</td>
                          <td style={{ color: movement.quantityDelta >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                            {movement.reason === 'branch_transfer' ? 'Moved' : `${movement.quantityDelta > 0 ? '+' : ''}${movement.quantityDelta}`}
                          </td>
                          <td>{log.userEmail}</td>
                          <td>{movement.note || '—'}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                          No stock activity recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
            </div>
            )}
          </section>
        )}

        {view === 'sales' && (
          <RegisterDesk
            products={products}
            services={services}
            cart={cart}
            customers={customers}
            heldTickets={heldTickets.map((ticket) => ({
              id: ticket.id,
              label: ticket.label,
              createdAt: ticket.createdAt,
              itemCount: ticket.cart.reduce((sum, item) => sum + item.qty, 0),
              totalLabel: formatUGX(settleCart(ticket.cart.map((item) => ({
                key: `${item.itemType}:${item.itemId}`,
                unitPrice: item.unitPrice,
                qty: item.qty,
                effectiveUnitPrice: getEffectiveUnitPrice(item),
                unitCost: item.unitCost,
              })), ticket.cartDiscount, taxSettings).total),
            }))}
            branchNames={branchMap}
            settlement={registerQuote}
            cartDiscount={cartDiscount}
            taxLabel={taxSettings.enabled ? `${taxSettings.name} ${taxSettings.ratePercent}%${taxSettings.pricesIncludeTax ? ' included' : ''}` : 'Tax'}
            customerName={checkoutDetails.customerName}
            customerPhone={checkoutDetails.customerPhone}
            cashSession={openCashSession}
            sessionExpected={sessionExpectedCash}
            suggestedFloat={suggestedFloat}
            showMargin={showRegisterMargin}
            formatMoney={formatUGX}
            onAddProduct={(productId) => addProductToCart(productId, true)}
            onAddService={(serviceId) => addServiceToCart(serviceId, true)}
            onChangeQty={updateCartItemQty}
            onDiscountMode={updateCartItemDiscountMode}
            onDiscountValue={updateCartItemDiscountValue}
            onRemove={removeFromCart}
            onCartDiscount={setCartDiscount}
            onCustomer={(patch) => setCheckoutDetails((prev) => ({ ...prev, ...patch }))}
            onSelectCustomer={(customer) => setCheckoutDetails((prev) => ({ ...prev, customerName: customer.name, customerPhone: customer.phone || '' }))}
            onHold={holdRegisterSale}
            onRecall={recallHeldSale}
            onOpenDrawer={openDrawer}
            onCloseDrawer={closeDrawer}
            onClear={() => { if (cart.length === 0 || window.confirm('Clear this sale?')) clearRegister(); }}
            onPay={completeRegisterSale}
            onCreateProduct={() => openProductForm(blankProductForm(branches[0]?.id || ''))}
          />
        )}

        {view === 'services' && (
          <section>
            <div className="page-tools">
              <p className="muted-copy">Photocopy, scanning, lamination, printing, and typing. Sell them from the register. They do not reduce shelf stock.</p>
              <button className="primary" type="button" onClick={() => { setServiceForm({ name: '', branchId: branches[0]?.id || '', amount: 0, serviceType: 'direct_cost', directCost: 0, monthlySharedCost: 0, expenseGroupId: '' }); setShowServiceModal(true); }}>Add service</button>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Branch</th>
                    <th>Type</th>
                    <th>Price</th>
                    <th>Cost Model</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {services.length > 0 ? servicesPagination.rows.map((service) => (
                    <tr key={service.id}>
                      <td style={{ fontWeight: 600 }}>{service.name}</td>
                      <td>{branchMap[service.branchId]}</td>
                      <td>{service.serviceType === 'direct_cost' ? 'Each sale' : 'Monthly'}</td>
                      <td>{formatUGX(service.salePrice)}</td>
                      <td>
                        {service.serviceType === 'direct_cost'
                          ? formatUGX(service.directCost)
                          : `${formatUGX(service.monthlySharedCost)} / month`}
                      </td>
                      <td>
                        <button className="edit-btn" onClick={() => { setServiceForm({
                          name: service.name,
                          branchId: service.branchId,
                          amount: service.salePrice,
                          serviceType: service.serviceType || 'direct_cost',
                          directCost: service.directCost || 0,
                          monthlySharedCost: service.monthlySharedCost || 0,
                          expenseGroupId: service.expenseGroupId || ''
                        }); setShowServiceModal(true); }}>Edit</button>
                        <button className="delete-btn" onClick={() => { setServices((prev) => prev.filter((item) => item.id !== service.id)); logActivity('delete_service', `Deleted service "${service.name}"`); }}>Delete</button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No services added yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalItems={services.length}
              totalPages={servicesPagination.totalPages}
              page={servicesPagination.safePage}
              start={servicesPagination.start}
              end={servicesPagination.end}
              onPrevious={() => setServicesPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setServicesPage((prev) => Math.min(servicesPagination.totalPages, prev + 1))}
            />
            {showServiceModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h3>Service</h3>
                    <button type="button" className="modal-close" onClick={() => setShowServiceModal(false)}>&times;</button>
                  </div>
                  <form onSubmit={saveService}>
                    <div className="modal-body">
                      <div className="form">
                        <label className="field">
                          <span>Service name</span>
                          <input type="text" value={serviceForm.name} onChange={(e) => setServiceForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Photocopy, scan, lamination" required />
                        </label>
                        <label className="field">
                          <span>Branch</span>
                          <select value={serviceForm.branchId} onChange={(e) => setServiceForm((prev) => ({ ...prev, branchId: e.target.value }))} required>
                            <option value="">Select branch</option>
                            {branches.map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Price</span>
                          <input type="number" min={0} value={serviceForm.amount} onChange={(e) => setServiceForm((prev) => ({ ...prev, amount: Number(e.target.value) }))} required />
                        </label>
                        <label className="field">
                          <span>How cost is counted</span>
                          <select value={serviceForm.serviceType} onChange={(e) => setServiceForm((prev) => ({ ...prev, serviceType: e.target.value as ServiceType }))}>
                            <option value="direct_cost">Cost each time it is sold</option>
                            <option value="shared_cost">One monthly cost</option>
                          </select>
                        </label>
                        {serviceForm.serviceType === 'direct_cost' ? (
                          <label className="field">
                            <span>Cost per sale</span>
                            <input type="number" min={0} value={serviceForm.directCost} onChange={(e) => setServiceForm((prev) => ({ ...prev, directCost: Number(e.target.value) }))} />
                          </label>
                        ) : (
                          <>
                            <label className="field">
                              <span>Monthly cost</span>
                              <input type="number" min={0} value={serviceForm.monthlySharedCost} onChange={(e) => setServiceForm((prev) => ({ ...prev, monthlySharedCost: Number(e.target.value) }))} />
                            </label>
                            <label className="field">
                              <span>Expense group</span>
                              <select value={serviceForm.expenseGroupId} onChange={(e) => setServiceForm((prev) => ({ ...prev, expenseGroupId: e.target.value }))}>
                                <option value="">Ungrouped</option>
                                {expenseGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                              </select>
                            </label>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="modal-footer">
                      <button type="button" className="edit-btn" onClick={() => setShowServiceModal(false)}>Cancel</button>
                      <button className="primary" type="submit">Save service</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </section>
        )}

        {view === 'sales_history' && (
          <section>
            <div className="page-header">
              <h2>Sales History</h2>
            </div>
            <div>
              <div className="filter-bar sales-history-filter-bar">
                <div className="filter-group">
                  <label>View</label>
                  <select value={salesHistoryViewMode} onChange={(e) => setSalesHistoryViewMode(e.target.value as 'day' | 'week' | 'month' | 'range')}>
                    <option value="day">Per Day</option>
                    <option value="week">Per Week</option>
                    <option value="month">Per Month</option>
                    <option value="range">Date Range</option>
                  </select>
                </div>

                {(salesHistoryViewMode === 'day' || salesHistoryViewMode === 'week' || salesHistoryViewMode === 'month') && (
                  <div className="filter-group">
                    <label>{salesHistoryViewMode === 'day' ? 'Date' : salesHistoryViewMode === 'week' ? 'Week of' : 'Month of'}</label>
                    <input type="date" value={salesDateFilter} onChange={(e) => setSalesDateFilter(e.target.value)} />
                  </div>
                )}

                {salesHistoryViewMode === 'range' && (
                  <>
                    <div className="filter-group">
                      <label>Start Date</label>
                      <input type="date" value={salesRangeStart} onChange={(e) => setSalesRangeStart(e.target.value)} />
                    </div>
                    <div className="filter-group">
                      <label>End Date</label>
                      <input type="date" value={salesRangeEnd} onChange={(e) => setSalesRangeEnd(e.target.value)} />
                    </div>
                  </>
                )}

                <button className="edit-btn" onClick={() => { const today = new Date().toISOString().split('T')[0]; setSalesDateFilter(today); setSalesRangeStart(today); setSalesRangeEnd(today); setSalesHistoryViewMode('day'); }}>Today</button>
              </div>
              <p className="period-summary">
                {groupedSales.length} receipt{groupedSales.length === 1 ? '' : 's'}
                <span>·</span>
                {formatUGX(groupedSales.reduce((sum, sale) => sum + sale.total, 0))}
                {showRegisterMargin && (
                  <>
                    <span>·</span>
                    <span className={groupedSales.reduce((sum, sale) => sum + sale.profit, 0) < 0 ? 'is-negative' : ''}>margin {formatUGX(groupedSales.reduce((sum, sale) => sum + sale.profit, 0))}</span>
                  </>
                )}
              </p>

            <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>Receipt</th>
                      <th>Items</th>
                      <th>Customer / tender</th>
                      <th>Total</th>
                      <th>Margin</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedSales.length > 0 ? (
                      paginatedSales.map((saleGroup) => (
                        <tr key={saleGroup.id}>
                          <td>{new Date(saleGroup.createdAt).toLocaleString()}</td>
                          <td style={{ fontWeight: 700 }}>{saleGroup.receiptNumber || `#${saleGroup.id.slice(0, 8)}`}</td>
                          <td>
                            {saleGroup.lines.map((line) => (
                              <div key={line.id}>{line.itemName} × {line.qty}</div>
                            ))}
                          </td>
                          <td>
                            <div>{saleGroup.customerName || 'Walk-in'}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                              {saleGroup.saleKind === 'return' ? 'Credit note · ' : ''}
                              {saleGroup.paymentMethod ? PAYMENT_METHOD_LABELS[saleGroup.paymentMethod] : 'Tender not recorded'}
                            </div>
                          </td>
                          <td style={{ fontWeight: 700 }}>{formatUGX(saleGroup.total)}</td>
                          <td style={{ color: saleGroup.profit >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{showRegisterMargin ? formatUGX(saleGroup.profit) : '—'}</td>
                          <td>
                            <button className="edit-btn" onClick={() => setActiveReceipt(receiptFromSaleLines(saleGroup.lines))}>Receipt</button>
                            {saleGroup.saleKind !== 'return' && <button className="edit-btn" onClick={() => setReturnTransactionId(saleGroup.id)}>Return</button>}
                            {canManageSalesAndExpenses ? (
                              <button className="delete-btn" onClick={() => deleteTransaction(saleGroup.lines.map((line) => line.id))}>Delete</button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="empty-cell">No sales recorded for this period</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pager">
                <span>
                  Showing {groupedSales.length === 0 ? 0 : (salesHistoryPage - 1) * salesHistoryPageSize + 1}–{Math.min(salesHistoryPage * salesHistoryPageSize, groupedSales.length)} of {groupedSales.length}
                </span>
                <div className="pager-actions">
                  <button className="edit-btn" disabled={salesHistoryPage <= 1} onClick={() => setSalesHistoryPage((prev) => Math.max(1, prev - 1))}>Previous</button>
                  <span>Page {salesHistoryPage} / {salesHistoryTotalPages}</span>
                  <button className="edit-btn" disabled={salesHistoryPage >= salesHistoryTotalPages} onClick={() => setSalesHistoryPage((prev) => Math.min(salesHistoryTotalPages, prev + 1))}>Next</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === 'expenses' && (
          <section>
            <div className="page-tools">
              <div className="pane-switch" role="tablist" aria-label="Expenses">
                <button type="button" className={expensePane === 'list' ? 'active' : ''} onClick={() => setExpensePane('list')}>Spending</button>
                <button type="button" className={expensePane === 'groups' ? 'active' : ''} onClick={() => setExpensePane('groups')}>Groups</button>
              </div>
              {expensePane === 'list' && (
                <button className="primary" onClick={() => { setExpenseForm({ id: '', title: '', branchId: branches[0]?.id || '', amount: 0, expenseGroupId: '', accountId: defaultAccount?.id || '' }); setShowExpenseModal(true); }}>
                  Add expense
                </button>
              )}
            </div>

            {expensePane === 'groups' && (
              <>
                <div className="card">
                  <h3>Groups</h3>
                  <p className="muted-copy">Name the kinds of spending, then assign each expense to one.</p>
                  <form onSubmit={createExpenseGroup} className="inline-form">
                    <input value={expenseGroupForm.name} onChange={(e) => setExpenseGroupForm({ name: e.target.value })} placeholder="Rent, wages, supplies" required />
                    <button type="submit" className="primary">Create group</button>
                  </form>
                  {expenseGroups.length > 0 ? (
                    <div className="group-row">
                      {expenseGroups.map((group) => (
                        <div key={group.id} className="group-chip">
                          {editingExpenseGroupId === group.id ? (
                            <>
                              <input value={editingExpenseGroupName} onChange={(e) => setEditingExpenseGroupName(e.target.value)} />
                              <button type="button" className="primary" onClick={() => saveExpenseGroupEdit(group.id)}>Save</button>
                              <button type="button" className="edit-btn" onClick={() => { setEditingExpenseGroupId(''); setEditingExpenseGroupName(''); }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <span>{group.name}</span>
                              <button type="button" className="edit-btn" title={`Edit ${group.name}`} aria-label={`Edit ${group.name}`} onClick={() => { setEditingExpenseGroupId(group.id); setEditingExpenseGroupName(group.name); }}>Edit</button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted-copy">No groups yet.</p>}
                  <div className="inline-form">
                    <select value={transferExpenseGroupId} onChange={(e) => setTransferExpenseGroupId(e.target.value)} aria-label="Group for ungrouped expenses">
                      <option value="">Move ungrouped expenses to…</option>
                      {expenseGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <button type="button" className="edit-btn" onClick={transferUngroupedExpenses} disabled={!transferExpenseGroupId}>Move them</button>
                  </div>
                </div>
                <div className="card">
                  <div className="insight-header-row">
                    <h3>Spending by group</h3>
                    <select aria-label="Spending period" value={expenseChartRange} onChange={(e) => setExpenseChartRange(e.target.value as ExpenseChartRange)}>
                      <option value="day">Today</option>
                      <option value="7days">7 days</option>
                      <option value="14days">14 days</option>
                      <option value="month">This month</option>
                      <option value="3months">3 months</option>
                      <option value="6months">6 months</option>
                      <option value="1year">This year</option>
                    </select>
                  </div>
                  {expenseChartData.total > 0 ? (
                    <div className="expense-chart">
                      <div style={{ width: 160, height: 160, borderRadius: '50%', background: `conic-gradient(${expenseChartData.segments.map((s, i) => `${s.color} ${expenseChartData.segments.slice(0, i).reduce((a, b) => a + b.percentage, 0)}% ${(expenseChartData.segments.slice(0, i + 1).reduce((a, b) => a + b.percentage, 0))}%`).join(', ')})` }} />
                      <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {expenseChartData.segments.map((segment) => (
                          <div key={segment.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: segment.color, marginRight: 6 }} />{segment.name}</span>
                            <span style={{ fontWeight: 600 }}>{segment.percentage.toFixed(1)}% ({formatUGX(segment.amount)})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : <p className="muted-copy">No expenses in this period.</p>}
                </div>
              </>
            )}

            {expensePane === 'list' && (
            <>
            <div className="filter-bar">
              <div className="pane-switch" role="tablist" aria-label="Expense list">
                <button type="button" className={expensesViewMode === 'all' ? 'active' : ''} onClick={() => setExpensesViewMode('all')}>All</button>
                <button type="button" className={expensesViewMode === 'day' ? 'active' : ''} onClick={() => setExpensesViewMode('day')}>One day</button>
              </div>
              {expensesViewMode === 'day' && (
                <input type="date" aria-label="Day" value={expensesDayFilter} onChange={(e) => setExpensesDayFilter(e.target.value)} />
              )}
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Expense Title</th>
                    <th>Branch</th>
                    <th>Amount</th>
                    <th>Expense Group</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.length > 0 ? (
                    expensesPagination.rows.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.createdAt).toLocaleString()}</td>
                        <td style={{ fontWeight: 600 }}>{e.title}</td>
                        <td>{branchMap[e.branchId]}</td>
                        <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{formatUGX(e.amount)}</td>
                        <td>{e.expenseGroupId ? expenseGroupMap[e.expenseGroupId] || 'Unknown group' : 'Ungrouped'}</td>
                        <td>
                          {canManageSalesAndExpenses ? (
                            <>
                              <button className="edit-btn" onClick={() => editExpense(e)}>Edit</button>
                              <button className="delete-btn" onClick={() => deleteExpense(e.id)}>Delete</button>
                            </>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Owner/Admin only</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No expenses found for this view</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalItems={filteredExpenses.length}
              totalPages={expensesPagination.totalPages}
              page={expensesPagination.safePage}
              start={expensesPagination.start}
              end={expensesPagination.end}
              onPrevious={() => setExpensesPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setExpensesPage((prev) => Math.min(expensesPagination.totalPages, prev + 1))}
            />
            </>
            )}
          </section>
        )}

        {view === 'users' && (
          <section>
            <div className="page-header">
              <h2>Staff</h2>
              {canManageUsers && (
                <button className="primary" onClick={() => { setUserForm({ id: '', name: '', email: '', role: 'cashier', branchId: branches[0]?.id || '' }); setShowUserModal(true); }}>
                  + Invite Staff
                </button>
              )}
            </div>
            
            {canManageUsers ? (
              <>
                <p className="muted-copy">Invite someone by email. AlphaPOS sends the link from the shop address. They open it and sign in with Google using that same address, as the role you chose.</p>
            <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Branch</th>
                        <th>Added</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length > 0 ? (
                        usersPagination.rows.map((u) => (
                          <tr key={u.id}>
                            <td style={{ fontWeight: 600 }}>{u.name}</td>
                            <td>{u.email}</td>
                            <td>
                              <span className={`badge ${u.role === 'manager' ? 'badge-warning' : 'badge-success'}`}>
                                {roleLabels[u.role] || u.role}
                              </span>
                            </td>
                            <td>{branchMap[u.branchId]}</td>
                            <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                            <td>
                              <button className="edit-btn" onClick={() => { setUserForm(u); setShowUserModal(true); }}>Edit</button>
                              <button className="edit-btn" onClick={() => { void emailStaffSignInLink(u.email, u.role).catch((error) => showNotification(staffSignInError(error), 'error', 7000)); }}>Email link</button>
                              <button className="delete-btn" onClick={() => {
                                setUsers(prev => prev.filter(x => x.id !== u.id));
                                if (db) void deleteDoc(doc(db, 'shopMemberships', `${activeShopOwnerUid}_${u.email.toLowerCase().trim()}`)).catch(() => undefined);
                                logActivity('delete_user', `Removed user "${u.email}"`);
                              }}>Remove</button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No staff members added yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  totalItems={users.length}
                  totalPages={usersPagination.totalPages}
                  page={usersPagination.safePage}
                  start={usersPagination.start}
                  end={usersPagination.end}
                  onPrevious={() => setUsersPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setUsersPage((prev) => Math.min(usersPagination.totalPages, prev + 1))}
                />
              </>
            ) : (
              <div className="card">
                <p className="muted-copy">Only the shop owner can manage staff.</p>
              </div>
            )}
          </section>
        )}

        {view === 'reports' && (
          <section>
            <div className="card trend-card">
              <div className="insight-header-row">
                <div>
                  <h3>Sales and expenses</h3>
                  <p className="muted-copy">{formatUGX(dashboardInsights.totalRevenue)} in · {formatUGX(dashboardInsights.totalExpense)} out</p>
                </div>
                <select aria-label="Chart window" value={insightTrendRange} onChange={(e) => setInsightTrendRange(Number(e.target.value) as InsightTrendRange)}>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={100}>100 days</option>
                </select>
              </div>
              <div className="pair-legend">
                <span><i className="is-sales" />Sales</span>
                <span><i className="is-expense" />Expenses</span>
              </div>
              <div className="pair-chart" role="img" aria-label="Sales and expenses by day">
                {dashboardInsights.trendDays.map((day) => (
                  <div key={day.date} className="pair-col" title={`${day.date}: sales ${formatUGX(day.revenue)}, expenses ${formatUGX(day.expense)}`}>
                    <div className="pair-bars">
                      <span className="is-sales" style={{ height: `${dashboardInsights.chartMax > 0 ? Math.max(day.revenue > 0 ? 6 : 0, (day.revenue / dashboardInsights.chartMax) * 100) : 0}%` }} />
                      <span className="is-expense" style={{ height: `${dashboardInsights.chartMax > 0 ? Math.max(day.expense > 0 ? 6 : 0, (day.expense / dashboardInsights.chartMax) * 100) : 0}%` }} />
                    </div>
                    {insightTrendRange <= 14 && <em>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</em>}
                  </div>
                ))}
              </div>
            </div>

            <div className="report-grid">
              <div className="card">
                <h4>Today</h4>
                <div className="metric-stack">
                  <div><span>Sales</span><strong>{formatUGX(getMetrics('day', 0).revenue)}</strong></div>
                  <div><span>Expenses</span><strong className="is-negative">{formatUGX(getMetrics('day', 0).expenseTotal)}</strong></div>
                  <div><span>Net profit</span><strong className={getMetrics('day', 0).netProfit >= 0 ? 'is-positive' : 'is-negative'}>{formatUGX(getMetrics('day', 0).netProfit)}</strong></div>
                </div>
              </div>
              <div className="card">
                <h4>This week</h4>
                <div className="metric-stack">
                  <div><span>Sales</span><strong>{formatUGX(getMetrics('week', 0).revenue)}</strong></div>
                  <div><span>Expenses</span><strong className="is-negative">{formatUGX(getMetrics('week', 0).expenseTotal)}</strong></div>
                  <div><span>Net profit</span><strong className={getMetrics('week', 0).netProfit >= 0 ? 'is-positive' : 'is-negative'}>{formatUGX(getMetrics('week', 0).netProfit)}</strong></div>
                </div>
              </div>
              <div className="card">
                <h4>This month</h4>
                <div className="metric-stack">
                  <div><span>Sales</span><strong>{formatUGX(getMetrics('month', 0).revenue)}</strong></div>
                  <div><span>Expenses</span><strong className="is-negative">{formatUGX(getMetrics('month', 0).expenseTotal)}</strong></div>
                  <div><span>Net profit</span><strong className={getMetrics('month', 0).netProfit >= 0 ? 'is-positive' : 'is-negative'}>{formatUGX(getMetrics('month', 0).netProfit)}</strong></div>
                </div>
              </div>
            </div>
            <p className="stock-line">Stock on hand is worth {formatUGX(products.reduce((a, p) => a + (p.stock * p.purchasePrice), 0))}. {products.filter((product) => stockIsLow(product)).length} product{products.filter((product) => stockIsLow(product)).length === 1 ? '' : 's'} below their reorder level.</p>
          </section>
        )}

        {view === 'activity_logs' && (
          <section>
            <p className="muted-copy">Who changed stock, sales, staff, or settings.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLogs.length > 0 ? activityLogsPagination.rows.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                      <td>{log.userEmail}</td>
                      <td><span className="badge badge-info">{roleLabels[log.role] || log.role}</span></td>
                      <td className="activity-action">{log.action.replaceAll('_', ' ')}</td>
                      <td>{log.details}</td>
                    </tr>
                  )) : <tr><td colSpan={5} className="empty-cell">No activity yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalItems={activityLogs.length}
              totalPages={activityLogsPagination.totalPages}
              page={activityLogsPagination.safePage}
              start={activityLogsPagination.start}
              end={activityLogsPagination.end}
              onPrevious={() => setActivityLogsPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setActivityLogsPage((prev) => Math.min(activityLogsPagination.totalPages, prev + 1))}
            />
          </section>
        )}

        {view === 'customers' && (
          <section>
            <div className="page-header">
              <h2>Customers</h2>
            </div>
            <div className="filter-bar">
              <div className="filter-group" style={{ flex: 1 }}>
                <label>Search</label>
                <input value={customerQuery} placeholder="Name or phone" onChange={(event) => setCustomerQuery(event.target.value)} />
              </div>
              <p className="filter-count">{customers.length} customer{customers.length === 1 ? '' : 's'}</p>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>On account</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.filter((customer) => {
                    const needle = customerQuery.trim().toLowerCase();
                    return !needle || customer.name.toLowerCase().includes(needle) || customer.phone?.toLowerCase().includes(needle);
                  }).map((customer) => {
                    const owed = customerBalance(customer.name, customer.phone);
                    return (
                    <tr key={customer.id}>
                      <td style={{ fontWeight: 700 }}>{customer.name}</td>
                      <td>{customer.phone || '—'}</td>
                      <td>{formatUGX(owed)}</td>
                      <td>{customer.notes || '—'}</td>
                      <td>{owed > 0 && <button type="button" className="edit-btn" onClick={() => { setPaymentCustomer(customer); setPaymentDraft({ amount: String(owed), method: 'cash' }); }}>Record payment</button>}</td>
                    </tr>
                    );
                  })}
                  {customers.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Customers appear here after a named sale.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {view === 'settings' && (
          <section className="settings-shell">
            <nav className="settings-nav" aria-label="Settings sections">
              <p>Shop</p>
              <button type="button" className={settingsTab === 'shop' ? 'active' : ''} onClick={() => setSettingsTab('shop')}>Name</button>
              <button type="button" className={settingsTab === 'branches' ? 'active' : ''} onClick={() => setSettingsTab('branches')}>Branches</button>
              <button type="button" className={settingsTab === 'time' ? 'active' : ''} onClick={() => setSettingsTab('time')}>Business day</button>
              <button type="button" className={settingsTab === 'assistant' ? 'active' : ''} onClick={() => setSettingsTab('assistant')}>Assistant</button>
              <p>Checkout</p>
              <button type="button" className={settingsTab === 'tax' ? 'active' : ''} onClick={() => setSettingsTab('tax')}>Tax</button>
              <button type="button" className={settingsTab === 'receipt' ? 'active' : ''} onClick={() => setSettingsTab('receipt')}>Receipt</button>
              <p>Money</p>
              <button type="button" onClick={() => { setView('accounts'); setIsSidebarOpen(false); }}>Balances</button>
              <p>Updates</p>
              <button type="button" className={settingsTab === 'email' ? 'active' : ''} onClick={() => setSettingsTab('email')}>Sales email</button>
              <p>Records</p>
              <button type="button" className={settingsTab === 'backup' ? 'active' : ''} onClick={() => setSettingsTab('backup')}>Backup</button>
            </nav>
            <div className="settings-panel">

            {settingsTab === 'shop' && (
              <div className="card">
                <h3>Shop</h3>
                <div className="fact-list">
                  <div><span>Name</span><strong>{currentShop?.shopName || 'My Shop'}</strong></div>
                  <div><span>Branches</span><strong>{branches.length}</strong></div>
                  <div><span>Your role</span><strong>{roleLabels[role]}</strong></div>
                </div>
                {isShopOwner && (
                  <button className="primary" onClick={() => { setShopNameForm(currentShop?.shopName || ''); setShowSettingsModal(true); }}>Edit shop name</button>
                )}
                {shopSwitchPanel}
              </div>
            )}

            {settingsTab === 'branches' && (
              <div>
                <div style={{ marginBottom: '2rem' }}>
                  {isShopOwner && (
                    <button className="primary" onClick={() => { setBranchForm({ name: '', location: '', id: '' }); setShowBranchFormModal(true); }}>+ Add Branch</button>
                  )}
                </div>
                <div className="grid dashboard-metrics-grid">
                  {branches.map((b) => (
                    <div key={b.id} className="card">
                      <h4 style={{ marginBottom: '1rem' }}>{b.name}</h4>
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Location</div>
                        <div style={{ fontSize: '0.95rem', color: 'var(--text)' }}>{b.location}</div>
                      </div>
                      {isShopOwner && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="edit-btn" onClick={() => { setBranchForm(b); setShowBranchFormModal(true); }}>Edit</button>
                          <button className="delete-btn" onClick={() => deleteBranch(b.id)}>Delete</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {settingsTab === 'time' && (
              <div className="card">
                <h3>Time & Timezone</h3>
                <p style={{ color: 'var(--text-muted)' }}>These settings control what counts as a business day in reports and expense charts.</p>
                <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  <div>
                    <label>Business day starts at</label>
                    <input
                      type="time"
                      value={shopTimeSettings.dayStartTime}
                      onChange={(e) => setShopTimeSettings((prev) => ({ ...prev, dayStartTime: e.target.value || '00:00' }))}
                    />
                  </div>
                  <div>
                    <label>Timezone</label>
                    <select
                      value={shopTimeSettings.timezoneOffsetMinutes}
                      onChange={(e) => setShopTimeSettings((prev) => ({ ...prev, timezoneOffsetMinutes: Number(e.target.value) }))}
                    >
                      {Array.from({ length: 27 }, (_, idx) => {
                        const hour = idx - 12;
                        const offsetMinutes = hour * 60;
                        const sign = hour >= 0 ? '+' : '-';
                        const absHour = Math.abs(hour).toString().padStart(2, '0');
                        return <option key={offsetMinutes} value={offsetMinutes}>UTC{sign}{absHour}:00</option>;
                      })}
                    </select>
                  </div>
                </div>
              </div>
            )}
            {settingsTab === 'assistant' && (
              <div className="card">
                <h3>Product assistant</h3>
                <p className="muted-copy">Paste a Gemini API key from Google AI Studio (aistudio.google.com/apikey). It is used only to read product photos. Staff cannot open this page, and the key is not included in a shop backup.</p>
                <p className="muted-copy">{catalogKey ? 'A key is saved for this shop.' : 'No key is saved yet.'}</p>
                <div className="form" style={{ marginTop: '1rem' }}>
                  <label className="field">
                    <span>{catalogKey ? 'Replace the key' : 'Gemini API key'}</span>
                    <input
                      type={showCatalogKey ? 'text' : 'password'}
                      value={catalogKeyDraft}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={200}
                      onChange={(event) => setCatalogKeyDraft(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Show the key while typing</span>
                    <select value={showCatalogKey ? 'yes' : 'no'} onChange={(event) => setShowCatalogKey(event.target.value === 'yes')}>
                      <option value="no">Hidden</option>
                      <option value="yes">Visible</option>
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="primary" onClick={() => { void saveCatalogKey(); }}>Save key</button>
                  {catalogKey && <button type="button" className="edit-btn" onClick={() => { void removeCatalogKey(); }}>Remove key</button>}
                </div>
              </div>
            )}
            {settingsTab === 'tax' && (
              <div className="card">
                <h3>Sales tax</h3>
                <p style={{ color: 'var(--text-muted)', maxWidth: '720px' }}>Turn tax on when the shop needs it. Inclusive prices keep the shelf price as the amount the customer pays. Exclusive prices add tax at the register. This is a shop calculation, not a filing connection to a tax authority.</p>
                <div className="form" style={{ marginTop: '1rem' }}>
                  <label className="field">
                    <span>Charge tax</span>
                    <select value={taxSettings.enabled ? 'yes' : 'no'} onChange={(event) => setTaxSettings((prev) => ({ ...prev, enabled: event.target.value === 'yes' }))}>
                      <option value="no">Off</option>
                      <option value="yes">On</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Tax name</span>
                    <input value={taxSettings.name} maxLength={40} onChange={(event) => setTaxSettings((prev) => ({ ...prev, name: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>Rate %</span>
                    <input type="number" min={0} max={100} step="0.01" value={taxSettings.ratePercent} onChange={(event) => setTaxSettings((prev) => ({ ...prev, ratePercent: Number(event.target.value) }))} />
                  </label>
                  <label className="field">
                    <span>Prices</span>
                    <select value={taxSettings.pricesIncludeTax ? 'included' : 'added'} onChange={(event) => setTaxSettings((prev) => ({ ...prev, pricesIncludeTax: event.target.value === 'included' }))}>
                      <option value="included">Tax included in shelf price</option>
                      <option value="added">Add tax at checkout</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="edit-btn" onClick={() => setTaxSettings({ enabled: true, name: 'VAT', ratePercent: 18, pricesIncludeTax: true })}>Use Uganda VAT, 18% included</button>
              </div>
            )}

            {settingsTab === 'receipt' && (
              <div className="card">
                <h3>Receipt</h3>
                <p style={{ color: 'var(--text-muted)' }}>These details print on every receipt and credit note.</p>
                <div className="form" style={{ marginTop: '1rem' }}>
                  <label className="field">
                    <span>Address</span>
                    <input value={receiptSettings.address} maxLength={180} onChange={(event) => setReceiptSettings((prev) => ({ ...prev, address: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>Phone</span>
                    <input value={receiptSettings.phone} maxLength={40} onChange={(event) => setReceiptSettings((prev) => ({ ...prev, phone: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>Footer</span>
                    <input value={receiptSettings.footer} maxLength={180} onChange={(event) => setReceiptSettings((prev) => ({ ...prev, footer: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>Show tax line</span>
                    <select value={receiptSettings.showTax ? 'yes' : 'no'} onChange={(event) => setReceiptSettings((prev) => ({ ...prev, showTax: event.target.value === 'yes' }))}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {settingsTab === 'email' && (
              <div className="card">
                <h3>Sales emails</h3>
                <p className="muted-copy">Choose how often the shop emails a sales summary. AlphaPOS sends the previous day, week, or month the next time an owner or admin opens the shop after that period ends. The browser has to be open for the email to go out.</p>
                <div className="office-form">
                  <label>
                    How often
                    <select value={salesEmailSettings.cadence} onChange={(event) => setSalesEmailSettings((prev) => ({ ...prev, cadence: event.target.value as SalesEmailSettings['cadence'] }))}>
                      <option value="off">Off</option>
                      <option value="daily">Every day</option>
                      <option value="weekly">Every week</option>
                      <option value="monthly">Every month</option>
                    </select>
                  </label>
                  <label>
                    Also send to
                    <input
                      ref={recipientInputRef}
                      value={recipientDraft}
                      placeholder="accountant@shop.com, owner@shop.com"
                      onChange={(event) => setRecipientDraft(event.target.value)}
                      onBlur={() => setSalesEmailSettings((prev) => ({
                        ...prev,
                        recipients: recipientDraft.split(',').map((email) => email.trim().toLowerCase()).filter((email) => email.includes('@')).slice(0, 5),
                      }))}
                    />
                  </label>
                </div>
                <p className="muted-copy">Your sign-in email is always included. Add up to five more addresses, separated by commas. Reports need RESEND_API_KEY and EMAIL_FROM on the server. EMAIL_FROM has to be an address on a domain that shows Verified in Resend, such as AlphaPOS &lt;reports@yourshop.com&gt;.</p>
                {salesEmailSettings.lastSentKey && <p className="muted-copy">Last report marked sent: {salesEmailSettings.lastSentKey}</p>}
                <button type="button" className="primary" disabled={sendingSalesEmail || salesEmailSettings.cadence === 'off'} onClick={() => { void deliverSalesReport(true); }}>
                  {sendingSalesEmail ? 'Sending…' : 'Send the latest report'}
                </button>
              </div>
            )}

            {settingsTab === 'backup' && (
              <div className="card">
                <h3>Backup & Restore Shop Data</h3>
                <p style={{ color: 'var(--text-muted)', maxWidth: '760px' }}>
                  Download one backup file with all important POS data: inventory, services, sales, expenses, expense groups, accounts, branches, staff users, activity logs, and shop time settings. If a shop is deleted or data is lost, create/open a new shop with the owner account, then upload this file here to reupload the records.
                </p>
                <p className="muted-copy">{products.length} products, {sales.length} sales, {expenses.length} expenses, {accounts.length + users.length} accounts and staff.</p>
                {isShopOwner ? (
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
                    <button type="button" className="primary" onClick={downloadShopBackup}>Download Full Backup</button>
                    <button type="button" className="edit-btn" onClick={() => backupFileInputRef.current?.click()}>Upload & Restore Backup</button>
                    <input ref={backupFileInputRef} type="file" accept="application/json,.json" onChange={restoreShopBackup} style={{ display: 'none' }} />
                  </div>
                ) : (
                  <p style={{ marginTop: '1rem', color: 'var(--danger)', fontWeight: 600 }}>Only the shop owner can export or restore a full shop backup.</p>
                )}
                <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: '0.75rem', background: '#f8fafc' }}>
                  <strong>Restore checklist</strong>
                  <ol style={{ color: 'var(--text-muted)', marginBottom: 0 }}>
                    <li>Sign in as the shop owner and create or open the destination shop.</li>
                    <li>Upload the latest AlphaPOS backup JSON file.</li>
                    <li>Confirm products, sales, expenses, accounts, staff, and branches are visible again.</li>
                  </ol>
                </div>
              </div>
            )}
            </div>
          </section>
        )}


        {view === 'accounts' && (
          <section>
            <div className="card">
              <h3>Where money sits</h3>
              <p className="muted-copy">Each sale and expense updates one of these balances. Cash in the drawer is counted on the register.</p>
              {(isShopOwner || role === 'admin') && (
                <details className="quiet-fold">
                  <summary>Add or adjust a balance</summary>
                  <form onSubmit={createAccount} className="form" style={{ marginTop: '1rem' }}>
                    <label className="field">
                      <span>Account name</span>
                      <input value={accountForm.name} onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Mobile money" required />
                    </label>
                    <label className="field">
                      <span>Opening balance</span>
                      <input type="number" value={accountForm.openingBalance} onChange={(e) => setAccountForm((prev) => ({ ...prev, openingBalance: Number(e.target.value) }))} />
                    </label>
                    <div><button type="submit" className="primary">Add account</button></div>
                  </form>
                  <form onSubmit={topUpAccount} className="form" style={{ marginTop: '0.75rem' }}>
                    <label className="field">
                      <span>Account</span>
                      <select value={accountTopUpForm.accountId || defaultAccount?.id || ''} onChange={(e) => setAccountTopUpForm((prev) => ({ ...prev, accountId: e.target.value }))}>
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (Default)' : ''}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Amount to add</span>
                      <input type="number" min={1} value={accountTopUpForm.amount} onChange={(e) => setAccountTopUpForm((prev) => ({ ...prev, amount: Number(e.target.value) }))} required />
                    </label>
                    <div><button type="submit" className="primary">Add money</button></div>
                  </form>
                </details>
              )}
              <div className="table-wrap" style={{ marginTop: '1rem' }}>
                <table className="data-table">
                  <thead><tr><th>Account</th><th>Type</th><th>Opening Balance</th><th>Current Balance</th>{(isShopOwner || role === 'admin') && <th>Actions</th>}</tr></thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr key={account.id}>
                        <td>{account.name}</td>
                        <td>{account.isDefault ? 'Default' : 'Custom'}</td>
                        <td>{formatUGX(account.openingBalance || 0)}</td>
                        <td>{formatUGX(accountBalances.get(account.id) || 0)}</td>
                        {(isShopOwner || role === 'admin') && (
                          <td>
                            <button type="button" className="edit-btn" onClick={() => editAccountOpeningBalance(account.id)}>Edit value</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {view === 'profile' && (
          <section className="profile-stack">
            <div className="card profile-card">
              <h3>Your profile</h3>
              <div className="fact-list">
                <div><span>Name</span><strong>{authUser?.displayName}</strong></div>
                <div><span>Email</span><strong>{authUser?.email}</strong></div>
                <div><span>Role</span><strong>{roleLabels[role]}</strong></div>
                <div><span>Shop</span><strong>{currentShop?.shopName || 'My Shop'}</strong></div>
              </div>
            </div>
            {shopSwitchPanel && <div className="card profile-card">{shopSwitchPanel}</div>}
          </section>
        )}

        {activeReceipt && <ReceiptDialog receipt={activeReceipt} formatMoney={formatUGX} onClose={() => setActiveReceipt(null)} />}
        {returnTransactionId && (
          <ReturnDialog
            receiptNumber={sales.find((sale) => transactionKey(sale) === returnTransactionId)?.receiptNumber || `#${returnTransactionId.slice(0, 8)}`}
            lines={sales.filter((sale) => transactionKey(sale) === returnTransactionId && sale.saleKind !== 'return' && sale.qty > 0).map((sale): ReturnableLine => ({
              id: sale.id,
              name: sale.itemName,
              type: sale.type,
              soldQty: sale.qty,
              returnableQty: returnableQuantity(sales, returnTransactionId, sale.itemName, sale.type),
              unitAmount: roundMoney(sale.amount / sale.qty),
            }))}
            formatMoney={formatUGX}
            onClose={() => setReturnTransactionId('')}
            onSubmit={issueReturn}
          />
        )}

        {/* Sale Modal */}
        {showSaleModal && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '500px' }}>
              <div className="modal-header">
                <h3>Quick sale</h3>
                <button className="modal-close" onClick={() => setShowSaleModal(false)}>&times;</button>
              </div>
              <div className="modal-body">
                <div style={{ padding: '1rem', backgroundColor: 'var(--info-light)', borderRadius: 'var(--radius)', marginBottom: '1rem', border: '1px solid var(--info-bg)' }}>
                  <p className="muted-copy">Use the register for a multi-item sale. This form records one product.</p>
                </div>
                <form onSubmit={(e) => { if (makeProductSale(e)) setShowSaleModal(false); }}>
                  <div className="form">
                    <label className="field">
                      <span>Product</span>
                      <select value={saleForm.productId} onChange={(e) => setSaleForm({ ...saleForm, productId: e.target.value })} required>
                        <option value="">Select product</option>
                        {products.filter(p => p.stock > 0).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.stock} available)</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Quantity</span>
                      <input type="number" min={1} max={products.find(p => p.id === saleForm.productId)?.stock || 1} value={saleForm.qty} onChange={(e) => setSaleForm({ ...saleForm, qty: Number(e.target.value) })} required />
                    </label>
                  </div>
                  {renderCheckoutDetailsFields()}
                  {saleForm.productId && (
                    <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      {(() => {
                        const p = products.find(x => x.id === saleForm.productId);
                        return p ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                              <span>Unit Price:</span>
                              <span style={{ fontWeight: 600 }}>{formatUGX(p.salePrice)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                              <span>Total:</span>
                              <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--success)' }}>{formatUGX(p.salePrice * saleForm.qty)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              <span>Profit:</span>
                              <span style={{ fontWeight: 600 }}>{formatUGX((p.salePrice - p.purchasePrice) * saleForm.qty)}</span>
                            </div>
                          </>
                        ) : null;
                      })()}
                    </div>
                  )}
                  <div className="modal-footer" style={{ marginTop: '1.5rem' }}>
                    <button type="button" className="edit-btn" onClick={() => setShowSaleModal(false)}>Cancel</button>
                    <button type="submit" className="primary">Complete Sale</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Product Modal */}
        {showProductModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>{productForm.id ? 'Edit Product' : 'Add New Product'}</h3>
                <button className="modal-close" onClick={() => setShowProductModal(false)}>&times;</button>
              </div>
              <form onSubmit={saveProduct}>
                <div className="modal-body">
                  <div className="form">
                    <div className="product-photo-field form-span">
                      <div className="product-photo-preview" aria-hidden="true">
                        {productForm.image ? <img src={productForm.image} alt="" /> : <span>{(productForm.name || 'P').slice(0, 1).toUpperCase()}</span>}
                      </div>
                      <div>
                        <div className="product-photo-actions">
                          <button type="button" className="edit-btn" disabled={productPhotoBusy} onClick={() => productPhotoRef.current?.click()}>
                            {productPhotoBusy ? 'Preparing photo…' : productForm.image ? 'Change photo' : 'Upload photo'}
                          </button>
                          <input ref={productPhotoRef} type="file" accept="image/*" onChange={chooseProductPhoto} />
                          {productForm.image && (
                            <button type="button" className="edit-btn" onClick={() => setProductForm((prev) => ({ ...prev, image: '' }))}>Remove photo</button>
                          )}
                        </div>
                        <p>Shown on the register and the shelf. Large pictures are reduced automatically.</p>
                      </div>
                    </div>
                    <label className="field">
                      <span>Product Name</span>
                      <input value={productForm.name} onChange={(e) => {
                        const name = e.target.value;
                        setProductForm((prev) => ({
                          ...prev,
                          name,
                          sku: !prev.id && !skuManual ? suggestSku(name, prev.barcode, prev.id) : prev.sku,
                        }));
                      }} required />
                    </label>
                    <div className="field form-span">
                      <span>Category</span>
                      <div className="category-choices" role="group" aria-label="Category">
                        <button type="button" className={!newCategoryOpen && !productForm.category ? 'active' : ''} onClick={() => { setNewCategoryOpen(false); setProductForm({ ...productForm, category: '' }); }}>None</button>
                        {productCategories.map((name) => (
                          <button type="button" key={name} className={!newCategoryOpen && productForm.category === name ? 'active' : ''} onClick={() => { setNewCategoryOpen(false); setProductForm({ ...productForm, category: name }); }}>{name}</button>
                        ))}
                        <button type="button" className={newCategoryOpen ? 'active' : ''} onClick={() => { setNewCategoryOpen(true); setProductForm({ ...productForm, category: '' }); }}>New category</button>
                      </div>
                      {newCategoryOpen && (
                        <input value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value.slice(0, 40) })} placeholder="Category name" maxLength={40} autoFocus />
                      )}
                    </div>
                    <label className="field">
                      <span>SKU</span>
                      <input value={productForm.sku} onChange={(e) => { setSkuManual(true); setProductForm({ ...productForm, sku: e.target.value }); }} autoCapitalize="characters" readOnly={!canEditSku} />
                    </label>
                    <p className="muted-copy form-span">{canEditSku ? 'Filled in from the product name. Change it when this product already has a code.' : 'A SKU is created automatically. An owner, admin, manager, or stock lead can change it.'}</p>
                    <label className="field">
                      <span>Barcode</span>
                      <input value={productForm.barcode} onChange={(e) => {
                        const barcode = e.target.value;
                        setProductForm((prev) => ({
                          ...prev,
                          barcode,
                          sku: !prev.id && !skuManual ? suggestSku(prev.name, barcode, prev.id) : prev.sku,
                        }));
                      }} inputMode="numeric" />
                    </label>
                    <label className="field">
                      <span>Branch</span>
                      <select value={productForm.branchId} onChange={(e) => setProductForm({ ...productForm, branchId: e.target.value })} required>
                        <option value="">Select Branch</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>{productForm.id ? 'Stock on hand' : 'Opening stock'}</span>
                      <input type="number" min="0" step="0.01" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: Number(e.target.value) })} required />
                    </label>
                    {seesCost && (
                      <label className="field">
                        <span>Reorder when below</span>
                        <input type="number" min="0" step="1" value={productForm.reorderPoint} onChange={(e) => setProductForm({ ...productForm, reorderPoint: Number(e.target.value) })} required />
                      </label>
                    )}
                    {seesCost && (
                      <label className="field">
                        <span>Purchase Price (UGX)</span>
                        <input type="number" min="0" step="0.01" value={productForm.purchasePrice} onChange={(e) => setProductForm({ ...productForm, purchasePrice: Number(e.target.value) })} required />
                      </label>
                    )}
                    <label className="field">
                      <span>Selling Price (UGX)</span>
                      <input type="number" min="0" step="0.01" value={productForm.salePrice} onChange={(e) => setProductForm({ ...productForm, salePrice: Number(e.target.value) })} required />
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setShowProductModal(false)}>Cancel</button>
                  <button type="submit" className="primary" disabled={productPhotoBusy}>Save Product</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showStockAdjustmentModal && (
          <div className="modal-overlay">
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="stock-adjustment-title">
              <div className="modal-header">
                <div>
                  <h3 id="stock-adjustment-title">{stockAdjustmentForm.lines ? 'Receive stock' : 'Adjust stock'}</h3>
                  {!stockAdjustmentForm.lines && products.find((product) => product.id === stockAdjustmentForm.productId) && (
                    <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      On hand: {products.find((product) => product.id === stockAdjustmentForm.productId)?.stock}
                    </p>
                  )}
                </div>
                <button type="button" className="modal-close" onClick={() => setShowStockAdjustmentModal(false)} aria-label="Close stock adjustment">&times;</button>
              </div>
              <form onSubmit={saveStockAdjustment}>
                <div className="modal-body">
                  <div className="form">
                    {stockAdjustmentForm.lines ? (
                      <div className="receipt-lines form-span">
                        {stockAdjustmentForm.lines.map((line, index) => (
                          <div className="receipt-line" key={`${index}-${line.productId}`}>
                            <label className="field receipt-product">
                              <span>Product</span>
                              <select value={line.productId} onChange={(event) => setStockAdjustmentForm((prev) => ({ ...prev, lines: prev.lines?.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item) || null }))} required>
                                <option value="">Select product</option>
                                {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock} on hand</option>)}
                              </select>
                            </label>
                            <label className="field">
                              <span>Quantity</span>
                              <input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setStockAdjustmentForm((prev) => ({ ...prev, lines: prev.lines?.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item) || null }))} required />
                            </label>
                            <label className="field">
                              <span>Unit cost</span>
                              <input type="number" min="0" step="0.01" value={line.unitCost} placeholder="Keep" onChange={(event) => setStockAdjustmentForm((prev) => ({ ...prev, lines: prev.lines?.map((item, itemIndex) => itemIndex === index ? { ...item, unitCost: event.target.value } : item) || null }))} />
                            </label>
                            {stockAdjustmentForm.lines && stockAdjustmentForm.lines.length > 1 && (
                              <button type="button" className="delete-btn" onClick={() => setStockAdjustmentForm((prev) => ({ ...prev, lines: prev.lines?.filter((_, itemIndex) => itemIndex !== index) || null }))}>Remove</button>
                            )}
                          </div>
                        ))}
                        <button type="button" className="edit-btn" onClick={() => setStockAdjustmentForm((prev) => ({ ...prev, lines: [...(prev.lines || []), { productId: '', quantity: '', unitCost: '' }] }))}>Add another product</button>
                      </div>
                    ) : (
                      <>
                        <label className="field">
                          <span>Product</span>
                          <select value={stockAdjustmentForm.productId} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, productId: e.target.value }))} required>
                            <option value="">Select product</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>{product.name} · {product.stock} on hand</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Change</span>
                          <select value={stockAdjustmentForm.direction} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, direction: e.target.value as 'add' | 'remove' }))}>
                            <option value="add">Add stock</option>
                            <option value="remove">Remove stock</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Quantity</span>
                          <input type="number" min="0.01" step="0.01" value={stockAdjustmentForm.quantity} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, quantity: Number(e.target.value) }))} required />
                        </label>
                        <label className="field">
                          <span>Reason</span>
                          <select
                            value={stockAdjustmentForm.reason}
                            onChange={(e) => {
                              const reason = e.target.value as typeof stockAdjustmentForm.reason;
                              setStockAdjustmentForm((prev) => ({
                                ...prev,
                                reason,
                                direction: reason === 'damaged' ? 'remove' : reason === 'customer_return' ? 'add' : prev.direction,
                              }));
                            }}
                          >
                            <option value="restock">Supplier receipt / restock</option>
                            <option value="count_correction">Count correction</option>
                            <option value="damaged">Damaged / expired</option>
                            <option value="customer_return">Customer return</option>
                          </select>
                        </label>
                      </>
                    )}
                    {(stockAdjustmentForm.lines || stockAdjustmentForm.reason === 'restock') && (
                      <>
                        <label className="field">
                          <span>Supplier (optional)</span>
                          <input list="supplier-names" value={stockAdjustmentForm.supplierName} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, supplierName: e.target.value }))} maxLength={80} placeholder="Supplier name" />
                          <datalist id="supplier-names">
                            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}
                          </datalist>
                        </label>
                        <label className="field">
                          <span>Invoice / reference (optional)</span>
                          <input value={stockAdjustmentForm.reference} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, reference: e.target.value }))} maxLength={80} placeholder="Supplier invoice number" />
                        </label>
                        {!stockAdjustmentForm.lines && (
                          <label className="field">
                            <span>Latest unit cost (UGX, optional)</span>
                            <input type="number" min="0" step="0.01" value={stockAdjustmentForm.unitCost} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, unitCost: e.target.value }))} placeholder="Leave blank to keep current cost" />
                          </label>
                        )}
                      </>
                    )}
                    <label className="field">
                      <span>Note (optional)</span>
                      <textarea value={stockAdjustmentForm.note} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, note: e.target.value }))} maxLength={160} rows={3} placeholder="Delivery condition or adjustment details" />
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setShowStockAdjustmentModal(false)}>Cancel</button>
                  <button type="submit" className="primary">{stockAdjustmentForm.lines || stockAdjustmentForm.reason === 'restock' ? 'Receive stock' : 'Save adjustment'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {paymentCustomer && (
          <div className="modal-overlay">
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="customer-payment-title">
              <div className="modal-header">
                <h3 id="customer-payment-title">Payment from {paymentCustomer.name}</h3>
                <button type="button" className="modal-close" onClick={() => setPaymentCustomer(null)} aria-label="Close payment">&times;</button>
              </div>
              <form onSubmit={recordCustomerPayment}>
                <div className="modal-body">
                  <div className="form">
                    <label className="field">
                      <span>Amount (UGX)</span>
                      <input type="number" min="1" step="1" value={paymentDraft.amount} onChange={(event) => setPaymentDraft((prev) => ({ ...prev, amount: event.target.value }))} required />
                    </label>
                    <label className="field">
                      <span>Method</span>
                      <select value={paymentDraft.method} onChange={(event) => setPaymentDraft((prev) => ({ ...prev, method: event.target.value as CustomerPayment['method'] }))}>
                        <option value="cash">Cash</option>
                        <option value="mobile_money">Mobile money</option>
                        <option value="card_terminal">Card</option>
                        <option value="bank_transfer">Bank</option>
                      </select>
                    </label>
                    <p className="muted-copy form-span">Owes {formatUGX(customerBalance(paymentCustomer.name, paymentCustomer.phone))}. {paymentDraft.method === 'cash' && openCashSession ? 'Cash is added to the open drawer.' : paymentDraft.method === 'cash' ? 'The drawer is closed, so this cash is recorded on the cash account only.' : 'This is recorded on that account. AlphaPOS does not collect the money.'}</p>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setPaymentCustomer(null)}>Cancel</button>
                  <button type="submit" className="primary">Record payment</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Expense Modal */}
        {showExpenseModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>{expenseForm.id ? 'Edit Expense' : 'Record Expense'}</h3>
                <button className="modal-close" onClick={() => setShowExpenseModal(false)}>&times;</button>
              </div>
              <form onSubmit={saveExpense}>
                <div className="modal-body">
                  <div className="form">
                    <label className="field">
                      <span>Expense Title</span>
                      <input value={expenseForm.title} onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })} required />
                    </label>
                    <label className="field">
                      <span>Branch</span>
                      <select value={expenseForm.branchId} onChange={(e) => setExpenseForm({ ...expenseForm, branchId: e.target.value })} required>
                        <option value="">Select Branch</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Expense Group</span>
                      <select value={expenseForm.expenseGroupId} onChange={(e) => setExpenseForm({ ...expenseForm, expenseGroupId: e.target.value })}>
                        <option value="">No group (Ungrouped)</option>
                        {expenseGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Deduct From Account</span>
                      <select value={expenseForm.accountId} onChange={(e) => setExpenseForm({ ...expenseForm, accountId: e.target.value })} required>
                        <option value="">Select Account</option>
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (Default)' : ''}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Amount (UGX)</span>
                      <input type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: Number(e.target.value) })} required />
                    </label>
                    {!expenseForm.id && openCashSession && (expenseForm.accountId || defaultAccount?.id) === defaultAccount?.id && (
                      <p className="muted-copy form-span">Cash taken from the open drawer is deducted from the expected till.</p>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setShowExpenseModal(false)}>Cancel</button>
                  <button type="submit" className="primary">Save Expense</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* User Modal */}
        {showUserModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>{userForm.id ? 'Edit Staff Member' : 'Invite Staff Member'}</h3>
                <button className="modal-close" onClick={() => setShowUserModal(false)}>&times;</button>
              </div>
              <form onSubmit={saveUser}>
                <div className="modal-body">
                  <div className="form">
                    <label className="field">
                      <span>Full Name</span>
                      <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required />
                    </label>
                    <label className="field">
                      <span>Email Address</span>
                      <input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
                    </label>
                    {!userForm.id && <p className="muted-copy form-span">We email this address a link from the shop. They open it and sign in with Google using that same address as {roleLabels[userForm.role]}.</p>}
                    <label className="field">
                      <span>Role</span>
                      <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as Role })} required>
                        <option value="cashier">Cashier</option>
                        <option value="admin">Admin</option>
                        <option value="manager">Manager</option>
                        <option value="stock">Stock Manager</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Branch</span>
                      <select value={userForm.branchId} onChange={(e) => setUserForm({ ...userForm, branchId: e.target.value })} required>
                        <option value="">Select Branch</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setShowUserModal(false)}>Cancel</button>
                  <button type="submit" className="primary">{userForm.id ? 'Update' : 'Send invite email'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>Edit Shop Name</h3>
                <button className="modal-close" onClick={() => setShowSettingsModal(false)}>&times;</button>
              </div>
              <form onSubmit={saveShopName}>
                <div className="modal-body">
                  <div className="form">
                    <label className="field">
                      <span>Shop Name</span>
                      <input value={shopNameForm} onChange={(e) => setShopNameForm(e.target.value)} placeholder="Enter your shop name" required />
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setShowSettingsModal(false)}>Cancel</button>
                  <button type="submit" className="primary">Save Shop Name</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* Branch Form Modal */}
        {showBranchFormModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>{branchForm.id ? 'Edit Branch' : 'Add New Branch'}</h3>
                <button className="modal-close" onClick={() => setShowBranchFormModal(false)}>&times;</button>
              </div>
              <form onSubmit={saveBranch}>
                <div className="modal-body">
                  <div className="form">
                    <label className="field">
                      <span>Branch Name</span>
                      <input value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="e.g., Main Branch" required />
                    </label>
                    <label className="field">
                      <span>Location</span>
                      <input value={branchForm.location} onChange={(e) => setBranchForm({ ...branchForm, location: e.target.value })} placeholder="e.g., Downtown" required />
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setShowBranchFormModal(false)}>Cancel</button>
                  <button type="submit" className="primary">Save Branch</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
