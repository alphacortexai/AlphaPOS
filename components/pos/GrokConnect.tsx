'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { deleteDoc, deleteField, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../lib.firebase';
import {
  buildGrokSnapshot,
  grokConnectionFromSecret,
  grokConnectorUrl,
  grokLinkId,
  grokOriginIsPublic,
  isGrokToken,
  newGrokToken,
  type GrokSource,
} from '../../lib/pos/grokLink';
import type { ShopClock } from '../../lib/pos/reports';

type Notice = (message: string, type?: 'success' | 'error' | 'info') => void;

type PanelState = {
  mode: 'loading' | 'local' | 'ready';
  connected: boolean;
  address: string;
  token: string;
  publicOrigin: boolean;
  sentAt: string;
  salesTruncatedBefore: string;
  error: string;
  busy: boolean;
  clock: ShopClock;
  connect: () => void;
  disconnect: () => void;
};

const EMPTY_CLOCK: ShopClock = { timezoneOffsetMinutes: 0, dayStartTime: '00:00' };

const panelEmpty = (): PanelState => ({
  mode: 'loading',
  connected: false,
  address: '',
  token: '',
  publicOrigin: false,
  sentAt: '',
  salesTruncatedBefore: '',
  error: '',
  busy: false,
  clock: EMPTY_CLOCK,
  connect: () => undefined,
  disconnect: () => undefined,
});

let panelState = panelEmpty();
const listeners = new Set<() => void>();
const publishPanel = (next: PanelState) => {
  panelState = next;
  listeners.forEach((listener) => listener());
};

const subscribePanel = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const STORAGE_KEY = 'alphapos.grokToken.v1';

const readStoredToken = (ownerUid: string) => {
  if (typeof window === 'undefined' || !ownerUid) return '';
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const token = (parsed as Record<string, unknown>)[ownerUid];
    return typeof token === 'string' && isGrokToken(token) ? token : '';
  } catch {
    return '';
  }
};

const writeStoredToken = (ownerUid: string, token: string) => {
  if (typeof window === 'undefined' || !ownerUid) return;
  const parsed = (() => {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as unknown;
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {};
    } catch {
      return {};
    }
  })();
  if (token) parsed[ownerUid] = token;
  else delete parsed[ownerUid];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
};

const denied = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
  const message = error instanceof Error ? error.message : '';
  return code.includes('permission-denied') || /permission/i.test(message);
};

const formatSent = (iso: string, clock: ShopClock) => {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  const shifted = new Date(instant.getTime() + clock.timezoneOffsetMinutes * 60 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}, ${hour}:${minute}`;
};

export function GrokConnectSync({
  enabled,
  ownerUid,
  source,
  notify,
  onActivity,
}: {
  enabled: boolean;
  ownerUid: string;
  source: GrokSource;
  notify: Notice;
  onActivity: (action: string, details: string) => void;
}) {
  const [connection, setConnection] = useState({ connected: false, token: '', known: false });
  const [sentAt, setSentAt] = useState('');
  const [salesTruncatedBefore, setSalesTruncatedBefore] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const sourceRef = useRef(source);
  const sentBody = useRef('');
  const sentAtMs = useRef(0);
  const holdToken = useRef('');
  sourceRef.current = source;

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!enabled || !db || !ownerUid) {
      setConnection({ connected: false, token: '', known: true });
      return undefined;
    }
    const local = readStoredToken(ownerUid);
    if (local) setConnection({ connected: true, token: local, known: false });
    return onSnapshot(doc(db, 'users', ownerUid, 'pos', 'secrets'), (snap) => {
      const next = grokConnectionFromSecret(snap.exists() ? snap.data() : undefined);
      if (holdToken.current && next.token !== holdToken.current) return;
      if (holdToken.current && next.token === holdToken.current) holdToken.current = '';
      writeStoredToken(ownerUid, next.token);
      setConnection({ ...next, known: true });
      if (!next.connected) sentBody.current = '';
    }, () => {
      if (local) setConnection({ connected: true, token: local, known: true });
    });
  }, [enabled, ownerUid]);

  const publish = useCallback(async (token: string, force = false) => {
    const database = db;
    if (!database || !ownerUid || !isGrokToken(token)) return false;
    const current = sourceRef.current;
    const built = buildGrokSnapshot(current);
    const fingerprint = JSON.stringify({ snapshot: built.snapshot, salesTruncatedBefore: built.salesTruncatedBefore });
    const due = force || fingerprint !== sentBody.current || Date.now() - sentAtMs.current > 55_000;
    if (!due) return true;
    const write = async (snapshot: typeof built) => {
      const linkId = await grokLinkId(token);
      await setDoc(doc(database, 'grokLinks', linkId), {
        linkId,
        ownerUid,
        shopName: snapshot.snapshot.shopName || '',
        updatedAt: snapshot.updatedAt,
        salesTruncatedBefore: snapshot.salesTruncatedBefore,
        snapshot: snapshot.snapshot,
      });
      return snapshot;
    };
    try {
      const saved = await write(built);
      sentBody.current = fingerprint;
      sentAtMs.current = Date.now();
      setSentAt(saved.updatedAt);
      setSalesTruncatedBefore(saved.salesTruncatedBefore);
      setError('');
      return true;
    } catch (first) {
      if (denied(first)) throw first;
      const smaller = buildGrokSnapshot(current, { budget: 200_000 });
      const saved = await write(smaller);
      sentBody.current = JSON.stringify({ snapshot: saved.snapshot, salesTruncatedBefore: saved.salesTruncatedBefore });
      sentAtMs.current = Date.now();
      setSentAt(saved.updatedAt);
      setSalesTruncatedBefore(saved.salesTruncatedBefore);
      setError('');
      return true;
    }
  }, [ownerUid]);

  const revision = useMemo(() => JSON.stringify({
    shopName: source.shopName,
    clock: source.clock,
    branches: source.branches.map((branch) => [branch.id, branch.name]),
    products: source.products.map((product) => [product.id, product.name, product.stock, product.salePrice, product.purchasePrice, product.branchId, product.category, product.sku, product.barcode, product.reorderPoint, product.variant, product.unit, product.wholesalePrice]),
    services: source.services.map((service) => [service.id, service.name, service.salePrice, service.directCost, service.monthlySharedCost, service.branchId]),
    sales: source.sales.map((sale) => [sale.id, sale.amount, sale.cost, sale.qty, sale.createdAt, sale.voidedAt, sale.itemName, sale.productId, sale.type, sale.branchId, sale.taxAmount]),
    expenses: source.expenses.map((expense) => [expense.title, expense.amount, expense.createdAt, expense.branchId]),
  }), [source]);

  useEffect(() => {
    if (!connection.known || !connection.connected || !connection.token) return undefined;
    const timer = window.setTimeout(() => {
      void publish(connection.token).catch((reason) => {
        setError(denied(reason)
          ? 'Publish the latest Firestore rules, then connect Grok again.'
          : 'The shop did not reach Grok. Keep this page open and try again.');
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [connection.connected, connection.known, connection.token, publish, revision]);

  useEffect(() => {
    if (!connection.known || !connection.connected || !connection.token) return undefined;
    const timer = window.setInterval(() => {
      void publish(connection.token).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [connection.connected, connection.known, connection.token, publish]);

  const connect = useCallback(() => {
    const database = db;
    if (!enabled || !database || !ownerUid || busy) return;
    setBusy(true);
    setError('');
    void (async () => {
      const token = newGrokToken();
      holdToken.current = token;
      try {
        await setDoc(doc(database, 'users', ownerUid, 'pos', 'secrets'), { grokConnected: true, grokToken: token }, { merge: true });
        writeStoredToken(ownerUid, token);
        setConnection({ connected: true, token, known: true });
        await publish(token, true);
        onActivity('grok_connect', 'Connected Grok to this shop.');
        notify('Grok can read this shop. Paste the address into Grok.', 'success');
      } catch (reason) {
        holdToken.current = '';
        setError(denied(reason)
          ? 'Publish the latest Firestore rules, then connect Grok again.'
          : 'Grok could not be connected. Try again when the shop is online.');
        notify('Grok could not be connected.', 'error');
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, enabled, notify, onActivity, ownerUid, publish]);

  const disconnect = useCallback(() => {
    const database = db;
    if (!database || !ownerUid || !connection.token || busy) return;
    setBusy(true);
    const token = connection.token;
    void (async () => {
      try {
        const linkId = await grokLinkId(token);
        await deleteDoc(doc(database, 'grokLinks', linkId)).catch((reason) => {
          const code = typeof reason === 'object' && reason && 'code' in reason ? String((reason as { code: string }).code) : '';
          if (code.includes('not-found')) return undefined;
          throw reason;
        });
        holdToken.current = '';
        await setDoc(doc(database, 'users', ownerUid, 'pos', 'secrets'), { grokConnected: false, grokToken: deleteField() }, { merge: true });
        writeStoredToken(ownerUid, '');
        sentBody.current = '';
        sentAtMs.current = 0;
        setConnection({ connected: false, token: '', known: true });
        setSentAt('');
        setSalesTruncatedBefore('');
        setError('');
        onActivity('grok_disconnect', 'Disconnected Grok from this shop.');
        notify('Grok can no longer read this shop.', 'info');
      } catch (reason) {
        setError(denied(reason)
          ? 'Publish the latest Firestore rules, then disconnect Grok again.'
          : 'Grok could not be disconnected. Try again.');
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, connection.token, notify, onActivity, ownerUid]);

  useEffect(() => {
    const address = origin && connection.token ? grokConnectorUrl(origin, connection.token) : '';
    publishPanel({
      mode: enabled ? 'ready' : 'local',
      connected: connection.connected,
      address,
      token: connection.token,
      publicOrigin: origin ? grokOriginIsPublic(origin) : false,
      sentAt,
      salesTruncatedBefore,
      error,
      busy,
      clock: source.clock,
      connect,
      disconnect,
    });
  }, [busy, connect, connection.connected, connection.token, disconnect, enabled, error, origin, salesTruncatedBefore, sentAt, source.clock]);

  useEffect(() => () => { publishPanel(panelEmpty()); }, []);

  return null;
}

export function GrokConnectCard() {
  const panel = useSyncExternalStore(subscribePanel, () => panelState, panelEmpty);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState('');

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied('');
    }
  };

  return (
    <div className="card grok-connect">
      <h3>Grok</h3>
      {panel.mode === 'loading' && <p className="muted-copy">Checking the Grok connection.</p>}
      {panel.mode === 'local' && (
        <p className="muted-copy">This counter stays in this browser. Sign in with Google to connect the shop to Grok.</p>
      )}
      {panel.mode === 'ready' && (
        <>
          <p className="muted-copy">Connect this shop to Grok. Grok can ask about sales, profit, expenses, stock, prices, services, account balances, what customers owe, and what the shop owes suppliers. It cannot ring a sale or change a price. Phone numbers are not sent. The connection stays with the owner and is not part of a shop backup.</p>
          <p className="muted-copy">Each question reads the latest sales saved in Firebase, including while this page is closed. A sale shows up after the till saves it.</p>
          {!panel.connected && (
            <button type="button" className="primary" onClick={panel.connect} disabled={panel.busy}>Connect to Grok</button>
          )}
          {panel.connected && (
            <>
              <ol>
                <li>Open grok.com/connectors.</li>
                <li>Choose New Connector, then Custom.</li>
                <li>Paste the shop address. If Grok asks for a bearer token, paste the token as well.</li>
                <li>Ask Grok about sales, stock, prices, profit, account balances, or who owes the shop.</li>
              </ol>
              {panel.publicOrigin ? (
                <p className="muted-copy">Anyone with this address can ask about this shop’s figures. Disconnect to turn that off.</p>
              ) : (
                <p className="assistant-warn">Grok cannot reach this browser. Open the published shop over https, sign in as the owner, and connect it there.</p>
              )}
              <div className="form">
                <label className="field">
                  <span>Shop address</span>
                  <input readOnly type={showSecret ? 'text' : 'password'} value={panel.address} spellCheck={false} />
                </label>
                <label className="field">
                  <span>Bearer token</span>
                  <input readOnly type={showSecret ? 'text' : 'password'} value={panel.token} spellCheck={false} autoComplete="off" />
                </label>
                <label className="field">
                  <span>Show the address and token</span>
                  <select value={showSecret ? 'yes' : 'no'} onChange={(event) => setShowSecret(event.target.value === 'yes')}>
                    <option value="no">Hidden</option>
                    <option value="yes">Visible</option>
                  </select>
                </label>
              </div>
              <div className="grok-connect-actions">
                <button type="button" className="edit-btn" onClick={() => { void copy(panel.address, 'address'); }}>Copy address</button>
                <button type="button" className="edit-btn" onClick={() => { void copy(panel.token, 'token'); }}>Copy token</button>
                <button type="button" className="delete-btn" onClick={panel.disconnect} disabled={panel.busy}>Disconnect</button>
              </div>
              {copied === 'address' && <p className="assistant-note">Address copied.</p>}
              {copied === 'token' && <p className="assistant-note">Token copied.</p>}
              {panel.sentAt && <p className="muted-copy">Last sent {formatSent(panel.sentAt, panel.clock)} shop time.</p>}
              {panel.salesTruncatedBefore && <p className="muted-copy">Older sales are left out so the connection stays within Firestore’s size limit. A long period can be short. The assistant inside AlphaPOS still uses the full records.</p>}
            </>
          )}
          {panel.error && <p className="assistant-warn">{panel.error}</p>}
        </>
      )}
    </div>
  );
}
