'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isFirebaseConfigured, firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

type Role = 'shop_owner' | 'manager' | 'cashier' | 'stock';
type View = 'dashboard' | 'products' | 'sales' | 'services' | 'expenses' | 'users' | 'branches' | 'reports';
type ReportDataType = 'all' | 'sales' | 'expenses';
type ReportPeriod = 'all' | 'day' | 'week' | 'month' | 'year';

type Branch = { id: string; name: string; location: string; createdAt?: string };
type ShopDetails = { name: string; location: string; description: string };
type AuditStamp = { createdAt: string; createdByUid: string; createdByEmail: string; updatedAt?: string; updatedByUid?: string; updatedByEmail?: string };
type Product = { id: string; name: string; branchId: string; stock: number; purchasePrice: number; salePrice: number } & AuditStamp;
type Sale = { id: string; type: 'product' | 'service'; itemName: string; branchId: string; qty: number; amount: number; cost: number } & AuditStamp;
type Expense = { id: string; title: string; branchId: string; amount: number } & AuditStamp;
type StaffUser = { id: string; name: string; email: string; role: Role; branchId: string } & AuditStamp;
type ShopMembership = { ownerUid: string; shopName: string; role: Role; branchName?: string };

const periodStart = (period: Exclude<ReportPeriod, 'all'>) => {
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
  const [activeShopOwnerUid, setActiveShopOwnerUid] = useState('');
  const [availableShops, setAvailableShops] = useState<ShopMembership[]>([]);
  const [view, setView] = useState<View>('dashboard');
  const [status, setStatus] = useState('Welcome to AlphaPOS Pro.');
  const [needsShopSetup, setNeedsShopSetup] = useState(false);
  const hasLoadedUserDataRef = useRef(false);
  const isSwitchingShopRef = useRef(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [shopDetails, setShopDetails] = useState<ShopDetails>({ name: '', location: '', description: '' });

  const [branchForm, setBranchForm] = useState({ name: '', location: '', id: '' });
  const [productForm, setProductForm] = useState({ id: '', name: '', branchId: '', stock: 0, purchasePrice: 0, salePrice: 0 });
  const [serviceForm, setServiceForm] = useState({ name: '', branchId: '', amount: 0 });
  const [saleForm, setSaleForm] = useState({ productId: '', qty: 1 });
  const [expenseForm, setExpenseForm] = useState({ id: '', title: '', branchId: '', amount: 0 });
  const [userForm, setUserForm] = useState({ id: '', name: '', email: '', role: 'cashier' as Role, branchId: '' });
  const [reportType, setReportType] = useState<ReportDataType>('all');
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('all');

  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const db = firebaseApp ? getFirestore(firebaseApp) : null;
  const formatUGX = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;

  useEffect(() => {
    const app = firebaseApp;
    if (!app) return setLoading(false);
    const auth = getAuth(app);
    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user); setLoading(false); hasLoadedUserDataRef.current = false;
    });
  }, []);

  useEffect(() => {
    const loadUserData = async () => {
      if (!authUser || !db) return;
      const normalizedEmail = authUser.email?.toLowerCase().trim();
      const memberships: ShopMembership[] = [{ ownerUid: authUser.uid, shopName: 'MyShop', branchName: 'MainBranch', role: 'shop_owner' }];
      if (normalizedEmail) {
        const membershipSnap = await getDocs(query(collection(db, 'shopMemberships'), where('email', '==', normalizedEmail)));
        membershipSnap.forEach((m) => {
          const data = m.data();
          if (data.ownerUid && data.ownerUid !== authUser.uid) memberships.push({ ownerUid: data.ownerUid as string, shopName: (data.shopName as string) || 'Shop', branchName: (data.branchName as string) || 'Branch', role: (data.role as Role) || 'cashier' });
        });
      }
      setAvailableShops(memberships);
      const selectedShopOwnerUid = activeShopOwnerUid || memberships[0].ownerUid;
      if (!activeShopOwnerUid) setActiveShopOwnerUid(selectedShopOwnerUid);
      const selectedShop = memberships.find((s) => s.ownerUid === selectedShopOwnerUid);
      const snap = await getDoc(doc(db, 'users', selectedShopOwnerUid, 'pos', 'data'));
      if (!snap.exists()) {
        setNeedsShopSetup(selectedShopOwnerUid === authUser.uid);
        setRole(selectedShop?.role || 'shop_owner');
        hasLoadedUserDataRef.current = true;
        return;
      }
      const data = snap.data();
      setNeedsShopSetup(false);
      setShopDetails(data.shopDetails || { name: '', location: '', description: '' });
      setBranches(Array.isArray(data.branches) ? data.branches : []);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setSales(Array.isArray(data.sales) ? data.sales : []);
      setExpenses(Array.isArray(data.expenses) ? data.expenses : []);
      setUsers(Array.isArray(data.users) ? data.users : []);
      setRole(selectedShop?.role || (data.role as Role) || 'shop_owner');
      hasLoadedUserDataRef.current = true;
      isSwitchingShopRef.current = false;
      setStatus(`Viewing ${selectedShop?.shopName || 'shop'}_${selectedShop?.branchName || 'branch'} as ${selectedShop?.role || role}.`);
    };
    void loadUserData();
  }, [activeShopOwnerUid, authUser, db]);

  useEffect(() => {
    const saveUserData = async () => {
      if (!authUser || !db || !hasLoadedUserDataRef.current || !activeShopOwnerUid || isSwitchingShopRef.current || needsShopSetup) return;
      await setDoc(doc(db, 'users', activeShopOwnerUid, 'pos', 'data'), { role, shopDetails, branches, products, sales, expenses, users, updatedAt: serverTimestamp() }, { merge: true });
    };
    void saveUserData();
  }, [activeShopOwnerUid, authUser, db, role, shopDetails, branches, products, sales, expenses, users, needsShopSetup]);

  const filteredSales = useMemo(() => sales.filter((s) => reportPeriod === 'all' || new Date(s.createdAt) >= periodStart(reportPeriod)), [sales, reportPeriod]);
  const filteredExpenses = useMemo(() => expenses.filter((e) => reportPeriod === 'all' || new Date(e.createdAt) >= periodStart(reportPeriod)), [expenses, reportPeriod]);

  const currentAuditStamp = () => ({ createdAt: new Date().toISOString(), createdByUid: authUser?.uid || 'unknown', createdByEmail: authUser?.email || 'unknown' });
  const canManageUsers = role === 'shop_owner';

  const handleShopSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || !db || !shopDetails.name.trim() || !shopDetails.location.trim()) return;
    const mainBranch = { id: crypto.randomUUID(), name: 'Main Branch', location: shopDetails.location, createdAt: new Date().toISOString() };
    setBranches([mainBranch]);
    await setDoc(doc(db, 'users', authUser.uid, 'pos', 'data'), { role: 'shop_owner', shopDetails, branches: [mainBranch], products: [], sales: [], expenses: [], users: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    setNeedsShopSetup(false);
    setStatus('Shop created successfully.');
  };

  if (loading) return <div className="auth-container"><main className="main auth-container"><p>Loading...</p></main></div>;
  if (!authUser) return <div className="auth-container"><main className="main auth-container"><button className="primary auth-button" onClick={async () => { if (!firebaseApp) return; await signInWithPopup(getAuth(firebaseApp), new GoogleAuthProvider()); }}>Continue with Google</button>{!isFirebaseConfigured && <p className="error">Firebase is not configured.</p>}</main></div>;
  if (needsShopSetup) return <div className="auth-container"><main className="main auth-container"><div className="auth-card"><h1>Create Your Shop</h1><form onSubmit={handleShopSetup} className="form polished-form"><label className="field"><span>Shop Name</span><input value={shopDetails.name} onChange={(e)=>setShopDetails({...shopDetails,name:e.target.value})}/></label><label className="field"><span>Location</span><input value={shopDetails.location} onChange={(e)=>setShopDetails({...shopDetails,location:e.target.value})}/></label><label className="field"><span>Brief Description</span><textarea value={shopDetails.description} onChange={(e)=>setShopDetails({...shopDetails,description:e.target.value})}/></label><button className="primary">Create Shop</button></form></div></main></div>;

  const salesTotals = (period: 'day' | 'week' | 'month' | 'year') => sales.filter((s) => new Date(s.createdAt) >= periodStart(period)).reduce((a, s) => a + s.amount, 0);
  const expenseTotals = (period: 'day' | 'week' | 'month' | 'year') => expenses.filter((e) => new Date(e.createdAt) >= periodStart(period)).reduce((a, e) => a + e.amount, 0);
  const totalRevenue = sales.reduce((a, s) => a + s.amount, 0);
  const grossProfit = totalRevenue - sales.reduce((a, s) => a + s.cost, 0);
  const netProfit = grossProfit - expenses.reduce((a, e) => a + e.amount, 0);

  return <div className="app"><aside className="sidebar"><h2>AlphaPOS Pro</h2><nav className="sidebar-nav">{(['dashboard','products','sales','services','expenses','users','branches','reports'] as View[]).map((v)=><button key={v} className={`nav-button ${view===v?'active':''}`} onClick={()=>setView(v)}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>)}</nav><button className="logout-button" onClick={async()=>{ if (!firebaseApp) return; await signOut(getAuth(firebaseApp)); }}>Logout</button></aside>
  <main className="main"><header className="main-header"><h1>{view.charAt(0).toUpperCase()+view.slice(1)}</h1><div className="status-container">{availableShops.length>1 && <select value={activeShopOwnerUid} onChange={(e)=>setActiveShopOwnerUid(e.target.value)} className="role-select">{availableShops.map((shop)=><option key={shop.ownerUid} value={shop.ownerUid}>{shop.shopName}_{shop.branchName || 'MainBranch'}</option>)}</select>}<span className="status">{status}</span></div></header>
  {view==='dashboard' && <section className="card"><h3>Dashboard Overview</h3><p>Total Revenue: {formatUGX(totalRevenue)}</p><p>Gross Profit: {formatUGX(grossProfit)}</p><p>Net Profit: {formatUGX(netProfit)}</p><p>Today Sales: {formatUGX(salesTotals('day'))}</p><p>This Week Sales: {formatUGX(salesTotals('week'))}</p><p>This Month Sales: {formatUGX(salesTotals('month'))}</p><p>Today Expenses: {formatUGX(expenseTotals('day'))}</p><p>This Month Expenses: {formatUGX(expenseTotals('month'))}</p></section>}
  {view==='products' && <section className="card"><h3>Products</h3><p>Total Products: {products.length}</p><p>Total Stock Units: {products.reduce((sum, product) => sum + product.stock, 0)}</p><p>Branches with Products: {new Set(products.map((product) => product.branchId)).size}</p></section>}
  {view==='services' && <section className="card"><h3>Services</h3><p>Service Sales Count: {sales.filter((sale) => sale.type === 'service').length}</p><p>Service Revenue: {formatUGX(sales.filter((sale) => sale.type === 'service').reduce((sum, sale) => sum + sale.amount, 0))}</p></section>}
  {view==='users' && <section className="card"><h3>Users</h3><p>Total Staff Users: {users.length}</p><p>Managers: {users.filter((u) => u.role === 'manager').length}</p><p>Cashiers: {users.filter((u) => u.role === 'cashier').length}</p><p>Stock Managers: {users.filter((u) => u.role === 'stock').length}</p></section>}
  {view==='branches' && <section className="card"><h3>Branches</h3><p>Total Branches: {branches.length}</p>{branches.length > 0 ? <ul>{branches.map((branch) => <li key={branch.id}>{branch.name} — {branch.location}</li>)}</ul> : <p>No branches added yet.</p>}</section>}
  {view==='sales' && <section className="card"><h3>Record Product Sale</h3><p>Total Sales Records: {sales.length}</p><p>Sales Revenue: {formatUGX(totalRevenue)}</p></section>}
  {view==='expenses' && <section className="card"><h3>Expense Management</h3></section>}
  {view==='reports' && <section className="card"><h3>Sales & Expense Reports</h3><div className="form"><label>Data View<select value={reportType} onChange={(e)=>setReportType(e.target.value as ReportDataType)}><option value="all">All</option><option value="sales">Sales only</option><option value="expenses">Expenses only</option></select></label><label>Period<select value={reportPeriod} onChange={(e)=>setReportPeriod(e.target.value as ReportPeriod)}><option value="all">All Time</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label></div>{(reportType==='all' || reportType==='sales') && <><h4>Sales</h4><p>Total: {formatUGX(filteredSales.reduce((a,s)=>a+s.amount,0))}</p></>}{(reportType==='all' || reportType==='expenses') && <><h4>Expenses</h4><p>Total: {formatUGX(filteredExpenses.reduce((a,e)=>a+e.amount,0))}</p></>}</section>}
  </main></div>;
}
