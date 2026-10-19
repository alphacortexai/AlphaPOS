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
- [ ] Run the applicable static checks/build, review the diff, create a coherent section commit, and push it to `origin/main`.
