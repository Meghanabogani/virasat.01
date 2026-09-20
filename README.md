# Virasat

**Heritage near you, with a local who knows it.**

Virasat is a web app prototype for heritage tourism in India. It tracks your live location, shows nearby monuments and heritage sites on a map, suggests photo and reel ideas to recreate at each place, and lets visitors book a student local guide by the hour, with the payment going directly to the guide.

> Status: prototype. Guides, ratings and bookings are demo data held in memory. Payments run in demo mode unless you add Razorpay test keys.

## Features

| Feature | How it works |
| --- | --- |
| Live location | Browser Geolocation API (`watchPosition`), list re-sorts as you move |
| Heritage sites | 12 sites across India in `data/sites.json`, nearest first (haversine distance) |
| Shots to recreate | Curated photo and reel ideas per site, each linking to the site's Instagram hashtag page |
| Local guides | Students and gig workers sign up, set an hourly rate and the sites they cover |
| Hourly booking | Visitor picks date, time and hours, and sees the price split before paying |
| Direct payout | Backend creates a Razorpay order with a Route transfer to the guide's linked account |

## Project structure

```
virasat/
├── public/            # Frontend (no build step)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/              # Seed data
│   ├── sites.json
│   └── guides.json
├── docs/
│   └── linkedin-post.md
├── server.js          # Express API: sites, guides, bookings, payments
├── package.json
├── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

## Run it locally

You need Node.js 18 or newer.

```bash
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000 and allow location access. If you block it, the app falls back to Hyderabad.

Geolocation only works on `localhost` or HTTPS, so use one of those when you deploy.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Payment mode and platform fee |
| GET | `/api/sites?lat=&lng=` | Sites, nearest first |
| GET | `/api/guides?siteId=` | Guides covering a site |
| POST | `/api/guides` | Sign up as a guide |
| POST | `/api/bookings` | Create a booking and payment order |
| POST | `/api/payments/verify` | Verify the Razorpay signature |
| POST | `/api/payments/demo-confirm` | Demo mode only |

## Payments: how the direct payout works

1. The visitor books a guide. The server calculates `total = ratePerHour × hours`.
2. The server creates a Razorpay order for the total, with a `transfers` entry that sends the guide's share to their linked account.
3. The visitor pays in Razorpay Checkout.
4. The server verifies the signature and marks the booking paid.

`PLATFORM_FEE_PERCENT` in `.env` is the share the platform keeps. It is `0` by default, so the guide gets everything.

To try it with real checkout, create a Razorpay account, enable Route, put your **test** key ID and secret in `.env`, and create test linked accounts for guides. In production every guide needs to complete KYC as a linked account before they can receive money.

## What is not real yet

- **Instagram content.** The app does not pull live Instagram posts. Instagram does not offer a free public feed of trending posts by location. Shot ideas are curated, and each links to the hashtag page. A next step is the Instagram Graph API's hashtag search, which needs a Business account and app review, or letting visitors submit their own posts.
- **Verification.** The "Verified student" badge is demo data. A real launch needs student ID and government ID checks.
- **Storage.** Guides and bookings reset when the server restarts. Swap the in-memory arrays for PostgreSQL or MongoDB.
- **Accounts and safety.** No login, reviews, cancellations or SOS button yet.

## Roadmap

- [ ] Sign in with phone OTP for visitors and guides
- [ ] Database (PostgreSQL) and booking status flow (accepted, completed, cancelled)
- [ ] Guide identity and student ID verification
- [ ] Reviews and ratings after a completed tour
- [ ] Instagram hashtag integration
- [ ] Offline site pages and multi-language UI
- [ ] Safety: share trip with a contact, SOS, public meeting points

## Tech

Node.js, Express, vanilla JavaScript, Leaflet with OpenStreetMap tiles, Razorpay Orders and Route.

## Deploy

Any Node host works (Render, Railway, Fly.io). Set the environment variables from `.env.example` and run `npm start`.

## License

MIT
