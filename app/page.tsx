'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

type Role = 'shop_owner' | 'manager' | 'cashier' | 'stock';
type View = 'dashboard' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports' | 'settings' | 'profile';
type DashboardPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

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
type Sale = { id: string; type: 'product' | 'service'; itemName: string; branchId: string; qty: number; amount: number; cost: number } & AuditStamp;
type Expense = { id: string; title: string; branchId: string; amount: number } & AuditStamp;
type StaffUser = { id: string; name: string; email: string; role: Role; branchId: string } & AuditStamp;
type ShopMembership = { ownerUid: string; shopName: string; role: Role };
type CartItem = { productId: string; productName: string; qty: number; unitPrice: number; unitCost: number; branchId: string };

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
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);

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
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('weekly');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productBranchFilter, setProductBranchFilter] = useState('');
  const [productStockFilter, setProductStockFilter] = useState<'all' | 'low' | 'out'>('all');

  const [branchForm, setBranchForm] = useState({ name: '', location: '', id: '' });
  const [productForm, setProductForm] = useState({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
  const [serviceForm, setServiceForm] = useState({ name: '', branchId: '', amount: 0 });
  const [saleForm, setSaleForm] = useState({ productId: '', qty: 1 });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedBranchForSale, setSelectedBranchForSale] = useState('');
  const [expenseForm, setExpenseForm] = useState({ id: '', title: '', branchId: '', amount: 0 });
  const [userForm, setUserForm] = useState({ id: '', name: '', email: '', role: 'cashier' as Role, branchId: '' });
  const [shopNameForm, setShopNameForm] = useState('');
  const [settingsTab, setSettingsTab] = useState<'shop' | 'branches'>('shop');

  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
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
        setSales([]);
        setExpenses([]);
        setUsers([]);
      }
    });
  }, []);

  useEffect(() => {
    const loadUserData = async () => {
      if (!authUser || !db) return;
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
          return;
        }
        const data = snap.data();
        setBranches(Array.isArray(data.branches) ? data.branches : []);
        setProducts(Array.isArray(data.products) ? data.products : []);
        setSales(Array.isArray(data.sales) ? data.sales : []);
        setExpenses(Array.isArray(data.expenses) ? data.expenses : []);
        setUsers(Array.isArray(data.users) ? data.users : []);
        setRole(selectedShop?.role || (data.role as Role) || 'shop_owner');
        hasLoadedUserDataRef.current = true;
        isSwitchingShopRef.current = false;
        setStatus(`Viewing ${selectedShop?.shopName || 'selected shop'} as ${selectedShop?.role || role}.`);
      } catch (error) {
        setStatus(`Failed to load your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    void loadUserData();
  }, [activeShopOwnerUid, authUser, db]);

  useEffect(() => {
    const saveUserData = async () => {
      if (!authUser || !db || !hasLoadedUserDataRef.current || !activeShopOwnerUid || isSwitchingShopRef.current) return;
      try {
        const userDataRef = doc(db, 'users', activeShopOwnerUid, 'pos', 'data');
        await setDoc(
          userDataRef,
          { role, branches, products, sales, expenses, users, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (error) {
        setStatus(`Failed to auto-save your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    void saveUserData();
  }, [activeShopOwnerUid, authUser, db, role, branches, products, sales, expenses, users]);

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
    setSales([]);
    setExpenses([]);
    setUsers([]);
    setBranchForm({ name: '', location: '', id: '' });
    setProductForm({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
    setServiceForm({ name: '', branchId: '', amount: 0 });
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
    const grossProfit = revenue - cost;
    const netProfit = grossProfit - expenseTotal;

    return { revenue, cost, expenseTotal, grossProfit, netProfit, salesCount: periodSales.length };
  };

  const getMetrics = (period: 'day' | 'week' | 'month', offset: number = 0) => {
    const now = new Date();
    let start: Date, end: Date;

    if (period === 'day') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset + 1);
    } else if (period === 'week') {
      const currentWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
      start = new Date(currentWeekStart.getTime() - offset * 7 * 24 * 60 * 60 * 1000);
      end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
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
    const grossProfit = revenue - cost;
    const netProfit = grossProfit - expenseTotal;

    return { revenue, cost, expenseTotal, grossProfit, netProfit };
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
  }, [sales, expenses, products, dashboardPeriod]);

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

  const saveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name || !productForm.branchId) return;
    if (productForm.id) {
      setProducts((prev) => prev.map((p) => (p.id === productForm.id ? { ...p, ...productForm, ...updatedAuditStamp() } : p)));
      setStatus('Product updated.');
    } else {
      setProducts((prev) => [...prev, { ...productForm, id: crypto.randomUUID(), ...currentAuditStamp() }]);
      setStatus('Product added.');
    }
    setProductForm({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
    setShowProductModal(false);
  };

  const saveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.title || !expenseForm.branchId || expenseForm.amount <= 0) return;
    if (expenseForm.id) {
      setExpenses((prev) => prev.map((ex) => (ex.id === expenseForm.id ? { ...ex, ...expenseForm, ...updatedAuditStamp() } : ex)));
      setStatus('Expense updated.');
    } else {
      setExpenses((prev) => [...prev, { ...expenseForm, id: crypto.randomUUID(), ...currentAuditStamp() }]);
      setStatus('Expense recorded.');
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

  const addToCart = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) {
      showNotification('Product not found', 'error');
      return;
    }
    if (product.stock <= 0) {
      showNotification('Product out of stock', 'error');
      return;
    }
    const existingItem = cart.find(item => item.productId === productId);
    if (existingItem) {
      if (existingItem.qty + 1 > product.stock) {
        showNotification('Insufficient stock for this quantity', 'error');
        return;
      }
      setCart(prev => prev.map(item => 
        item.productId === productId ? { ...item, qty: item.qty + 1 } : item
      ));
    } else {
      setCart(prev => [...prev, {
        productId: product.id,
        productName: product.name,
        qty: 1,
        unitPrice: product.salePrice,
        unitCost: product.purchasePrice,
        branchId: product.branchId
      }]);
    }
    showNotification(`${product.name} added to cart`, 'success', 2000);
  };

  const updateCartItemQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(productId);
      return;
    }
    const product = products.find(p => p.id === productId);
    if (product && qty > product.stock) {
      showNotification(`Only ${product.stock} units available`, 'error');
      return;
    }
    setCart(prev => prev.map(item => 
      item.productId === productId ? { ...item, qty } : item
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
    showNotification('Item removed from cart', 'info', 1500);
  };

  const completeCartSale = () => {
    if (cart.length === 0) {
      showNotification('Cart is empty', 'error');
      return;
    }
    const newSales = cart.map(item => ({
      id: crypto.randomUUID(),
      type: 'product' as const,
      itemName: item.productName,
      branchId: item.branchId,
      qty: item.qty,
      amount: item.unitPrice * item.qty,
      cost: item.unitCost * item.qty,
      ...currentAuditStamp(),
    }));
    setSales(prev => [...newSales, ...prev]);
    const updatedProducts = products.map(p => {
      const cartItem = cart.find(ci => ci.productId === p.id);
      return cartItem ? { ...p, stock: p.stock - cartItem.qty } : p;
    });
    setProducts(updatedProducts);
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
    setSaleForm({ productId: '', qty: 1 });
    setStatus('Sale recorded.');
  };

  const filteredSales = useMemo(() => {
    if (!salesDateFilter) return sales;
    return sales.filter(s => s.createdAt.startsWith(salesDateFilter));
  }, [sales, salesDateFilter]);

  const canManageUsers = role === 'shop_owner' && activeShopOwnerUid === authUser?.uid;
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
    } else {
      setBranches((prev) => [...prev, { id: crypto.randomUUID(), name: branchForm.name, location: branchForm.location, createdAt: new Date().toISOString() }]);
      showNotification('Branch added successfully!', 'success');
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
    showNotification('Branch deleted successfully!', 'success');
  };

  const Badge = ({ value }: { value: number }) => (
    <span className={`badge ${value >= 0 ? 'badge-success' : 'badge-danger'}`}>
      {value >= 0 ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  );

  // Sales performance table state
  const [salesPerformanceSearch, setSalesPerformanceSearch] = useState('');
  const [salesPerformanceFilter, setSalesPerformanceFilter] = useState<'all' | 'product' | 'service'>('all');

  type SalesItem = {
    name: string;
    type: 'product' | 'service';
    qty: number;
    revenue: number;
    count: number;
    avgPerTransaction: number;
  };

  const filteredSalesPerformance = useMemo(() => {
    let filtered: SalesItem[] = Object.entries(chartData.productMap).map(([name, data]) => ({
      name,
      type: 'product' as const,
      qty: data.qty,
      revenue: data.revenue,
      count: data.count,
      avgPerTransaction: data.count > 0 ? data.revenue / data.count : 0,
    }));

    if (salesPerformanceFilter === 'service' || salesPerformanceFilter === 'all') {
      const services: SalesItem[] = Object.entries(chartData.serviceMap).map(([name, data]) => ({
        name,
        type: 'service' as const,
        qty: 0,
        revenue: data.revenue,
        count: data.count,
        avgPerTransaction: data.count > 0 ? data.revenue / data.count : 0,
      }));
      if (salesPerformanceFilter === 'service') {
        filtered = services;
      } else {
        filtered = [...filtered, ...services];
      }
    }

    return filtered
      .filter((item) => item.name.toLowerCase().includes(salesPerformanceSearch.toLowerCase()))
      .sort((a, b) => b.revenue - a.revenue);
  }, [chartData, salesPerformanceSearch, salesPerformanceFilter]);

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
          <button className={`nav-button ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }}>📈 Dashboard</button>
          <button className={`nav-button ${view === 'sales' ? 'active' : ''}`} onClick={() => { setView('sales'); setIsSidebarOpen(false); }}>🛒 Sales Desk</button>
          <button className={`nav-button ${view === 'products' ? 'active' : ''}`} onClick={() => { setView('products'); setIsSidebarOpen(false); }}>📦 Inventory</button>
          <button className={`nav-button ${view === 'expenses' ? 'active' : ''}`} onClick={() => { setView('expenses'); setIsSidebarOpen(false); }}>💰 Expenses</button>
          <button className={`nav-button ${view === 'users' ? 'active' : ''}`} onClick={() => { setView('users'); setIsSidebarOpen(false); }}>👥 Staff</button>
          <button className={`nav-button ${view === 'reports' ? 'active' : ''}`} onClick={() => { setView('reports'); setIsSidebarOpen(false); }}>📊 Reports</button>
          {isShopOwner && <button className={`nav-button ${view === 'settings' ? 'active' : ''}`} onClick={() => { setView('settings'); setIsSidebarOpen(false); }}>⚙️ Settings</button>}
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
          <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            backgroundColor: notification.type === 'success' ? 'var(--success)' : notification.type === 'error' ? 'var(--danger)' : 'var(--info)',
            color: 'white',
            fontSize: '0.875rem',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            animation: 'slideIn 0.3s ease-out'
          }}>
            {notification.message}
          </div>
        )}
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </aside>

      <main className="main">
        <header className="main-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <button className="mobile-menu-toggle" onClick={() => setIsSidebarOpen(true)}>☰</button>
            <h1 style={{ margin: 0 }}>{view.charAt(0).toUpperCase() + view.slice(1)}</h1>
          </div>
          <div className="status-container">
            <span className="status">{status}</span>
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
            </div>

            {/* KPI Cards Grid */}
            <div className="grid">
              <div className="card dashboard-card">
                <h4>💵 Sales ({dashboardPeriod})</h4>
                <div className="card-value">{formatUGX(dashboardMetrics.sales.value)}</div>
                <Badge value={dashboardMetrics.sales.change} />
              </div>
              <div className="card dashboard-card">
                <h4>💰 Expenses ({dashboardPeriod})</h4>
                <div className="card-value">{formatUGX(dashboardMetrics.expenses.value)}</div>
                <Badge value={dashboardMetrics.expenses.change} />
              </div>
              <div className="card dashboard-card">
                <h4>📈 Net Profit ({dashboardPeriod})</h4>
                <div className="card-value" style={{ color: 'var(--success)' }}>{formatUGX(dashboardMetrics.netProfit.value)}</div>
                <Badge value={dashboardMetrics.netProfit.change} />
              </div>
              <div className="card dashboard-card">
                <h4>📦 Products in Stock</h4>
                <div className="card-value">{dashboardMetrics.products}</div>
                <span className="badge badge-info">Total Items</span>
              </div>
              <div className="card dashboard-card">
                <h4>📊 Gross Profit ({dashboardPeriod})</h4>
                <div className="card-value">{formatUGX(dashboardMetrics.grossProfit.value)}</div>
                <Badge value={dashboardMetrics.grossProfit.change} />
              </div>
              <div className="card dashboard-card">
                <h4>🎯 Transactions ({dashboardPeriod})</h4>
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

            {/* Sales Performance Table */}
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 700 }}>Sales Performance</h3>
              <div className="filter-bar">
                <div className="filter-group" style={{ flex: 1 }}>
                  <label>Search Item</label>
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={salesPerformanceSearch}
                    onChange={(e) => setSalesPerformanceSearch(e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label>Type</label>
                  <select value={salesPerformanceFilter} onChange={(e) => setSalesPerformanceFilter(e.target.value as 'all' | 'product' | 'service')}>
                    <option value="all">All Items</option>
                    <option value="product">Products</option>
                    <option value="service">Services</option>
                  </select>
                </div>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item Name</th>
                      <th>Type</th>
                      <th>Units Sold</th>
                      <th>Transactions</th>
                      <th>Total Revenue</th>
                      <th>Avg per Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSalesPerformance.length > 0 ? (
                      filteredSalesPerformance.map((item, idx) => (
                        <tr key={`${item.type}-${item.name}-${idx}`}>
                          <td style={{ fontWeight: 600 }}>{item.name}</td>
                          <td>
                            <span className={`badge ${item.type === 'product' ? 'badge-info' : 'badge-success'}`}>
                              {item.type === 'product' ? 'Product' : 'Service'}
                            </span>
                          </td>
                          <td>{item.qty}</td>
                          <td>{item.count}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatUGX(item.revenue)}</td>
                          <td>{formatUGX(item.avgPerTransaction)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                          No sales data available for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
            <div className="filter-bar">
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
                    filteredProducts.map((p) => (
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
                          <button className="delete-btn" onClick={() => setProducts(prev => prev.filter(x => x.id !== p.id))}>Delete</button>
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
          </section>
        )}

        {view === 'sales' && (
          <section>
            <div className="page-header">
              <h2>Sales Desk</h2>
              <button className="primary" onClick={() => { setCart([]); setShowSaleModal(true); }}>+ New Sale</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem', marginBottom: '2rem' }}>
              {/* Products Selection */}
              <div>
                <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 700 }}>Available Products</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                  {products.filter(p => p.stock > 0).map(p => (
                    <div key={p.id} className="card" style={{ cursor: 'pointer', transition: 'all 0.2s ease' }} onClick={() => addToCart(p.id)}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Product</div>
                        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Price</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{formatUGX(p.salePrice)}</div>
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <span className="badge badge-info">Stock: {p.stock}</span>
                      </div>
                      <button className="primary" style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.8rem' }}>Add to Cart</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cart Summary */}
              <div>
                <div className="card" style={{ position: 'sticky', top: '2rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>Cart</h3>
                  {cart.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>Cart is empty</div>
                  ) : (
                    <>
                      <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '1rem' }}>
                        {cart.map(item => (
                          <div key={item.productId} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.productName}</div>
                              <button className="delete-btn" onClick={() => removeFromCart(item.productId)}>Remove</button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <button className="edit-btn" onClick={() => updateCartItemQty(item.productId, item.qty - 1)}>−</button>
                              <input type="number" value={item.qty} onChange={(e) => updateCartItemQty(item.productId, Number(e.target.value))} style={{ width: '50px', textAlign: 'center', padding: '0.25rem' }} />
                              <button className="edit-btn" onClick={() => updateCartItemQty(item.productId, item.qty + 1)}>+</button>
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

            {/* Sales History */}
            <div>
              <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 700 }}>Sales History</h3>
              <div className="filter-bar">
                <div className="filter-group">
                  <label>Filter by Date</label>
                  <input type="date" value={salesDateFilter} onChange={(e) => setSalesDateFilter(e.target.value)} />
                </div>
                <button className="edit-btn" onClick={() => setSalesDateFilter(new Date().toISOString().split('T')[0])}>Today</button>
                <button className="edit-btn" onClick={() => setSalesDateFilter('')}>All Time</button>
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.length > 0 ? (
                      filteredSales.map((s) => (
                        <tr key={s.id}>
                          <td>{new Date(s.createdAt).toLocaleString()}</td>
                          <td style={{ fontWeight: 600 }}>{s.itemName}</td>
                          <td>{s.qty}</td>
                          <td>{formatUGX(s.amount)}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatUGX(s.amount - s.cost)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No sales recorded for this period</td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
                    expenses.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.createdAt).toLocaleString()}</td>
                        <td style={{ fontWeight: 600 }}>{e.title}</td>
                        <td>{branchMap[e.branchId]}</td>
                        <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{formatUGX(e.amount)}</td>
                        <td>
                          <button className="edit-btn" onClick={() => { setExpenseForm(e); setShowExpenseModal(true); }}>Edit</button>
                          <button className="delete-btn" onClick={() => setExpenses(prev => prev.filter(x => x.id !== e.id))}>Delete</button>
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
                        users.map((u) => (
                          <tr key={u.id}>
                            <td style={{ fontWeight: 600 }}>{u.name}</td>
                            <td>{u.email}</td>
                            <td>
                              <span className={`badge ${u.role === 'manager' ? 'badge-warning' : 'badge-success'}`}>
                                {u.role === 'manager' ? '👔 Manager' : '💼 Cashier'}
                              </span>
                            </td>
                            <td>{branchMap[u.branchId]}</td>
                            <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                            <td>
                              <button className="edit-btn" onClick={() => { setUserForm(u); setShowUserModal(true); }}>Edit</button>
                              <button className="delete-btn" onClick={() => setUsers(prev => prev.filter(x => x.id !== u.id))}>Remove</button>
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
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
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
                <div className="grid">
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
