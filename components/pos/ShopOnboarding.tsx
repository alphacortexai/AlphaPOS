'use client';

import { useState } from 'react';
import Logo from '../brand/Logo';
import {
  ONBOARDING_ROLES,
  reviewBranchName,
  reviewShopName,
  reviewStaffInvite,
  type OnboardingRole,
  type OnboardingStaff,
} from '../../lib/pos/onboarding';

export type OnboardingResult = {
  shopName: string;
  branchName: string;
  branchLocation: string;
  staff: OnboardingStaff | null;
};

type Step = 0 | 1 | 2;

const ROLE_LABELS: Record<OnboardingRole, string> = {
  cashier: 'Cashier',
  manager: 'Manager',
  stock: 'Stock',
  admin: 'Admin',
};

const TITLES = ['Name the shop', 'Name the branch', 'Invite staff'] as const;

export default function ShopOnboarding({
  canEmailInvites,
  ownerEmail,
  busy,
  onComplete,
  onLeave,
  leaveLabel,
}: {
  canEmailInvites: boolean;
  ownerEmail: string;
  busy: boolean;
  onComplete: (result: OnboardingResult) => void;
  onLeave: () => void;
  leaveLabel: string;
}) {
  const [step, setStep] = useState<Step>(0);
  const [shopName, setShopName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchLocation, setBranchLocation] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState<OnboardingRole>('cashier');
  const [error, setError] = useState('');

  const bodies = [
    'This name is on receipts and in the sidebar. Products and services can be added after the counter opens.',
    'A branch is one counter or place you sell from. You can add more later.',
    canEmailInvites
      ? 'Send a sign-in link now, or skip and invite people from Staff later.'
      : 'This device keeps the shop on this browser, so an email is not sent. Add someone to the list, or skip and invite them after you sign in.',
  ] as const;

  const goShop = () => {
    const reviewed = reviewShopName(shopName);
    if (!reviewed.ok) {
      setError(reviewed.error);
      return;
    }
    setShopName(reviewed.shopName);
    setError('');
    setStep(1);
  };

  const goBranch = () => {
    const reviewed = reviewBranchName(branchName, branchLocation);
    if (!reviewed.ok) {
      setError(reviewed.error);
      return;
    }
    setBranchName(reviewed.branchName);
    setBranchLocation(reviewed.branchLocation === reviewed.branchName && !branchLocation.trim() ? '' : reviewed.branchLocation);
    setError('');
    setStep(2);
  };

  const finish = (staff: OnboardingStaff | null) => {
    const shop = reviewShopName(shopName);
    const branch = reviewBranchName(branchName, branchLocation);
    if (!shop.ok || !branch.ok) {
      setError('Go back and enter the shop and branch names.');
      return;
    }
    onComplete({
      shopName: shop.shopName,
      branchName: branch.branchName,
      branchLocation: branch.branchLocation,
      staff,
    });
  };

  const invite = () => {
    const reviewed = reviewStaffInvite({ name: staffName, email: staffEmail, role: staffRole, ownerEmail });
    if (!reviewed.ok) {
      setError(reviewed.error);
      return;
    }
    setError('');
    finish(reviewed.staff);
  };

  return (
    <div className="auth-container">
      <div className="auth-layout onboard-layout">
        <Logo variant="stacked" />
        <div className="auth-copy">
          <p className="auth-kicker">Set up your shop</p>
          <h1>{TITLES[step]}</h1>
          <p>{bodies[step]}</p>
        </div>
        <section className="auth-card" aria-label="Shop setup">
          <div className="onboard-steps" aria-label={`Step ${step + 1} of 3`}>
            {TITLES.map((title, index) => (
              <span key={title} className={index < step ? 'is-done' : index === step ? 'is-current' : ''} />
            ))}
          </div>
          <p className="auth-lede">Step {step + 1} of 3</p>
          <form
            className="onboard-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              if (step === 0) goShop();
              else if (step === 1) goBranch();
              else invite();
            }}
          >
            {step === 0 && (
              <label className="field">
                <span>Shop name</span>
                <input
                  value={shopName}
                  onChange={(event) => { setShopName(event.target.value); setError(''); }}
                  placeholder="Acacia Grocers"
                  autoFocus
                  autoComplete="organization"
                  maxLength={80}
                />
              </label>
            )}
            {step === 1 && (
              <>
                <label className="field">
                  <span>Branch name</span>
                  <input
                    value={branchName}
                    onChange={(event) => { setBranchName(event.target.value); setError(''); }}
                    placeholder="Main counter"
                    autoFocus
                    maxLength={80}
                  />
                </label>
                <label className="field">
                  <span>Location, optional</span>
                  <input
                    value={branchLocation}
                    onChange={(event) => { setBranchLocation(event.target.value); setError(''); }}
                    placeholder="Kampala Road"
                    maxLength={80}
                  />
                </label>
              </>
            )}
            {step === 2 && (
              <>
                <label className="field">
                  <span>Name</span>
                  <input
                    value={staffName}
                    onChange={(event) => { setStaffName(event.target.value); setError(''); }}
                    placeholder="Amina Nakato"
                    autoFocus
                    autoComplete="name"
                    maxLength={80}
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={staffEmail}
                    onChange={(event) => { setStaffEmail(event.target.value); setError(''); }}
                    placeholder="amina@shop.com"
                    autoComplete="email"
                  />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select value={staffRole} onChange={(event) => setStaffRole(event.target.value as OnboardingRole)}>
                    {ONBOARDING_ROLES.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {error && <p className="field-error onboard-error" role="alert">{error}</p>}
            <div className="onboard-actions">
              <button className="auth-action" type="submit" disabled={busy}>
                {busy ? 'Saving…' : step === 2 ? (canEmailInvites ? 'Send invite' : 'Add to staff') : 'Continue'}
              </button>
              {step === 2 && (
                <button
                  type="button"
                  className="onboard-skip"
                  disabled={busy}
                  onClick={() => { setError(''); finish(null); }}
                >
                  Skip for now
                </button>
              )}
              {step > 0 && (
                <button
                  type="button"
                  className="onboard-back"
                  disabled={busy}
                  onClick={() => { setError(''); setStep((current) => (current === 2 ? 1 : 0)); }}
                >
                  Back
                </button>
              )}
            </div>
          </form>
          <button type="button" className="shop-choice-leave onboard-leave" onClick={onLeave} disabled={busy}>
            {leaveLabel}
          </button>
        </section>
      </div>
    </div>
  );
}
