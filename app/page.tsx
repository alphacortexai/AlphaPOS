'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isFirebaseConfigured, firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';

type Role = 'shop_owner' | 'manager' | 'cashier' | 'stock';
type View = 'dashboard' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports';

type Branch = { id: string; name: string; location: string; createdAt?: string };
type Product = { id: string; name: string; branchId: string; stock: number; purchasePrice: number; salePrice: number };
type Sale = { id: string; type: 'product' | 'service'; itemName: string; branchId: string; qty: number; amount: number; cost: number; createdAt: string };
type Expense = { id: string; title: string; branchId: string; amount: number; createdAt: string };
type StaffUser = { id: string; name: string; email: string; role: Role; branchId: string };

const periodStart = (period: 'day' | 'week' | 'month' | 'year') => {
  const d = new Date();
  if (period === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), 0, 1);
};

export default function Page() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role>('shop_owner');
  const [view, setView] = useState<View>('dashboard');
  const [status, setStatus] = useState('Welcome to AlphaPOS Pro.');
  const hasLoadedUserDataRef = useRef(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);

  const [branchForm, setBranchForm] = useState({ name: '', location: '', id: '' });
  const [productForm, setProductForm] = useState({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
  const [serviceForm, setServiceForm] = useState({ name: '', branchId: '', amount: 0 });
  const [saleForm, setSaleForm] = useState({ productId: '', qty: 1 });
  const [expenseForm, setExpenseForm] = useState({ id: '', title: '', branchId: '', amount: 0 });
  const [userForm, setUserForm] = useState({ id: '', name: '', email: '', role: 'cashier' as Role, branchId: '' });

  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const db = firebaseApp ? getFirestore(firebaseApp) : null;

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
        const userDataRef = doc(db, 'users', authUser.uid, 'pos', 'data');
        const snap = await getDoc(userDataRef);
        if (!snap.exists()) {
          const defaultBranch = { id: crypto.randomUUID(), name: 'Main Branch', location: 'HQ', createdAt: new Date().toISOString() };
          setBranches([defaultBranch]);
          hasLoadedUserDataRef.current = true;
          return;
        }
        const data = snap.data();
        setBranches(Array.isArray(data.branches) ? data.branches : []);
        setProducts(Array.isArray(data.products) ? data.products : []);
        setSales(Array.isArray(data.sales) ? data.sales : []);
        setExpenses(Array.isArray(data.expenses) ? data.expenses : []);
        setUsers(Array.isArray(data.users) ? data.users : []);
        setRole((data.role as Role) || 'shop_owner');
        hasLoadedUserDataRef.current = true;
      } catch (error) {
        setStatus(`Failed to load your data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    void loadUserData();
  }, [authUser, db]);

  useEffect(() => {
    const saveUserData = async () => {
      if (!authUser || !db || !hasLoadedUserDataRef.current) return;
      try {
        const userDataRef = doc(db, 'users', authUser.uid, 'pos', 'data');
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
  }, [authUser, db, role, branches, products, sales, expenses, users]);

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

  const salesTotals = (period: 'day' | 'week' | 'month' | 'year') => {
    const start = periodStart(period);
    return sales.filter((s) => new Date(s.createdAt) >= start).reduce((a, s) => a + s.amount, 0);
  };

  const expenseTotals = (period: 'day' | 'week' | 'month' | 'year') => {
    const start = periodStart(period);
    return expenses.filter((e) => new Date(e.createdAt) >= start).reduce((a, e) => a + e.amount, 0);
  };

  const totalCost = sales.reduce((a, s) => a + s.cost, 0);
  const totalRevenue = sales.reduce((a, s) => a + s.amount, 0);
  const grossProfit = totalRevenue - totalCost;
  const netProfit = grossProfit - expenses.reduce((a, e) => a + e.amount, 0);

  const canManageUsers = role === 'shop_owner';

  const saveBranch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchForm.name.trim()) return;
    if (branchForm.id) {
      setBranches((prev) => prev.map((b) => (b.id === branchForm.id ? { ...b, name: branchForm.name, location: branchForm.location } : b)));
      setStatus('Branch updated.');
    } else {
      setBranches((prev) => [...prev, { id: crypto.randomUUID(), name: branchForm.name, location: branchForm.location, createdAt: new Date().toISOString() }]);
      setStatus('Branch created.');
    }
    setBranchForm({ name: '', location: '', id: '' });
  };

  const saveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name || !productForm.branchId) return;
    const payload = { ...productForm, stock: Number(productForm.stock), purchasePrice: Number(productForm.purchasePrice), salePrice: Number(productForm.salePrice) };
    if (productForm.id) {
      setProducts((prev) => prev.map((p) => (p.id === productForm.id ? { ...p, ...payload } : p)));
      setStatus('Product updated.');
    } else {
      setProducts((prev) => [...prev, { ...payload, id: crypto.randomUUID() }]);
      setStatus('Product created.');
    }
    setProductForm({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
  };

  const makeProductSale = (e: React.FormEvent) => {
    e.preventDefault();
    const p = products.find((x) => x.id === saleForm.productId);
    if (!p || saleForm.qty < 1 || p.stock < saleForm.qty) return setStatus('Not enough stock for sale.');
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, stock: x.stock - saleForm.qty } : x)));
    setSales((prev) => [...prev, { id: crypto.randomUUID(), type: 'product', itemName: p.name, branchId: p.branchId, qty: saleForm.qty, amount: p.salePrice * saleForm.qty, cost: p.purchasePrice * saleForm.qty, createdAt: new Date().toISOString() }]);
    setStatus('Product sale recorded and stock deducted.');
    setSaleForm({ productId: '', qty: 1 });
  };

  const makeServiceSale = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceForm.name || !serviceForm.branchId || serviceForm.amount <= 0) return;
    setSales((prev) => [...prev, { id: crypto.randomUUID(), type: 'service', itemName: serviceForm.name, branchId: serviceForm.branchId, qty: 1, amount: Number(serviceForm.amount), cost: 0, createdAt: new Date().toISOString() }]);
    setServiceForm({ name: '', branchId: '', amount: 0 });
    setStatus('Service sale recorded.');
  };

  const saveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.title || !expenseForm.branchId || expenseForm.amount <= 0) return;
    if (expenseForm.id) {
      setExpenses((prev) => prev.map((x) => (x.id === expenseForm.id ? { ...x, ...expenseForm, amount: Number(expenseForm.amount) } : x)));
      setStatus('Expense updated.');
    } else {
      setExpenses((prev) => [...prev, { id: crypto.randomUUID(), title: expenseForm.title, branchId: expenseForm.branchId, amount: Number(expenseForm.amount), createdAt: new Date().toISOString() }]);
      setStatus('Expense added.');
    }
    setExpenseForm({ id: '', title: '', branchId: '', amount: 0 });
  };

  const saveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) return setStatus('Only shop owner can manage users.');
    if (!userForm.name || !userForm.email || !userForm.branchId) return;
    if (userForm.id) {
      setUsers((prev) => prev.map((x) => (x.id === userForm.id ? { ...x, ...userForm } : x)));
      setStatus('User updated.');
    } else {
      setUsers((prev) => [...prev, { ...userForm, id: crypto.randomUUID() }]);
      setStatus('User created.');
    }
    setUserForm({ id: '', name: '', email: '', role: 'cashier', branchId: '' });
  };

  if (loading) {
    return <div className="app"><main className="main"><p>Loading...</p></main></div>;
  }

  if (!authUser) {
    return (
      <div className="app">
        <main className="main auth-container">
          <div className="auth-card">
            <h1>AlphaPOS Pro</h1>
            <p className="subtitle">Professional Point of Sale Management System</p>
            <button className="primary auth-button" onClick={handleLogin}>
              Sign in with Google
            </button>
            {!isFirebaseConfigured && <p className="error">Firebase is not configured. Please set up environment variables.</p>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>AlphaPOS Pro</h2>
          <p className="sidebar-subtitle">Professional POS</p>
        </div>

        <div className="sidebar-section">
          <label className="role-label">Your Role:</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="role-select">
            <option value="shop_owner">Shop Owner</option>
            <option value="manager">Manager</option>
            <option value="cashier">Cashier</option>
            <option value="stock">Stock Manager</option>
          </select>
        </div>

        <nav className="sidebar-nav">
          {(['dashboard', 'products', 'sales', 'services', 'expenses', 'users', 'branches', 'reports'] as View[]).map((v) => (
            <button key={v} className={`nav-button ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <p className="user-email">{authUser.email}</p>
          </div>
          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="main-header glass">
          <h1>{view.charAt(0).toUpperCase() + view.slice(1)}</h1>
          <p className="status">{status}</p>
        </header>

        {view === 'dashboard' && (
          <section className="grid">
            {[
              ['Daily Sales', salesTotals('day')],
              ['Weekly Sales', salesTotals('week')],
              ['Monthly Sales', salesTotals('month')],
              ['Yearly Sales', salesTotals('year')],
              ['Gross Profit', grossProfit],
              ['Net Profit', netProfit],
              ['Products', products.length],
              ['Users', users.length],
            ].map(([k, v]) => (
              <article key={String(k)} className="card dashboard-card">
                <h4>{k}</h4>
                <strong className="card-value">${Number(v).toFixed(2)}</strong>
              </article>
            ))}
          </section>
        )}

        {view === 'branches' && (
          <section className="card">
            <h3>Branch Management</h3>
            <form onSubmit={saveBranch} className="form">
              <input placeholder="Branch name" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} />
              <input placeholder="Location" value={branchForm.location} onChange={(e) => setBranchForm({ ...branchForm, location: e.target.value })} />
              <button className="primary">{branchForm.id ? 'Update' : 'Add'} Branch</button>
            </form>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.location}</td>
                    <td>
                      <button className="edit-btn" onClick={() => setBranchForm({ id: b.id, name: b.name, location: b.location })}>
                        Edit
                      </button>
                      <button className="delete-btn" onClick={() => setBranches((prev) => prev.filter((x) => x.id !== b.id))}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {view === 'products' && (
          <section className="card">
            <h3>Product Management</h3>
            <form onSubmit={saveProduct} className="form">
              <input placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
              <select value={productForm.branchId} onChange={(e) => setProductForm({ ...productForm, branchId: e.target.value })}>
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input type="number" placeholder="Stock" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: Number(e.target.value) })} />
              <input type="number" placeholder="Purchase Price" value={productForm.purchasePrice} onChange={(e) => setProductForm({ ...productForm, purchasePrice: Number(e.target.value) })} />
              <input type="number" placeholder="Sale Price" value={productForm.salePrice} onChange={(e) => setProductForm({ ...productForm, salePrice: Number(e.target.value) })} />
              <button className="primary">{productForm.id ? 'Update' : 'Add'} Product</button>
            </form>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Branch</th>
                  <th>Stock</th>
                  <th>Buy</th>
                  <th>Sell</th>
                  <th>Unit Profit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{branchMap[p.branchId]}</td>
                    <td>{p.stock}</td>
                    <td>${p.purchasePrice.toFixed(2)}</td>
                    <td>${p.salePrice.toFixed(2)}</td>
                    <td>${(p.salePrice - p.purchasePrice).toFixed(2)}</td>
                    <td>
                      <button className="edit-btn" onClick={() => setProductForm(p)}>
                        Edit
                      </button>
                      <button className="delete-btn" onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {view === 'sales' && (
          <section className="card">
            <h3>Record Product Sale</h3>
            <form onSubmit={makeProductSale} className="form">
              <select value={saleForm.productId} onChange={(e) => setSaleForm({ ...saleForm, productId: e.target.value })}>
                <option value="">Select product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.stock} in stock)
                  </option>
                ))}
              </select>
              <input type="number" min={1} value={saleForm.qty} onChange={(e) => setSaleForm({ ...saleForm, qty: Number(e.target.value) })} placeholder="Quantity" />
              <button className="primary">Record Sale</button>
            </form>
            <div className="sales-summary">
              <p>Recent Sales: {sales.length}</p>
              <p>Total Revenue: ${totalRevenue.toFixed(2)}</p>
            </div>
          </section>
        )}

        {view === 'services' && (
          <section className="card">
            <h3>Record Service Sale</h3>
            <form onSubmit={makeServiceSale} className="form">
              <input placeholder="Service name" value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} />
              <select value={serviceForm.branchId} onChange={(e) => setServiceForm({ ...serviceForm, branchId: e.target.value })}>
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input type="number" placeholder="Amount" value={serviceForm.amount} onChange={(e) => setServiceForm({ ...serviceForm, amount: Number(e.target.value) })} />
              <button className="primary">Record Service</button>
            </form>
          </section>
        )}

        {view === 'expenses' && (
          <section className="card">
            <h3>Expense Management</h3>
            <form onSubmit={saveExpense} className="form">
              <input placeholder="Expense title" value={expenseForm.title} onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })} />
              <select value={expenseForm.branchId} onChange={(e) => setExpenseForm({ ...expenseForm, branchId: e.target.value })}>
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input type="number" placeholder="Amount" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: Number(e.target.value) })} />
              <button className="primary">{expenseForm.id ? 'Update' : 'Add'} Expense</button>
            </form>
            <div className="expense-summary">
              <p>Day: ${expenseTotals('day').toFixed(2)} | Week: ${expenseTotals('week').toFixed(2)} | Month: ${expenseTotals('month').toFixed(2)} | Year: ${expenseTotals('year').toFixed(2)}</p>
            </div>
            <table className="data-table">
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td>{branchMap[e.branchId]}</td>
                    <td>${e.amount.toFixed(2)}</td>
                    <td>
                      <button className="edit-btn" onClick={() => setExpenseForm({ id: e.id, title: e.title, branchId: e.branchId, amount: e.amount })}>
                        Edit
                      </button>
                      <button className="delete-btn" onClick={() => setExpenses((prev) => prev.filter((x) => x.id !== e.id))}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {view === 'users' && (
          <section className="card">
            <h3>User Management</h3>
            {canManageUsers ? (
              <>
                <form onSubmit={saveUser} className="form">
                  <input placeholder="Name" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                  <input placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
                  <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as Role })}>
                    <option value="manager">Manager</option>
                    <option value="cashier">Cashier</option>
                    <option value="stock">Stock Manager</option>
                  </select>
                  <select value={userForm.branchId} onChange={(e) => setUserForm({ ...userForm, branchId: e.target.value })}>
                    <option value="">Select branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button className="primary">{userForm.id ? 'Update' : 'Add'} User</button>
                </form>
                <table className="data-table">
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.email}</td>
                        <td>{u.role}</td>
                        <td>{branchMap[u.branchId]}</td>
                        <td>
                          <button className="edit-btn" onClick={() => setUserForm(u)}>
                            Edit
                          </button>
                          <button className="delete-btn" onClick={() => setUsers((prev) => prev.filter((x) => x.id !== u.id))}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p>Only shop owners can manage users.</p>
            )}
          </section>
        )}

        {view === 'reports' && (
          <section className="card">
            <h3>Sales & Expense Reports</h3>
            <div className="reports-summary">
              <p>
                <strong>Sales:</strong> Daily: ${salesTotals('day').toFixed(2)} | Weekly: ${salesTotals('week').toFixed(2)} | Monthly: ${salesTotals('month').toFixed(2)} | Yearly: ${salesTotals('year').toFixed(2)}
              </p>
              <p>
                <strong>Net Profit:</strong> ${netProfit.toFixed(2)}
              </p>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Item</th>
                  <th>Branch</th>
                  <th>Amount</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                    <td>{s.type}</td>
                    <td>{s.itemName}</td>
                    <td>{branchMap[s.branchId]}</td>
                    <td>${s.amount.toFixed(2)}</td>
                    <td>${(s.amount - s.cost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
