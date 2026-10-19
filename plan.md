# AlphaPOS rebuild plan

## Goal and scope

Rebuild the existing AlphaPOS app in independently useful increments, pushing each completed section to the selected private GitHub repository (`alphacortexai/AlphaPOS`). Preserve the existing Next.js App Router, TypeScript, Firebase Authentication, Firestore data, role, branch, product/service, sales, expense, reporting, account, activity-log, and backup workflows while the replacement is built. Avoid a risky big-bang migration.

The product target is a configurable POS for common business types, with retail shops as the primary workflow and services as an important adjacent workflow. The existing application has product and service catalogs, branches, checkout, discounts, stock deduction, sales history, expenses, staff roles, reporting, accounts, and backup/restore; extend that foundation rather than replacing it with a disconnected demo. Preserve the current UGX default and introduce explicit business settings before broadening currencies or tax behavior. Payment integrations, fiscal rules, or external hardware connections must not be represented as live until actually implemented and configured.

## Implementation approach

- Keep the existing Next.js 15 / React 19 / TypeScript / Firebase stack and current authentication/data source during the first increments.
- Move domain decisions out of the large `app/page.tsx` client component into small typed modules under `lib/pos/` as each area is touched. Extract reusable UI into `components/` without replacing the full application at once.
- Maintain backwards compatibility with the current Firestore document and backup schema during UI/domain modernization. Use explicit versioned migrations before any data shape or persistence-strategy change.
- First establish a maintainable project baseline and refresh the shared app shell. Then deliver retail catalog/inventory controls, safer checkout and transaction detail, service/general-business support, and reporting/security/resilience in separate reviewed commits.
- For each code increment, run the relevant TypeScript/build/lint checks, inspect the resulting diff, commit only the intended files, and push normally to `origin/main`. Never force-push or rewrite the existing history. A failed check or push blocks only that increment, not later planning.

## Initial project structure

- `app/`: Next.js routes, root layout, and global design system.
- `components/`: reusable shell, forms, tables, dialogs, and POS interaction components extracted incrementally from the current client page.
- `lib/pos/`: typed domain logic for catalog, inventory, checkout, payments, customers, and reports; added in the matching feature increments.
- `lib.firebase.ts`: existing Firebase app initialization and environment-variable compatibility.
- `docs/`: data model, rollout, and operational setup notes as those contracts become concrete.
- `plan.md` / `TODO.md`: phased implementation record and delivery status.

## Design direction

Retain the existing clean, professional, minimalist workspace feel, but make it more operator-focused: a high-contrast evergreen/graphite navigation rail, warm-neutral surfaces, a single clear action color, compact scan-friendly tables, visible stock/payment state, strong keyboard focus, touch-friendly controls, and responsive checkout layouts. Use typography and icons consistently; avoid decoration that competes with the cash-desk workflow. Keep existing authentication and navigation behavior accessible.

## Delivery slices

1. **Foundation and operator shell:** clean repository hygiene, truthful run/config docs, design tokens, improved navigation and responsive shell; keep current workflows reachable and preserve Firestore compatibility.
2. **Retail catalog and stock operations:** SKU/barcode and category metadata, reasoned stock adjustments, one-product supplier receipts with optional supplier/invoice reference and latest unit cost, and current movement history; preserve compatibility with existing products and branch stock. A supplier directory, multi-line purchase workflow, and longer-retention movement history need a versioned storage/security design rather than unbounded growth of the current shop document.
3. **Checkout and transaction record:** fast search/scan workflow, grouped transaction identifiers, optional customer association, locally recorded tender/reference details, tax settings, safe stock validation, receipts/returns, and reliable transaction persistence; explicitly distinguish locally recorded tenders from external payment processing.
4. **General-business workflows:** configurable service/non-stock items, business profiles/units, appointment/table/rental needs where grounded by the domain model, and usable branch/staff controls.
5. **Operations and resilience:** reports/exports, permissions and audit coverage, backup/migration quality, deployment/runtime verification, and remaining high-priority tests.

## Constraints

- A pushed commit is a completed section, not proof that all requested business modes or third-party integrations are finished.
- Preserve existing user data and role semantics; do not test by writing to a live Firebase project.
- Do not expose credentials, commit `.env` values, or invent a payment provider.
