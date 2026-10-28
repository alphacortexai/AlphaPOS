# AlphaPOS

AlphaPOS is a Next.js retail point-of-sale and back-office application. The counter is a register: barcode or name search, category tiles, line and ticket discounts, tax, split tender, cash change, held tickets, a cash drawer, printable receipts, and returns that put stock back without rewriting the original sale. Behind the register it keeps Firebase or on-device shop data, branches, inventory, services, customers, expenses, staff roles, reports, accounts, activity logs, and backup/restore. See [`TODO.md`](./TODO.md) for what is still intentionally out of scope.

## Features
- Register with barcode/SKU scan, categories, discounts, hold, and split tender
- Cash drawer open/close with expected cash and variance
- Shop tax settings, including a Uganda VAT 18% preset, and printable receipts or credit notes
- Returns that restore stock and leave the original receipt unchanged
- Customers, including an on-account balance
- Multi-branch business operations
- Role-based access (Owner/Admin, Branch Manager, Cashier/Sales, Stock Manager)
- Product, service, stock, sales, expense, user and branch workflows
- Stock deduction after product sales
- Stock receipts with optional supplier/invoice reference and latest unit-cost capture
- Branch-level visibility + owner aggregation
- Firebase configuration detection, with an on-device counter when Firebase is not configured
- Responsive register and back office

## Firebase environment variables
This app now reads either **Next.js** or **Vite-style** public env names:

- `NEXT_PUBLIC_FIREBASE_API_KEY` or `VITE_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` or `VITE_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` or `VITE_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` or `VITE_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_APP_ID` or `VITE_FIREBASE_APP_ID`

If all five values are present, Firebase is initialized automatically.

Staff invites email a sign-in link. In Firebase Authentication, open Sign-in method → Email/Password and turn on both **Email/Password** and **Email link (passwordless sign-in)**, then Save. Also add this site under Authentication → Settings → Authorized domains. The person opens that link, or signs in with Google using the same address, and the shop opens with the role you saved.

Sales emails (daily, weekly, or monthly) are sent with [Resend](https://resend.com) when `RESEND_API_KEY` and `EMAIL_FROM` are set. AlphaPOS sends the previous completed period the next time an owner or admin opens the shop. It does not send while the app is closed.

The product assistant is on the Assistant page, and only the shop owner can open it. A photo of names and quantities, or a supplier receipt, is read into a list the owner confirms. Confirming adds products or updates purchase prices. A price that is not on the photo is saved as 0, and a missing category is left blank. It does not record a sale. The owner pastes a Gemini API key in Settings → Assistant. That key is stored for the owner, separate from the shop backup. `GEMINI_API_KEY` or `OPENAI_API_KEY` on the server is used only when Settings is empty. `CATALOG_ASSISTANT_ALLOW_LOCAL=false` refuses the on-device counter.

## Run locally
```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. If Firebase is not configured, choose **Open the counter**. That shop is stored in this browser only.

For reproducible installs, use `npm ci`. Copy `.env.example` to `.env.local` and fill in the Firebase web app configuration before signing in.

## Authentication and operational notes

Enable the Google sign-in provider in Firebase Authentication and configure Firestore security rules for shop data before connecting a real store. The app defaults to UGX and preserves the existing Firestore data shape. Existing product records can omit the optional category, SKU, and barcode fields.

Stock receipts can cover several products, remember a supplier name, and update the latest unit cost. Inventory history keeps the latest 2,000 events in a side record and shows the latest 400 movements. Payment method choices, including split tender and cash change, are transaction records only; they do not initiate or confirm card, mobile-money, or bank payments. Tax is calculated from the shop's own rate and is not filed with a revenue authority. Older documentation claimed demo users with a shared password; the application does not provide those accounts, so do not use those credentials. External card processing, fiscal connections, hardware integrations, and offline synchronization across devices are not implied by the current interface. Deleting a receipt asks for confirmation and reverses the stock on its product lines. Use Return when the original receipt should stay.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
