'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import RegisterDesk from '../components/pos/RegisterDesk';
import ReceiptDialog from '../components/pos/ReceiptDialog';
import ReturnDialog, { type ReturnableLine } from '../components/pos/ReturnDialog';
import { LOCAL_OPERATOR_ID, readLocalShop, writeLocalShop } from '../lib/pos/localShop';
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
type View = 'dashboard' | 'sales_history' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports' | 'settings' | 'accounts' | 'profile' | 'activity_logs' | 'customers';
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

type Product = { id: string; name: string; branchId: string; stock: number; purchasePrice: number; salePrice: number; sku?: string; barcode?: string; category?: string } & AuditStamp;
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
type Expense = { id: string; title: string; branchId: string; amount: number; expenseGroupId?: string; accountId?: string } & AuditStamp;
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
    heldTickets?: HeldTicket[];
    cashSessions?: CashSession[];
    taxSettings?: TaxSettings;
    receiptSettings?: ReceiptSettings;
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
  const [view, setView] = useState<View>('sales');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [status, setStatus] = useState('Welcome to AlphaPOS Pro.');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const hasLoadedUserDataRef = useRef(false);
  const isSwitchingShopRef = useRef(false);
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
  const [reportsSalesPage, setReportsSalesPage] = useState(1);
  const [activityLogsPage, setActivityLogsPage] = useState(1);
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('weekly');
  const [insightTrendRange, setInsightTrendRange] = useState<InsightTrendRange>(30);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productBranchFilter, setProductBranchFilter] = useState('');
  const [productStockFilter, setProductStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);

  const [branchForm, setBranchForm] = useState({ name: '', location: '', id: '' });
  const [productForm, setProductForm] = useState({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0, sku: '', barcode: '', category: '' });
  const [stockAdjustmentForm, setStockAdjustmentForm] = useState({ productId: '', direction: 'add' as 'add' | 'remove', quantity: 1, reason: 'restock' as Exclude<StockMovementReason, 'sale' | 'opening_stock' | 'branch_transfer'>, note: '', supplierName: '', reference: '', unitCost: '' });
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
  const [showExpenseGroupsDetails, setShowExpenseGroupsDetails] = useState(false);
  const [userForm, setUserForm] = useState({ id: '', name: '', email: '', role: 'cashier' as Role, branchId: '' });
  const [shopNameForm, setShopNameForm] = useState('');
  const [settingsTab, setSettingsTab] = useState<'shop' | 'branches' | 'time' | 'accounts' | 'backup' | 'tax' | 'receipt'>('shop');
  const [shopTimeSettings, setShopTimeSettings] = useState<ShopTimeSettings>({ timezoneOffsetMinutes: 0, dayStartTime: '00:00' });

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
  const ensureDefaultCashAccount = useCallback((existingAccounts: Account[]) => {
    const normalized = existingAccounts.map((account) => ({ ...account, openingBalance: Number.isFinite(account.openingBalance) ? account.openingBalance : 0 }));
    const existingCash = normalized.find((account) => account.name.trim().toLowerCase() === 'cash');
    if (existingCash) {
      return normalized.map((account) => ({ ...account, isDefault: account.id === existingCash.id }));
    }
    return [{
      id: crypto.randomUUID(),
      name: 'CASH',
      openingBalance: 0,
      isDefault: true,
      ...currentAuditStamp(),
    }, ...normalized];
  }, []);
  const currentShop = availableShops.find((s) => s.ownerUid === activeShopOwnerUid);
  const isShopOwner = activeShopOwnerUid === authUser?.uid;
  const truncateShopName = (name: string, maxLength: number = 15) => name.length > maxLength ? name.substring(0, maxLength) + '...' : name;

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info', duration: number = 3000) => {
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    setNotification({ message, type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, duration);
  };

  // Firebase Auth Setup
  useEffect(() => {
    const app = firebaseApp;
    if (!app) {
      setLoading(false);
      return;
    }

    const auth = getAuth(app);
    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null);
      setLoading(false);
      hasLoadedUserDataRef.current = false;
      if (!user) {
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
        setHeldTickets([]);
        setCashSessions([]);
        setTaxSettings(defaultTaxSettings);
        setReceiptSettings(defaultReceiptSettings);
      }
    });
  }, []);

  const loadUserData = useCallback(async () => {
      if (!authUser) return false;
      const applyRetailCollections = (data?: Record<string, unknown>) => {
        setCustomers(normalizeCustomers(data?.customers));
        setHeldTickets(normalizeHeldTickets(data?.heldTickets));
        setCashSessions(normalizeCashSessions(data?.cashSessions));
        setTaxSettings(normalizeTaxSettings(data?.taxSettings));
        setReceiptSettings(normalizeReceiptSettings(data?.receiptSettings));
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
            setAccounts(ensureDefaultCashAccount([]));
            setShopTimeSettings({ timezoneOffsetMinutes: 0, dayStartTime: '00:00' });
            applyRetailCollections();
          } else {
            setBranches(Array.isArray(data.branches) ? data.branches as Branch[] : []);
            setProducts(Array.isArray(data.products) ? data.products as Product[] : []);
            setServices(Array.isArray(data.services) ? data.services as Service[] : []);
            setSales(Array.isArray(data.sales) ? data.sales as Sale[] : []);
            setExpenses(Array.isArray(data.expenses) ? data.expenses as Expense[] : []);
            setExpenseGroups(Array.isArray(data.expenseGroups) ? data.expenseGroups as ExpenseGroup[] : []);
            setUsers(Array.isArray(data.users) ? data.users as StaffUser[] : []);
            setActivityLogs(Array.isArray(data.activityLogs) ? data.activityLogs as ActivityLog[] : []);
            setAccounts(ensureDefaultCashAccount(Array.isArray(data.accounts) ? data.accounts as Account[] : []));
            const time = data.shopTimeSettings as Partial<ShopTimeSettings> | undefined;
            setShopTimeSettings({
              timezoneOffsetMinutes: typeof time?.timezoneOffsetMinutes === 'number' ? time.timezoneOffsetMinutes : 0,
              dayStartTime: typeof time?.dayStartTime === 'string' ? time.dayStartTime : '00:00',
            });
            applyRetailCollections(data);
          }
          setRole('shop_owner');
          hasLoadedUserDataRef.current = true;
          isSwitchingShopRef.current = false;
          setStatus(`Counter ready at ${shopName}. Records stay on this device.`);
          return true;
        } catch (error) {
          setStatus(`Could not open the on-device counter: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return false;
        }
      }
      if (!db) return false;
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
        setAvailableShops(memberships);
        const selectedShopOwnerUid = activeShopOwnerUid || memberships[0].ownerUid;
        if (!activeShopOwnerUid) setActiveShopOwnerUid(selectedShopOwnerUid);
        const selectedShop = memberships.find((s) => s.ownerUid === selectedShopOwnerUid);
        const userDataRef = doc(db, 'users', selectedShopOwnerUid, 'pos', 'data');
        const snap = await getDoc(userDataRef);
        if (!snap.exists()) {
          const defaultBranch = { id: crypto.randomUUID(), name: 'Main Branch', location: 'HQ', createdAt: new Date().toISOString() };
          setBranches([defaultBranch]);
          const defaultCashAccount = ensureDefaultCashAccount([]);
          setAccounts(defaultCashAccount);
          setExpenseGroups([]);
          setUsers([]);
          setActivityLogs([]);
          applyRetailCollections();
          setRole(selectedShop?.role || 'shop_owner');
          hasLoadedUserDataRef.current = true;
          isSwitchingShopRef.current = false;
          setStatus(`Viewing ${selectedShop?.shopName || 'selected shop'} as ${selectedShop?.role || role}.`);
          return true;
        }
        const data = snap.data();
        setBranches(Array.isArray(data.branches) ? data.branches : []);
        setProducts(Array.isArray(data.products) ? data.products : []);
        setServices(Array.isArray(data.services) ? data.services : []);
        setSales(Array.isArray(data.sales) ? data.sales : []);
        setExpenses(Array.isArray(data.expenses) ? data.expenses : []);
        setAccounts(ensureDefaultCashAccount(Array.isArray(data.accounts) ? data.accounts : []));
        setExpenseGroups(Array.isArray(data.expenseGroups) ? data.expenseGroups : []);
        setUsers(Array.isArray(data.users) ? data.users : []);
        setRole(selectedShop?.role || (data.role as Role) || 'shop_owner');
        setShopTimeSettings({
          timezoneOffsetMinutes: typeof data?.shopTimeSettings?.timezoneOffsetMinutes === 'number' ? data.shopTimeSettings.timezoneOffsetMinutes : 0,
          dayStartTime: typeof data?.shopTimeSettings?.dayStartTime === 'string' ? data.shopTimeSettings.dayStartTime : '00:00',
        });
        setActivityLogs(Array.isArray(data.activityLogs) ? data.activityLogs : []);
        applyRetailCollections(data as Record<string, unknown>);
        const storedShopName = typeof data.shopName === 'string' ? data.shopName.trim() : '';
        if (storedShopName && selectedShopOwnerUid === authUser.uid) {
          memberships[0] = { ...memberships[0], shopName: storedShopName };
          setAvailableShops([...memberships]);
        }
        hasLoadedUserDataRef.current = true;
        isSwitchingShopRef.current = false;
        setStatus(`Viewing ${selectedShop?.shopName || 'selected shop'} as ${selectedShop?.role || role}.`);
        return true;
      } catch (error) {
        setStatus(`Failed to load your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
      }
    }, [activeShopOwnerUid, authUser, db, role]);

  useEffect(() => {
    void loadUserData();
  }, [loadUserData]);

  const recalculateSystemData = useCallback((payload: { products: Product[]; services: Service[]; sales: Sale[]; expenses: Expense[] }) => {
    const productCostByName = new Map(payload.products.map((product) => [product.name.trim().toLowerCase(), product.purchasePrice]));
    const serviceCostByName = new Map(
      payload.services.map((service) => [
        service.name.trim().toLowerCase(),
        service.serviceType === 'shared_cost' ? 0 : service.directCost,
      ])
    );

    const recalculatedSales = payload.sales.map((sale) => {
      const itemKey = sale.itemName.trim().toLowerCase();
      const unitCost = sale.type === 'product' ? (productCostByName.get(itemKey) ?? 0) : (serviceCostByName.get(itemKey) ?? 0);
      return { ...sale, cost: unitCost * sale.qty };
    });

    const totalInventoryValue = payload.products.reduce((sum, product) => sum + product.stock * product.purchasePrice, 0);
    const monthlySharedCostTotal = payload.services
      .filter((service) => service.serviceType === 'shared_cost')
      .reduce((sum, service) => sum + service.monthlySharedCost, 0);
    const totalExpenseValue = payload.expenses.reduce((sum, expense) => sum + expense.amount, 0);

    return {
      sales: recalculatedSales,
      stats: {
        totalInventoryValue,
        monthlySharedCostTotal,
        totalExpenseValue,
      },
    };
  }, []);

  const handleDashboardRefresh = async () => {
    if (!authUser || !db || isRefreshingDashboard) return;
    setIsRefreshingDashboard(true);
    try {
      const didRefresh = await loadUserData();
      if (!didRefresh) return;

      const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');
      const freshSnap = await getDoc(userDataRef);
      if (!freshSnap.exists()) {
        showNotification('No stored records found for this shop yet.', 'info');
        return;
      }

      const data = freshSnap.data();
      const latestProducts = Array.isArray(data.products) ? (data.products as Product[]) : [];
      const latestServices = Array.isArray(data.services) ? (data.services as Service[]) : [];
      const latestSales = Array.isArray(data.sales) ? (data.sales as Sale[]) : [];
      const latestExpenses = Array.isArray(data.expenses) ? (data.expenses as Expense[]) : [];

      const recalculated = recalculateSystemData({
        products: latestProducts,
        services: latestServices,
        sales: latestSales,
        expenses: latestExpenses,
      });

      setProducts(latestProducts);
      setServices(latestServices);
      setExpenses(latestExpenses);
      setSales(recalculated.sales);

      await setDoc(
        userDataRef,
        removeUndefinedDeep({
          products: latestProducts,
          services: latestServices,
          expenses: latestExpenses,
          sales: recalculated.sales,
          recalculatedAt: serverTimestamp(),
          recalculatedSummary: recalculated.stats,
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      );

      showNotification('Dashboard fully recalculated and updated successfully.', 'success');
      setStatus('Dashboard recalculated from source data and synced to database.');
    } catch (error) {
      showNotification('Dashboard update failed. Please retry.', 'error');
      setStatus(`Dashboard recalculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRefreshingDashboard(false);
    }
  };

  useEffect(() => {
    const saveUserData = async () => {
      if (!authUser || !hasLoadedUserDataRef.current || !activeShopOwnerUid || isSwitchingShopRef.current) return;
      if (authUser.uid !== LOCAL_OPERATOR_ID && !db) return;
      try {
        const shopPayload = {
          role,
          shopName: currentShop?.shopName || 'My Shop',
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
          heldTickets,
          cashSessions,
          taxSettings,
          receiptSettings,
        };
        if (authUser.uid === LOCAL_OPERATOR_ID) {
          writeLocalShop(removeUndefinedDeep(shopPayload));
          return;
        }
        if (!db) return;
        const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');
        await setDoc(userDataRef, removeUndefinedDeep({
          ...shopPayload,
          updatedAt: serverTimestamp(),
        }), { merge: true });
      } catch (error) {
        setStatus(`Failed to auto-save your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    void saveUserData();
  }, [activeShopOwnerUid, authUser, db, role, branches, products, services, sales, expenses, expenseGroups, users, activityLogs, shopTimeSettings, accounts, customers, heldTickets, cashSessions, taxSettings, receiptSettings, currentShop?.shopName]);

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
    try {
      await signInWithPopup(auth, provider);
      setStatus('Logged in successfully!');
    } catch (error) {
      setStatus(`Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleLogout = async () => {
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
    setCustomers([]);
    setHeldTickets([]);
    setCashSessions([]);
    setTaxSettings(defaultTaxSettings);
    setReceiptSettings(defaultReceiptSettings);
    setCartDiscount({ mode: 'none', value: 0 });
    setBranchForm({ name: '', location: '', id: '' });
    setProductForm({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0, sku: '', barcode: '', category: '' });
    setStockAdjustmentForm({ productId: '', direction: 'add', quantity: 1, reason: 'restock', note: '', supplierName: '', reference: '', unitCost: '' });
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
    setActiveShopOwnerUid(nextOwnerUid);
    setStatus('Switching shop...');
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

    return { revenue, taxCollected, cost: cost + sharedServiceCost, expenseTotal, grossProfit, netProfit, salesCount: periodSales.length };
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
      }
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
      d.setHours(0, 0, 0, 0);
      d.setDate(today.getDate() - (insightTrendRange - 1 - idx));
      const key = d.toISOString().slice(0, 10);
      return { date: key, revenue: 0 };
    });
    const trendMap = new Map(trendDays.map((item) => [item.date, item]));

    sales.forEach((sale) => {
      const key = new Date(sale.createdAt).toISOString().slice(0, 10);
      const bucket = trendMap.get(key);
      if (bucket) bucket.revenue += sale.amount;
    });

    const maxRevenue = trendDays.reduce((max, day) => Math.max(max, day.revenue), 0);
    const totalRevenue = trendDays.reduce((acc, day) => acc + day.revenue, 0);
    const averageRevenue = trendDays.length > 0 ? totalRevenue / trendDays.length : 0;
    const points = trendDays
      .map((day, idx) => {
        const x = trendDays.length === 1 ? 0 : (idx / (trendDays.length - 1)) * 100;
        const y = maxRevenue > 0 ? 100 - (day.revenue / maxRevenue) * 100 : 100;
        return `${x},${y}`;
      })
      .join(' ');

    const areaPoints = `0,100 ${points} 100,100`;
    const yTicks = [1, 0.75, 0.5, 0.25, 0].map((factor) => {
      const y = (1 - factor) * 100;
      return { y, value: maxRevenue * factor };
    });

    const xTicks = trendDays.map((day, index) => {
      const x = trendDays.length === 1 ? 0 : (index / (trendDays.length - 1)) * 100;
      return { x, label: day.date.slice(5) };
    });

    return { mostSold, topRevenue, trendDays, maxRevenue, points, areaPoints, yTicks, xTicks, totalRevenue, averageRevenue, trendMap };
  }, [insightTrendRange, sales]);

  // Filtered products for inventory
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const query = productSearchQuery.trim().toLowerCase();
      const matchesSearch = [p.name, p.sku, p.barcode, p.category].some((value) => value?.toLowerCase().includes(query));
      const matchesBranch = !productBranchFilter || p.branchId === productBranchFilter;
      const matchesStock = 
        productStockFilter === 'all' ? true :
        productStockFilter === 'low' ? p.stock < 10 && p.stock > 0 :
        p.stock === 0;
      return matchesSearch && matchesBranch && matchesStock;
    });
  }, [products, productSearchQuery, productBranchFilter, productStockFilter]);

  const recentStockMovements = useMemo(() => activityLogs
    .filter((log): log is ActivityLog & { stockMovement: StockMovementAudit } => Boolean(log.stockMovement))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 100), [activityLogs]);

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
    }, ...prev].slice(0, 500));
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

  const saveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const name = productForm.name.trim();
    const sku = productForm.sku.trim().toUpperCase();
    const barcode = productForm.barcode.trim();
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
    const productDetails = { ...productForm, name, sku: sku || undefined, barcode: barcode || undefined, category: productForm.category.trim() || undefined };
    if (productForm.id) {
      const previousProduct = products.find((product) => product.id === productForm.id);
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
    setProductForm({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0, sku: '', barcode: '', category: '' });
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
  };

  const sellService = (serviceId: string) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) {
      showNotification('Service not found', 'error');
      return;
    }
    if (!selectedSaleAccountId) {
      showNotification('Please create an account first (CASH is created by default).', 'error');
      return;
    }
    const serviceQuote = settleCart([{
      key: service.id,
      unitPrice: service.salePrice,
      qty: 1,
      effectiveUnitPrice: service.salePrice,
      unitCost: service.serviceType === 'direct_cost' ? service.directCost : 0,
    }], { mode: 'none', value: 0 }, taxSettings);
    const serviceLine = serviceQuote.lines[0];
    const newSale: Sale = {
      id: crypto.randomUUID(),
      type: 'service',
      itemName: service.name,
      branchId: service.branchId,
      qty: 1,
      amount: serviceLine?.amount ?? service.salePrice,
      cost: serviceLine?.cost ?? (service.serviceType === 'direct_cost' ? service.directCost : 0),
      taxAmount: serviceLine?.taxAmount,
      discountAmount: serviceLine?.discountAmount,
      accountId: selectedSaleAccountId,
      receiptNumber: nextDocumentNumber(sales, receiptPrefix(new Date(), 'sale')),
      saleKind: 'sale',
      ...(openCashSession ? { cashSessionId: openCashSession.id } : {}),
      ...createCheckoutMetadata(),
      ...currentAuditStamp(),
    };
    setSales((prev) => [newSale, ...prev]);
    logActivity('sale', `Sold service "${service.name}"`);
    showNotification(`${service.name} sold successfully`, 'success');
    setCheckoutDetails({ customerName: '', customerPhone: '', paymentMethod: 'cash', paymentReference: '' });
  };


  const expenseGroupMap = useMemo(() => Object.fromEntries(expenseGroups.map((g) => [g.id, g.name])), [expenseGroups]);
  const defaultAccount = useMemo(() => accounts.find((account) => account.isDefault) || accounts[0], [accounts]);
  const selectedSaleAccountId = useMemo(() => {
    if (saleAccountId && accounts.some((account) => account.id === saleAccountId)) return saleAccountId;
    return defaultAccount?.id;
  }, [accounts, defaultAccount?.id, saleAccountId]);
  const accountMap = useMemo(() => Object.fromEntries(accounts.map((account) => [account.id, account.name])), [accounts]);
  const accountBalances = useMemo(() => {
    const balances = new Map<string, number>();
    accounts.forEach((account) => balances.set(account.id, account.openingBalance || 0));
    sales.forEach((sale) => {
      const accountId = sale.accountId || defaultAccount?.id;
      if (!accountId) return;
      balances.set(accountId, (balances.get(accountId) || 0) + sale.amount);
    });
    expenses.forEach((expense) => {
      const accountId = expense.accountId || defaultAccount?.id;
      if (!accountId) return;
      balances.set(accountId, (balances.get(accountId) || 0) - expense.amount);
    });
    return balances;
  }, [accounts, defaultAccount?.id, expenses, sales]);
  const openCashSession = useMemo(() => cashSessions.find((session) => session.status === 'open') || null, [cashSessions]);
  const sessionExpectedCash = openCashSession ? openCashSession.openingFloat + sessionCashTaken(sales, openCashSession.id) : 0;
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
    const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
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
      setExpenses((prev) => [...prev, { ...expenseForm, accountId: selectedAccountId, id: crypto.randomUUID(), ...currentAuditStamp() }]);
      setStatus('Expense recorded.');
      logActivity('add_expense', `Added expense "${expenseForm.title}"`);
    }
    setExpenseForm({ id: '', title: '', branchId: '', amount: 0, expenseGroupId: '', accountId: defaultAccount?.id || '' });
    setShowExpenseModal(false);
  };

  const saveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.email || !userForm.name || !userForm.branchId) return;

    if (userForm.id) {
      setUsers((prev) => prev.map((u) => (u.id === userForm.id ? { ...u, ...userForm, ...updatedAuditStamp() } : u)));
      setStatus('User updated.');
      logActivity('edit_user', `Updated user "${userForm.email}"`);
    } else {
      const newUser: StaffUser = {
        id: crypto.randomUUID(),
        name: userForm.name,
        email: userForm.email,
        role: userForm.role,
        branchId: userForm.branchId,
        ...currentAuditStamp(),
      };
      setUsers((prev) => [...prev, newUser]);
      logActivity('add_user', `Added user "${userForm.email}" with role "${userForm.role}"`);

      // Save shop membership for email-based invitation
      if (db) {
        const normalizedEmail = userForm.email.toLowerCase().trim();
        const shopMembershipRef = doc(db, 'shopMemberships', `${activeShopOwnerUid}_${normalizedEmail}`);
        setDoc(shopMembershipRef, {
          ownerUid: activeShopOwnerUid,
          email: normalizedEmail,
          shopName: availableShops.find(s => s.ownerUid === activeShopOwnerUid)?.shopName || 'My Shop',
          role: userForm.role,
          invitedAt: serverTimestamp(),
        }, { merge: true }).catch(err => console.error('Failed to save membership:', err));
      }
      setStatus(`Invitation sent to ${userForm.email}`);
    }
    setUserForm({ id: '', name: '', email: '', role: 'cashier', branchId: '' });
    setShowUserModal(false);
  };

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
    logActivity('sale', `Completed ${receiptNumber} for ${formatUGX(registerQuote.total)} (${cart.length} item(s)).`);
    setActiveReceipt(receiptFromSaleLines(newSales, 'sale'));
    clearRegister();
    showNotification(`${receiptNumber} completed.`, 'success');
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
    setStockAdjustmentForm({ productId, direction: 'add', quantity: 1, reason: 'restock', note: '', supplierName: '', reference: '', unitCost: '' });
    setShowStockAdjustmentModal(true);
  };

  const saveStockAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
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
      ...(stockAdjustmentForm.supplierName.trim() ? { supplierName: stockAdjustmentForm.supplierName.trim() } : {}),
      ...(stockAdjustmentForm.reference.trim() ? { reference: stockAdjustmentForm.reference.trim() } : {}),
      ...(unitCost !== undefined ? { unitCost } : {}),
    } : undefined;
    const receiptNote = stockAdjustmentForm.reason === 'restock' ? [
      stockAdjustmentForm.supplierName.trim() ? `Supplier: ${stockAdjustmentForm.supplierName.trim()}` : '',
      stockAdjustmentForm.reference.trim() ? `Reference: ${stockAdjustmentForm.reference.trim()}` : '',
      unitCost !== undefined ? `Unit cost: ${formatUGX(unitCost)}` : '',
    ].filter(Boolean).join(' · ') : '';
    const movementNote = [stockAdjustmentForm.note.trim(), receiptNote].filter(Boolean).join(' | ');
    setProducts((prev) => prev.map((item) => item.id === product.id ? {
      ...item,
      stock: item.stock + quantityDelta,
      ...(stockAdjustmentForm.reason === 'restock' && unitCost !== undefined ? { purchasePrice: unitCost } : {}),
      ...updatedAuditStamp(),
    } : item));
    logStockMovement(product, quantityDelta, stockAdjustmentForm.reason, movementNote, undefined, receiptMetadata);
    setStatus(`Stock adjusted for ${product.name}.`);
    showNotification(`${product.name}: ${quantityDelta > 0 ? '+' : ''}${quantityDelta} units recorded.`, 'success');
    setShowStockAdjustmentModal(false);
    setStockAdjustmentForm({ productId: '', direction: 'add', quantity: 1, reason: 'restock', note: '', supplierName: '', reference: '', unitCost: '' });
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

  const productsPagination = paginateData(filteredProducts, productsPage, setProductsPage);
  const servicesPagination = paginateData(services, servicesPage, setServicesPage);
  const expensesPagination = paginateData(filteredExpenses, expensesPage, setExpensesPage);
  const usersPagination = paginateData(users, usersPage, setUsersPage);
  const reportsSalesPagination = paginateData(sales, reportsSalesPage, setReportsSalesPage);
  const activityLogsPagination = paginateData(activityLogs, activityLogsPage, setActivityLogsPage);

  const PaginationControls = ({ totalItems, totalPages, page, start, end, onPrevious, onNext }: { totalItems: number; totalPages: number; page: number; start: number; end: number; onPrevious: () => void; onNext: () => void }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Showing {totalItems === 0 ? 0 : start + 1}–{end} of {totalItems}
      </span>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="edit-btn" disabled={page <= 1} onClick={onPrevious}>Previous</button>
        <span style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Page {page} / {totalPages}</span>
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
    setSales((prev) => prev.filter((sale) => !ids.includes(sale.id)));
    logActivity('delete_sale', `Deleted ${ids.length} line(s) from a receipt. Stock was not changed.`);
    showNotification('Receipt deleted. Stock was not changed.', 'success');
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
      heldTickets,
      cashSessions,
      taxSettings,
      receiptSettings,
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
      const restoredProducts = Array.isArray(parsed.data.products) ? parsed.data.products : [];
      const restoredServices = Array.isArray(parsed.data.services) ? parsed.data.services : [];
      const restoredSales = Array.isArray(parsed.data.sales) ? parsed.data.sales : [];
      const restoredExpenses = Array.isArray(parsed.data.expenses) ? parsed.data.expenses : [];
      const restoredExpenseGroups = Array.isArray(parsed.data.expenseGroups) ? parsed.data.expenseGroups : [];
      const restoredUsers = Array.isArray(parsed.data.users) ? parsed.data.users : [];
      const restoredActivityLogs = Array.isArray(parsed.data.activityLogs) ? parsed.data.activityLogs : [];
      const restoredShopTimeSettings = parsed.data.shopTimeSettings && typeof parsed.data.shopTimeSettings.dayStartTime === 'string'
        ? parsed.data.shopTimeSettings
        : { timezoneOffsetMinutes: 0, dayStartTime: '00:00' };
      const restoredAccounts = ensureDefaultCashAccount(Array.isArray(parsed.data.accounts) ? parsed.data.accounts : []);
      const restoredCustomers = normalizeCustomers(parsed.data.customers);
      const restoredHeldTickets = normalizeHeldTickets(parsed.data.heldTickets);
      const restoredCashSessions = normalizeCashSessions(parsed.data.cashSessions);
      const restoredTaxSettings = normalizeTaxSettings(parsed.data.taxSettings);
      const restoredReceiptSettings = normalizeReceiptSettings(parsed.data.receiptSettings);
      const restoredShopName = parsed.shopName?.trim() || currentShop?.shopName || 'Restored Shop';

      const restoredLog: ActivityLog = {
        id: crypto.randomUUID(),
        action: 'backup_restore',
        details: `Restored full shop backup from ${file.name}`,
        role,
        userEmail: authUser.email || 'Unknown user',
        createdAt: new Date().toISOString(),
      };
      const nextActivityLogs = [restoredLog, ...restoredActivityLogs].slice(0, 100);
      const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');

      await setDoc(userDataRef, removeUndefinedDeep({
        role: 'shop_owner' as Role,
        shopName: restoredShopName,
        branches: restoredBranches,
        products: restoredProducts,
        services: restoredServices,
        sales: restoredSales,
        expenses: restoredExpenses,
        expenseGroups: restoredExpenseGroups,
        users: restoredUsers,
        activityLogs: nextActivityLogs,
        shopTimeSettings: restoredShopTimeSettings,
        accounts: restoredAccounts,
        customers: restoredCustomers,
        heldTickets: restoredHeldTickets,
        cashSessions: restoredCashSessions,
        taxSettings: restoredTaxSettings,
        receiptSettings: restoredReceiptSettings,
        restoredFromBackupAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }), { merge: true });

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
      setHeldTickets(restoredHeldTickets);
      setCashSessions(restoredCashSessions);
      setTaxSettings(restoredTaxSettings);
      setReceiptSettings(restoredReceiptSettings);
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
    <span className={`badge ${value >= 0 ? 'badge-success' : 'badge-danger'}`}>
      {value >= 0 ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  );


  if (loading) return <div className="auth-container"><div className="status">Loading AlphaPOS...</div></div>;
  if (!authUser) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <span className="auth-badge">Retail counter</span>
          <h1>AlphaPOS</h1>
          <p>Sell, take payment, print a receipt, and keep stock in one counter.</p>
          <ul className="auth-highlights">
            <li>Barcode register with hold, split payment, and change</li>
            <li>Tax, cash drawer, returns, and customer accounts</li>
            <li>Inventory, expenses, staff, and branch reporting</li>
            <li>Google sign-in for shared shops, or this device when Firebase is not configured</li>
          </ul>
          {firebaseApp ? (
            <button className="primary" style={{ width: '100%', padding: '1rem' }} onClick={handleLogin}>Sign in with Google</button>
          ) : (
            <>
              <p className="auth-local-note">No Firebase project is configured. The counter will keep this shop in this browser only.</p>
              <button className="primary" style={{ width: '100%', padding: '1rem' }} onClick={startLocalCounter}>Open the counter</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className={`sidebar-overlay ${isSidebarOpen ? 'show' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2><span className="brand-mark" aria-hidden="true">A</span> AlphaPOS</h2>
          <div className="sidebar-subtitle">Point of sale · Operations</div>
        </div>

        <div className="sidebar-section">
          <label className="role-label">Active Shop</label>
          <select className="role-select" value={activeShopOwnerUid} onChange={(e) => handleShopSwitch(e.target.value)}>
            {availableShops.map((s) => (
              <option key={s.ownerUid} value={s.ownerUid}>
                {truncateShopName(s.shopName, 22)} · {roleLabels[s.role]}
              </option>
            ))}
          </select>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-label">Overview</div>
          <button className={`nav-button ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">◫</span><span>Dashboard</span></button>

          <div className="nav-group-label">Sell</div>
          <button className={`nav-button ${view === 'sales' ? 'active' : ''}`} onClick={() => { setView('sales'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">▣</span><span>Register</span></button>
          <button className={`nav-button ${view === 'sales_history' ? 'active' : ''}`} onClick={() => { setView('sales_history'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">≡</span><span>Sales History</span></button>
          <button className={`nav-button ${view === 'customers' ? 'active' : ''}`} onClick={() => { setView('customers'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">☺</span><span>Customers</span></button>
          <div className="nav-group-label">Stock</div>
          <button className={`nav-button ${view === 'products' ? 'active' : ''}`} onClick={() => { setView('products'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">□</span><span>Inventory</span></button>
          <button className={`nav-button ${view === 'services' ? 'active' : ''}`} onClick={() => { setView('services'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">✦</span><span>Services</span></button>

          <div className="nav-group-label">Management</div>
          <button className={`nav-button ${view === 'expenses' ? 'active' : ''}`} onClick={() => { setView('expenses'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">−</span><span>Expenses</span></button>
          <button className={`nav-button ${view === 'users' ? 'active' : ''}`} onClick={() => { setView('users'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">◎</span><span>Staff</span></button>
          <button className={`nav-button ${view === 'activity_logs' ? 'active' : ''}`} onClick={() => { setView('activity_logs'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">⌘</span><span>Activity Logs</span></button>
          <button className={`nav-button ${view === 'reports' ? 'active' : ''}`} onClick={() => { setView('reports'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">▤</span><span>Reports</span></button>
          <button className={`nav-button ${view === 'accounts' ? 'active' : ''}`} onClick={() => { setView('accounts'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">⌁</span><span>Accounts</span></button>
          {isShopOwner && <button className={`nav-button ${view === 'settings' ? 'active' : ''}`} onClick={() => { setView('settings'); setIsSidebarOpen(false); }}><span className="nav-icon" aria-hidden="true">⚙</span><span>Settings</span></button>}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <button onClick={() => setView('profile')} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
              <div>{authUser.displayName}</div>
              <div style={{ opacity: 0.6 }}>{authUser.email}</div>
            </button>
          </div>
          <button className="logout-button" onClick={handleLogout}>Sign Out</button>
        </div>

        {notification && (
          <div className={`notification-toast ${notification.type}`}>
            <div className="notification-content">
              <span className="notification-icon">
                {notification.type === 'success' ? '✅' : notification.type === 'error' ? '❌' : 'ℹ️'}
              </span>
              <span className="notification-message">{notification.message}</span>
            </div>
            <button className="notification-close" onClick={() => setNotification(null)}>✕</button>
          </div>
        )}
      </aside>

      <main className={`main${view === 'sales' ? ' main-register' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
        <header className="main-header" style={{ padding: 'var(--space-lg) var(--space-xl)', margin: '0 0 var(--space-xl) 0', borderBottom: '1px solid var(--border)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <button className="mobile-menu-toggle" onClick={() => setIsSidebarOpen(true)}>☰</button>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {view === 'dashboard' ? 'Dashboard overview' :
               view === 'sales' ? 'Register' :
               view === 'sales_history' ? 'Sales history' :
               view === 'customers' ? 'Customers' :
               view === 'products' ? 'Inventory management' :
               view === 'services' ? 'Service catalog' :
               view === 'expenses' ? 'Expense tracking' :
               view === 'users' ? 'Staff management' :
               view === 'activity_logs' ? 'Activity logs' :
               view === 'reports' ? 'Business reports' :
               view === 'accounts' ? 'Accounts' :
               view === 'settings' ? 'System settings' :
               view.charAt(0).toUpperCase() + view.slice(1)}
            </h1>
          </div>
          <div className="status-container" style={{ margin: 0 }}>
            <span className="status" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>{status}</span>
          </div>
        </header>

        {view === 'dashboard' && (
          <section>
            {/* Dashboard Period Selector */}
            <div className="dashboard-controls">
              <div className="filter-group">
                <label>Time Period</label>
                <select 
                  value={dashboardPeriod} 
                  onChange={(e) => setDashboardPeriod(e.target.value as DashboardPeriod)}
                  className="period-select"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <button className="dashboard-refresh-btn" onClick={handleDashboardRefresh} disabled={isRefreshingDashboard}>
                <span className="refresh-btn-icon" aria-hidden="true">{isRefreshingDashboard ? '⏳' : '🧮'}</span>
                <span>{isRefreshingDashboard ? 'Refreshing data…' : 'Refresh Data'}</span>
              </button>
            </div>

            {/* KPI Cards Grid */}
            <div className="grid dashboard-metrics-grid">
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">💵</span>
                <h4>Sales ({dashboardPeriod})</h4>
                <div className="card-value">{formatUGX(dashboardMetrics.sales.value)}</div>
                <Badge value={dashboardMetrics.sales.change} />
              </div>
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">💰</span>
                <h4>Expenses ({dashboardPeriod})</h4>
                <div className="card-value">{formatUGX(dashboardMetrics.expenses.value)}</div>
                <Badge value={dashboardMetrics.expenses.change} />
              </div>
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">📈</span>
                <h4>Net Profit ({dashboardPeriod})</h4>
                <div className="card-value" style={{ color: 'var(--success)' }}>{formatUGX(dashboardMetrics.netProfit.value)}</div>
                <Badge value={dashboardMetrics.netProfit.change} />
              </div>
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">％</span>
                <h4>Tax ({dashboardPeriod})</h4>
                <div className="card-value">{formatUGX(dashboardMetrics.tax.value)}</div>
                <span className="badge badge-info">{taxSettings.enabled ? taxSettings.name : 'Not configured'}</span>
              </div>
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">📦</span>
                <h4>Products in Stock</h4>
                <div className="card-value">{dashboardMetrics.products}</div>
                <span className="badge badge-info">Total Items</span>
              </div>
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">📊</span>
                <h4>Gross Profit ({dashboardPeriod})</h4>
                <div className="card-value">{formatUGX(dashboardMetrics.grossProfit.value)}</div>
                <Badge value={dashboardMetrics.grossProfit.change} />
              </div>
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">🏦</span>
                <h4>Default Account</h4>
                <div className="card-value">{defaultAccount?.name || 'No Account'}</div>
                <span className="badge badge-info">{formatUGX(defaultAccount ? (accountBalances.get(defaultAccount.id) || 0) : 0)}</span>
              </div>
              <div className="card dashboard-card">
                <span className="dashboard-card-icon" aria-hidden="true">🎯</span>
                <h4>Transactions ({dashboardPeriod})</h4>
                <div className="card-value">{sales.filter(s => {
                  const d = new Date(s.createdAt);
                  const now = new Date();
                  if (dashboardPeriod === 'daily') return d.toDateString() === now.toDateString();
                  if (dashboardPeriod === 'weekly') return d.getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
                  if (dashboardPeriod === 'monthly') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                  return d.getFullYear() === now.getFullYear();
                }).length}</div>
                <span className="badge badge-success">Total</span>
              </div>
            </div>

            <div className="card insight-card">
              <div className="insight-header-row">
                <h3 className="insight-title">📌 Insights</h3>
                <div className="insight-actions">
                  <div className="filter-group insight-filter-group">
                    <label>Sales Trend Window</label>
                    <select value={insightTrendRange} onChange={(e) => setInsightTrendRange(Number(e.target.value) as InsightTrendRange)}>
                      <option value={7}>Last 7 days</option>
                      <option value={14}>Last 14 days</option>
                      <option value={30}>Last 30 days</option>
                      <option value={60}>Last 60 days</option>
                      <option value={100}>Last 100 days</option>
                    </select>
                  </div>
                  <button className="dashboard-refresh-btn" onClick={handleDashboardRefresh} disabled={isRefreshingDashboard}>
                    <span className="refresh-btn-icon" aria-hidden="true">{isRefreshingDashboard ? '⏳' : '🔄'}</span>
                    <span>{isRefreshingDashboard ? 'Refreshing…' : 'Refresh Insights'}</span>
                  </button>
                </div>
              </div>

              <div className="insight-stats-grid">
                <div>
                  <h4>1) Most sold product/service</h4>
                  {dashboardInsights.mostSold.length > 0 ? (
                    <div className="insight-list">
                      {dashboardInsights.mostSold.map((item, i) => (
                        <p key={i} className="insight-list-item">
                          <span className="insight-list-rank">#{i+1}</span>
                          <strong>{item.name}</strong> <span className="insight-list-type">({item.type})</span> — {item.qty} units
                        </p>
                      ))}
                    </div>
                  ) : <p style={{ margin: 0 }}>No sales data yet.</p>}
                </div>
                <div>
                  <h4>2) Product/service with most revenue</h4>
                  {dashboardInsights.topRevenue.length > 0 ? (
                    <div className="insight-list">
                      {dashboardInsights.topRevenue.map((item, i) => (
                        <p key={i} className="insight-list-item">
                          <span className="insight-list-rank">#{i+1}</span>
                          <strong>{item.name}</strong> <span className="insight-list-type">({item.type})</span> — {formatUGX(item.revenue)}
                        </p>
                      ))}
                    </div>
                  ) : <p style={{ margin: 0 }}>No revenue data yet.</p>}
                </div>
              </div>

              <div className="insight-trend-section">
                <div className="insight-trend-header">
                  <h4 className="insight-trend-title">3) Sales trend (last {insightTrendRange} days)</h4>
                  <div className="insight-legend">
                    <div className="insight-legend-item">
                      <div className="insight-legend-dot"></div>
                      <span>Daily Revenue</span>
                    </div>
                  </div>
                </div>
                <div className="insight-trend-chart">
                  <svg viewBox="-14 0 122 116" preserveAspectRatio="xMidYMid meet" aria-label={`Sales trend for last ${insightTrendRange} days`}>
                    {/* Grid lines + y-axis labels */}
                    {dashboardInsights.yTicks.map((tick, idx) => (
                      <g key={idx}>
                        <line x1="0" y1={tick.y} x2="100" y2={tick.y} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,2" />
                        <text x="-1" y={tick.y + 1.5} textAnchor="end" className="trend-axis-label">
                          {formatUGX(tick.value)}
                        </text>
                      </g>
                    ))}
                    <line x1="0" y1="100" x2="100" y2="100" stroke="var(--text-muted)" strokeWidth="0.6" />
                    <line x1="0" y1="0" x2="0" y2="100" stroke="var(--text-muted)" strokeWidth="0.6" />

                    <polygon points={dashboardInsights.areaPoints} fill="url(#trendFill)" />
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--info)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="var(--info)" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    <polyline points={dashboardInsights.points} fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    {/* Data points */}
                    {dashboardInsights.points.split(' ').map((p, i) => {
                      const [x, y] = p.split(',');
                      const day = dashboardInsights.trendDays[i];
                      return (
                        <circle key={i} cx={x} cy={y} r="1.5" fill="var(--bg)" stroke="var(--info)" strokeWidth="1">
                          <title>{`${day?.date || ''}: ${formatUGX(day?.revenue || 0)}`}</title>
                        </circle>
                      );
                    })}

                    {dashboardInsights.xTicks.map((tick, idx) => (
                      <text key={idx} x={tick.x} y="108.5" textAnchor={idx === 0 ? 'start' : idx === dashboardInsights.xTicks.length - 1 ? 'end' : 'middle'} className="trend-axis-label">
                        {tick.label}
                      </text>
                    ))}
                    <text x="50" y="114" textAnchor="middle" className="trend-axis-title">Date</text>
                    <text x="-12" y="50" textAnchor="middle" transform="rotate(-90 -12 50)" className="trend-axis-title">Revenue (UGX)</text>
                  </svg>
                </div>
                <div className="insight-trend-footer">
                  <p className="insight-trend-meta">Peak day: <strong>{formatUGX(dashboardInsights.maxRevenue)}</strong></p>
                  <p className="insight-trend-meta">Total window revenue: <strong>{formatUGX(dashboardInsights.totalRevenue)}</strong></p>
                  <p className="insight-trend-meta insight-trend-meta-muted">Average/day: <strong>{formatUGX(dashboardInsights.averageRevenue)}</strong></p>
                </div>
              </div>
            </div>

          </section>
        )}

        {view === 'products' && (
          <section>
            <div className="page-header">
              <h2>Product Inventory</h2>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button className="edit-btn" disabled={products.length === 0} onClick={() => {
                  setStockAdjustmentForm({ productId: '', direction: 'add', quantity: 1, reason: 'restock', note: '', supplierName: '', reference: '', unitCost: '' });
                  setShowStockAdjustmentModal(true);
                }}>Receive stock</button>
                <button className="primary" onClick={() => { setProductForm({ id: '', name: '', branchId: branches[0]?.id || '', stock: 0, purchasePrice: 0, salePrice: 0, sku: '', barcode: '', category: '' }); setShowProductModal(true); }}>
                  + Add Product
                </button>
              </div>
            </div>

            {/* Inventory Search & Filter */}
            <div className="filter-bar inventory-filter-bar">
              <div className="filter-group">
                <label>Search Product</label>
                <input 
                  type="text" 
                  placeholder="Search name, category, SKU or barcode..."
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <label>Branch</label>
                <select 
                  value={productBranchFilter}
                  onChange={(e) => setProductBranchFilter(e.target.value)}
                >
                  <option value="">All Branches</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label>Stock Status</label>
                <select 
                  value={productStockFilter}
                  onChange={(e) => setProductStockFilter(e.target.value as 'all' | 'low' | 'out')}
                >
                  <option value="all">All Products</option>
                  <option value="low">Low Stock (1-9)</option>
                  <option value="out">Out of Stock</option>
                </select>
              </div>
              <button className="edit-btn" onClick={() => { setProductSearchQuery(''); setProductBranchFilter(''); setProductStockFilter('all'); }}>Reset Filters</button>
            </div>

            {/* Inventory Table */}

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU / Barcode</th>
                    <th>Branch</th>
                    <th>Stock</th>
                    <th>Purchase</th>
                    <th>Sale</th>
                    <th>Profit/Unit</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length > 0 ? (
                    productsPagination.rows.map((p) => (
                      <tr key={p.id} style={{ opacity: p.stock === 0 ? 0.6 : 1 }}>
                        <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                          {p.name}
                          {p.category && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 400 }}>{p.category}</div>}
                        </td>
                        <td>
                          <div>{p.sku || '—'}</div>
                          {p.barcode && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{p.barcode}</div>}
                        </td>
                        <td>{branchMap[p.branchId]}</td>
                        <td>
                          <span className={`badge ${p.stock === 0 ? 'badge-danger' : p.stock < 10 ? 'badge-warning' : 'badge-success'}`}>
                            {p.stock === 0 ? '❌ Out' : p.stock < 10 ? '⚠️ Low' : '✅ ' + p.stock}
                          </span>
                        </td>
                        <td>{formatUGX(p.purchasePrice)}</td>
                        <td>{formatUGX(p.salePrice)}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatUGX(p.salePrice - p.purchasePrice)}</td>
                        <td>
                          <button className="edit-btn" onClick={() => { setProductForm({ ...p, sku: p.sku || '', barcode: p.barcode || '', category: p.category || '' }); setShowProductModal(true); }}>Edit</button>
                          <button className="edit-btn" onClick={() => restockProduct(p.id)}>Adjust stock</button>
                          <button className="delete-btn" onClick={() => {
                            if (p.stock > 0) logStockMovement(p, -p.stock, 'product_removed', 'Product removed from inventory');
                            setProducts(prev => prev.filter(x => x.id !== p.id));
                            logActivity('delete_inventory', `Deleted product "${p.name}"`);
                          }}>Delete</button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No products found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card" style={{ marginTop: '1.25rem' }}>
              <div className="page-header" style={{ marginBottom: '0.85rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Recent stock activity</h3>
                  <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    Shows up to 100 movements from the latest 500 shop activity entries.
                  </p>
                </div>
              </div>
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
            </div>
            <PaginationControls
              totalItems={filteredProducts.length}
              totalPages={productsPagination.totalPages}
              page={productsPagination.safePage}
              start={productsPagination.start}
              end={productsPagination.end}
              onPrevious={() => setProductsPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setProductsPage((prev) => Math.min(productsPagination.totalPages, prev + 1))}
            />
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
            onCreateProduct={() => { setProductForm({ id: '', name: '', branchId: branches[0]?.id || '', stock: 0, purchasePrice: 0, salePrice: 0, sku: '', barcode: '', category: '' }); setShowProductModal(true); }}
          />
        )}

        {view === 'services' && (
          <section>
            <div className="page-header">
              <h2>Service Catalog</h2>
            </div>
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="field" style={{ maxWidth: '320px' }}>
                <label>Credit service sales to account</label>
                <select value={selectedSaleAccountId || ''} onChange={(e) => setSaleAccountId(e.target.value)}>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (Default)' : ''}</option>)}
                </select>
              </div>
              {renderCheckoutDetailsFields()}
            </div>
            <div className="card" style={{ marginBottom: '1rem' }}>
              <form onSubmit={saveService} style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
                <div className="field">
                  <label>Service Name</label>
                  <input type="text" value={serviceForm.name} onChange={(e) => setServiceForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Phone Repair" />
                </div>
                <div className="field">
                  <label>Branch</label>
                  <select value={serviceForm.branchId} onChange={(e) => setServiceForm((prev) => ({ ...prev, branchId: e.target.value }))}>
                    <option value="">Select Branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Price</label>
                  <input type="number" min={0} value={serviceForm.amount} onChange={(e) => setServiceForm((prev) => ({ ...prev, amount: Number(e.target.value) }))} />
                </div>
                <div className="field">
                  <label>Service Type</label>
                  <select value={serviceForm.serviceType} onChange={(e) => setServiceForm((prev) => ({ ...prev, serviceType: e.target.value as ServiceType }))}>
                    <option value="direct_cost">Direct Cost Service</option>
                    <option value="shared_cost">Shared Cost Service</option>
                  </select>
                </div>
                {serviceForm.serviceType === 'direct_cost' ? (
                  <div className="field">
                    <label>Direct Cost</label>
                    <input type="number" min={0} value={serviceForm.directCost} onChange={(e) => setServiceForm((prev) => ({ ...prev, directCost: Number(e.target.value) }))} />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label>Monthly Shared Cost</label>
                      <input type="number" min={0} value={serviceForm.monthlySharedCost} onChange={(e) => setServiceForm((prev) => ({ ...prev, monthlySharedCost: Number(e.target.value) }))} />
                    </div>
                    <div className="field">
                      <label>Expense Group (for auto-added expenses)</label>
                      <select value={serviceForm.expenseGroupId} onChange={(e) => setServiceForm((prev) => ({ ...prev, expenseGroupId: e.target.value }))}>
                        <option value="">Ungrouped</option>
                        {expenseGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <button className="primary" type="submit">Save Service</button>
              </form>
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
                      <td>{service.serviceType === 'direct_cost' ? 'Direct Cost' : 'Shared Cost'}</td>
                      <td>{formatUGX(service.salePrice)}</td>
                      <td>
                        {service.serviceType === 'direct_cost'
                          ? `Unit cost: ${formatUGX(service.directCost)}`
                          : `Monthly: ${formatUGX(service.monthlySharedCost)} | Weekly: ${formatUGX(service.monthlySharedCost / 4)} | Daily: ${formatUGX(service.monthlySharedCost / 30)}`}
                      </td>
                      <td>
                        <button className="edit-btn" onClick={() => setServiceForm({
                          name: service.name,
                          branchId: service.branchId,
                          amount: service.salePrice,
                          serviceType: service.serviceType || 'direct_cost',
                          directCost: service.directCost || 0,
                          monthlySharedCost: service.monthlySharedCost || 0,
                          expenseGroupId: service.expenseGroupId || ''
                        })}>Edit</button>
                        <button className="primary" onClick={() => sellService(service.id)}>Sell</button>
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
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No sales recorded for this period</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Showing {groupedSales.length === 0 ? 0 : (salesHistoryPage - 1) * salesHistoryPageSize + 1}–{Math.min(salesHistoryPage * salesHistoryPageSize, groupedSales.length)} of {groupedSales.length}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="edit-btn" disabled={salesHistoryPage <= 1} onClick={() => setSalesHistoryPage((prev) => Math.max(1, prev - 1))}>Previous</button>
                  <span style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Page {salesHistoryPage} / {salesHistoryTotalPages}</span>
                  <button className="edit-btn" disabled={salesHistoryPage >= salesHistoryTotalPages} onClick={() => setSalesHistoryPage((prev) => Math.min(salesHistoryTotalPages, prev + 1))}>Next</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === 'expenses' && (
          <section>
            <div className="page-header">
              <h2>💰 Expense Tracking</h2>
              <button className="primary" onClick={() => { setExpenseForm({ id: '', title: '', branchId: branches[0]?.id || '', amount: 0, expenseGroupId: '', accountId: defaultAccount?.id || '' }); setShowExpenseModal(true); }}>
                + Add Expense
              </button>
            </div>
            
            {/* Expense Summary */}
            {expenses.length > 0 && (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '2rem' }}>
                <div className="card">
                  <h4 style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, marginBottom: '0.5rem' }}>Total Expenses</h4>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>{formatUGX(expenses.reduce((sum, e) => sum + e.amount, 0))}</div>
                  <span className="badge badge-danger" style={{ marginTop: '0.5rem' }}>All Time</span>
                </div>
                <div className="card">
                  <h4 style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, marginBottom: '0.5rem' }}>This Month</h4>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>{formatUGX(expenses.filter(e => {
                    const d = new Date(e.createdAt);
                    const now = new Date();
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                  }).reduce((sum, e) => sum + e.amount, 0))}</div>
                  <span className="badge badge-warning" style={{ marginTop: '0.5rem' }}>Current Month</span>
                </div>
                <div className="card">
                  <h4 style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, marginBottom: '0.5rem' }}>Total Records</h4>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{expenses.length}</div>
                  <span className="badge badge-info" style={{ marginTop: '0.5rem' }}>Transactions</span>
                </div>
              </div>
            )}
            

            <div className="card" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0 }}>Expense Groups</h4>
                <button type="button" className="edit-btn" onClick={() => setShowExpenseGroupsDetails((prev) => !prev)}>
                  {showExpenseGroupsDetails ? 'Hide details ▲' : 'Show details ▼'}
                </button>
              </div>
              {showExpenseGroupsDetails && (
                <>
                  <form onSubmit={createExpenseGroup} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <input value={expenseGroupForm.name} onChange={(e) => setExpenseGroupForm({ name: e.target.value })} placeholder="New expense group name" style={{ flex: '1', minWidth: '220px' }} required />
                    <button type="submit" className="primary">Create Group</button>
                  </form>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <select value={transferExpenseGroupId} onChange={(e) => setTransferExpenseGroupId(e.target.value)} style={{ minWidth: '240px' }}>
                      <option value="">Transfer ungrouped expenses to...</option>
                      {expenseGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <button type="button" className="edit-btn" onClick={transferUngroupedExpenses} disabled={!transferExpenseGroupId}>Transfer Existing Ungrouped</button>
                  </div>
                </>
              )}
              {expenseGroups.length > 0 && (
                <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  {expenseGroups.map((group) => (
                    <div key={group.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', background: 'var(--surface-strong)', border: '1px solid var(--border)', borderRadius: '999px', padding: '0.35rem 0.7rem' }}>
                      {editingExpenseGroupId === group.id ? (
                        <>
                          <input value={editingExpenseGroupName} onChange={(e) => setEditingExpenseGroupName(e.target.value)} style={{ minWidth: '140px' }} />
                          <button type="button" className="primary" onClick={() => saveExpenseGroupEdit(group.id)}>Save</button>
                          <button type="button" className="edit-btn" onClick={() => { setEditingExpenseGroupId(''); setEditingExpenseGroupName(''); }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className="badge badge-info" style={{ fontWeight: 600 }}>{group.name}</span>
                          <button type="button" className="edit-btn" title={`Edit ${group.name}`} aria-label={`Edit ${group.name}`} onClick={() => { setEditingExpenseGroupId(group.id); setEditingExpenseGroupName(group.name); }} style={{ width: 26, height: 26, borderRadius: '50%', padding: 0, lineHeight: 1 }}>
                            +
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {expenseGroups.length > 0 ? `${expenseGroups.length} group(s) created.` : 'No expense groups yet. Create one to organize expenses.'}
              </div>
            </div>
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h4 style={{ marginTop: 0 }}>Expense Group Distribution</h4>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {(['day', '7days', '14days', 'month', '3months', '6months', '1year'] as ExpenseChartRange[]).map((range) => (
                  <button key={range} type="button" className={expenseChartRange === range ? 'primary' : 'edit-btn'} onClick={() => setExpenseChartRange(range)}>
                    {range === 'day' ? 'Per day' : range === '7days' ? '7 days' : range === '14days' ? '14 days' : range === 'month' ? 'Month' : range === '3months' ? '3 months' : range === '6months' ? '6 months' : '1 year'}
                  </button>
                ))}
              </div>
              {expenseChartData.total > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '1rem', alignItems: 'center' }}>
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
              ) : <div style={{ color: 'var(--text-muted)' }}>No expenses in this period.</div>}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className={expensesViewMode === 'all' ? 'primary' : 'edit-btn'} onClick={() => setExpensesViewMode('all')}>
                All expenses
              </button>
              <button type="button" className={expensesViewMode === 'day' ? 'primary' : 'edit-btn'} onClick={() => setExpensesViewMode('day')}>
                Expenses by day
              </button>
              {expensesViewMode === 'day' && (
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  <span>Day</span>
                  <input type="date" value={expensesDayFilter} onChange={(e) => setExpensesDayFilter(e.target.value)} />
                </label>
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
          </section>
        )}

        {view === 'users' && (
          <section>
            <div className="page-header">
              <h2>👥 Staff Management</h2>
              {canManageUsers && (
                <button className="primary" onClick={() => { setUserForm({ id: '', name: '', email: '', role: 'cashier', branchId: branches[0]?.id || '' }); setShowUserModal(true); }}>
                  + Invite Staff
                </button>
              )}
            </div>
            
            {canManageUsers ? (
              <>
                {/* Staff Summary */}
                {users.length > 0 && (
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '2rem' }}>
                    <div className="card">
                    <h4 style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, marginBottom: '0.5rem' }}>Total Staff</h4>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{users.length}</div>
                      <span className="badge badge-info" style={{ marginTop: '0.5rem' }}>Members</span>
                    </div>
                    <div className="card">
                    <h4 style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, marginBottom: '0.5rem' }}>Cashiers</h4>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{users.filter(u => u.role === 'cashier').length}</div>
                      <span className="badge badge-success" style={{ marginTop: '0.5rem' }}>Active</span>
                    </div>
                    <div className="card">
                    <h4 style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, marginBottom: '0.5rem' }}>Managers</h4>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{users.filter(u => u.role === 'manager').length}</div>
                      <span className="badge badge-warning" style={{ marginTop: '0.5rem' }}>Supervisors</span>
                    </div>
                  </div>
                )}
                
    
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
                                {u.role === 'manager' ? '👔 Manager' : u.role === 'admin' ? '🛡️ Admin' : '💼 Cashier'}
                              </span>
                            </td>
                            <td>{branchMap[u.branchId]}</td>
                            <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                            <td>
                              <button className="edit-btn" onClick={() => { setUserForm(u); setShowUserModal(true); }}>Edit</button>
                              <button className="delete-btn" onClick={() => { setUsers(prev => prev.filter(x => x.id !== u.id)); logActivity('delete_user', `Removed user "${u.email}"`); }}>Remove</button>
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
                <p style={{ margin: 0 }}>⚠️ Only shop owners can manage staff members.</p>
              </div>
            )}
          </section>
        )}

        {view === 'reports' && (
          <section>
            <div className="page-header">
              <h2>Business Reports & Analytics</h2>
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div className="card">
                <h4>Daily Summary</h4>
                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Today's Sales</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{formatUGX(getMetrics('day', 0).revenue)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Today's Expenses</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>{formatUGX(getMetrics('day', 0).expenseTotal)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Today's Net Profit</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{formatUGX(getMetrics('day', 0).netProfit)}</div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h4>Weekly Summary</h4>
                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Week's Sales</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{formatUGX(getMetrics('week', 0).revenue)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Week's Expenses</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>{formatUGX(getMetrics('week', 0).expenseTotal)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Week's Net Profit</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{formatUGX(getMetrics('week', 0).netProfit)}</div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h4>Monthly Summary</h4>
                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Month's Sales</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{formatUGX(getMetrics('month', 0).revenue)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Month's Expenses</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>{formatUGX(getMetrics('month', 0).expenseTotal)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Month's Gross Profit</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{formatUGX(getMetrics('month', 0).grossProfit)}</div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h4>Inventory Status</h4>
                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Products</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{products.length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Low Stock Items</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--warning)' }}>{products.filter(p => p.stock < 10).length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Stock Value</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--info)' }}>{formatUGX(products.reduce((a, p) => a + (p.stock * p.purchasePrice), 0))}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '3rem' }}>
              <h3 style={{ marginBottom: '1.5rem' }}>All Sales Transactions</h3>
  
            <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Item</th>
                      <th>Branch</th>
                      <th>Qty</th>
                      <th>Revenue</th>
                      <th>Cost</th>
                      <th>Profit</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportsSalesPagination.rows.map((s) => (
                      <tr key={s.id}>
                        <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                        <td><span className="badge badge-info">{s.type}</span></td>
                        <td style={{ fontWeight: 600 }}>{s.itemName}</td>
                        <td>{branchMap[s.branchId]}</td>
                        <td>{s.qty}</td>
                        <td>{formatUGX(s.amount)}</td>
                        <td>{formatUGX(s.cost)}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatUGX(s.amount - s.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                totalItems={sales.length}
                totalPages={reportsSalesPagination.totalPages}
                page={reportsSalesPagination.safePage}
                start={reportsSalesPagination.start}
                end={reportsSalesPagination.end}
                onPrevious={() => setReportsSalesPage((prev) => Math.max(1, prev - 1))}
                onNext={() => setReportsSalesPage((prev) => Math.min(reportsSalesPagination.totalPages, prev + 1))}
              />
            </div>
          </section>
        )}

        {view === 'activity_logs' && (
          <section className="card activity-log-card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>All User Activities</h2>
            <p style={{ color: 'var(--text-muted)' }}>Sale, add inventory, add stock, delete, edit, and add user actions for all roles.</p>

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
                      <td>{log.role}</td>
                      <td>{log.action}</td>
                      <td>{log.details}</td>
                    </tr>
                  )) : <tr><td colSpan={5}>No activity logs yet.</td></tr>}
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
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>On account</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.filter((customer) => {
                    const needle = customerQuery.trim().toLowerCase();
                    return !needle || customer.name.toLowerCase().includes(needle) || customer.phone?.toLowerCase().includes(needle);
                  }).map((customer) => (
                    <tr key={customer.id}>
                      <td style={{ fontWeight: 700 }}>{customer.name}</td>
                      <td>{customer.phone || '—'}</td>
                      <td>{formatUGX(customerAccountBalance(sales, customer.name, customer.phone))}</td>
                      <td>{customer.notes || '—'}</td>
                    </tr>
                  ))}
                  {customers.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Customers appear here after a named sale.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {view === 'settings' && (
          <section>
            <div className="page-header">
              <h2>Shop Settings</h2>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)' }}>
              <button onClick={() => setSettingsTab('shop')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'shop' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'shop' ? 600 : 400 }}>Shop Information</button>
              <button onClick={() => setSettingsTab('branches')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'branches' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'branches' ? 600 : 400 }}>Manage Branches</button>
              <button onClick={() => setSettingsTab('time')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'time' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'time' ? 600 : 400 }}>Time & Timezone</button>
              <button onClick={() => setSettingsTab('accounts')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'accounts' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'accounts' ? 600 : 400 }}>Accounts</button>
              <button onClick={() => setSettingsTab('tax')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'tax' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'tax' ? 600 : 400 }}>Tax</button>
              <button onClick={() => setSettingsTab('receipt')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'receipt' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'receipt' ? 600 : 400 }}>Receipt</button>
              <button onClick={() => setSettingsTab('backup')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'backup' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'backup' ? 600 : 400 }}>Backup & Restore</button>
            </div>

            {settingsTab === 'shop' && (
              <div className="card">
                <h3>Shop Information</h3>
                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Shop Name</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginBottom: '1rem' }}>{currentShop?.shopName || 'My Shop'}</div>
                    {isShopOwner && (
                      <button className="primary" onClick={() => { setShopNameForm(currentShop?.shopName || ''); setShowSettingsModal(true); }}>Edit Shop Name</button>
                    )}
                  </div>
                </div>
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

            {settingsTab === 'backup' && (
              <div className="card">
                <h3>Backup & Restore Shop Data</h3>
                <p style={{ color: 'var(--text-muted)', maxWidth: '760px' }}>
                  Download one backup file with all important POS data: inventory, services, sales, expenses, expense groups, accounts, branches, staff users, activity logs, and shop time settings. If a shop is deleted or data is lost, create/open a new shop with the owner account, then upload this file here to reupload the records.
                </p>
                <div className="grid dashboard-metrics-grid" style={{ marginTop: '1rem' }}>
                  <div className="card dashboard-card">
                    <h4>Inventory Items</h4>
                    <div className="card-value">{products.length}</div>
                  </div>
                  <div className="card dashboard-card">
                    <h4>Sales Records</h4>
                    <div className="card-value">{sales.length}</div>
                  </div>
                  <div className="card dashboard-card">
                    <h4>Expenses</h4>
                    <div className="card-value">{expenses.length}</div>
                  </div>
                  <div className="card dashboard-card">
                    <h4>Accounts & Staff</h4>
                    <div className="card-value">{accounts.length + users.length}</div>
                  </div>
                </div>
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

            {settingsTab === 'accounts' && (
              <div className="card">
                <h3>Accounts</h3>
                <p style={{ color: 'var(--text-muted)' }}>Sales (products and services) are credited to the selected account below (or default CASH). Expenses are deducted from the selected expense account.</p>
                <form onSubmit={createAccount} className="form" style={{ marginTop: '1rem' }}>
                  <label className="field">
                    <span>Account Name</span>
                    <input value={accountForm.name} onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Mobile Money" required />
                  </label>
                  <label className="field">
                    <span>Opening Balance (UGX)</span>
                    <input type="number" value={accountForm.openingBalance} onChange={(e) => setAccountForm((prev) => ({ ...prev, openingBalance: Number(e.target.value) }))} />
                  </label>
                  <div><button type="submit" className="primary">+ Add Account</button></div>
                </form>
                {(isShopOwner || role === 'admin') && (
                  <form onSubmit={topUpAccount} className="form" style={{ marginTop: '0.75rem' }}>
                    <label className="field">
                      <span>Top Up Account</span>
                      <select value={accountTopUpForm.accountId || defaultAccount?.id || ''} onChange={(e) => setAccountTopUpForm((prev) => ({ ...prev, accountId: e.target.value }))}>
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (Default)' : ''}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Top Up Amount (UGX)</span>
                      <input type="number" min={1} value={accountTopUpForm.amount} onChange={(e) => setAccountTopUpForm((prev) => ({ ...prev, amount: Number(e.target.value) }))} required />
                    </label>
                    <div><button type="submit" className="primary">+ Top Up</button></div>
                  </form>
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
            )}
          </section>
        )}


        {view === 'accounts' && (
          <section>
            <div className="card">
              <h3>Accounts</h3>
              <p style={{ color: 'var(--text-muted)' }}>Sales (products and services) are credited to the selected account below (or default CASH). Expenses are deducted from the selected expense account.</p>
              <form onSubmit={createAccount} className="form" style={{ marginTop: '1rem' }}>
                <label className="field">
                  <span>Account Name</span>
                  <input value={accountForm.name} onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Mobile Money" required />
                </label>
                <label className="field">
                  <span>Opening Balance (UGX)</span>
                  <input type="number" value={accountForm.openingBalance} onChange={(e) => setAccountForm((prev) => ({ ...prev, openingBalance: Number(e.target.value) }))} />
                </label>
                <div><button type="submit" className="primary">+ Add Account</button></div>
              </form>
              {(isShopOwner || role === 'admin') && (
                <form onSubmit={topUpAccount} className="form" style={{ marginTop: '0.75rem' }}>
                  <label className="field">
                    <span>Top Up Account</span>
                    <select value={accountTopUpForm.accountId || defaultAccount?.id || ''} onChange={(e) => setAccountTopUpForm((prev) => ({ ...prev, accountId: e.target.value }))}>
                      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? ' (Default)' : ''}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Top Up Amount (UGX)</span>
                    <input type="number" min={1} value={accountTopUpForm.amount} onChange={(e) => setAccountTopUpForm((prev) => ({ ...prev, amount: Number(e.target.value) }))} required />
                  </label>
                  <div><button type="submit" className="primary">+ Top Up</button></div>
                </form>
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
          <section>
            <div className="card">
              <h3>Your Profile</h3>
              <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Name</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>{authUser?.displayName}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Email</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>{authUser?.email}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current Role</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>{roleLabels[role]}</div>
                </div>
              </div>
            </div>
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
                <h3>🛒 Quick Sale</h3>
                <button className="modal-close" onClick={() => setShowSaleModal(false)}>&times;</button>
              </div>
              <div className="modal-body">
                <div style={{ padding: '1rem', backgroundColor: 'var(--info-light)', borderRadius: 'var(--radius)', marginBottom: '1rem', border: '1px solid var(--info-bg)' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--info)' }}>💡 Use the Sales Desk for multi-item transactions. This form is for quick single-item sales.</p>
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
                    <label className="field">
                      <span>Product Name</span>
                      <input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} required />
                    </label>
                    <label className="field">
                      <span>Category</span>
                      <input value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} placeholder="e.g. Beverages" />
                    </label>
                    <label className="field">
                      <span>SKU</span>
                      <input value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} autoCapitalize="characters" />
                    </label>
                    <label className="field">
                      <span>Barcode</span>
                      <input value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })} inputMode="numeric" />
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
                    <label className="field">
                      <span>Purchase Price (UGX)</span>
                      <input type="number" min="0" step="0.01" value={productForm.purchasePrice} onChange={(e) => setProductForm({ ...productForm, purchasePrice: Number(e.target.value) })} required />
                    </label>
                    <label className="field">
                      <span>Selling Price (UGX)</span>
                      <input type="number" min="0" step="0.01" value={productForm.salePrice} onChange={(e) => setProductForm({ ...productForm, salePrice: Number(e.target.value) })} required />
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="edit-btn" onClick={() => setShowProductModal(false)}>Cancel</button>
                  <button type="submit" className="primary">Save Product</button>
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
                  <h3 id="stock-adjustment-title">Receive or adjust stock</h3>
                  {products.find((product) => product.id === stockAdjustmentForm.productId) && (
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
                    {stockAdjustmentForm.reason === 'restock' && (
                      <>
                        <label className="field">
                          <span>Supplier (optional)</span>
                          <input value={stockAdjustmentForm.supplierName} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, supplierName: e.target.value }))} maxLength={80} placeholder="Supplier name" />
                        </label>
                        <label className="field">
                          <span>Invoice / reference (optional)</span>
                          <input value={stockAdjustmentForm.reference} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, reference: e.target.value }))} maxLength={80} placeholder="Supplier invoice number" />
                        </label>
                        <label className="field">
                          <span>Latest unit cost (UGX, optional)</span>
                          <input type="number" min="0" step="0.01" value={stockAdjustmentForm.unitCost} onChange={(e) => setStockAdjustmentForm((prev) => ({ ...prev, unitCost: e.target.value }))} placeholder="Leave blank to keep current cost" />
                        </label>
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
                  <button type="submit" className="primary">{stockAdjustmentForm.reason === 'restock' ? 'Receive stock' : 'Save adjustment'}</button>
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
                  <button type="submit" className="primary">{userForm.id ? 'Update' : 'Send Invitation'}</button>
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
