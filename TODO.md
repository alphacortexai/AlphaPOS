# AlphaPOS delivery checklist

## 1. Phased rebuild and GitHub delivery — in progress

- [ ] “do a full revamp or rebuild of this Alph POS System” — replace the existing UX and structure incrementally while keeping the product operational and preserving its current Firebase-backed shop data.
- [ ] “do it in bits as you push to github” — deliver finished, independently reviewable increments as commits pushed to the selected `alphacortexai/AlphaPOS` repository; keep a clear record of what each push contains and what remains.
- [ ] “do sections as you push to github” — each push must correspond to a coherent product section, and must not be described as the entire rebuild unless all planned sections are complete.

## 2. Broad business and retail POS capability — in progress

- [ ] “a fully operational and fucntional POS system for almost all kinds of business, esp retail shops” — keep a usable POS foundation, lead with retail shop operations, and extend the current product/service model and back-office workflows to cover common business types in successive sections.
- [ ] Preserve existing product/service sales, stock deduction, branch/shop selection, staff roles, expenses, reports, accounts, activity logs, Firebase authentication, and backup/restore while each replacement section is delivered.
- [ ] Do not imply that an external card processor, tax/fiscal integration, device integration, or offline synchronization is working until that capability has been implemented, configured, and verified.

## 3. Foundation slice

- [x] Remove tracked generated build output from source control; add appropriate ignores and keep source/lockfiles as the reproducible project inputs.
- [x] Establish truthful setup/configuration documentation without publishing or copying Firebase secrets.
- [x] Refresh the shared shell and responsive operator experience while retaining access to the current operational screens.
- [x] Add backward-compatible product category, SKU, and barcode fields, duplicate identifier checks, and Enter-to-add scanning for stocked retail products.
- [x] Run the applicable static checks/build, review the diff, create a coherent section commit, and push it to `origin/main` (`92c22f0`, pushed to `alphacortexai/AlphaPOS:main`).

## 4. Retail inventory controls — in progress

- [x] Keep the product/category/SKU/barcode catalog compatible with existing Firestore records and protect stock and price inputs from invalid negative values.
- [x] Record and display structured stock changes for opening stock, checkout sales, restocks, count corrections, damaged/expired goods, customer returns, product removal, and product branch changes; identify product, branch, quantity, reason, time, and staff member.
- [x] Make receiving and stock adjustments usable from a dedicated form that validates available stock and records a reason/note.
- [x] Capture optional supplier, invoice/reference, and unit cost for a one-product receipt; record that metadata and update the product's latest purchase cost when provided.
- [x] Preserve the current activity-log retention boundary (latest 500 shop events; inventory view shows up to 100 movement events) until a versioned, separately stored movement ledger can be deployed safely.
- [ ] Add a supplier directory, multi-line purchasing workflow, and durable long-term inventory movement history in a later compatible storage increment.

## 5. Checkout transaction details — in progress

- [x] Group each cart sale's line items under one transaction identifier while preserving legacy sale records that have no identifier.
- [x] Capture optional customer name/phone, payment method, and optional tender reference on quick product sales, multi-item checkout, and direct service sales; retain walk-in checkout.
- [x] Make clear that card-terminal, mobile-money, bank-transfer, and other non-cash options are recorded locally only and do not process payments.
- [ ] Add grouped printable receipts and explicit returns/refunds without silently rewriting prior sale history.
- [ ] Add jurisdiction-specific business tax configuration and reliable Firestore transaction-level stock/tender persistence before treating checkout as production-hardened.
