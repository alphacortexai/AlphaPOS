'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

type Role = 'shop_owner' | 'manager' | 'cashier' | 'stock';
type View = 'dashboard' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports';

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
  const [status, setStatus] = useState('Welcome to AlphaPOS Pro.');
  const hasLoadedUserDataRef = useRef(false);
  const isSwitchingShopRef = useRef(false);

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

  // Filters
  const [salesDateFilter, setSalesDateFilter] = useState(new Date().toISOString().split('T')[0]);

  const [branchForm, setBranchForm] = useState({ name: '', location: '', id: '' });
  const [productForm, setProductForm] = useState({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
  const [serviceForm, setServiceForm] = useState({ name: '', branchId: '', amount: 0 });
  const [saleForm, setSaleForm] = useState({ productId: '', qty: 1 });
  const [expenseForm, setExpenseForm] = useState({ id: '', title: '', branchId: '', amount: 0 });
  const [userForm, setUserForm] = useState({ id: '', name: '', email: '', role: 'cashier' as Role, branchId: '' });

  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const db = firebaseApp ? getFirestore(firebaseApp) : null;
  const formatUGX = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;

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

  // Metric Calculation Utilities
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

  const dashboardMetrics = useMemo(() => {
    const currentDay = getMetrics('day', 0);
    const prevDay = getMetrics('day', 1);
    const currentWeek = getMetrics('week', 0);
    const prevWeek = getMetrics('week', 1);
    const currentMonth = getMetrics('month', 0);
    const prevMonth = getMetrics('month', 1);

    return {
      sales: {
        value: currentWeek.revenue,
        change: calculateChange(currentWeek.revenue, prevWeek.revenue),
        period: 'week'
      },
      expenses: {
        value: currentWeek.expenseTotal,
        change: calculateChange(currentWeek.expenseTotal, prevWeek.expenseTotal),
        period: 'week'
      },
      products: products.length,
      profits: {
        value: currentDay.netProfit,
        change: calculateChange(currentDay.netProfit, prevDay.netProfit),
        period: 'day'
      },
      grossProfit: {
        value: currentMonth.grossProfit,
        change: calculateChange(currentMonth.grossProfit, prevMonth.grossProfit),
        period: 'month'
      },
      netProfit: {
        value: currentMonth.netProfit,
        change: calculateChange(currentMonth.netProfit, prevMonth.netProfit),
        period: 'month'
      }
    };
  }, [sales, expenses, products]);

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

  const Badge = ({ value }: { value: number }) => (
    <span className={`badge ${value >= 0 ? 'badge-success' : 'badge-danger'}`}>
      {value >= 0 ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>AlphaPOS</h2>
          <div className="sidebar-subtitle">Business Intelligence</div>
        </div>

        <div className="sidebar-section">
          <label className="role-label">Active Shop</label>
          <select className="role-select" value={activeShopOwnerUid} onChange={(e) => handleShopSwitch(e.target.value)}>
            {availableShops.map((s) => (
              <option key={s.ownerUid} value={s.ownerUid}>
                {s.shopName} ({s.role})
              </option>
            ))}
          </select>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-button ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
          <button className={`nav-button ${view === 'products' ? 'active' : ''}`} onClick={() => setView('products')}>Inventory</button>
          <button className={`nav-button ${view === 'sales' ? 'active' : ''}`} onClick={() => setView('sales')}>Sales Desk</button>
          <button className={`nav-button ${view === 'expenses' ? 'active' : ''}`} onClick={() => setView('expenses')}>Expenses</button>
          <button className={`nav-button ${view === 'users' ? 'active' : ''}`} onClick={() => setView('users')}>Staff</button>
          <button className={`nav-button ${view === 'reports' ? 'active' : ''}`} onClick={() => setView('reports')}>Reports</button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div>{authUser.displayName}</div>
            <div style={{ opacity: 0.6 }}>{authUser.email}</div>
          </div>
          <button className="logout-button" onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <main className="main">
        <header className="main-header">
          <h1>{view.charAt(0).toUpperCase() + view.slice(1)}</h1>
          <div className="status-container">
            <span className="status">{status}</span>
          </div>
        </header>

        {view === 'dashboard' && (
          <div className="grid">
            <div className="card dashboard-card">
              <h4>Weekly Sales</h4>
              <div className="card-value">{formatUGX(dashboardMetrics.sales.value)}</div>
              <Badge value={dashboardMetrics.sales.change} />
            </div>
            <div className="card dashboard-card">
              <h4>Weekly Expenses</h4>
              <div className="card-value">{formatUGX(dashboardMetrics.expenses.value)}</div>
              <Badge value={dashboardMetrics.expenses.change} />
            </div>
            <div className="card dashboard-card">
              <h4>Products in Shop</h4>
              <div className="card-value">{dashboardMetrics.products}</div>
              <span className="badge badge-info">Total Stock</span>
            </div>
            <div className="card dashboard-card">
              <h4>Daily Net Profit</h4>
              <div className="card-value">{formatUGX(dashboardMetrics.profits.value)}</div>
              <Badge value={dashboardMetrics.profits.change} />
            </div>
            <div className="card dashboard-card">
              <h4>Monthly Gross Profit</h4>
              <div className="card-value">{formatUGX(dashboardMetrics.grossProfit.value)}</div>
              <Badge value={dashboardMetrics.grossProfit.change} />
            </div>
            <div className="card dashboard-card">
              <h4>Monthly Net Profit</h4>
              <div className="card-value">{formatUGX(dashboardMetrics.netProfit.value)}</div>
              <Badge value={dashboardMetrics.netProfit.change} />
            </div>
          </div>
        )}

        {view === 'products' && (
          <section>
            <div className="page-header">
              <h2>Product Inventory</h2>
              <button className="primary" onClick={() => { setProductForm({ id: '', name: '', branchId: branches[0]?.id || '', stock: 0, purchasePrice: 0, salePrice: 0 }); setShowProductModal(true); }}>
                + Add Product
              </button>
            </div>
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
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</td>
                      <td>{branchMap[p.branchId]}</td>
                      <td>
                        <span className={`badge ${p.stock < 10 ? 'badge-danger' : 'badge-info'}`}>{p.stock}</span>
                      </td>
                      <td>{formatUGX(p.purchasePrice)}</td>
                      <td>{formatUGX(p.salePrice)}</td>
                      <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatUGX(p.salePrice - p.purchasePrice)}</td>
                      <td>
                        <button className="edit-btn" onClick={() => { setProductForm(p); setShowProductModal(true); }}>Edit</button>
                        <button className="delete-btn" onClick={() => setProducts(prev => prev.filter(x => x.id !== p.id))}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {view === 'sales' && (
          <section>
            <div className="page-header">
              <h2>Sales Records</h2>
            </div>
            
            <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', alignItems: 'start' }}>
              <div className="card">
                <h3>Record New Sale</h3>
                <form onSubmit={makeProductSale} className="field" style={{ gap: '1.5rem', marginTop: '1.5rem' }}>
                  <label className="field">
                    <span>Product</span>
                    <select value={saleForm.productId} onChange={(e) => setSaleForm({ ...saleForm, productId: e.target.value })} required>
                      <option value="">Select product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.stock} left)</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Quantity</span>
                    <input type="number" min={1} value={saleForm.qty} onChange={(e) => setSaleForm({ ...saleForm, qty: Number(e.target.value) })} required />
                  </label>
                  <button className="primary">Complete Sale</button>
                </form>
              </div>

              <div>
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
                        <th>Date</th>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>Total</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSales.map((s) => (
                        <tr key={s.id}>
                          <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                          <td style={{ fontWeight: 600 }}>{s.itemName}</td>
                          <td>{s.qty}</td>
                          <td>{formatUGX(s.amount)}</td>
                          <td style={{ color: 'var(--success)' }}>{formatUGX(s.amount - s.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === 'expenses' && (
          <section>
            <div className="page-header">
              <h2>Expense Tracking</h2>
              <button className="primary" onClick={() => { setExpenseForm({ id: '', title: '', branchId: branches[0]?.id || '', amount: 0 }); setShowExpenseModal(true); }}>
                + Add Expense
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Expense Title</th>
                    <th>Branch</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                      <td style={{ fontWeight: 600 }}>{e.title}</td>
                      <td>{branchMap[e.branchId]}</td>
                      <td style={{ color: 'var(--danger)' }}>{formatUGX(e.amount)}</td>
                      <td>
                        <button className="edit-btn" onClick={() => { setExpenseForm(e); setShowExpenseModal(true); }}>Edit</button>
                        <button className="delete-btn" onClick={() => setExpenses(prev => prev.filter(x => x.id !== e.id))}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
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
      </main>
    </div>
  );
}
