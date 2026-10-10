# Pulse

Personal PWA for the Google Fitbit Air: today's heart rate, sleep, HRV and other daily metrics from the Google Health API, workouts the Air records, live Bluetooth heart rate on laptops, and a Claude coach that reads all of it.

Live at **https://danton404.github.io/pulse/**. Add it to the iPhone home screen from Safari (Share > Add to Home Screen). No build step: plain HTML, CSS and ES modules, same setup as TRING.

## Tabs

- **Today**: latest heart-rate reading, today's heart rate in 5-minute averages, readiness (HRV and resting HR against your 30-day baseline, adjusted for sleep), and 30-day cards for resting HR, HRV, sleep (with deep/REM), steps, SpO2 and breathing rate.
- **Live** (laptop Chrome only): heart rate every second over Bluetooth, zones, HRV and alerts. Record a workout here. Hidden on iPhone, where browsers can't use Bluetooth.
- **Workouts**: workouts the Air recorded (with heart-rate chart and Fitbit zones) plus sessions recorded on Live.
- **Coach**: Claude with your profile, workouts, today's heart rate and 30 days of daily data.

## Google Health API

- Google Cloud project "Pulse" with the Google Health API enabled. OAuth consent screen in **Testing** with your account as the only test user, read-only scopes for activity, health metrics and sleep.
- OAuth client "Pulse web" (Web application). Its client ID is the default in `js/store.js` (client IDs are public).
- Authorized JavaScript origins: `http://localhost:8792`, `https://danton404.github.io`. Authorized redirect URIs: `http://localhost:8792/`, `https://danton404.github.io/pulse/`.

Sign-in is a full-page OAuth redirect (works in the home-screen app, where popups don't) and lasts an hour; after that the app shows saved data and a Sign in button. Data reaches Google after the Air syncs through the Google Health app, so it lags by a few minutes.

## Keys

| What | Where | Notes |
|---|---|---|
| Claude | https://console.anthropic.com/settings/keys | Settings > Claude. Stored only on that device, sent only to Anthropic. Default `claude-sonnet-5-5`. |

Each device (iPhone home-screen app, laptop browser) keeps its own settings, key and saved data.

## Deploy

Double-click `deploy.command`: commits and pushes to GitHub; Pages republishes in about a minute. Bump `VERSION` in `sw.js` when you change files.

## Run locally

```bash
python3 -m http.server 8792 -d Pulse
```

Then open http://localhost:8792. The `pulse` entry in `.claude/launch.json` does the same.
