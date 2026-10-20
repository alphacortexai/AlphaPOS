'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { parseProductCsv } from '../../lib/pos/catalog';
import {
  BUSINESS_COUNTRIES,
  BUSINESS_MODELS,
  ONBOARDING_STEPS,
  buildChecklist,
  countryByCode,
  detectedCountry,
  goLiveIssues,
  importReportText,
  presetForModel,
  reviewImportRows,
  validateBusinessStep,
  validateCatalogueItem,
  validateOutlet,
  type BusinessModel,
  type BusinessProfile,
  type BusinessSetup,
  type ChecklistItem,
  type OnboardingProgress,
  type OnboardingStepId,
} from '../../lib/pos/onboarding';

export type OnboardingSave = {
  profile: BusinessProfile;
  setup: BusinessSetup;
  progress: OnboardingProgress;
  branchName?: string;
  branchLocation?: string;
  secondBranchName?: string;
  secondBranchLocation?: string;
  item?: {
    kind: 'product' | 'service';
    name: string;
    price: number;
    cost: number;
    stock: number;
    reorderAt: number;
    categoryName: string;
    durationMinutes: number;
  };
  staff?: { name: string; email: string; role: 'cashier' | 'manager' | 'stock' | 'admin' | 'accountant' };
  receiptFooter?: string;
  finish?: boolean;
  pause?: boolean;
};

type CataloguePreview = {
  imported: number;
  issues: { line: number; message: string }[];
  names: string[];
};

const stepIndex = (id: OnboardingStepId) => Math.max(0, ONBOARDING_STEPS.findIndex((step) => step.id === id));

export default function OnboardingWizard({
  profile,
  setup,
  progress,
  branches,
  productCount,
  serviceCount,
  staffCount,
  existingCodes,
  practiceSale,
  formatMoney,
  initialReceiptFooter,
  onSave,
  onPractice,
  onUndoPractice,
  onImportCsv,
}: {
  profile: BusinessProfile;
  setup: BusinessSetup;
  progress: OnboardingProgress;
  branches: { id: string; name: string; location: string }[];
  productCount: number;
  serviceCount: number;
  staffCount: number;
  existingCodes: string[];
  practiceSale: { itemName: string; amount: number } | null;
  formatMoney: (value: number) => string;
  initialReceiptFooter?: string;
  onSave: (save: OnboardingSave) => void;
  onPractice: () => void;
  onUndoPractice: () => void;
  onImportCsv: (text: string) => { imported: number; skipped: number; errors: string[] };
}) {
  const titleId = useId();
  const [step, setStep] = useState<OnboardingStepId>(progress.step);
  const [draftProfile, setDraftProfile] = useState(profile);
  const [draftSetup, setDraftSetup] = useState(setup);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [item, setItem] = useState({ name: '', price: '', cost: '', stock: '', reorderAt: '10', categoryName: '', durationMinutes: '30' });
  const [branchName, setBranchName] = useState(branches[0]?.name || 'Main Branch');
  const [branchLocation, setBranchLocation] = useState(branches[0]?.location || '');
  const [secondBranchName, setSecondBranchName] = useState('');
  const [secondBranchLocation, setSecondBranchLocation] = useState('');
  const [staff, setStaff] = useState({ name: '', email: '', role: 'cashier' as 'cashier' | 'manager' | 'stock' | 'admin' | 'accountant' });
  const [preview, setPreview] = useState<CataloguePreview | null>(null);
  const [csvText, setCsvText] = useState('');
  const [receiptFooter, setReceiptFooter] = useState(initialReceiptFooter || 'Thank you. Please come again.');
  const [skipped, setSkipped] = useState<OnboardingStepId[]>(progress.skipped);
  const onSaveRef = useRef(onSave);
  const progressRef = useRef(progress);
  onSaveRef.current = onSave;
  progressRef.current = progress;

  useEffect(() => {
    document.getElementById('setup-step-title')?.focus();
  }, [step]);

  const draftKey = JSON.stringify({ draftProfile, draftSetup, step, skipped, branchName, branchLocation, secondBranchName, secondBranchLocation, receiptFooter });
  const savedDraftKey = useRef(draftKey);

  useEffect(() => {
    if (draftKey === savedDraftKey.current) return;
    const handle = window.setTimeout(() => {
      const current = progressRef.current;
      onSaveRef.current({
        profile: { ...draftProfile, currency: draftProfile.currency.toUpperCase() },
        setup: draftSetup,
        progress: {
          ...current,
          startedAt: current.startedAt || new Date().toISOString(),
          step,
          skipped,
        },
        branchName,
        branchLocation,
        ...(secondBranchName.trim() ? { secondBranchName: secondBranchName.trim(), secondBranchLocation: secondBranchLocation.trim() } : {}),
        receiptFooter,
      });
      savedDraftKey.current = draftKey;
    }, 400);
    return () => window.clearTimeout(handle);
  }, [draftKey, draftProfile, draftSetup, step, skipped, branchName, branchLocation, secondBranchName, secondBranchLocation, receiptFooter]);

  useEffect(() => {
    if (draftProfile.displayName || draftProfile.countryCode !== 'UG') return;
    const country = detectedCountry();
    if (country.code === 'UG') return;
    setDraftProfile((prev) => prev.displayName ? prev : { ...prev, countryCode: country.code, currency: country.currency, timezone: country.timezone });
    setDraftSetup((prev) => prev.taxAcknowledged ? prev : { ...prev, taxName: country.taxName, taxRate: country.taxRate });
  }, [draftProfile.countryCode, draftProfile.displayName]);

  const checklist = buildChecklist(draftProfile, draftSetup, { ...progress, step, skipped }, {
    products: productCount,
    services: serviceCount,
    sales: 0,
    branches: branches.length + (secondBranchName.trim() ? 1 : 0),
    staff: staffCount,
    practice: Boolean(practiceSale),
  });
  const issues = goLiveIssues(checklist);
  const index = stepIndex(step);
  const sellsServices = draftSetup.sells === 'services';
  const showProducts = draftSetup.sells !== 'services';
  const showServices = draftSetup.sells !== 'products';

  const persist = (nextStep: OnboardingStepId, extra: Partial<OnboardingSave> = {}, nextSkipped = skipped) => {
    onSave({
      profile: { ...draftProfile, currency: draftProfile.currency.toUpperCase() },
      setup: draftSetup,
      progress: {
        ...progressRef.current,
        startedAt: progressRef.current.startedAt || new Date().toISOString(),
        ...(extra.pause ? { pausedAt: new Date().toISOString() } : { pausedAt: undefined }),
        step: nextStep,
        skipped: nextSkipped,
        ...(extra.finish ? { completedAt: new Date().toISOString() } : {}),
      },
      branchName,
      branchLocation,
      receiptFooter,
      ...extra,
    });
  };

  const go = (next: OnboardingStepId, extra: Partial<OnboardingSave> = {}, nextSkipped = skipped) => {
    setErrors({});
    setSkipped(nextSkipped);
    persist(next, extra, nextSkipped);
    setStep(next);
  };

  const skip = () => {
    const next = ONBOARDING_STEPS[index + 1]?.id;
    if (!next) return;
    go(next, {}, [...new Set([...skipped, step])]);
  };

  const back = () => {
    const previous = ONBOARDING_STEPS[index - 1]?.id;
    if (previous) setStep(previous);
  };

  const continueBusiness = () => {
    const nextErrors = validateBusinessStep(draftProfile);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    go('configure');
  };

  const continueConfigure = () => {
    go('catalogue');
  };

  const continueCatalogue = () => {
    if (!item.name.trim() && !preview) {
      go('outlet', {}, [...new Set([...skipped, 'catalogue' as OnboardingStepId])]);
      return;
    }
    if (item.name.trim()) {
      const nextErrors = validateCatalogueItem({
        name: item.name,
        price: Number(item.price),
        cost: Number(item.cost || 0),
        stock: Number(item.stock || 0),
      }, sellsServices && !showProducts);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) return;
      go('outlet', {
        item: {
          kind: sellsServices && !showProducts ? 'service' : showProducts ? 'product' : 'service',
          name: item.name.trim(),
          price: Number(item.price),
          cost: Number(item.cost || 0),
          stock: showProducts && draftSetup.trackInventory ? Number(item.stock || 0) : 0,
          reorderAt: Number(item.reorderAt || 10),
          categoryName: item.categoryName.trim(),
          durationMinutes: showServices ? Number(item.durationMinutes || 0) : 0,
        },
      });
      setItem({ name: '', price: '', cost: '', stock: '', reorderAt: '10', categoryName: '', durationMinutes: '30' });
      return;
    }
    go('outlet');
  };

  const continueOutlet = () => {
    const nextErrors = validateOutlet(branchName);
    if (draftSetup.outlets === 'multiple' && !secondBranchName.trim() && branches.length < 2) {
      nextErrors.secondBranchName = 'Add a second outlet, or switch back to one outlet.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    go('staff', {
      secondBranchName: secondBranchName.trim() || undefined,
      secondBranchLocation: secondBranchLocation.trim() || undefined,
    });
  };

  const continueStaff = () => {
    if (!staff.email.trim() && !staff.name.trim()) {
      go('payments', {}, [...new Set([...skipped, 'staff' as OnboardingStepId])]);
      return;
    }
    const nextErrors: Record<string, string> = {};
    if (!staff.name.trim()) nextErrors.staffName = 'Enter the person’s name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staff.email.trim())) nextErrors.staffEmail = 'Enter the email they will use to sign in.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    go('payments', { staff });
    setStaff({ name: '', email: '', role: 'cashier' });
  };

  const continuePayments = () => {
    if (!draftSetup.taxAcknowledged) {
      setErrors({ taxAcknowledged: 'Confirm that you will check the tax rate for this business.' });
      return;
    }
    go('practice');
  };

  const chooseCountry = (code: string) => {
    const country = countryByCode(code);
    setDraftProfile((prev) => ({ ...prev, countryCode: country.code, currency: country.currency, timezone: country.timezone }));
    setDraftSetup((prev) => ({ ...prev, taxName: country.taxName, taxRate: country.taxRate }));
  };

  const chooseModel = (model: BusinessModel) => {
    setDraftSetup((prev) => ({ ...prev, model, ...presetForModel(model) }));
  };

  const readCsv = async (file: File) => {
    const text = await file.text();
    const parsed = parseProductCsv(text);
    const issues = [
      ...parsed.errors.map((message) => ({ line: 0, message })),
      ...reviewImportRows(parsed.rows, existingCodes),
    ];
    setCsvText(parsed.rows.length > 0 ? text : '');
    setPreview({ imported: 0, issues, names: parsed.rows.slice(0, 6).map((row) => row.name) });
  };

  const saveCsv = () => {
    if (!csvText) return;
    const parsed = parseProductCsv(csvText);
    const result = onImportCsv(csvText);
    setPreview({
      imported: result.imported,
      issues: [
        ...parsed.errors.map((message) => ({ line: 0, message })),
        ...reviewImportRows(parsed.rows, existingCodes),
        ...result.errors.map((message) => ({ line: 0, message })),
      ],
      names: parsed.rows.slice(0, 6).map((row) => row.name),
    });
    setCsvText('');
  };

  const downloadReport = () => {
    if (!preview) return;
    const blob = new Blob([importReportText(preview.issues)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'catalogue-import-notes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="setup-shell" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="setup-layout">
        <aside className="setup-rail">
          <p className="setup-kicker">Shop setup</p>
          <h2 id={titleId}>Get ready for the first sale</h2>
          <p>You can leave and come back. Nothing here connects a payment provider, tax office, or device until that connection is verified.</p>
          <ol className="setup-steps">
            {ONBOARDING_STEPS.map((item, itemIndex) => {
              const state = checklist.find((entry) => entry.id === item.id)?.status;
              return (
                <li key={item.id}>
                  <button type="button" className={item.id === step ? 'active' : ''} onClick={() => setStep(item.id)}>
                    <span>{itemIndex + 1}</span>
                    <strong>{item.title}</strong>
                    <em>{item.required ? 'Required' : 'Optional'}{state === 'complete' ? ' · Done' : ''}</em>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
        <section className="setup-panel">
          <header className="setup-panel-head">
            <p>Step {index + 1} of {ONBOARDING_STEPS.length}</p>
            <div className="setup-meter" aria-hidden="true"><span style={{ width: `${((index + 1) / ONBOARDING_STEPS.length) * 100}%` }} /></div>
          </header>
          <div className="setup-body">
            {step === 'business' && (
              <>
                <h3 id="setup-step-title" tabIndex={-1}>Create the business</h3>
                <p>Use the name on the receipt. You can correct these details later in setup.</p>
                <div className="setup-grid">
                  <label>Display name
                    <input value={draftProfile.displayName} maxLength={80} onChange={(event) => setDraftProfile((prev) => ({ ...prev, displayName: event.target.value }))} />
                    {errors.displayName && <small role="alert">{errors.displayName}</small>}
                  </label>
                  <label>Legal name <em>optional</em>
                    <input value={draftProfile.legalName} maxLength={120} onChange={(event) => setDraftProfile((prev) => ({ ...prev, legalName: event.target.value }))} />
                  </label>
                  <label>Country
                    <select value={draftProfile.countryCode} onChange={(event) => chooseCountry(event.target.value)}>
                      {BUSINESS_COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                    </select>
                  </label>
                  <label>Currency
                    <input value={draftProfile.currency} maxLength={3} onChange={(event) => setDraftProfile((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))} />
                    {errors.currency && <small role="alert">{errors.currency}</small>}
                  </label>
                  <label>Time zone
                    <input value={draftProfile.timezone} maxLength={60} onChange={(event) => setDraftProfile((prev) => ({ ...prev, timezone: event.target.value }))} />
                  </label>
                  <label>City
                    <input value={draftProfile.city} maxLength={80} onChange={(event) => setDraftProfile((prev) => ({ ...prev, city: event.target.value }))} />
                  </label>
                  <label className="setup-span">Street address
                    <input value={draftProfile.address} maxLength={180} onChange={(event) => setDraftProfile((prev) => ({ ...prev, address: event.target.value }))} />
                  </label>
                  <label>Phone
                    <input value={draftProfile.phone} maxLength={40} inputMode="tel" onChange={(event) => setDraftProfile((prev) => ({ ...prev, phone: event.target.value }))} />
                  </label>
                  <label>Owner name
                    <input value={draftProfile.ownerName} maxLength={80} onChange={(event) => setDraftProfile((prev) => ({ ...prev, ownerName: event.target.value }))} />
                  </label>
                  <label>Owner email
                    <input type="email" value={draftProfile.email} maxLength={120} onChange={(event) => setDraftProfile((prev) => ({ ...prev, email: event.target.value }))} />
                    {errors.email && <small role="alert">{errors.email}</small>}
                  </label>
                  <label>Tax ID <em>optional</em>
                    <input value={draftProfile.taxId} maxLength={40} onChange={(event) => setDraftProfile((prev) => ({ ...prev, taxId: event.target.value }))} />
                  </label>
                </div>
                <p className="setup-note">Sign-in stays with Google, or with this browser if you opened the counter on this device. AlphaPOS does not ask for or store a password. A receipt logo can be added in a later update; the receipt uses the display name for now.</p>
              </>
            )}

            {step === 'configure' && (
              <>
                <h3 id="setup-step-title" tabIndex={-1}>How this business sells</h3>
                <p>The choices below set the defaults. You can change them, and you can add branches or modules later.</p>
                <div className="setup-choices">
                  {BUSINESS_MODELS.map((model) => (
                    <button key={model.id} type="button" className={draftSetup.model === model.id ? 'active' : ''} onClick={() => chooseModel(model.id)}>
                      <strong>{model.label}</strong>
                      <span>{model.detail}</span>
                    </button>
                  ))}
                </div>
                <div className="setup-grid">
                  <label>What you sell
                    <select value={draftSetup.sells} onChange={(event) => setDraftSetup((prev) => ({ ...prev, sells: event.target.value as BusinessSetup['sells'] }))}>
                      <option value="products">Products</option>
                      <option value="services">Services</option>
                      <option value="both">Products and services</option>
                    </select>
                  </label>
                  <label>Outlets
                    <select value={draftSetup.outlets} onChange={(event) => setDraftSetup((prev) => ({ ...prev, outlets: event.target.value as BusinessSetup['outlets'] }))}>
                      <option value="single">One outlet</option>
                      <option value="multiple">More than one outlet</option>
                    </select>
                  </label>
                </div>
                {draftSetup.sells !== 'services' && (
                  <label className="setup-check"><input type="checkbox" checked={draftSetup.trackInventory} onChange={(event) => setDraftSetup((prev) => ({ ...prev, trackInventory: event.target.checked }))} /> Track stock for products</label>
                )}
                {draftSetup.sells === 'services' && <p className="setup-note">A service-only business does not need stock counts. You can turn inventory on later if you start selling products.</p>}
                <label className="setup-check"><input type="checkbox" checked={draftSetup.customers} onChange={(event) => setDraftSetup((prev) => ({ ...prev, customers: event.target.checked }))} /> Keep customer names on sales</label>
                <label className="setup-check"><input type="checkbox" checked={draftSetup.bookings} onChange={(event) => setDraftSetup((prev) => ({ ...prev, bookings: event.target.checked }))} /> We take appointments</label>
                {draftSetup.bookings && <p className="setup-note">Appointment booking is saved as a preference. The register does not take bookings yet.</p>}
              </>
            )}

            {step === 'catalogue' && (
              <>
                <h3 id="setup-step-title" tabIndex={-1}>{showProducts ? 'Add a product' : 'Add a service'}</h3>
                <p>Start with one item. Import a CSV if the list is already in a spreadsheet. Excel can save a sheet as CSV. Variants, such as sizes, should be separate items for now.</p>
                <div className="setup-grid">
                  <label>{showProducts ? 'Product name' : 'Service name'}
                    <input value={item.name} maxLength={120} onChange={(event) => setItem((prev) => ({ ...prev, name: event.target.value }))} />
                    {errors.name && <small role="alert">{errors.name}</small>}
                  </label>
                  <label>Category <em>optional</em>
                    <input value={item.categoryName} maxLength={60} placeholder="Drinks" onChange={(event) => setItem((prev) => ({ ...prev, categoryName: event.target.value }))} />
                  </label>
                  <label>Selling price
                    <input inputMode="decimal" value={item.price} onChange={(event) => setItem((prev) => ({ ...prev, price: event.target.value }))} />
                    {errors.price && <small role="alert">{errors.price}</small>}
                  </label>
                  <label>Cost price
                    <input inputMode="decimal" value={item.cost} onChange={(event) => setItem((prev) => ({ ...prev, cost: event.target.value }))} />
                    {errors.cost && <small role="alert">{errors.cost}</small>}
                  </label>
                  {showProducts && draftSetup.trackInventory && (
                    <>
                      <label>Opening stock
                        <input inputMode="decimal" value={item.stock} onChange={(event) => setItem((prev) => ({ ...prev, stock: event.target.value }))} />
                        {errors.stock && <small role="alert">{errors.stock}</small>}
                      </label>
                      <label>Low-stock alert below
                        <input inputMode="decimal" value={item.reorderAt} onChange={(event) => setItem((prev) => ({ ...prev, reorderAt: event.target.value }))} />
                      </label>
                    </>
                  )}
                  {showServices && (
                    <label>Duration in minutes <em>optional</em>
                      <input inputMode="numeric" value={item.durationMinutes} onChange={(event) => setItem((prev) => ({ ...prev, durationMinutes: event.target.value }))} />
                    </label>
                  )}
                </div>
                {showProducts && (
                  <div className="setup-import">
                    <label className="edit-btn">Import CSV
                      <input type="file" accept=".csv,text/csv" hidden onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void readCsv(file);
                      }} />
                    </label>
                    <p>Columns: name, sku, barcode, category, stock, purchase, sale, branch. A blank SKU is generated. Category can be a path such as Drinks / Sodas.</p>
                  </div>
                )}
                {preview && (
                  <div className="setup-preview">
                    <strong>{preview.imported > 0 ? `Saved ${preview.imported} product${preview.imported === 1 ? '' : 's'}.` : 'Nothing was saved from that file.'}</strong>
                    {preview.names.length > 0 && <p>{preview.names.join(', ')}</p>}
                    {preview.issues.length > 0 && <ul>{preview.issues.slice(0, 6).map((issue) => <li key={`${issue.line}-${issue.message}`}>{issue.line ? `Row ${issue.line}: ` : ''}{issue.message}</li>)}</ul>}
                    {preview.issues.length > 0 && <button type="button" className="edit-btn" onClick={downloadReport}>Download notes</button>}
                    {csvText && <button type="button" className="primary" onClick={saveCsv}>Save import</button>}
                  </div>
                )}
                <p className="setup-note">{productCount + serviceCount > 0 ? `${productCount + serviceCount} item${productCount + serviceCount === 1 ? '' : 's'} already in the catalogue.` : 'You can skip this and add items from Products or Services.'}</p>
              </>
            )}

            {step === 'outlet' && (
              <>
                <h3 id="setup-step-title" tabIndex={-1}>{draftSetup.outlets === 'multiple' ? 'Outlets' : 'Your outlet'}</h3>
                <p>{draftSetup.outlets === 'multiple' ? 'Each outlet keeps its own sales and stock. You can still read the whole business in reports.' : 'One counter is enough to start. Add another branch later from Branches.'}</p>
                <div className="setup-grid">
                  <label>Outlet name
                    <input value={branchName} maxLength={80} onChange={(event) => setBranchName(event.target.value)} />
                    {errors.branchName && <small role="alert">{errors.branchName}</small>}
                  </label>
                  <label>Address or area
                    <input value={branchLocation} maxLength={120} onChange={(event) => setBranchLocation(event.target.value)} />
                  </label>
                  {draftSetup.outlets === 'multiple' && (
                    <>
                      <label>Second outlet
                        <input value={secondBranchName} maxLength={80} onChange={(event) => setSecondBranchName(event.target.value)} />
                        {errors.secondBranchName && <small role="alert">{errors.secondBranchName}</small>}
                      </label>
                      <label>Second address
                        <input value={secondBranchLocation} maxLength={120} onChange={(event) => setSecondBranchLocation(event.target.value)} />
                      </label>
                    </>
                  )}
                </div>
                <p className="setup-note">Opening stock is recorded as a stock movement. Moving stock between outlets stays in Receive stock, and only people allowed to adjust stock can do it.</p>
              </>
            )}

            {step === 'staff' && (
              <>
                <h3 id="setup-step-title" tabIndex={-1}>Staff access</h3>
                <p>The owner sign-in is not a shared cashier login. Invite each person with their own email. Phone invites and staff PINs are not used.</p>
                <div className="setup-grid">
                  <label>Name
                    <input value={staff.name} maxLength={80} onChange={(event) => setStaff((prev) => ({ ...prev, name: event.target.value }))} />
                    {errors.staffName && <small role="alert">{errors.staffName}</small>}
                  </label>
                  <label>Email
                    <input type="email" value={staff.email} maxLength={120} onChange={(event) => setStaff((prev) => ({ ...prev, email: event.target.value }))} />
                    {errors.staffEmail && <small role="alert">{errors.staffEmail}</small>}
                  </label>
                  <label>Role
                    <select value={staff.role} onChange={(event) => setStaff((prev) => ({ ...prev, role: event.target.value as typeof staff.role }))}>
                      <option value="cashier">Cashier — sell, no catalogue changes</option>
                      <option value="stock">Stock — inventory, no sales settings</option>
                      <option value="manager">Manager — sales, refunds, and stock</option>
                      <option value="admin">Admin — staff and shop settings</option>
                      <option value="accountant">Accountant — reports only</option>
                    </select>
                  </label>
                </div>
                <p className="setup-note">An email invite needs Google sign-in and the shop email address. On this browser-only counter, the person is saved here but the email cannot be sent. Deactivate someone later from Staff. Sensitive actions are written to the activity log.</p>
              </>
            )}

            {step === 'payments' && (
              <>
                <h3 id="setup-step-title" tabIndex={-1}>Payments, tax, and receipts</h3>
                <p>Cash is ready. Other methods are written on the sale. AlphaPOS does not charge a card, phone, or bank account.</p>
                <ul className="setup-status-list">
                  <li><strong>Cash</strong><span>Ready. Counted in the drawer. This is not a payment provider.</span></li>
                  <li><strong>Mobile money</strong><span>Record only. {draftProfile.countryCode === 'UG' ? 'MTN MoMo and Airtel Money are not connected.' : 'No wallet is connected.'} Staff can type a reference.</span></li>
                  <li><strong>Card terminal</strong><span>Record only. No terminal is linked.</span></li>
                  <li><strong>Bank transfer</strong><span>Record only.</span></li>
                  <li><strong>Split payment</strong><span>The register can record two methods on one sale. It still does not charge either one.</span></li>
                </ul>
                <div className="setup-grid">
                  <label className="setup-check setup-span"><input type="checkbox" checked={draftSetup.taxEnabled} onChange={(event) => setDraftSetup((prev) => ({ ...prev, taxEnabled: event.target.checked }))} /> Charge {draftSetup.taxName || 'tax'} on receipts</label>
                  {draftSetup.taxEnabled && (
                    <>
                      <label>Tax name
                        <input value={draftSetup.taxName} maxLength={40} onChange={(event) => setDraftSetup((prev) => ({ ...prev, taxName: event.target.value }))} />
                      </label>
                      <label>Rate %
                        <input inputMode="decimal" value={String(draftSetup.taxRate)} onChange={(event) => setDraftSetup((prev) => ({ ...prev, taxRate: Number(event.target.value) }))} />
                      </label>
                    </>
                  )}
                  <p className="setup-note setup-span">Confirm the rate with the business. AlphaPOS does not file tax{draftProfile.countryCode === 'UG' ? ' and is not connected to EFRIS' : ''}. Prices are treated as tax-inclusive when tax is on.</p>
                  <label className="setup-span">Receipt footer or return policy <em>optional</em>
                    <input value={receiptFooter} maxLength={180} onChange={(event) => setReceiptFooter(event.target.value)} />
                  </label>
                  <label className="setup-check setup-span"><input type="checkbox" checked={draftSetup.taxAcknowledged} onChange={(event) => setDraftSetup((prev) => ({ ...prev, taxAcknowledged: event.target.checked }))} /> I understand tax must be confirmed for this country, and that no payment provider is connected.</label>
                  {errors.taxAcknowledged && <small role="alert">{errors.taxAcknowledged}</small>}
                </div>
                <h4>Hardware</h4>
                <ul className="setup-status-list">
                  <li><strong>Receipt printer</strong><span>Optional. Print from the browser. No printer is marked connected.</span></li>
                  <li><strong>Barcode scanner</strong><span>Optional. A USB scanner types into the register search.</span></li>
                  <li><strong>Cash drawer</strong><span>Optional. The register tracks the count. It does not open a physical drawer.</span></li>
                  <li><strong>Customer display and payment terminal</strong><span>Not connected.</span></li>
                </ul>
              </>
            )}

            {step === 'practice' && (
              <>
                <h3 id="setup-step-title" tabIndex={-1}>Practice sale</h3>
                <p>This sale is labeled practice. No money is collected, and it stays out of the sales totals.</p>
                {productCount + serviceCount === 0 ? (
                  <p className="setup-note">Add a product or service first. Then come back and run the practice sale.</p>
                ) : practiceSale ? (
                  <div className="setup-preview">
                    <strong>Practice sale recorded</strong>
                    <p>{practiceSale.itemName} · {formatMoney(practiceSale.amount)}. The receipt says it is not a customer sale.</p>
                    <p>{draftSetup.trackInventory && showProducts ? 'Stock was reduced by one and the movement is in the activity log. Remove the practice sale to put that unit back.' : 'Stock was not changed.'}</p>
                    <button type="button" className="edit-btn" onClick={onUndoPractice}>Remove practice sale</button>
                  </div>
                ) : (
                  <button type="button" className="primary" onClick={onPractice}>Run practice sale</button>
                )}
                <ul className="setup-status-list">
                  {checklist.map((itemEntry) => (
                    <li key={itemEntry.id}><strong>{itemEntry.title}</strong><span>{itemEntry.status === 'complete' ? 'Done. ' : itemEntry.status === 'action_required' ? 'Still needed. ' : ''}{itemEntry.detail}</span></li>
                  ))}
                </ul>
                {issues.length > 0 && <p className="setup-note">Before go-live, finish: {issues.join(', ')}.</p>}
              </>
            )}
          </div>
          <footer className="setup-actions">
            <button type="button" className="edit-btn" onClick={back} disabled={index === 0}>Back</button>
            <button type="button" className="edit-btn" onClick={() => persist(step, { pause: true })}>Continue later</button>
            {!ONBOARDING_STEPS[index].required && step !== 'practice' && <button type="button" className="edit-btn" onClick={skip}>Skip for now</button>}
            {step === 'business' && <button type="button" className="primary" onClick={continueBusiness}>Continue</button>}
            {step === 'configure' && <button type="button" className="primary" onClick={continueConfigure}>Continue</button>}
            {step === 'catalogue' && <button type="button" className="primary" onClick={continueCatalogue}>{item.name.trim() ? 'Save item' : 'Continue'}</button>}
            {step === 'outlet' && <button type="button" className="primary" onClick={continueOutlet}>Continue</button>}
            {step === 'staff' && <button type="button" className="primary" onClick={continueStaff}>{staff.email.trim() ? 'Save staff' : 'Continue'}</button>}
            {step === 'payments' && <button type="button" className="primary" onClick={continuePayments}>Continue</button>}
            {step === 'practice' && <button type="button" className="primary" disabled={issues.length > 0 || !practiceSale} onClick={() => persist('practice', { finish: true })}>Start selling</button>}
          </footer>
        </section>
      </div>
    </div>
  );
}

export function SetupChecklist({
  items,
  onOpen,
}: {
  items: ChecklistItem[];
  onOpen: (id: OnboardingStepId) => void;
}) {
  const done = items.filter((item) => item.status === 'complete').length;
  return (
    <section className="setup-checklist card">
      <header>
        <div>
          <h3>Shop setup</h3>
          <p>{done} of {items.length} ready. Optional steps do not block the register.</p>
        </div>
        <strong>{Math.round((done / items.length) * 100)}%</strong>
      </header>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span className={`setup-pill is-${item.status}`}>{item.status === 'complete' ? 'Done' : item.status === 'action_required' ? 'Needed' : item.status === 'in_progress' ? 'In progress' : 'Not started'}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
            <button type="button" className="edit-btn" onClick={() => onOpen(item.id)}>{item.status === 'complete' ? 'Edit' : 'Open'}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
