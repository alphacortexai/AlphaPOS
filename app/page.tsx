'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isFirebaseConfigured, firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';

type Role = 'shop_owner' | 'manager' | 'cashier' | 'stock';
type Category = 'dashboard' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports';
type View = Category | 'settings';

type Branch = { id: string; name: string; location: string; createdAt?: string };
type Product = { id: string; name: string; branchId: string; stock: number; purchasePrice: number; salePrice: number };
type Sale = { id: string; type: 'product' | 'service'; itemName: string; branchId: string; qty: number; amount: number; cost: number; createdAt: string };
type Expense = { id: string; title: string; branchId: string; amount: number; createdAt: string };
type StaffUser = { id: string; name: string; email: string; role: Role; branchId: string };
type PermissionMatrix = Record<Role, Record<Category, boolean>>;

const categories: Category[] = ['dashboard', 'products', 'sales', 'services', 'expenses', 'users', 'branches', 'reports'];
const defaultPermissions: PermissionMatrix = {
  shop_owner: Object.fromEntries(categories.map((c) => [c, true])) as Record<Category, boolean>,
  manager: { dashboard: true, products: true, sales: true, services: true, expenses: true, users: false, branches: false, reports: true },
  cashier: { dashboard: true, products: false, sales: true, services: true, expenses: false, users: false, branches: false, reports: false },
  stock: { dashboard: true, products: true, sales: false, services: false, expenses: false, users: false, branches: false, reports: false },
};

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
  const [activeShopId, setActiveShopId] = useState('');
  const [permissions, setPermissions] = useState<PermissionMatrix>(defaultPermissions);
  const [assignedBranchId, setAssignedBranchId] = useState('');
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

  const db = firebaseApp ? getFirestore(firebaseApp) : null;
  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const formatUGX = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;
  const canManageUsers = role === 'shop_owner' || permissions[role].users;
  const allowedBranchIds = role === 'shop_owner' ? branches.map((b) => b.id) : assignedBranchId ? [assignedBranchId] : [];
  const canAccess = (c: Category) => role === 'shop_owner' || permissions[role][c];
  const visibleProducts = products.filter((p) => allowedBranchIds.includes(p.branchId));
  const visibleSales = sales.filter((s) => allowedBranchIds.includes(s.branchId));
  const visibleExpenses = expenses.filter((e) => allowedBranchIds.includes(e.branchId));

  useEffect(() => {
    if (!firebaseApp) return setLoading(false);
    const auth = getAuth(firebaseApp);
    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setLoading(false);
      hasLoadedUserDataRef.current = false;
    });
  }, []);

  useEffect(() => {
    const loadUserData = async () => {
      if (!authUser || !db) return;
      const emailKey = (authUser.email || '').toLowerCase();
      const inviteSnap = emailKey ? await getDoc(doc(db, 'shopInvites', emailKey)) : null;
      const invite = inviteSnap?.exists() ? inviteSnap.data() : null;
      const shopId = (invite?.shopId as string) || authUser.uid;
      setActiveShopId(shopId);
      setRole((invite?.role as Role) || 'shop_owner');
      setAssignedBranchId((invite?.branchId as string) || '');

      const shopDataRef = doc(db, 'shops', shopId, 'pos', 'data');
      const snap = await getDoc(shopDataRef);
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
      setPermissions((data.permissions as PermissionMatrix) || defaultPermissions);
      hasLoadedUserDataRef.current = true;
    };
    void loadUserData();
  }, [authUser, db]);

  useEffect(() => {
    const saveUserData = async () => {
      if (!authUser || !db || !hasLoadedUserDataRef.current || !activeShopId) return;
      const shopDataRef = doc(db, 'shops', activeShopId, 'pos', 'data');
      await setDoc(shopDataRef, { branches, products, sales, expenses, users, permissions, updatedAt: serverTimestamp() }, { merge: true });
    };
    void saveUserData();
  }, [authUser, db, activeShopId, branches, products, sales, expenses, users, permissions]);

  const handleLogin = async () => firebaseApp && signInWithPopup(getAuth(firebaseApp), new GoogleAuthProvider());
  const handleLogout = async () => firebaseApp && signOut(getAuth(firebaseApp));
  const salesTotals = (p: 'day' | 'week' | 'month' | 'year') => visibleSales.filter((s) => new Date(s.createdAt) >= periodStart(p)).reduce((a, s) => a + s.amount, 0);
  const expenseTotals = (p: 'day' | 'week' | 'month' | 'year') => visibleExpenses.filter((e) => new Date(e.createdAt) >= periodStart(p)).reduce((a, e) => a + e.amount, 0);

  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !canManageUsers || !userForm.email || !userForm.branchId || !activeShopId) return;
    const payload = { ...userForm, id: userForm.id || crypto.randomUUID() };
    setUsers((prev) => (userForm.id ? prev.map((x) => (x.id === userForm.id ? payload : x)) : [...prev, payload]));
    await setDoc(doc(collection(db, 'shopInvites'), userForm.email.toLowerCase()), { shopId: activeShopId, role: userForm.role, branchId: userForm.branchId, updatedAt: serverTimestamp() }, { merge: true });
    setUserForm({ id: '', name: '', email: '', role: 'cashier', branchId: '' });
    setStatus('User added to your shop. They will login into your shop workspace with assigned permissions.');
  };

  if (loading) return <div className="main auth-container">Loading...</div>;
  if (!authUser) return <div className="auth-container"><div className="auth-card"><span className="auth-badge">AlphaPOS Pro</span><h1>Welcome back</h1><p className="subtitle">Sign in to access your workspace.</p><button className="primary auth-button" onClick={handleLogin}>Sign in with Google</button></div></div>;

  return <div className="app"><aside className="sidebar"><div className="sidebar-header"><h2>AlphaPOS Pro</h2><p className="sidebar-subtitle">Smart retail operations</p></div><nav className="sidebar-nav">{([...categories, 'settings'] as View[]).filter((v) => v === 'settings' ? role === 'shop_owner' : canAccess(v as Category)).map((v) => <button className={`nav-button ${view===v?'active':''}`} key={v} onClick={() => setView(v)}>{v}</button>)}</nav><div className="sidebar-footer"><div className="user-info"><p className="user-email">{authUser.email}</p></div><button className="logout-button" onClick={handleLogout}>Logout</button></div></aside><main className="main"><header className="main-header glass"><h1>{view}</h1><p className="status">{status}</p></header>{view==='users'&&canManageUsers&&<form className='form polished-form' onSubmit={saveUser}><input placeholder='Name' value={userForm.name} onChange={(e)=>setUserForm({...userForm,name:e.target.value})}/><input placeholder='Email' value={userForm.email} onChange={(e)=>setUserForm({...userForm,email:e.target.value})}/><select value={userForm.role} onChange={(e)=>setUserForm({...userForm,role:e.target.value as Role})}><option value='manager'>Manager</option><option value='cashier'>Cashier</option><option value='stock'>Stock</option></select><select value={userForm.branchId} onChange={(e)=>setUserForm({...userForm,branchId:e.target.value})}><option value=''>Select branch</option>{branches.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select><button className='primary'>Add User</button></form>}{view==='settings'&&role==='shop_owner'&&<section className='card'><h3>Role Permissions</h3>{(['manager','cashier','stock'] as Role[]).map((r)=><div key={r}><h4>{r}</h4>{categories.map((c)=><label key={c}><input type='checkbox' checked={permissions[r][c]} onChange={(e)=>setPermissions((prev)=>({...prev,[r]:{...prev[r],[c]:e.target.checked}}))}/>{c}</label>)}</div>)}</section>}<p className='sales-summary'>Visible products: {visibleProducts.length} | sales: {visibleSales.length} | expenses: {visibleExpenses.length}</p></main></div>;
}
