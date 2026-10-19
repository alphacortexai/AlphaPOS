# AlphaPOS

AlphaPOS is a Next.js point-of-sale and business-operations application. Its current workspace includes Firebase sign-in, shop/branch selection, product and service sales, discounts, stock deduction and adjustment, recent stock-activity history, sales history, expenses, staff roles, reports, accounts, activity logs, and shop backup/restore. A phased rebuild is underway; see [`TODO.md`](./TODO.md) for delivered and planned sections.

## Features
- Multi-branch business operations
- Role-based access (Owner/Admin, Branch Manager, Cashier/Sales, Stock Manager)
- Product, service, stock, sales, expense, user and branch workflows
- Stock deduction after product sales
- Discount-aware sales and profit calculation
- Branch-level visibility + owner aggregation
- Firebase configuration detection for hosted environments
- Responsive professional UI

## Firebase environment variables
This app now reads either **Next.js** or **Vite-style** public env names:

- `NEXT_PUBLIC_FIREBASE_API_KEY` or `VITE_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` or `VITE_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` or `VITE_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` or `VITE_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_APP_ID` or `VITE_FIREBASE_APP_ID`

If all five values are present, Firebase is initialized automatically.

## Run locally
```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

For reproducible installs, use `npm ci`. Copy `.env.example` to `.env.local` and fill in the Firebase web app configuration before signing in.

## Authentication and operational notes

Enable the Google sign-in provider in Firebase Authentication and configure Firestore security rules for shop data before connecting a real store. The app defaults to UGX and preserves the existing Firestore data shape. Existing product records can omit the optional category, SKU, and barcode fields.

The inventory history is currently a structured view over shop activity logs: the application retains the most recent 500 activity entries and displays up to 100 stock movements from those entries. A separately stored long-retention inventory ledger and supplier receiving flow remain future work. Older documentation claimed demo users with a shared password; the application does not provide those accounts, so do not use those credentials. External card processing, fiscal/tax-provider connections, hardware integrations, and offline synchronization are not implied by the current interface.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
