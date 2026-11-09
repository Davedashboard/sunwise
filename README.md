# ☀️ Sunwise – Weather & UV

A lightweight, mobile-first web app with:

- **Weather**: current conditions, a 14-day forecast strip, and hour-by-hour detail for any day
- **UV index**: peak UV per day, an hourly UV chart (actual vs clear-sky), and the time window when protection is needed
- **Sun safety**: pick your skin type (Fitzpatrick I–VI) to get an estimated time-to-burn and what to do about it

Location search, your chosen location and your skin type are remembered in the browser (`localStorage`).

## Data source

There's no public BBC Weather API (it was retired years ago). This app uses **[Open-Meteo](https://open-meteo.com/)**:

- Free, **no API key**, CORS-enabled, so it runs as a static site with no backend
- Up to 16-day forecasts (the app uses 14)
- `uv_index` / `uv_index_clear_sky` hourly, `uv_index_max` daily
- Geocoding API for place search

Licence: CC BY 4.0. Attribution is shown in the footer. The free tier is for **non-commercial** use. Commercial use needs a paid Open-Meteo plan.

> Forecasts beyond about 7 days, especially UV, are much less reliable. The app flags this.

## Run locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open http://localhost:8000.

## Deploy

Works as-is on **GitHub Pages**, **Azure Static Web Apps**, Netlify, etc.

GitHub Pages: push to `main` → Settings → Pages → Deploy from branch → `main` / root.

On a phone, use "Add to Home Screen" to get it as an app (there's a `manifest.json`).

## How time-to-burn is calculated

```
minutes = MED / (UVI × 0.025 W/m²) / 60
```

- **UVI × 0.025** converts the UV index to erythemally weighted irradiance (W/m²)
- **MED** (minimal erythemal dose) is the typical UV dose that causes reddening for each skin type:

| Type | Description | MED (J/m²) |
|---|---|---|
| I | Very fair, always burns | 200 |
| II | Fair, usually burns | 250 |
| III | Medium, sometimes burns | 350 |
| IV | Olive / light brown, rarely burns | 450 |
| V | Brown, very rarely burns | 600 |
| VI | Dark brown / black, almost never burns | 1000 |

Example: Type II at UV 6 → 250 / 0.15 / 60 ≈ **28 minutes**.

These are rough estimates for adults with unprotected skin. Advice follows WHO UV-index bands and NHS sunscreen guidance (SPF 30+, 4–5 star UVA, reapply every 2 hours).

## Files

```
index.html     – layout and the three views
styles.css     – styling (light and dark mode)
app.js         – API calls, rendering, burn-time calculation
manifest.json  – PWA manifest
icon.svg       – app icon
```

## Ideas for later

- Service worker for offline caching
- Hourly burn-time timeline
- SPF selector
- Notifications when UV goes over a threshold
