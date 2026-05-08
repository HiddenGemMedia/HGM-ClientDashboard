# Dynamic Ads Dashboard

This project gives you one reusable HTML dashboard instead of 22 separate hard-coded client files.

## Files

- [dashboard.html](/Users/Pooja/Documents/New project/dashboard.html)
- [dashboard.js](/Users/Pooja/Documents/New project/dashboard.js)
- [dashboard.config.js](/Users/Pooja/Documents/New project/dashboard.config.js)

## What It Does

The page:

1. Reads `client` and `month` from the URL.
2. Loads all matching client rows for that month from `monthly_ad_data`.
3. Matches the selected client from `clients` using `client_id`.
4. Renders the full dashboard with HTML, CSS, JS, and ApexCharts.
5. Lets you download the currently rendered report as a static HTML snapshot.

## Route Format

Use this pattern:

```text
dashboard.html?client=flohom&month=2026-03
```

Examples:

```text
dashboard.html?client=paradise-pointe&month=2026-03
dashboard.html?client=flohom&month=2026-04
```

## Supabase Setup

Update [dashboard.config.js](/Users/Pooja/Documents/New project/dashboard.config.js) with:

- `supabaseUrl`
- `supabaseAnonKey`

The code already uses your real table/column names:

- `clients`
  - `id, name, slug, status, created_at, metadata`
- `monthly_ad_data`
  - `id, client_id, month, year, campaign_type, spend, impressions, profile_visits, cost_per_visit, leads_followers, cost_per_lead_follower, ig_bio_leads, bookings_email_matched, bookings_fb_events, cost_per_booking, avg_booking_value, revenue, roas, blended_roas, pms_data_received, stats_done, comments, todos, metadata`

## How To Use It

1. Open [dashboard.html](/Users/Pooja/Documents/New project/dashboard.html).
2. Pick a month.
3. Pick a client.
4. Click `Load Dashboard`.
5. If you want a standalone file for that exact report, click `Download Current HTML`.

## Important Supabase Note

If this page is loaded directly as a `file://` URL, some Supabase/browser setups may block parts of the request flow depending on your policies and CORS rules.

Safest option: serve the folder locally with a tiny static server, for example:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/dashboard.html?client=flohom&month=2026-03
```

## Recommended Next Step

Once this works, the cleanest production flow is:

1. Keep this as the single source dashboard.
2. Use the URL params as your dynamic routing.
3. When you need to send a client-specific HTML file, open the right route and click `Download Current HTML`.

That gives you both:

- one maintainable dashboard codebase
- optional generated per-client HTML files when needed
