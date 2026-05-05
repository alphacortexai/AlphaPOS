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
