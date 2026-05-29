# Alpha Matrix (Next.js)

Alpha Matrix is implemented with **Next.js (App Router)** and React.

## Features
- Multi-branch business operations
- Role-based access (Owner/Admin, Branch Manager, Cashier/Sales, Stock Manager)
- Product, service, stock, sales, expense, user and branch workflows
- Stock deduction after product sales
- Discount-aware sales and profit calculation
- Branch-level visibility + owner aggregation
- Firebase configuration detection for hosted environments
- Responsive professional UI

## Accounting setup model

Alpha Matrix now supports a Tally-style profit structure without changing the simple POS workflow:

- **Products / retail:** enter purchase price and sale price on each product. Sales automatically reduce stock and use purchase price as cost of goods sold.
- **Direct-cost services:** use this for services with a known cost per sale, such as printing where paper is UGX 50 and ink is UGX 100 per page. Enter UGX 150 as the direct cost per sale.
- **Monthly shared-cost services:** use this for fixed monthly costs tied to a service stream, such as WiFi at UGX 110,000 per month.
- **Direct + monthly-cost services:** use this when a service has both per-sale cost and overhead, such as printing with UGX 150 per page plus electricity of UGX 40,000 per month.
- **Expenses:** record real cash payments when they happen, such as rent, salaries, fuel, or the actual monthly internet bill. Reporting allocation is separate from cash so account balances are not reduced until payment is recorded.

The reports screen shows daily, weekly, and monthly overhead allocation plus monthly income-stream profit so businesses can compare gross profit, allocated operating profit, and actual expenses.

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
npm install
npm run dev
```

Open `http://localhost:3000`.

## Demo users
Password for all: `1234`
- `owner`
- `manager`
- `cashier`
- `stock`
