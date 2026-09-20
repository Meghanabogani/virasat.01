require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const sites = require('./data/sites.json');
const guides = [...require('./data/guides.json')]; // in-memory store for the prototype
const bookings = new Map();

const PORT = process.env.PORT || 3000;
const FEE_PERCENT = Math.min(Math.max(Number(process.env.PLATFORM_FEE_PERCENT || 0), 0), 30);
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_LIVE = Boolean(RZP_KEY_ID && RZP_KEY_SECRET);

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Never send payout details to the browser.
const publicGuide = ({ payoutAccountId, ...rest }) => rest;

const clean = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);

/* ---------- API ---------- */

app.get('/api/config', (_req, res) => {
  res.json({
    paymentMode: RAZORPAY_LIVE ? 'razorpay' : 'demo',
    razorpayKeyId: RAZORPAY_LIVE ? RZP_KEY_ID : null,
    platformFeePercent: FEE_PERCENT,
  });
});

// Heritage sites, nearest first when lat/lng are provided.
app.get('/api/sites', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng);
  const list = sites.map((s) => ({
    ...s,
    distanceKm: hasPos ? Math.round(haversineKm(lat, lng, s.lat, s.lng) * 10) / 10 : null,
  }));
  if (hasPos) list.sort((a, b) => a.distanceKm - b.distanceKm);
  res.json(list);
});

app.get('/api/guides', (req, res) => {
  const { siteId } = req.query;
  const list = siteId ? guides.filter((g) => g.siteIds.includes(siteId)) : guides;
  res.json(list.map(publicGuide));
});

// A student / gig worker signs up as a local guide.
app.post('/api/guides', (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 60);
  const college = clean(b.college, 80);
  const city = clean(b.city, 40);
  const bio = clean(b.bio, 240);
  const ratePerHour = Number(b.ratePerHour);
  const languages = (Array.isArray(b.languages) ? b.languages : String(b.languages || '').split(','))
    .map((l) => clean(l, 20))
    .filter(Boolean)
    .slice(0, 6);
  const siteIds = (Array.isArray(b.siteIds) ? b.siteIds : []).filter((id) =>
    sites.some((s) => s.id === id)
  );
  const payoutAccountId = clean(b.payoutAccountId, 60);

  if (!name || !college || !city) return res.status(400).json({ error: 'Name, college and city are required.' });
  if (!Number.isFinite(ratePerHour) || ratePerHour < 100 || ratePerHour > 2000)
    return res.status(400).json({ error: 'Hourly rate must be between ₹100 and ₹2000.' });
  if (!siteIds.length) return res.status(400).json({ error: 'Pick at least one site you can guide at.' });
  if (!languages.length) return res.status(400).json({ error: 'Add at least one language.' });

  const guide = {
    id: 'g_' + crypto.randomBytes(4).toString('hex'),
    name, college, city, bio, languages, ratePerHour, siteIds,
    rating: null, tripsCompleted: 0,
    verified: false, // production: ID + student ID check before this becomes true
    payoutAccountId: payoutAccountId || 'acc_DEMO_PENDING',
  };
  guides.push(guide);
  res.status(201).json(publicGuide(guide));
});

// Visitor books a guide. Payment goes to the guide, minus the optional platform fee.
app.post('/api/bookings', async (req, res) => {
  const { guideId, siteId, visitorName } = req.body || {};
  const hours = Number(req.body?.hours);
  const date = clean(req.body?.date, 10);
  const time = clean(req.body?.time, 5);

  const guide = guides.find((g) => g.id === guideId);
  const site = sites.find((s) => s.id === siteId);
  if (!guide || !site || !guide.siteIds.includes(siteId))
    return res.status(400).json({ error: 'This guide does not cover that site.' });
  if (!Number.isInteger(hours) || hours < 1 || hours > 8)
    return res.status(400).json({ error: 'Choose between 1 and 8 hours.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return res.status(400).json({ error: 'Pick a valid date and start time.' });
  if (!clean(visitorName, 60)) return res.status(400).json({ error: 'Enter your name.' });

  const total = guide.ratePerHour * hours;
  const platformFee = Math.round((total * FEE_PERCENT) / 100);
  const guidePayout = total - platformFee;

  const booking = {
    id: 'bk_' + crypto.randomBytes(5).toString('hex'),
    guideId, siteId, visitorName: clean(visitorName, 60), date, time, hours,
    total, platformFee, guidePayout, status: 'created', orderId: null,
  };

  try {
    if (RAZORPAY_LIVE) {
      // Razorpay Route: the guide's share is transferred straight to their linked account.
      if (!String(guide.payoutAccountId).startsWith('acc_') || guide.payoutAccountId.startsWith('acc_DEMO'))
        return res.status(400).json({ error: 'This guide has not finished payout setup yet.' });

      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64'),
        },
        body: JSON.stringify({
          amount: total * 100, // paise
          currency: 'INR',
          receipt: booking.id,
          transfers: [{ account: guide.payoutAccountId, amount: guidePayout * 100, currency: 'INR' }],
        }),
      });
      const order = await r.json();
      if (!r.ok) return res.status(502).json({ error: order?.error?.description || 'Payment provider error.' });
      booking.orderId = order.id;
    } else {
      booking.orderId = 'order_DEMO_' + crypto.randomBytes(4).toString('hex');
    }
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Could not reach the payment provider.' });
  }

  bookings.set(booking.id, booking);
  res.status(201).json({ booking, mode: RAZORPAY_LIVE ? 'razorpay' : 'demo', keyId: RAZORPAY_LIVE ? RZP_KEY_ID : null });
});

// Real mode: verify Razorpay's signature before marking the booking as paid.
app.post('/api/payments/verify', (req, res) => {
  if (!RAZORPAY_LIVE) return res.status(400).json({ error: 'Not in Razorpay mode.' });
  const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const booking = bookings.get(bookingId);
  if (!booking || booking.orderId !== razorpay_order_id)
    return res.status(400).json({ error: 'Unknown booking.' });

  const expected = crypto
    .createHmac('sha256', RZP_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(400).json({ error: 'Payment signature mismatch.' });

  booking.status = 'paid';
  res.json({ booking });
});

// Demo mode only: pretend the payment succeeded.
app.post('/api/payments/demo-confirm', (req, res) => {
  if (RAZORPAY_LIVE) return res.status(400).json({ error: 'Demo confirm is disabled with real keys.' });
  const booking = bookings.get(req.body?.bookingId);
  if (!booking) return res.status(404).json({ error: 'Unknown booking.' });
  booking.status = 'paid';
  res.json({ booking });
});

app.listen(PORT, () => {
  console.log(`Virasat running at http://localhost:${PORT}  (payments: ${RAZORPAY_LIVE ? 'Razorpay' : 'demo'})`);
});
