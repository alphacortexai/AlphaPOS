import type { FormEvent } from 'react';
import Logo from '../brand/Logo';
import { ONBOARDING_ROLE_LABELS, ONBOARDING_ROLES, type OnboardingRole } from '../../lib/pos/onboarding';

export type OnboardingStep = 'shop' | 'branch' | 'staff';

type Props = {
  step: OnboardingStep;
  shopName: string;
  branchName: string;
  branchLocation: string;
  staffName: string;
  staffEmail: string;
  staffRole: OnboardingRole;
  error: string;
  busy: boolean;
  canEmail: boolean;
  leaveLabel: string;
  onShopName: (value: string) => void;
  onBranchName: (value: string) => void;
  onBranchLocation: (value: string) => void;
  onStaffName: (value: string) => void;
  onStaffEmail: (value: string) => void;
  onStaffRole: (value: OnboardingRole) => void;
  onContinueShop: () => void;
  onContinueBranch: () => void;
  onBack: () => void;
  onSkipStaff: () => void;
  onInvite: () => void;
  onLeave: () => void;
};

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'shop', label: 'Shop' },
  { id: 'branch', label: 'Branch' },
  { id: 'staff', label: 'Staff' },
];

const copy: Record<OnboardingStep, { kicker: string; title: string; lede: string }> = {
  shop: {
    kicker: 'Step 1 of 3',
    title: 'Name the shop.',
    lede: 'This is the name on receipts and at the top of the counter.',
  },
  branch: {
    kicker: 'Step 2 of 3',
    title: 'Name the first branch.',
    lede: 'Sales and stock stay with a branch. One is enough to open. Add more later.',
  },
  staff: {
    kicker: 'Step 3 of 3',
    title: 'Invite someone, if you want.',
    lede: 'They sign in on their own phone. Skip this and add people later from Staff. Products and services can wait until the counter is open.',
  },
};

export default function ShopOnboarding({
  step,
  shopName,
  branchName,
  branchLocation,
  staffName,
  staffEmail,
  staffRole,
  error,
  busy,
  canEmail,
  leaveLabel,
  onShopName,
  onBranchName,
  onBranchLocation,
  onStaffName,
  onStaffEmail,
  onStaffRole,
  onContinueShop,
  onContinueBranch,
  onBack,
  onSkipStaff,
  onInvite,
  onLeave,
}: Props) {
  const current = copy[step];
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (step === 'shop') onContinueShop();
    else if (step === 'branch') onContinueBranch();
    else onInvite();
  };

  return (
    <div className="auth-container">
      <div className="auth-layout">
        <Logo variant="stacked" />
        <div className="auth-copy">
          <p className="auth-kicker">{current.kicker}</p>
          <h1>{current.title}</h1>
          <p>{current.lede}</p>
        </div>
        <section className="auth-card" aria-label="Set up the shop">
          <ol className="onboard-steps">
            {STEPS.map((item, index) => (
              <li key={item.id} className={index < stepIndex ? 'is-done' : index === stepIndex ? 'is-current' : ''} aria-current={index === stepIndex ? 'step' : undefined}>
                {item.label}
              </li>
            ))}
          </ol>
          <form className="onboard-form" onSubmit={submit}>
            {step === 'shop' && (
              <label className="field">
                <span>Shop name</span>
                <input
                  value={shopName}
                  onChange={(event) => onShopName(event.target.value)}
                  placeholder="C & E Supplies"
                  maxLength={80}
                  autoComplete="organization"
                  autoFocus
                  required
                />
              </label>
            )}
            {step === 'branch' && (
              <>
                <label className="field">
                  <span>Branch name</span>
                  <input
                    value={branchName}
                    onChange={(event) => onBranchName(event.target.value)}
                    placeholder="Main shop"
                    maxLength={80}
                    autoComplete="off"
                    autoFocus
                    required
                  />
                </label>
                <label className="field">
                  <span>Location</span>
                  <input
                    value={branchLocation}
                    onChange={(event) => onBranchLocation(event.target.value)}
                    placeholder="Street or town, optional"
                    maxLength={80}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            {step === 'staff' && (
              <>
                <label className="field">
                  <span>Name</span>
                  <input value={staffName} onChange={(event) => onStaffName(event.target.value)} placeholder="Amina Kato" autoComplete="off" autoFocus />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input type="email" value={staffEmail} onChange={(event) => onStaffEmail(event.target.value)} placeholder="amina@shop.test" autoComplete="off" />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select value={staffRole} onChange={(event) => onStaffRole(event.target.value as OnboardingRole)}>
                    {ONBOARDING_ROLES.map((role) => (
                      <option key={role} value={role}>{ONBOARDING_ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                </label>
                <p className="auth-fine">
                  {canEmail
                    ? 'They receive a sign-in link for this shop. They do not become the owner.'
                    : 'They are saved on this counter. Email the sign-in link from Staff once the shop is signed in.'}
                </p>
              </>
            )}
            {error && <p className="onboard-error" role="alert">{error}</p>}
            <div className="onboard-actions">
              <button className="auth-action" type="submit" disabled={busy}>
                {busy ? 'Saving…' : step === 'staff' ? (canEmail ? 'Send invite' : 'Add them') : 'Continue'}
              </button>
              {step !== 'shop' && (
                <button className="onboard-quiet" type="button" onClick={onBack} disabled={busy}>Back</button>
              )}
              {step === 'staff' && (
                <button className="onboard-quiet" type="button" onClick={onSkipStaff} disabled={busy}>Skip for now</button>
              )}
              <button className="onboard-quiet" type="button" onClick={onLeave} disabled={busy}>{leaveLabel}</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
