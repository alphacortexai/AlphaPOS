'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

type Role = 'shop_owner' | 'admin' | 'manager' | 'cashier' | 'stock';
type View = 'dashboard' | 'sales_history' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports' | 'settings' | 'profile' | 'activity_logs';
type DashboardPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
type InsightTrendRange = 7 | 14 | 30 | 60 | 100;

type Branch = { id: string; name: string; location: string; createdAt?: string };
type AuditStamp = {
  createdAt: string;
  createdByUid: string;
  createdByEmail: string;
  updatedAt?: string;
  updatedByUid?: string;
  updatedByEmail?: string;
};

type Product = { id: string; name: string; branchId: string; stock: number; purchasePrice: number; salePrice: number } & AuditStamp;
type ServiceType = 'direct_cost' | 'shared_cost';
type Service = { id: string; name: string; branchId: string; salePrice: number; serviceType: ServiceType; directCost: number; monthlySharedCost: number } & AuditStamp;
type Sale = { id: string; type: 'product' | 'service'; itemName: string; branchId: string; qty: number; amount: number; cost: number } & AuditStamp;
type Expense = { id: string; title: string; branchId: string; amount: number } & AuditStamp;
type StaffUser = { id: string; name: string; email: string; role: Role; branchId: string } & AuditStamp;
type ShopMembership = { ownerUid: string; shopName: string; role: Role };
type ActivityLog = {
  id: string;
  action: string;
  details: string;
  role: Role;
  userEmail: string;
  createdAt: string;
};
type CartItem = { itemId: string; itemType: 'product' | 'service'; itemName: string; qty: number; unitPrice: number; unitCost: number; branchId: string; maxQty?: number };

const periodStart = (period: 'day' | 'week' | 'month' | 'year', date: Date = new Date()) => {
  const d = new Date(date);
  if (period === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), 0, 1);
};

export default function Page() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role>('shop_owner');
  const [activeShopOwnerUid, setActiveShopOwnerUid] = useState('');
  const [availableShops, setAvailableShops] = useState<ShopMembership[]>([]);
  const [view, setView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [status, setStatus] = useState('Welcome to AlphaPOS Pro.');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const hasLoadedUserDataRef = useRef(false);
  const isSwitchingShopRef = useRef(false);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Modals
  const [showProductModal, setShowProductModal] = useState(false);
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
  const [usersPage, setUsersPage] = useState(1);
  const [reportsSalesPage, setReportsSalesPage] = useState(1);
  const [activityLogsPage, setActivityLogsPage] = useState(1);
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('weekly');
  const [insightTrendRange, setInsightTrendRange] = useState<InsightTrendRange>(30);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [quickSaleSearchQuery, setQuickSaleSearchQuery] = useState('');
  const [productBranchFilter, setProductBranchFilter] = useState('');
  const [productStockFilter, setProductStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);

  const [branchForm, setBranchForm] = useState({ name: '', location: '', id: '' });
  const [productForm, setProductForm] = useState({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
  const [serviceForm, setServiceForm] = useState({ name: '', branchId: '', amount: 0, serviceType: 'direct_cost' as ServiceType, directCost: 0, monthlySharedCost: 0 });
  const [saleForm, setSaleForm] = useState({ productId: '', qty: 1 });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedBranchForSale, setSelectedBranchForSale] = useState('');
  const [expenseForm, setExpenseForm] = useState({ id: '', title: '', branchId: '', amount: 0 });
  const [userForm, setUserForm] = useState({ id: '', name: '', email: '', role: 'cashier' as Role, branchId: '' });
  const [shopNameForm, setShopNameForm] = useState('');
  const [settingsTab, setSettingsTab] = useState<'shop' | 'branches'>('shop');

  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const topSellingProducts = useMemo(() => {
    const productAccessCount = new Map<string, number>();
    sales
      .filter((sale) => sale.type === 'product')
      .forEach((sale) => {
        productAccessCount.set(sale.itemName, (productAccessCount.get(sale.itemName) || 0) + sale.qty);
      });

    const rankedProducts = products
      .filter((product) => product.stock > 0)
      .sort((a, b) => (productAccessCount.get(b.name) || 0) - (productAccessCount.get(a.name) || 0));

    return rankedProducts.slice(0, 12);
  }, [products, sales]);
  const filteredQuickSaleProducts = useMemo(() => {
    const query = quickSaleSearchQuery.trim().toLowerCase();
    if (!query) return topSellingProducts;

    return products
      .filter((product) => product.stock > 0 && product.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, quickSaleSearchQuery, topSellingProducts]);
  const filteredQuickSaleServices = useMemo(() => {
    const query = quickSaleSearchQuery.trim().toLowerCase();
    const branchIdsWithStockProducts = new Set(products.filter((product) => product.stock > 0).map((product) => product.branchId));
    return services
      .filter((service) => branchIdsWithStockProducts.has(service.branchId) && (!query || service.name.toLowerCase().includes(query)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, quickSaleSearchQuery, services]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + (item.unitPrice * item.qty), 0), [cart]);
  const cartCost = useMemo(() => cart.reduce((sum, item) => sum + (item.unitCost * item.qty), 0), [cart]);
  const cartProfit = useMemo(() => cartTotal - cartCost, [cartTotal, cartCost]);
  const db = firebaseApp ? getFirestore(firebaseApp) : null;
  const formatUGX = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;
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
      setAuthUser(user);
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
        setUsers([]);
      }
    });
  }, []);

  const loadUserData = useCallback(async () => {
      if (!authUser || !db) return false;
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
        setUsers(Array.isArray(data.users) ? data.users : []);
        setRole(selectedShop?.role || (data.role as Role) || 'shop_owner');
        setActivityLogs(Array.isArray(data.activityLogs) ? data.activityLogs : []);
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
        {
          products: latestProducts,
          services: latestServices,
          expenses: latestExpenses,
          sales: recalculated.sales,
          recalculatedAt: serverTimestamp(),
          recalculatedSummary: recalculated.stats,
          updatedAt: serverTimestamp(),
        },
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
      if (!authUser || !db || !hasLoadedUserDataRef.current || !activeShopOwnerUid || isSwitchingShopRef.current) return;
      try {
        const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');
        await setDoc(
          userDataRef,
          { role, branches, products, services, sales, expenses, users, activityLogs, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (error) {
        setStatus(`Failed to auto-save your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    void saveUserData();
  }, [activeShopOwnerUid, authUser, db, role, branches, products, services, sales, expenses, users, activityLogs]);

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
    setUsers([]);
    setActivityLogs([]);
    setBranchForm({ name: '', location: '', id: '' });
    setProductForm({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
    setServiceForm({ name: '', branchId: '', amount: 0, serviceType: 'direct_cost', directCost: 0, monthlySharedCost: 0 });
    setSaleForm({ productId: '', qty: 1 });
    setExpenseForm({ id: '', title: '', branchId: '', amount: 0 });
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

  const getMetricsForPeriod = (period: DashboardPeriod, offset: number = 0) => {
    const now = new Date();
    let start: Date, end: Date;

    if (period === 'daily') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset + 1);
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
    const cost = periodSales.reduce((a, s) => a + s.cost, 0);
    const expenseTotal = periodExpenses.reduce((a, e) => a + e.amount, 0);
    const sharedServiceCost = getSharedServiceCostForRange(periodSales);
    const grossProfit = revenue - cost - sharedServiceCost;
    const netProfit = grossProfit - expenseTotal;

    return { revenue, cost: cost + sharedServiceCost, expenseTotal, grossProfit, netProfit, salesCount: periodSales.length };
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
      }
    };
  }, [sales, expenses, products, dashboardPeriod, services]);

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
      const matchesSearch = p.name.toLowerCase().includes(productSearchQuery.toLowerCase());
      const matchesBranch = !productBranchFilter || p.branchId === productBranchFilter;
      const matchesStock = 
        productStockFilter === 'all' ? true :
        productStockFilter === 'low' ? p.stock < 10 && p.stock > 0 :
        p.stock === 0;
      return matchesSearch && matchesBranch && matchesStock;
    });
  }, [products, productSearchQuery, productBranchFilter, productStockFilter]);

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
          ...currentAuditStamp(),
        });
      });

      if (newAutoExpenses.length === 0) return prev;
      return [...newAutoExpenses, ...prev];
    });
  }, [services]);

  const logActivity = (action: string, details: string) => {
    setActivityLogs((prev) => [{
      id: crypto.randomUUID(),
      action,
      details,
      role,
      userEmail: authUser?.email || 'unknown',
      createdAt: new Date().toISOString(),
    }, ...prev].slice(0, 500));
  };

  const saveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name || !productForm.branchId) return;
    if (productForm.id) {
      setProducts((prev) => prev.map((p) => (p.id === productForm.id ? { ...p, ...productForm, ...updatedAuditStamp() } : p)));
      setStatus('Product updated.');
      logActivity('edit_inventory', `Updated product "${productForm.name}"`);
    } else {
      setProducts((prev) => [...prev, { ...productForm, id: crypto.randomUUID(), ...currentAuditStamp() }]);
      setStatus('Product added.');
      logActivity('add_inventory', `Added product "${productForm.name}"`);
    }
    setProductForm({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
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
        ...currentAuditStamp()
      }];
    });

    showNotification('Service saved successfully!', 'success');
    setServiceForm({ name: '', branchId: '', amount: 0, serviceType: 'direct_cost', directCost: 0, monthlySharedCost: 0 });
  };

  const sellService = (serviceId: string) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) {
      showNotification('Service not found', 'error');
      return;
    }
    const newSale: Sale = {
      id: crypto.randomUUID(),
      type: 'service',
      itemName: service.name,
      branchId: service.branchId,
      qty: 1,
      amount: service.salePrice,
      cost: service.serviceType === 'direct_cost' ? service.directCost : 0,
      ...currentAuditStamp(),
    };
    setSales((prev) => [newSale, ...prev]);
    logActivity('sale', `Sold service "${service.name}"`);
    showNotification(`${service.name} sold successfully`, 'success');
  };

  const saveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.title || !expenseForm.branchId || expenseForm.amount <= 0) return;
    if (expenseForm.id) {
      setExpenses((prev) => prev.map((ex) => (ex.id === expenseForm.id ? { ...ex, ...expenseForm, ...updatedAuditStamp() } : ex)));
      setStatus('Expense updated.');
      logActivity('edit_expense', `Updated expense "${expenseForm.title}"`);
    } else {
      setExpenses((prev) => [...prev, { ...expenseForm, id: crypto.randomUUID(), ...currentAuditStamp() }]);
      setStatus('Expense recorded.');
      logActivity('add_expense', `Added expense "${expenseForm.title}"`);
    }
    setExpenseForm({ id: '', title: '', branchId: '', amount: 0 });
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

  const addProductToCart = (productId: string) => {
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
    showNotification(`${product.name} added to cart`, 'success', 2000);
  };

  const addServiceToCart = (serviceId: string) => {
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
    showNotification(`${service.name} added to cart`, 'success', 2000);
  };

  const updateCartItemQty = (itemId: string, itemType: 'product' | 'service', qty: number) => {
    if (qty <= 0) {
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

  const completeCartSale = () => {
    if (cart.length === 0) {
      showNotification('Cart is empty', 'error');
      return;
    }
    const newSales = cart.map(item => ({
      id: crypto.randomUUID(),
      type: item.itemType,
      itemName: item.itemName,
      branchId: item.branchId,
      qty: item.qty,
      amount: item.unitPrice * item.qty,
      cost: item.unitCost * item.qty,
      ...currentAuditStamp(),
    }));
    setSales(prev => [...newSales, ...prev]);
    const updatedProducts = products.map(p => {
      const cartItem = cart.find(ci => ci.itemType === 'product' && ci.itemId === p.id);
      return cartItem ? { ...p, stock: p.stock - cartItem.qty } : p;
    });
    setProducts(updatedProducts);
    logActivity('sale', `Completed cart sale with ${cart.length} item(s)`);
    showNotification(`Sale completed! ${cart.length} item(s) sold.`, 'success');
    setCart([]);
    setShowSaleModal(false);
  };

  const makeProductSale = (e: React.FormEvent) => {
    e.preventDefault();
    const p = products.find((x) => x.id === saleForm.productId);
    if (!p || p.stock < saleForm.qty) {
      setStatus('Invalid sale or insufficient stock.');
      return;
    }
    const newSale: Sale = {
      id: crypto.randomUUID(),
      type: 'product',
      itemName: p.name,
      branchId: p.branchId,
      qty: saleForm.qty,
      amount: p.salePrice * saleForm.qty,
      cost: p.purchasePrice * saleForm.qty,
      ...currentAuditStamp(),
    };
    setSales((prev) => [newSale, ...prev]);
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, stock: x.stock - saleForm.qty } : x)));
    logActivity('sale', `Sold ${saleForm.qty} of "${p.name}"`);
    setSaleForm({ productId: '', qty: 1 });
    setStatus('Sale recorded.');
  };


  const restockProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      showNotification('Product not found', 'error');
      return;
    }

    const stockInput = window.prompt(`Add stock for ${product.name}. Current stock: ${product.stock}`, '0');
    if (stockInput === null) return;

    const qtyToAdd = Number(stockInput);
    if (!Number.isFinite(qtyToAdd) || qtyToAdd <= 0) {
      showNotification('Enter a valid stock quantity greater than 0', 'error');
      return;
    }

    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, stock: p.stock + qtyToAdd, ...updatedAuditStamp() } : p))
    );
    logActivity('add_stock', `Added ${qtyToAdd} stock to "${product.name}"`);
    showNotification(`${qtyToAdd} units added to ${product.name}`, 'success');
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

  const salesHistoryPageSize = 10;
  const sharedTablePageSize = 10;
  const salesHistoryTotalPages = Math.max(1, Math.ceil(filteredSales.length / salesHistoryPageSize));
  const paginatedSales = useMemo(() => {
    const safePage = Math.min(salesHistoryPage, salesHistoryTotalPages);
    const start = (safePage - 1) * salesHistoryPageSize;
    return filteredSales.slice(start, start + salesHistoryPageSize);
  }, [filteredSales, salesHistoryPage, salesHistoryTotalPages]);

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

  const productsPagination = paginateData(filteredProducts, productsPage, setProductsPage);
  const servicesPagination = paginateData(services, servicesPage, setServicesPage);
  const expensesPagination = paginateData(expenses, expensesPage, setExpensesPage);
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

  const deleteSale = (id: string) => {
    if (!canManageSalesAndExpenses) {
      setStatus('Only the shop owner or admin can delete sales.');
      return;
    }
    setSales((prev) => prev.filter((sale) => sale.id !== id));
    logActivity('delete_sale', `Deleted sale id "${id}"`);
    showNotification('Sale deleted successfully!', 'success');
  };

  const editExpense = (expense: Expense) => {
    if (!canManageSalesAndExpenses) {
      setStatus('Only the shop owner or admin can edit expenses.');
      return;
    }
    setExpenseForm(expense);
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
    if (!shopNameForm.trim() || !db || !activeShopOwnerUid) {
      setStatus('Please enter a valid shop name.');
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
          <span className="auth-badge">v2.0 Beta</span>
          <h1>AlphaPOS Pro</h1>
          <p>The ultimate point of sale for modern businesses.</p>
          <ul className="auth-highlights">
            <li>Multi-branch inventory management</li>
            <li>Real-time sales tracking & analytics</li>
            <li>Expense & profit monitoring</li>
            <li>Staff role-based access control</li>
          </ul>
          <button className="primary" style={{ width: '100%', padding: '1rem' }} onClick={handleLogin}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className={`sidebar-overlay ${isSidebarOpen ? 'show' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>📊 AlphaPOS</h2>
          <div className="sidebar-subtitle">v2.0 Pro</div>
        </div>

        <div className="sidebar-section">
          <label className="role-label">Active Shop</label>
          <select className="role-select" value={activeShopOwnerUid} onChange={(e) => handleShopSwitch(e.target.value)}>
            {availableShops.map((s) => (
              <option key={s.ownerUid} value={s.ownerUid}>
                {truncateShopName(s.shopName)} ({s.role})
              </option>
            ))}
          </select>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-label">Overview</div>
          <button className={`nav-button ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }}><span className="nav-icon">📈</span><span>Dashboard</span></button>

          <div className="nav-group-label">Operations</div>
          <button className={`nav-button ${view === 'sales' ? 'active' : ''}`} onClick={() => { setView('sales'); setIsSidebarOpen(false); }}><span className="nav-icon">🛒</span><span>Sales Desk</span></button>
          <button className={`nav-button ${view === 'sales_history' ? 'active' : ''}`} onClick={() => { setView('sales_history'); setIsSidebarOpen(false); }}><span className="nav-icon">🧾</span><span>Sales History</span></button>
          <button className={`nav-button ${view === 'products' ? 'active' : ''}`} onClick={() => { setView('products'); setIsSidebarOpen(false); }}><span className="nav-icon">📦</span><span>Inventory</span></button>
          <button className={`nav-button ${view === 'services' ? 'active' : ''}`} onClick={() => { setView('services'); setIsSidebarOpen(false); }}><span className="nav-icon">🧰</span><span>Services</span></button>

          <div className="nav-group-label">Management</div>
          <button className={`nav-button ${view === 'expenses' ? 'active' : ''}`} onClick={() => { setView('expenses'); setIsSidebarOpen(false); }}><span className="nav-icon">💰</span><span>Expenses</span></button>
          <button className={`nav-button ${view === 'users' ? 'active' : ''}`} onClick={() => { setView('users'); setIsSidebarOpen(false); }}><span className="nav-icon">👥</span><span>Staff</span></button>
          <button className={`nav-button ${view === 'activity_logs' ? 'active' : ''}`} onClick={() => { setView('activity_logs'); setIsSidebarOpen(false); }}><span className="nav-icon">📜</span><span>Activity Logs</span></button>
          <button className={`nav-button ${view === 'reports' ? 'active' : ''}`} onClick={() => { setView('reports'); setIsSidebarOpen(false); }}><span className="nav-icon">📊</span><span>Reports</span></button>
          {isShopOwner && <button className={`nav-button ${view === 'settings' ? 'active' : ''}`} onClick={() => { setView('settings'); setIsSidebarOpen(false); }}><span className="nav-icon">⚙️</span><span>Settings</span></button>}
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

      <main className="main" style={{ display: 'flex', flexDirection: 'column' }}>
        <header className="main-header" style={{ padding: 'var(--space-lg) var(--space-xl)', margin: '0 0 var(--space-xl) 0', borderBottom: '1px solid var(--border)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <button className="mobile-menu-toggle" onClick={() => setIsSidebarOpen(true)}>☰</button>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {view === 'dashboard' ? '📊 Dashboard Overview' : 
               view === 'sales' ? '🛒 Sales Desk' :
               view === 'sales_history' ? '🧾 Sales History' :
               view === 'products' ? '📦 Inventory Management' :
               view === 'services' ? '🧰 Service Catalog' :
               view === 'expenses' ? '💰 Expense Tracking' :
               view === 'users' ? '👥 Staff Management' :
               view === 'activity_logs' ? '🧾 Activity Logs' :
               view === 'reports' ? '📈 Business Reports' :
               view === 'settings' ? '⚙️ System Settings' :
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
              <button className="primary" onClick={() => { setProductForm({ id: '', name: '', branchId: branches[0]?.id || '', stock: 0, purchasePrice: 0, salePrice: 0 }); setShowProductModal(true); }}>
                + Add Product
              </button>
            </div>

            {/* Inventory Search & Filter */}
            <div className="filter-bar inventory-filter-bar">
              <div className="filter-group">
                <label>Search Product</label>
                <input 
                  type="text" 
                  placeholder="Search by name..." 
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
                    <th>Product Name</th>
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
                        <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</td>
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
                          <button className="edit-btn" onClick={() => { setProductForm(p); setShowProductModal(true); }}>Edit</button>
                          <button className="edit-btn" onClick={() => restockProduct(p.id)}>+ Stock</button>
                          <button className="delete-btn" onClick={() => { setProducts(prev => prev.filter(x => x.id !== p.id)); logActivity('delete_inventory', `Deleted product "${p.name}"`); }}>Delete</button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No products found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
          <section>
            <div className="page-header">
              <h2>Sales Desk</h2>
            </div>

            <div className="sales-desk-layout" style={{ marginTop: '0.2rem', marginBottom: '2rem' }}>
              {/* Products Selection */}
              <div>
                <h3 style={{ margin: '0 0 0.45rem 0', fontSize: '1.02rem', fontWeight: 700 }}>Available Products</h3>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'end', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                  <div className="filter-group" style={{ marginBottom: 0, flex: '1 1 240px' }}>
                    <label>Quick Search Item</label>
                    <input
                      type="text"
                      placeholder="Search item to sell..."
                      value={quickSaleSearchQuery}
                      onChange={(e) => setQuickSaleSearchQuery(e.target.value)}
                    />
                  </div>
                  <button className="primary" onClick={() => { setCart([]); setShowSaleModal(true); }}>+ New Sale</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: '0.55rem', marginBottom: '1rem' }}>
                  {filteredQuickSaleProducts.map(p => (
                    <div key={p.id} className="card" style={{ cursor: 'pointer', transition: 'all 0.2s ease', padding: '0.55rem' }} onClick={() => addProductToCart(p.id)}>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.3rem' }}>{p.name}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--success)' }}>{formatUGX(p.salePrice)}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>x{p.stock}</span>
                      </div>
                      <button className="primary" style={{ width: '100%', fontSize: '0.68rem', padding: '0.35rem 0.45rem' }}>Add</button>
                    </div>
                  ))}
                  {filteredQuickSaleServices.map((service) => (
                    <div key={service.id} className="card" style={{ cursor: 'pointer', transition: 'all 0.2s ease', padding: '0.55rem', border: '1px dashed var(--border)' }} onClick={() => addServiceToCart(service.id)}>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.3rem' }}>{service.name}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--info)' }}>{formatUGX(service.salePrice)}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Service</span>
                      </div>
                      <button className="primary" style={{ width: '100%', fontSize: '0.68rem', padding: '0.35rem 0.45rem' }}>Add Service</button>
                    </div>
                  ))}
                </div>
                <div className="card" style={{ position: 'sticky', top: '2rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>Cart</h3>
                  {cart.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>Cart is empty</div>
                  ) : (
                    <>
                      <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '1rem' }}>
                        {cart.map(item => (
                          <div key={`${item.itemType}-${item.itemId}`} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.itemName} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({item.itemType})</span></div>
                              <button className="delete-btn" onClick={() => removeFromCart(item.itemId, item.itemType)}>Remove</button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <button className="edit-btn" onClick={() => updateCartItemQty(item.itemId, item.itemType, item.qty - 1)}>−</button>
                              <input type="number" value={item.qty} onChange={(e) => updateCartItemQty(item.itemId, item.itemType, Number(e.target.value))} style={{ width: '50px', textAlign: 'center', padding: '0.25rem' }} />
                              <button className="edit-btn" onClick={() => updateCartItemQty(item.itemId, item.itemType, item.qty + 1)}>+</button>
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatUGX(item.unitPrice * item.qty)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ borderTop: '2px solid var(--border)', paddingTop: '1rem', marginTop: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                          <span>Subtotal:</span>
                          <span style={{ fontWeight: 600 }}>{formatUGX(cartTotal)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--success)' }}>
                          <span>Profit:</span>
                          <span style={{ fontWeight: 600 }}>{formatUGX(cartProfit)}</span>
                        </div>
                        <button className="primary" style={{ width: '100%', fontWeight: 700 }} onClick={completeCartSale}>Complete Sale</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {view === 'services' && (
          <section>
            <div className="page-header">
              <h2>Service Catalog</h2>
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
                  <div className="field">
                    <label>Monthly Shared Cost</label>
                    <input type="number" min={0} value={serviceForm.monthlySharedCost} onChange={(e) => setServiceForm((prev) => ({ ...prev, monthlySharedCost: Number(e.target.value) }))} />
                  </div>
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
                          monthlySharedCost: service.monthlySharedCost || 0
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
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Total</th>
                      <th>Profit</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.length > 0 ? (
                      paginatedSales.map((s) => (
                        <tr key={s.id}>
                          <td>{new Date(s.createdAt).toLocaleString()}</td>
                          <td style={{ fontWeight: 600 }}>{s.itemName}</td>
                          <td>{s.qty}</td>
                          <td>{formatUGX(s.amount)}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatUGX(s.amount - s.cost)}</td>
                          <td>
                            {canManageSalesAndExpenses ? (
                              <button className="delete-btn" onClick={() => deleteSale(s.id)}>Delete</button>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Owner/Admin only</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No sales recorded for this period</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Showing {filteredSales.length === 0 ? 0 : (salesHistoryPage - 1) * salesHistoryPageSize + 1}–{Math.min(salesHistoryPage * salesHistoryPageSize, filteredSales.length)} of {filteredSales.length}
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
              <button className="primary" onClick={() => { setExpenseForm({ id: '', title: '', branchId: branches[0]?.id || '', amount: 0 }); setShowExpenseModal(true); }}>
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
            
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Expense Title</th>
                    <th>Branch</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length > 0 ? (
                    expensesPagination.rows.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.createdAt).toLocaleString()}</td>
                        <td style={{ fontWeight: 600 }}>{e.title}</td>
                        <td>{branchMap[e.branchId]}</td>
                        <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{formatUGX(e.amount)}</td>
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
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No expenses recorded yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls
              totalItems={expenses.length}
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

        {view === 'settings' && (
          <section>
            <div className="page-header">
              <h2>Shop Settings</h2>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)' }}>
              <button onClick={() => setSettingsTab('shop')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'shop' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'shop' ? 600 : 400 }}>Shop Information</button>
              <button onClick={() => setSettingsTab('branches')} style={{ padding: '0.75rem 1.5rem', borderBottom: settingsTab === 'branches' ? '3px solid var(--primary)' : 'none', background: 'none', cursor: 'pointer', fontWeight: settingsTab === 'branches' ? 600 : 400 }}>Manage Branches</button>
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
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>{role}</div>
                </div>
              </div>
            </div>
          </section>
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
                <form onSubmit={(e) => { makeProductSale(e); setShowSaleModal(false); }}>
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
                      <span>Branch</span>
                      <select value={productForm.branchId} onChange={(e) => setProductForm({ ...productForm, branchId: e.target.value })} required>
                        <option value="">Select Branch</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Initial Stock</span>
                      <input type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: Number(e.target.value) })} required />
                    </label>
                    <label className="field">
                      <span>Purchase Price (UGX)</span>
                      <input type="number" value={productForm.purchasePrice} onChange={(e) => setProductForm({ ...productForm, purchasePrice: Number(e.target.value) })} required />
                    </label>
                    <label className="field">
                      <span>Selling Price (UGX)</span>
                      <input type="number" value={productForm.salePrice} onChange={(e) => setProductForm({ ...productForm, salePrice: Number(e.target.value) })} required />
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
