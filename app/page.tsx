'use client';

import { useEffect, useMemo, useState } from 'react';
import { isFirebaseConfigured, firebaseApp } from '../lib.firebase';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

type Branch = {
  id: string;
  name: string;
  createdAt: string;
};

type OwnerProfile = {
  uid: string;
  email: string;
  displayName: string;
  role: 'platform_admin' | 'shop_owner';
  shopName: string;
  branches: Branch[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

type View = 'dashboard' | 'products' | 'services' | 'sales' | 'expenses' | 'users' | 'customers' | 'branches' | 'reports';

const ADMIN_EMAIL = 'alphacortexai@gmail.com';

export default function Page() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
  const [shopName, setShopName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<View>('dashboard');

  const isAdmin = ownerProfile?.role === 'platform_admin';

  useEffect(() => {
    const app = firebaseApp;
    if (!app) {
      setLoading(false);
      return;
    }

    const auth = getAuth(app);
    return onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setOwnerProfile(null);

      if (!user) {
        setLoading(false);
        return;
      }

      const db = getFirestore(app);
      const ownerRef = doc(db, 'shopOwners', user.uid);
      const ownerSnap = await getDoc(ownerRef);

      if (!ownerSnap.exists()) {
        const created: OwnerProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'Shop Owner',
          role: (user.email || '').toLowerCase() === ADMIN_EMAIL ? 'platform_admin' : 'shop_owner',
          shopName: '',
          branches: [],
        };

        await setDoc(ownerRef, {
          ...created,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        setOwnerProfile(created);
      } else {
        setOwnerProfile(ownerSnap.data() as OwnerProfile);
      }

      setLoading(false);
    });
  }, []);

  const canCreateShop = useMemo(() => !!authUser && !!ownerProfile && !ownerProfile.shopName, [authUser, ownerProfile]);

  async function handleGoogleSignIn() {
    if (!firebaseApp) return;
    const auth = getAuth(firebaseApp);
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async function handleCreateShop(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!firebaseApp || !authUser || !ownerProfile || !shopName.trim()) return;

    const db = getFirestore(firebaseApp);
    const ownerRef = doc(db, 'shopOwners', authUser.uid);

    await updateDoc(ownerRef, {
      shopName: shopName.trim(),
      updatedAt: serverTimestamp(),
    });

    setOwnerProfile({ ...ownerProfile, shopName: shopName.trim() });
    setShopName('');
    setStatus('Shop created successfully.');
  }

  async function handleAddBranch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!firebaseApp || !authUser || !ownerProfile || !branchName.trim()) return;

    const branch: Branch = {
      id: crypto.randomUUID(),
      name: branchName.trim(),
      createdAt: new Date().toISOString(),
    };

    const nextBranches = [...ownerProfile.branches, branch];
    const db = getFirestore(firebaseApp);
    const ownerRef = doc(db, 'shopOwners', authUser.uid);

    await updateDoc(ownerRef, {
      branches: nextBranches,
      updatedAt: serverTimestamp(),
    });

    setOwnerProfile({ ...ownerProfile, branches: nextBranches });
    setBranchName('');
    setStatus('Branch added successfully.');
  }

  async function handleLogout() {
    if (!firebaseApp) return;
    await signOut(getAuth(firebaseApp));
    setOwnerProfile(null);
    setStatus('');
  }

  if (!isFirebaseConfigured) {
    return <div className="auth"><h2>Firebase setup required</h2><p>Add Firebase environment variables before using Google authentication.</p></div>;
  }

  if (loading) return <div className="auth"><p>Loading...</p></div>;

  if (!authUser) {
    return (
      <div className="auth">
        <h2>AlphaPOS Authentication</h2>
        <p>Sign in with Gmail to continue as platform admin or shop owner.</p>
        <button className="primary" onClick={handleGoogleSignIn}>Continue with Google</button>
      </div>
    );
  }

  const sidebarViews: View[] = ['dashboard', 'products', 'services', 'sales', 'expenses', 'users', 'customers', 'branches', 'reports'];

  return (
    <div className="app">
      <aside className="sidebar">
        <h3>AlphaPOS</h3>
        <div>{ownerProfile?.displayName}</div>
        <div>{ownerProfile?.email}</div>
        <div>{isAdmin ? 'Platform Admin' : 'Shop Owner'}</div>
        <nav className="nav">
          {sidebarViews.map((item) => (
            <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <button onClick={handleLogout}>Logout</button>
      </aside>

      <main className="main">
        <h2>{isAdmin ? 'Platform Admin Console' : 'Shop Owner Console'}</h2>

        {canCreateShop && (
          <div className="card">
            <h3>Create your shop</h3>
            <form onSubmit={handleCreateShop}>
              <input
                name="shopName"
                placeholder="Shop name"
                required
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
              />
              <button className="primary">Create Shop</button>
            </form>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="card">
            <h3>Business Dashboard</h3>
            <div className="kpis">
              <div className="kpi"><strong>Branches</strong><div>{ownerProfile?.branches.length ?? 0}</div></div>
              <div className="kpi"><strong>Total Sales</strong><div>Coming soon</div></div>
              <div className="kpi"><strong>Expenses</strong><div>Coming soon</div></div>
              <div className="kpi"><strong>Net Profit</strong><div>Coming soon</div></div>
            </div>
            <p>Next phase connects products, stock, sales, discounts, profits, and cross-branch reports to Firestore collections.</p>
          </div>
        )}

        {view === 'branches' && ownerProfile?.shopName && (
          <div className="card">
            <h3>Shop: {ownerProfile.shopName}</h3>
            <p>Add branches for this shop as needed.</p>
            <form onSubmit={handleAddBranch}>
              <input
                name="branchName"
                placeholder="Branch name"
                required
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
              />
              <button className="primary">Add Branch</button>
            </form>

            <ul>
              {ownerProfile.branches.map((branch) => (
                <li key={branch.id}>{branch.name}</li>
              ))}
            </ul>
          </div>
        )}

        {!['dashboard', 'branches'].includes(view) && (
          <div className="card">
            <h3>{view[0].toUpperCase() + view.slice(1)} Module</h3>
            <p>
              This section is prepared in the UI so you can navigate product management, services, sales, expenses,
              users, customers, and consolidated reporting. Data wiring is the next implementation stage.
            </p>
          </div>
        )}

        {status && <p>{status}</p>}
      </main>
    </div>
  );
}
