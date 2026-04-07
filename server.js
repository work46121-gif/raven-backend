<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>history.scrollRestoration="manual";if("serviceWorker"in navigator)navigator.serviceWorker.getRegistrations().then(r=>r.forEach(s=>s.unregister()));</script>
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">

<!-- Sentry: add your loader script here when ready (sentry.io → Settings → Projects → Client Keys) -->
<!-- PostHog: add your analytics script here when ready (posthog.com → Project Settings → API Keys) -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard — RavenSplit | AI Bill Splitter</title>
<meta name="description" content="Manage your bills, track group trip expenses, and get paid faster with RavenSplit's AI-powered dashboard.">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="https://ravensplit.com/dashboard.html">
<meta name="description" content="Your RavenSplit dashboard — manage bills, trip hubs, and payments.">

<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#06060A">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="RAVEN">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="apple-touch-icon" sizes="152x152" href="/icon-152.png">
<link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Epilogue:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --black: #06060A;
  --dark: #0C0C12;
  --dark2: #13131A;
  --dark3: #1A1A24;
  --dark4: #22222E;
  --border: rgba(255,255,255,0.07);
  --border2: rgba(255,255,255,0.12);
  --white: #F0EEF8;
  --muted: #6E6B80;
  --muted2: #9896A8;
  --purple: #7C3AED;
  --purple2: #A855F7;
  --purple3: #C084FC;
  --green: #30D158;
  --green-glow: rgba(48,209,88,0.2);
  --red: #FF4444;
  --orange: #FF6B35;
}
html, body { height: 100%; font-family: 'Epilogue', sans-serif; background: var(--black); color: var(--white); overflow-x: hidden; }

#auth-screen {
  display: none;
  align-items: center;
  justify-content: center;
  position: fixed;
  inset: 0;
  z-index: 9999;
  overflow: hidden;
  background: var(--black);
}
#auth-screen::before {
  content: '';
  position: absolute;
  top: -200px; left: 50%; transform: translateX(-50%);
  width: 800px; height: 600px;
  background: radial-gradient(ellipse, rgba(124,58,237,0.15) 0%, transparent 65%);
  pointer-events: none;
}
.auth-grid {
  position: absolute; inset: 0;
  background-image: linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
}
.auth-box { position: relative; z-index: 10; width: 100%; max-width: 420px; padding: 0 20px; }
.auth-logo { text-align: center; margin-bottom: 36px; }
.auth-logo-icon { font-size: 36px; display: block; margin-bottom: 8px; filter: drop-shadow(0 0 20px rgba(124,58,237,0.6)); }
.auth-logo-name { font-family: 'Bebas Neue', sans-serif; font-size: 42px; letter-spacing: 0.15em; background: linear-gradient(135deg, var(--white) 30%, var(--purple3)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.auth-logo-sub { font-size: 11px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; margin-top: 2px; }
.auth-card { background: var(--dark); border: 1px solid var(--border2); border-radius: 20px; padding: 36px; box-shadow: 0 40px 100px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.1); }
.auth-tabs { display: flex; gap: 4px; background: var(--dark2); border-radius: 10px; padding: 4px; margin-bottom: 28px; }
.auth-tab { flex: 1; padding: 9px; border: none; background: none; color: var(--muted); font-family: 'Epilogue', sans-serif; font-size: 13px; font-weight: 600; border-radius: 7px; cursor: pointer; transition: all 0.2s; }
.auth-tab.active { background: var(--dark3); color: var(--white); box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
.auth-form { display: flex; flex-direction: column; gap: 14px; }
.auth-label { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted2); margin-bottom: 6px; display: block; }
.auth-input { width: 100%; padding: 13px 16px; background: var(--dark2); border: 1px solid var(--border); border-radius: 10px; color: var(--white); font-family: 'Epilogue', sans-serif; font-size: 14px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
.auth-input:focus { border-color: var(--purple); box-shadow: 0 0 0 3px rgba(124,58,237,0.15); }
.auth-btn { width: 100%; padding: 14px; background: var(--green); color: #000; border: none; border-radius: 10px; font-family: 'Epilogue', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-top: 6px; box-shadow: 0 4px 20px var(--green-glow); letter-spacing: 0.02em; }
.auth-btn:hover { background: #3ddd68; transform: translateY(-1px); box-shadow: 0 8px 30px var(--green-glow); }
.auth-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.auth-error { background: rgba(255,68,68,0.1); border: 1px solid rgba(255,68,68,0.25); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #FF8888; display: none; }
.auth-footer { text-align: center; margin-top: 20px; font-size: 12px; color: var(--muted); }
/* join trip banner shown on auth screen */
.join-banner { background: rgba(48,209,88,0.08); border: 1px solid rgba(48,209,88,0.25); border-radius: 12px; padding: 14px 16px; margin-bottom: 20px; font-size: 13px; color: var(--green); display: none; text-align: center; }
.join-banner b { color: var(--white); }

#dashboard-screen { display: none; min-height: 100vh; }
.sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 240px; background: var(--dark); border-right: 1px solid var(--border); display: flex; flex-direction: column; z-index: 100; }
.sidebar-logo { padding: 24px 24px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; text-decoration: none; }
.sidebar-logo-mark { font-size: 22px; filter: drop-shadow(0 0 10px rgba(124,58,237,0.5)); }
.sidebar-logo-text { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 0.15em; background: linear-gradient(135deg, var(--white), var(--purple3)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.sidebar-nav { flex: 1; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; color: var(--muted); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; border: none; background: none; width: 100%; text-align: left; text-decoration: none; }
.nav-item:hover { background: var(--dark2); color: var(--white); }
.nav-item.active { background: rgba(124,58,237,0.15); color: var(--white); }
.nav-item .ni { font-size: 16px; width: 20px; text-align: center; }
.nav-badge { margin-left: auto; background: var(--purple); color: #fff; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; }
.sidebar-user { padding: 16px; border-top: 1px solid var(--border); }
.main { margin-left: 240px; min-height: 100vh; padding: 32px 48px; }
.main-inner { max-width: 1100px; margin: 0 auto; }
@media(min-width: 1400px) { .main { padding: 36px 64px; } }
@media(min-width: 1600px) { .main-inner { max-width: 1280px; } }
.page { display: none; }
.page.active { display: block; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; flex-wrap: wrap; gap: 16px; }
.page-title { font-family: 'Bebas Neue', sans-serif; font-size: 38px; letter-spacing: 0.05em; line-height: 1; }
.page-title span { color: var(--green); }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
.stat-card { background: var(--dark); border: 1px solid var(--border); border-radius: 14px; padding: 20px; position: relative; overflow: hidden; transition: border-color 0.2s; }
.stat-card:hover { border-color: var(--border2); }
.stat-label { font-size: 11px; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 10px; }
.stat-value { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 0.03em; line-height: 1; }
.stat-value.green { color: var(--green); }
.stat-value.purple { color: var(--purple3); }
.stat-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }
.bills-list { display: flex; flex-direction: column; gap: 12px; }
.bill-card { background: var(--dark); border: 1px solid var(--border); border-radius: 14px; padding: 20px 24px; display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 20px; transition: all 0.2s; cursor: pointer; }
.bill-card:hover { border-color: var(--border2); background: var(--dark2); transform: translateX(2px); }
.bill-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.bill-meta { font-size: 12px; color: var(--muted); display: flex; gap: 12px; }
.bill-id { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: var(--dark3); padding: 2px 8px; border-radius: 4px; color: var(--purple3); }
.bill-amount { font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: 0.03em; text-align: right; }
.bill-progress-wrap { width: 100px; }
.bill-progress-label { font-size: 11px; color: var(--muted); margin-bottom: 5px; text-align: right; }
.bill-progress { height: 4px; background: var(--dark3); border-radius: 2px; overflow: hidden; }
.bill-progress-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, var(--purple), var(--green)); transition: width 0.5s ease; }
.bill-actions { display: flex; gap: 8px; }
.bill-action-btn { padding: 7px 14px; border-radius: 7px; font-family: 'Epilogue', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
.roommates-shell { display:flex; flex-direction:column; gap:20px; }
.roommates-hero { position:relative; overflow:hidden; background:radial-gradient(circle at top left, rgba(124,58,237,0.22), transparent 34%), linear-gradient(135deg, rgba(14,14,20,0.96), rgba(9,9,14,0.98)); border:1px solid rgba(124,58,237,0.18); border-radius:24px; padding:28px; display:grid; grid-template-columns:1.3fr 0.9fr; gap:20px; }
.roommates-hero::after { content:''; position:absolute; inset:auto -40px -50px auto; width:220px; height:220px; background:radial-gradient(circle, rgba(48,209,88,0.15), transparent 68%); pointer-events:none; }
.roommates-kicker { display:inline-flex; align-items:center; gap:8px; padding:7px 12px; border-radius:999px; border:1px solid rgba(48,209,88,0.28); background:rgba(48,209,88,0.08); color:var(--green); font-size:11px; font-weight:800; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:14px; }
.roommates-hero-title { font-family:'Bebas Neue',sans-serif; font-size:54px; letter-spacing:0.05em; line-height:0.95; margin-bottom:10px; }
.roommates-hero-copy { max-width:620px; font-size:14px; color:var(--muted2); line-height:1.75; margin-bottom:18px; }
.roommates-pill-row { display:flex; flex-wrap:wrap; gap:10px; }
.roommates-pill { display:inline-flex; align-items:center; gap:8px; padding:9px 12px; border-radius:999px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:var(--white); font-size:12px; font-weight:600; }
.roommates-command { position:relative; background:linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:20px; min-height:100%; }
.roommates-command-label { font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-bottom:10px; }
.roommates-command-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-top:16px; }
.roommates-command-card { padding:14px; border-radius:16px; background:rgba(10,10,16,0.82); border:1px solid rgba(255,255,255,0.06); }
.roommates-command-value { font-family:'Bebas Neue',sans-serif; font-size:30px; letter-spacing:0.04em; line-height:1; margin-bottom:4px; }
.roommates-command-sub { font-size:12px; color:var(--muted); line-height:1.5; }
.roommates-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
.roommates-stat { background:linear-gradient(180deg, rgba(19,19,26,0.95), rgba(11,11,17,0.95)); border:1px solid rgba(255,255,255,0.07); border-radius:18px; padding:18px; min-height:120px; }
.roommates-stat-label { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--muted); margin-bottom:10px; }
.roommates-stat-value { font-family:'Bebas Neue',sans-serif; font-size:40px; letter-spacing:0.04em; line-height:1; margin-bottom:6px; }
.roommates-stat-note { font-size:12px; color:var(--muted2); line-height:1.6; }
.roommates-houses-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:18px; }
.house-card { position:relative; overflow:hidden; background:linear-gradient(180deg, rgba(17,17,24,0.98), rgba(11,11,16,0.98)); border:1px solid rgba(255,255,255,0.08); border-radius:22px; padding:22px; cursor:pointer; transition:transform 0.18s,border-color 0.18s, box-shadow 0.18s; }
.house-card:hover { transform:translateY(-2px); border-color:rgba(124,58,237,0.32); box-shadow:0 20px 40px rgba(0,0,0,0.22); }
.house-card::before { content:''; position:absolute; inset:0 auto auto 0; width:100%; height:4px; background:linear-gradient(90deg, rgba(124,58,237,0.95), rgba(48,209,88,0.95)); opacity:0.9; }
.house-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:18px; }
.house-card-kicker { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:var(--purple3); margin-bottom:8px; }
.house-card-title { font-family:'Bebas Neue',sans-serif; font-size:34px; letter-spacing:0.04em; line-height:0.95; margin-bottom:8px; }
.house-card-id { display:inline-flex; align-items:center; padding:3px 8px; border-radius:999px; background:rgba(124,58,237,0.12); border:1px solid rgba(124,58,237,0.22); color:var(--purple3); font-size:10px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; }
.house-card-balance { text-align:right; }
.house-card-balance-label { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }
.house-card-balance-value { font-family:'Bebas Neue',sans-serif; font-size:42px; letter-spacing:0.04em; line-height:0.95; }
.house-card-balance-value.settled { color:var(--green); }
.house-card-balance-value.open { color:#FFB04A; }
.house-card-meta { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
.house-card-chip { display:inline-flex; align-items:center; gap:6px; padding:7px 10px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); color:var(--muted2); }
.house-card-panel { display:grid; grid-template-columns:1.2fr 1fr; gap:14px; margin-bottom:18px; }
.house-card-rhythm, .house-card-settlement { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:16px; padding:14px; }
.house-card-panel-label { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-bottom:8px; }
.house-card-rhythm-list { display:flex; flex-wrap:wrap; gap:8px; }
.house-card-rhythm-pill { padding:6px 9px; border-radius:999px; background:rgba(48,209,88,0.08); border:1px solid rgba(48,209,88,0.16); color:var(--green); font-size:11px; font-weight:700; }
.house-card-rhythm-empty { font-size:12px; color:var(--muted); line-height:1.6; }
.house-settle-row { display:flex; align-items:end; justify-content:space-between; gap:12px; margin-bottom:8px; }
.house-settle-value { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:0.04em; line-height:1; }
.house-settle-copy { font-size:12px; color:var(--muted2); line-height:1.6; }
.house-progress-track { height:8px; background:rgba(255,255,255,0.06); border-radius:999px; overflow:hidden; }
.house-progress-fill { height:100%; border-radius:999px; background:linear-gradient(90deg, #7C3AED, #30D158); }
.house-card-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.house-avatar-stack { display:flex; align-items:center; }
.house-avatar { width:34px; height:34px; border-radius:50%; border:2px solid #0B0B10; display:flex; align-items:center; justify-content:center; margin-left:-8px; font-size:11px; font-weight:800; color:#fff; box-shadow:0 4px 14px rgba(0,0,0,0.28); }
.house-avatar:first-child { margin-left:0; }
.raven-home-link { transition: filter 0.2s ease, text-shadow 0.2s ease, transform 0.2s ease; }
.raven-home-link.raven-armed { filter: drop-shadow(0 0 12px rgba(48,209,88,0.55)); text-shadow: 0 0 14px rgba(48,209,88,0.45); transform: scale(1.03); }
.house-card-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.house-btn { padding:9px 12px; border-radius:10px; font-family:'Epilogue',sans-serif; font-size:12px; font-weight:700; cursor:pointer; border:1px solid; background:none; }
.house-btn.remind { background:rgba(124,58,237,0.12); border-color:rgba(124,58,237,0.26); color:var(--purple3); }
.house-btn.share { background:rgba(0,140,255,0.1); border-color:rgba(0,140,255,0.2); color:#4DB8FF; }
.house-btn.view { background:rgba(48,209,88,0.12); border-color:rgba(48,209,88,0.2); color:var(--green); }
.roommates-empty { text-align:center; padding:70px 24px; border:1px dashed rgba(124,58,237,0.18); border-radius:24px; background:linear-gradient(180deg, rgba(17,17,24,0.9), rgba(10,10,14,0.95)); }
.roommates-empty-title { font-family:'Bebas Neue',sans-serif; font-size:34px; letter-spacing:0.04em; margin-bottom:8px; }
.roommates-empty-sub { font-size:13px; color:var(--muted); max-width:480px; margin:0 auto; line-height:1.75; }
.btn-remind { background: rgba(124,58,237,0.15); color: var(--purple3); border: 1px solid rgba(124,58,237,0.25); }
.btn-remind:hover { background: rgba(124,58,237,0.3); }
.btn-view { background: var(--dark3); color: var(--muted2); border: 1px solid var(--border); }
.btn-view:hover { color: var(--white); border-color: var(--border2); }
.status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.status-active { background: rgba(48,209,88,0.1); color: var(--green); border: 1px solid rgba(48,209,88,0.2); }
.status-completed { background: rgba(110,107,128,0.15); color: var(--muted2); border: 1px solid var(--border); }
.form-card { background: var(--dark); border: 1px solid var(--border); border-radius: 16px; padding: 32px; max-width: 600px; }
.form-group { margin-bottom: 20px; }
.form-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted2); margin-bottom: 8px; }
.form-input { width: 100%; padding: 12px 16px; background: var(--dark2); border: 1px solid var(--border); border-radius: 10px; color: var(--white); font-family: 'Epilogue', sans-serif; font-size: 14px; outline: none; transition: border-color 0.2s; }
.form-input:focus { border-color: var(--purple); }
.people-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.person-tag { display: flex; align-items: center; gap: 6px; background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25); border-radius: 20px; padding: 5px 12px; font-size: 13px; color: var(--purple3); }
.person-tag button { background: none; border: none; color: var(--purple3); cursor: pointer; font-size: 14px; padding: 0; line-height: 1; opacity: 0.6; transition: opacity 0.15s; }
.person-tag button:hover { opacity: 1; }
.add-person-input { flex: 1; padding: 10px 14px; background: var(--dark2); border: 1px solid var(--border); border-radius: 8px; color: var(--white); font-family: 'Epilogue', sans-serif; font-size: 13px; outline: none; }
.add-person-input:focus { border-color: var(--purple); }
.add-person-btn { padding: 10px 16px; background: rgba(124,58,237,0.15); border: 1px solid rgba(124,58,237,0.3); border-radius: 8px; color: var(--purple3); font-family: 'Epilogue', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.add-person-btn:hover { background: rgba(124,58,237,0.3); }
.submit-btn { width: 100%; padding: 14px; background: var(--green); color: #000; border: none; border-radius: 10px; font-family: 'Epilogue', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 20px var(--green-glow); }
.submit-btn:hover { background: #3ddd68; transform: translateY(-1px); }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 500; display: none; align-items: center; justify-content: center; padding: 20px; }
.modal-overlay.open { display: flex; }
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 600; display: none; align-items: center; justify-content: center; padding: 20px; }
.modal-bg.open { display: flex; }
.modal { background: var(--dark); border: 1px solid var(--border2); border-radius: 20px; padding: 32px; width: 100%; max-width: 520px; max-height: 85vh; overflow-y: auto; position: relative; }
.modal-close { position: absolute; top: 20px; right: 20px; background: var(--dark3); border: none; color: var(--muted); width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.modal-close:hover { background: var(--dark4); color: var(--white); }
.modal-title { font-family: 'Bebas Neue', sans-serif; font-size: 30px; letter-spacing: 0.05em; margin-bottom: 6px; }
.modal-meta { font-size: 13px; color: var(--muted); margin-bottom: 24px; }
.participants-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
.participant-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--dark2); border-radius: 10px; border: 1px solid var(--border); }
.participant-name { font-weight: 500; font-size: 14px; }
.participant-amount { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.paid-tag { color: var(--green); font-weight: 600; }
.owed-tag { color: var(--orange); }
.mark-paid-btn { padding: 5px 12px; background: rgba(48,209,88,0.1); border: 1px solid rgba(48,209,88,0.25); border-radius: 6px; color: var(--green); font-family: 'Epilogue', sans-serif; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.mark-paid-btn:hover { background: rgba(48,209,88,0.25); }
.modal-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.modal-btn { flex: 1; padding: 12px; border-radius: 10px; font-family: 'Epilogue', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; min-width: 120px; }
.modal-btn-remind { background: rgba(124,58,237,0.15); color: var(--purple3); border: 1px solid rgba(124,58,237,0.25); }
.modal-btn-remind:hover { background: rgba(124,58,237,0.3); }
.modal-btn-delete { background: rgba(255,68,68,0.1); color: var(--red); border: 1px solid rgba(255,68,68,0.2); }
.modal-btn-delete:hover { background: rgba(255,68,68,0.2); }
.modal-btn-view { background: rgba(48,209,88,0.12); color: var(--green); border: 1px solid rgba(48,209,88,0.25); }
.modal-btn-view:hover { background: rgba(48,209,88,0.25); }
.empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
.empty-icon { font-size: 48px; margin-bottom: 16px; display: block; opacity: 0.4; }
.empty-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: var(--muted2); margin-bottom: 8px; }
.empty-sub { font-size: 14px; }
.toast { position: fixed; bottom: 24px; right: 24px; background: var(--dark2); border: 1px solid var(--border2); border-radius: 12px; padding: 14px 20px; font-size: 13px; color: var(--white); box-shadow: 0 20px 60px rgba(0,0,0,0.5); z-index: 1000; transform: translateY(80px); opacity: 0; transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1); display: flex; align-items: center; gap: 10px; }
.toast.show { transform: translateY(0); opacity: 1; }
.toast.success { border-color: rgba(48,209,88,0.3); }
.toast.error { border-color: rgba(255,68,68,0.3); }
.notif-filter { padding:7px 16px;border-radius:20px;font-family:'Epilogue',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--dark2);color:var(--muted);transition:all 0.15s; }
.notif-filter.active { background:rgba(124,58,237,0.15);border-color:rgba(124,58,237,0.35);color:var(--purple3); }
.notif-filter:hover { color:var(--white);border-color:var(--border2); }
.notif-item { display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:var(--dark);border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:all 0.15s; }
.notif-item:hover { border-color:var(--border2);background:var(--dark2); }
.notif-item.unread { border-left:3px solid var(--purple3);background:rgba(124,58,237,0.04); }
.notif-icon { width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0; }
.loading { display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--muted); gap: 10px; font-size: 13px; }
.spinner { width: 18px; height: 18px; border: 2px solid var(--border); border-top-color: var(--purple); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--dark4); border-radius: 2px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 0.06em; color: var(--muted2); }
.section-count { font-size: 12px; color: var(--muted); background: var(--dark3); padding: 3px 10px; border-radius: 10px; }
.history-table { width: 100%; border-collapse: collapse; }
.history-table th { text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); padding: 0 16px 12px; border-bottom: 1px solid var(--border); }
.history-table td { padding: 14px 16px; font-size: 13px; color: var(--muted2); border-bottom: 1px solid var(--border); }
.history-table tr:last-child td { border-bottom: none; }
.history-table tr:hover td { background: var(--dark2); }
.history-table td:first-child { color: var(--white); font-weight: 500; }
@media(max-width: 768px) {
  .sidebar { display: none !important; }
  .main { margin-left: 0 !important; padding: 16px 16px 120px !important; }
  .stats-row { grid-template-columns: 1fr 1fr !important; gap: 10px !important; }
  .stat-value { font-size: 26px !important; }
  .stat-card { padding: 16px !important; }
  .bill-card { grid-template-columns: 1fr !important; gap: 8px !important; padding: 14px !important; }
  .bill-amount { text-align: left !important; font-size: 20px !important; }
  .bill-progress-wrap { display: none !important; }
  .bill-actions { display: flex !important; }
  .bill-action-btn { padding: 8px 12px !important; font-size: 11px !important; }
  .roommates-hero { grid-template-columns:1fr !important; padding:20px !important; }
  .roommates-hero-title { font-size:40px !important; }
  .roommates-stats { grid-template-columns:1fr 1fr !important; }
  .roommates-command-grid { grid-template-columns:1fr 1fr !important; }
  .house-card-panel { grid-template-columns:1fr !important; }
  .house-card-footer { flex-direction:column; align-items:flex-start !important; }
  .house-card-actions { width:100%; justify-content:stretch !important; }
  .house-btn { flex:1; text-align:center; }
  .page-title { font-size: 26px !important; }
  .page-header { margin-bottom: 20px !important; }
  .form-card { padding: 18px !important; }
  .auth-card { padding: 24px 18px !important; border-radius: 16px !important; }
  .auth-logo-name { font-size: 32px !important; }
  .auth-box { padding: 0 16px !important; }
  #auth-screen { padding-top: 32px; align-items: flex-start; }
  .modal { padding: 20px 16px !important; border-radius: 16px !important; }
  .modal-actions { flex-wrap: wrap !important; }
  .modal-btn { min-width: calc(50% - 5px) !important; font-size: 12px !important; padding: 10px 8px !important; }
  #cb-step-1 > div, #cb-step-2 > div, #cb-step-3 > div { grid-template-columns: 1fr !important; }
  .history-table th:nth-child(3), .history-table td:nth-child(3) { display: none; }
}
#mobile-nav {
  display: none;
  position: fixed; bottom: 0; left: 0; right: 0;
  background: rgba(12,12,18,0.98);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255,255,255,0.08);
  z-index: 200;
  padding: 12px 0 10px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
}
.mob-nav-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 4px 2px; border: none; background: none;
  color: rgba(182,171,208,0.92); font-family: 'Epilogue', sans-serif;
  font-size: 9px; font-weight: 700; cursor: pointer;
  -webkit-tap-highlight-color: transparent; transition: color 0.15s;
  letter-spacing: 0.03em; text-transform: uppercase;
}
.mob-nav-btn .mi { width: 26px; height: 26px; display:flex; align-items:center; justify-content:center; line-height: 1; margin-bottom: 1px; }
.mob-nav-btn .mi svg { width: 22px; height: 22px; display:block; }
.mob-nav-btn .mi svg * { vector-effect: non-scaling-stroke; }
.mob-nav-btn:not(.create-btn) .mi svg { color: #a98af6; }
.mob-nav-btn.active { color: var(--green); }
.mob-nav-btn.active .mi svg { color: var(--green); filter: drop-shadow(0 0 10px rgba(48,209,88,0.16)); }
.mob-nav-btn.active .mi-ring { background: rgba(48,209,88,0.1); border-color: rgba(48,209,88,0.24); }
.mob-nav-btn .mi-ring { box-shadow: inset 0 1px 0 rgba(255,255,255,0.03); }
.mob-nav-btn:not(.create-btn):not(.active) .mi-ring { background: rgba(168,85,247,0.08); border-color: rgba(168,85,247,0.16); }
.mob-nav-btn.create-btn { transform: translateY(-3px); }
.mob-nav-btn.create-btn .mi { width: 44px; height: 44px; margin-bottom: 0; }
.mob-nav-btn.create-btn .mi-ring { width: 44px; height: 44px; border-radius: 999px; background: var(--green); border: 1px solid rgba(48,209,88,0.32); color:#000; box-shadow: 0 12px 24px rgba(48,209,88,0.2); }
.mob-nav-btn.create-btn .mi svg { width: 20px; height: 20px; }
.mob-nav-label { display:block; line-height:1; }
.mob-nav-btn.create-btn .mob-nav-label { margin-top: 8px; }
.mi-ring { display:flex; align-items:center; justify-content:center; width: 36px; height: 36px; border-radius: 14px; border: 1px solid transparent; transition: all 0.15s; }
#mobile-header {
  display: none; position: sticky; top: 0;
  background: rgba(12,12,18,0.98);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  padding: 0 16px; height: 52px;
  align-items: center; justify-content: space-between; z-index: 150;
}
@media(max-width: 768px) {
  #mobile-nav { display: flex !important; }
  #mobile-header { display: flex !important; }
}
.cb-item-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--dark2); border: 1px solid var(--border); border-radius: 10px; transition: border-color 0.2s; }
.cb-item-row:hover { border-color: var(--border2); }
.pay-method-row { display:flex;align-items:center;gap:14px;padding:14px 16px;border:2px solid rgba(255,255,255,0.06);border-radius:14px;text-decoration:none;transition:all 0.18s;margin-bottom:0; }
.pay-method-row:hover { border-color:rgba(255,255,255,0.15);transform:translateX(3px); }
.pay-method-icon { width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;font-size:16px;color:#fff; }
.pay-method-info { flex:1; }
.pay-method-name { font-size:15px;font-weight:600;color:#fff; }
.pay-method-handle { font-size:12px;color:rgba(255,255,255,0.5);margin-top:2px; }
.pay-method-arrow { font-size:16px;color:rgba(255,255,255,0.4); }

.raven-r-mark::before {
  content: '';
  display: inline-block;
  width: 1em;
  height: 1em;
  background-image: url("data:image/svg+xml,%3Csvg width='28' height='28' viewBox='0 0 28 28' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3ClinearGradient id='rg' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23C084FC'/%3E%3Cstop offset='100%25' stop-color='%237C3AED'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ctext x='2' y='22' font-family='Bebas Neue, sans-serif' font-size='24' fill='url(%23rg)'%3ER%3C/text%3E%3Ccircle cx='11' cy='24' r='3' fill='%2330D158'/%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  vertical-align: middle;
}
.raven-sprite { position:absolute; width:0; height:0; overflow:hidden; pointer-events:none; }
.raven-icon { width:18px; height:18px; display:inline-block; vertical-align:middle; flex-shrink:0; }
.raven-icon.lg { width:22px; height:22px; }
.raven-icon.xl { width:26px; height:26px; }
.raven-icon.empty { width:54px; height:54px; opacity:0.82; }
.nav-item .ni { width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
.mob-quick-glyph { width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; }
.notif-icon .raven-icon { width:20px; height:20px; }
.trip-title-icon,.bill-action-icon { width:15px; height:15px; display:inline-block; vertical-align:-2px; margin-right:6px; flex-shrink:0; }
.bill-action-icon { margin-right:5px; }
.empty-icon.empty-icon-svg { width:auto; height:auto; opacity:1; display:inline-flex; align-items:center; justify-content:center; }
</style>
</head>
<body>
<svg class="raven-sprite" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="ravenGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#C084FC"></stop>
      <stop offset="100%" stop-color="#7C3AED"></stop>
    </linearGradient>
    <linearGradient id="ravenGradientSoft" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#A855F7"></stop>
      <stop offset="100%" stop-color="#6D28D9"></stop>
    </linearGradient>
  </defs>
  <symbol id="raven-mark" viewBox="0 0 28 28">
    <text x="2" y="22" font-family="Bebas Neue, sans-serif" font-size="24" fill="url(#ravenGradient)">R</text>
    <circle cx="11" cy="24" r="3" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-overview" viewBox="0 0 18 18">
    <rect x="2" y="9" width="3" height="7" rx="1.2" fill="url(#ravenGradient)" opacity="0.72"></rect>
    <rect x="7.5" y="5.5" width="3" height="10.5" rx="1.2" fill="url(#ravenGradient)"></rect>
    <rect x="13" y="2" width="3" height="14" rx="1.2" fill="url(#ravenGradient)" opacity="0.56"></rect>
    <circle cx="15.2" cy="15.2" r="1.45" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-active-bills" viewBox="0 0 18 18">
    <path d="M4 2.5H11.2C12.2 2.5 13 3.3 13 4.3V15.2L11.4 14L9.9 15.2L8.4 14L6.9 15.2L5.4 14L4 15.2V2.5Z" fill="none" stroke="url(#ravenGradient)" stroke-width="1.4" stroke-linejoin="round"></path>
    <path d="M6.3 6.1H10.1M6.3 8.9H10.1M6.3 11.7H8.5" stroke="url(#ravenGradientSoft)" stroke-width="1.35" stroke-linecap="round"></path>
    <path d="M12.7 4.1L15.4 5.4L12.7 6.9" stroke="#30D158" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"></path>
  </symbol>
  <symbol id="icon-create-bill" viewBox="0 0 18 18">
    <path d="M3.1 3.4C3.1 2.63 3.73 2 4.5 2H11.6C12.37 2 13 2.63 13 3.4V14.8L11.6 13.7L10.2 14.8L8.8 13.7L7.4 14.8L6 13.7L4.6 14.8L3.1 13.8V3.4Z" fill="none" stroke="rgba(192,132,252,0.5)" stroke-width="1.2" stroke-linejoin="round"></path>
    <path d="M8 5.3V11.6M4.9 8.45H11.1" stroke="url(#ravenGradient)" stroke-width="1.9" stroke-linecap="round"></path>
    <path d="M8 11.6L6.9 13.1M8 11.6L9.2 13.1" stroke="#A855F7" stroke-width="1.05" stroke-linecap="round"></path>
    <circle cx="14.55" cy="14.55" r="1.45" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-trip-hub" viewBox="0 0 18 18">
    <path d="M2.1 10.5L8.9 8.3L15.9 2.8L12.1 9L14.8 10.3L11.4 10.9L9.2 14.9L8.1 10.8L2.1 10.5Z" fill="none" stroke="url(#ravenGradient)" stroke-width="1.35" stroke-linejoin="round"></path>
    <path d="M8.9 8.3L12.1 9" stroke="url(#ravenGradientSoft)" stroke-width="1.2" stroke-linecap="round"></path>
    <circle cx="14.8" cy="12.8" r="1.4" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-roommates" viewBox="0 0 18 18">
    <path d="M2.4 7.9L9 3L15.6 7.9" fill="none" stroke="url(#ravenGradient)" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M4.1 7.7H13.9V14.9H4.1V7.7Z" fill="none" stroke="url(#ravenGradient)" stroke-width="1.35" stroke-linejoin="round"></path>
    <rect x="7.05" y="10.1" width="3.9" height="4.8" rx="0.8" fill="url(#ravenGradientSoft)" opacity="0.72"></rect>
    <circle cx="13.9" cy="13.9" r="1.35" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-friends" viewBox="0 0 18 18">
    <circle cx="6.2" cy="5.25" r="2.45" fill="none" stroke="url(#ravenGradient)" stroke-width="1.3"></circle>
    <path d="M2 14C2 11.51 3.88 9.55 6.2 9.55C8.52 9.55 10.4 11.51 10.4 14" fill="none" stroke="url(#ravenGradient)" stroke-width="1.3" stroke-linecap="round"></path>
    <circle cx="12.8" cy="6" r="1.9" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.2"></circle>
    <path d="M12.2 10.2C13.78 10.48 15 11.93 15 13.85" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.2" stroke-linecap="round"></path>
    <circle cx="13.8" cy="13.8" r="1.3" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-history" viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="6.25" fill="none" stroke="url(#ravenGradient)" stroke-width="1.3"></circle>
    <path d="M9 5.15V9L11.85 11.35" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M3.45 7.2C3.05 8.12 2.98 9.4 3.44 10.63C4.11 12.42 5.47 13.8 7.19 14.5" fill="none" stroke="#30D158" stroke-width="1.05" stroke-linecap="round" stroke-dasharray="2.2 2.4"></path>
  </symbol>
  <symbol id="icon-notifications" viewBox="0 0 18 18">
    <path d="M5.1 12.2C3.6 10.95 3 9.23 3 7.25C3 4.63 5.37 2.45 8.98 2.45C12.59 2.45 14.95 4.63 14.95 7.25C14.95 9.23 14.36 10.95 12.85 12.2H5.1Z" fill="none" stroke="url(#ravenGradient)" stroke-width="1.3" stroke-linejoin="round"></path>
    <path d="M7 13.35C7.32 14.24 8.09 14.8 9 14.8C9.91 14.8 10.68 14.24 11 13.35" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.3" stroke-linecap="round"></path>
    <circle cx="13.65" cy="4.15" r="1.7" fill="#FF4444"></circle>
    <circle cx="9" cy="1.95" r="1.05" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-invite" viewBox="0 0 18 18">
    <circle cx="11.9" cy="5" r="2.3" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.25"></circle>
    <path d="M8.7 13.8C8.95 11.64 10.15 9.8 11.9 9.8C13.65 9.8 14.85 11.64 15.1 13.8" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.25" stroke-linecap="round"></path>
    <path d="M2.2 14.4C3.25 10.65 5.85 7.25 8.25 5.05" fill="none" stroke="url(#ravenGradient)" stroke-width="1.6" stroke-linecap="round"></path>
    <path d="M5 12C5.65 11.25 6.4 10.7 7.25 10.35M6.9 9.5C7.5 8.7 8.1 8.05 8.8 7.5" fill="none" stroke="#A855F7" stroke-width="1.02" stroke-linecap="round"></path>
    <path d="M8.25 5.05L7.7 6.4L9.1 6.8Z" fill="url(#ravenGradient)"></path>
    <circle cx="14.95" cy="13.95" r="1.3" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-privacy" viewBox="0 0 18 18">
    <path d="M9 2.4L14 4.4V8.3C14 11.5 11.95 13.98 9 15.2C6.05 13.98 4 11.5 4 8.3V4.4L9 2.4Z" fill="none" stroke="url(#ravenGradient)" stroke-width="1.3" stroke-linejoin="round"></path>
    <path d="M7.1 8.55V7.65C7.1 6.58 7.95 5.75 9 5.75C10.05 5.75 10.9 6.58 10.9 7.65V8.55" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.2" stroke-linecap="round"></path>
    <rect x="6.15" y="8.4" width="5.7" height="4.35" rx="1" fill="none" stroke="url(#ravenGradientSoft)" stroke-width="1.2"></rect>
    <circle cx="12.95" cy="12.95" r="1.2" fill="#30D158"></circle>
  </symbol>
  <symbol id="icon-more" viewBox="0 0 18 18">
    <path d="M3 5.2H12.2M5.8 9H15M3 12.8H12.2" stroke="url(#ravenGradient)" stroke-width="1.8" stroke-linecap="round"></path>
    <circle cx="14.3" cy="5.2" r="1.25" fill="#30D158"></circle>
    <circle cx="3.7" cy="12.8" r="1.15" fill="#A855F7"></circle>
  </symbol>
  <symbol id="mob-icon-overview" viewBox="0 0 24 24">
    <rect x="4" y="12" width="3.2" height="7" rx="1.2" fill="currentColor" opacity="0.72"></rect>
    <rect x="10.4" y="8" width="3.2" height="11" rx="1.2" fill="currentColor"></rect>
    <rect x="16.8" y="4.5" width="3.2" height="14.5" rx="1.2" fill="currentColor" opacity="0.82"></rect>
    <circle cx="19.4" cy="18.8" r="1.8" fill="currentColor"></circle>
  </symbol>
  <symbol id="mob-icon-bills" viewBox="0 0 24 24">
    <path d="M7 4.5H15.2C16.53 4.5 17.6 5.57 17.6 6.9V18.7L15.9 17.4L14.3 18.7L12.7 17.4L11.1 18.7L9.5 17.4L7 19.1V4.5Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"></path>
    <path d="M9.5 8.8H14M9.5 12H14M9.5 15.2H12.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    <path d="M17.3 7.2L20 8.5L17.3 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
  </symbol>
  <symbol id="mob-icon-create" viewBox="0 0 24 24">
    <path d="M12 6.2V17.8M6.2 12H17.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
  </symbol>
  <symbol id="mob-icon-trips" viewBox="0 0 24 24">
    <path d="M3.7 13.8L12.1 11.3L20 5.2L15.8 11.9L18.8 13.4L14.4 14.1L11.5 18.5L10 14L3.7 13.8Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"></path>
    <circle cx="17.8" cy="16.7" r="1.7" fill="currentColor"></circle>
  </symbol>
  <symbol id="mob-icon-more" viewBox="0 0 24 24">
    <path d="M6 7H18M6 12H18M6 17H18" stroke="currentColor" stroke-width="2.15" stroke-linecap="round"></path>
    <circle cx="18" cy="7" r="1.4" fill="currentColor"></circle>
    <circle cx="6" cy="12" r="1.4" fill="currentColor"></circle>
    <circle cx="18" cy="17" r="1.4" fill="currentColor"></circle>
  </symbol>
</svg>

<!-- AUTH SCREEN -->
<div id="auth-screen">
  <div class="auth-grid"></div>
  <div class="auth-box">
    <div class="auth-logo">
      <span class="auth-logo-icon" style="display:flex;align-items:center;justify-content:center"><svg width="44" height="44" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><defs><linearGradient id="rg1a" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#C084FC"/><stop offset="100%" stop-color="#7C3AED"/></linearGradient></defs><text x="3" y="32" font-family="Bebas Neue, sans-serif" font-size="36" fill="url(#rg1a)">R</text><circle cx="14" cy="26" r="4" fill="#30D158"/></svg></span>
      <div class="auth-logo-name">RAVEN</div>
      <div class="auth-logo-sub">Request Automatically Via Every Network</div>
    </div>
    <!-- Join trip banner — shown when coming from an invite link -->
    <div class="join-banner" id="join-banner">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M14 5.5a2 2 0 0 1-2 2l-2.5 0L6 13H4.5l1.5-5.5H3.5L2.5 9H1l1-3.5L1 2h1.5l1 1.5H6L4.5 0H6l3.5 5.5H13a1.5 1.5 0 0 1 1 1.5z" fill="currentColor"/></svg> You've been invited to join <b id="join-trip-name-display">a trip</b> on RAVEN.<br>
      <span style="font-size:12px;color:#9896A8;margin-top:4px;display:block">Create an account or sign in to join.</span>
    </div>
    <div class="auth-card">
      <div class="auth-tabs">
        <button class="auth-tab active" onclick="switchAuthTab('login')">Sign In</button>
        <button class="auth-tab" onclick="switchAuthTab('signup')">Create Account</button>
      </div>
      <div id="auth-error" class="auth-error"></div>
      <!-- Google OAuth button — shown for both tabs -->
      <button onclick="handleGoogleAuth()" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:13px 16px;background:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:10px;cursor:pointer;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;color:#1f1f1f;margin-bottom:16px;transition:all 0.2s" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='#fff'">
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
        Continue with Google
      </button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="flex:1;height:1px;background:var(--border)"></div>
        <span style="font-size:11px;color:var(--muted);font-weight:600;letter-spacing:0.08em">OR</span>
        <div style="flex:1;height:1px;background:var(--border)"></div>
      </div>
      <div id="login-form" class="auth-form">
        <div><label class="auth-label">Email</label><input id="login-email" type="email" class="auth-input" placeholder="your@email.com" autocomplete="email"></div>
        <div style="position:relative">
          <label class="auth-label">Password</label>
          <input id="login-password" type="password" class="auth-input" placeholder="••••••••" autocomplete="current-password" style="padding-right:44px">
          <button type="button" onclick="togglePasswordVis('login-password',this)" style="position:absolute;right:12px;bottom:12px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0">👁</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:-4px">
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:var(--muted)">
            <input type="checkbox" id="remember-me" style="width:15px;height:15px;accent-color:var(--green);cursor:pointer" onchange="handleRememberMe()">
            Remember me
          </label>
          <button type="button" onclick="showForgotPassword()" style="background:none;border:none;color:var(--purple3);font-size:12px;font-weight:600;cursor:pointer;font-family:'Epilogue',sans-serif;padding:0">Forgot password?</button>
        </div>
        <button class="auth-btn" onclick="handleLogin()">Sign In →</button>
      </div>

      <!-- Forgot Password form — hidden by default -->
      <div id="forgot-form" class="auth-form" style="display:none">
        <div style="text-align:center;margin-bottom:4px">
          <div style="font-size:32px;margin-bottom:8px">🔑</div>
          <div style="font-size:15px;font-weight:700;color:var(--white);margin-bottom:4px">Reset your password</div>
          <div style="font-size:13px;color:var(--muted)">Enter your email and we'll send you a reset link</div>
        </div>
        <div><label class="auth-label">Email</label><input id="forgot-email" type="email" class="auth-input" placeholder="your@email.com" autocomplete="email"></div>
        <button class="auth-btn" id="forgot-btn" onclick="handleForgotPassword()">Send Reset Link →</button>
        <div id="forgot-success" style="display:none;padding:12px 16px;background:rgba(48,209,88,0.07);border:1px solid rgba(48,209,88,0.2);border-radius:10px;font-size:13px;color:var(--green);text-align:center">
          ✅ Reset link sent! Check your email inbox (and spam folder).
        </div>
        <button type="button" onclick="showLoginForm()" style="background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;font-family:'Epilogue',sans-serif;text-align:center;width:100%;padding:4px 0">← Back to Sign In</button>
      </div>
      <div id="signup-form" class="auth-form" style="display:none">
        <div><label class="auth-label">First Name</label><input id="signup-firstname" type="text" class="auth-input" placeholder="Your first name"></div>
        <div><label class="auth-label">Email</label><input id="signup-email" type="email" class="auth-input" placeholder="your@email.com" autocomplete="email"></div>
        <div><label class="auth-label">Password</label><input id="signup-password" type="password" class="auth-input" placeholder="At least 6 characters" autocomplete="new-password"></div>
        <div><label class="auth-label">Confirm Password</label><input id="signup-confirm" type="password" class="auth-input" placeholder="••••••••" autocomplete="new-password"></div>
        <button class="auth-btn" onclick="handleSignup()">Create Account →</button>
      </div>
    </div>
    <div class="auth-footer"><a href="index.html" style="color:var(--muted);text-decoration:none">← Back to ravensplit.com</a></div>
  </div>
</div>

<!-- MOBILE HEADER -->
<div id="mobile-header">
  <a href="index.html" id="dashboard-raven-home-link" class="raven-home-link" style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:0.15em;text-decoration:none;background:linear-gradient(135deg,var(--white),var(--purple3));-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:flex;align-items:center;gap:6px"><svg class="raven-icon lg" style="-webkit-text-fill-color:initial"><use href="#raven-mark"></use></svg> RAVEN</a>
  <div style="display:flex;align-items:center;gap:10px">
    <button onclick="handleLogout()" style="padding:6px 12px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.18);border-radius:8px;color:#FF6B6B;font-family:'Epilogue',sans-serif;font-size:11px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent">⎋ Sign Out</button>
    <div id="mob-user-avatar" onclick="showPage('settings');setMobNav('mob-settings')" style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--green));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;cursor:pointer;overflow:hidden">?</div>
  </div>
</div>

<!-- DASHBOARD SCREEN -->
<div id="dashboard-screen">
  <aside class="sidebar">
    <a href="index.html" class="sidebar-logo">
      <span class="sidebar-logo-mark" style="display:flex;align-items:center"><svg class="raven-icon lg"><use href="#raven-mark"></use></svg></span>
      <span class="sidebar-logo-text">RAVEN</span>
    </a>
    <nav class="sidebar-nav">
      <button class="nav-item active" onclick="showPage('overview')"><span class="ni"><svg class="raven-icon"><use href="#icon-overview"></use></svg></span> Overview</button>
      <button class="nav-item" onclick="showPage('active-bills')"><span class="ni"><svg class="raven-icon"><use href="#icon-active-bills"></use></svg></span> Active Bills <span class="nav-badge" id="active-count">0</span></button>
      <button class="nav-item" onclick="showPage('create-bill')"><span class="ni"><svg class="raven-icon"><use href="#icon-create-bill"></use></svg></span> Create Bill</button>
      <button class="nav-item" onclick="showPage('trip-hub')"><span class="ni"><svg class="raven-icon"><use href="#icon-trip-hub"></use></svg></span> Trip Hub</button>
      <button class="nav-item" onclick="showPage('roommates')"><span class="ni"><svg class="raven-icon"><use href="#icon-roommates"></use></svg></span> Roommates <span style="font-size:9px;font-weight:700;padding:1px 6px;background:rgba(48,209,88,0.15);border:1px solid rgba(48,209,88,0.3);border-radius:6px;color:var(--green);margin-left:4px;vertical-align:middle">BETA</span></button>
      <button class="nav-item" onclick="showPage('friends')" style="position:relative"><span class="ni"><svg class="raven-icon"><use href="#icon-friends"></use></svg></span> Friends <span id="friends-dm-badge" style="display:none;position:absolute;top:6px;right:8px;min-width:16px;height:16px;padding:0 4px;background:var(--purple);border-radius:8px;font-size:10px;font-weight:700;color:#fff;align-items:center;justify-content:center"></span></button>
      <button class="nav-item" onclick="showPage('history')"><span class="ni"><svg class="raven-icon"><use href="#icon-history"></use></svg></span> History</button>
      <div style="flex:1"></div>
      <button class="nav-item" onclick="showPage('notifications')" style="position:relative"><span class="ni"><svg class="raven-icon"><use href="#icon-notifications"></use></svg></span> Notifications <span id="notif-badge" style="display:none;margin-left:auto;background:#FF4444;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;min-width:20px;text-align:center"></span></button>
      <button class="nav-item" onclick="showPage('invite')"><span class="ni"><svg class="raven-icon"><use href="#icon-invite"></use></svg></span> Invite Friends</button>
    </nav>
    <div class="sidebar-user">
      <button onclick="showPage('settings')" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;background:transparent;border:none;border-radius:10px;cursor:pointer;transition:background 0.2s;text-align:left" onmouseover="this.style.background='var(--dark3)'" onmouseout="this.style.background='transparent'">
        <div id="sidebar-avatar" style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--green));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">?</div>
        <div style="flex:1;min-width:0">
          <div id="sidebar-name" style="font-size:13px;font-weight:600;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">My Account</div>
          <div style="font-size:11px;color:var(--muted)">Settings, payments & privacy</div>
        </div>
      </button>
      <button onclick="handleLogout()" style="width:100%;margin-top:4px;padding:8px 12px;background:transparent;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:12px;cursor:pointer;border-radius:8px;transition:all 0.15s;text-align:left" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--muted)'">⎋ Sign Out</button>
    </div>
  </aside>

  <main class="main">
    <div class="main-inner">
    <!-- OVERVIEW -->
    <div id="page-overview" class="page active">
      <div class="page-header"><h1 class="page-title">Welcome, <span id="greeting-name"></span></h1></div>
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Active Bills</div><div class="stat-value purple" id="stat-active">—</div><div class="stat-sub">currently open</div></div>
        <div class="stat-card"><div class="stat-label">Total Owed by You</div><div class="stat-value" id="stat-owed" style="color:#FF6B6B">—</div><div class="stat-sub" id="stat-owed-sub" style="display:none">across active bills</div></div>
        <div class="stat-card"><div class="stat-label">You're Owed</div><div class="stat-value green" id="stat-collected" style="display:none">—</div><div class="stat-sub" id="stat-collected-sub" style="display:none">owed to you on active bills</div><div id="stat-collected-empty" style="color:var(--muted);font-size:13px">—</div></div>
        <div class="stat-card"><div class="stat-label">Bills Settled</div><div class="stat-value" id="stat-settled">—</div><div class="stat-sub">all time</div></div>
      </div>
      <div class="section-header">
        <div class="section-title">Recent Bills</div>
        <button onclick="showPage('active-bills')" style="background:none;border:none;color:var(--purple3);font-size:13px;cursor:pointer;font-family:'Epilogue',sans-serif">View all →</button>
      </div>
      <div id="overview-bills" class="bills-list"><div class="loading"><div class="spinner"></div> Loading bills...</div></div>
    </div>

    <!-- ACTIVE BILLS -->
    <div id="page-active-bills" class="page">
      <div class="page-header">
        <h1 class="page-title">Active <span>Bills</span></h1>
        <button class="bill-action-btn btn-remind" style="padding:10px 20px;font-size:13px" onclick="showPage('create-bill')">+ New Bill</button>
      </div>
      <div id="active-bills-list" class="bills-list"><div class="loading"><div class="spinner"></div> Loading...</div></div>
    </div>

    <!-- CREATE BILL -->
    <div id="page-create-bill" class="page">
      <div class="page-header"><h1 class="page-title">Create <span>Bill</span></h1></div>

      <!-- STEP PROGRESS BAR — full width, pill style -->
      <div style="display:flex;gap:0;margin-bottom:36px;background:var(--dark);border:1px solid var(--border);border-radius:14px;overflow:hidden;max-width:100%">
        <div id="cbs-1" onclick="cbGoToStep(1)" style="flex:1;display:flex;align-items:center;gap:12px;padding:16px 24px;cursor:pointer;border-right:1px solid var(--border);background:rgba(48,209,88,0.06);transition:background 0.2s">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:16px;color:#000;flex-shrink:0">1</div>
          <div><div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--green);font-weight:700">Step 1</div><div style="font-size:14px;color:var(--white);font-weight:600;margin-top:1px">Snap Receipt</div></div>
        </div>
        <div id="cbs-2" onclick="if(cbItems.length>0)cbGoToStep(2)" style="flex:1;display:flex;align-items:center;gap:12px;padding:16px 24px;cursor:pointer;border-right:1px solid var(--border);transition:background 0.2s">
          <div id="cbs-2-num" style="width:32px;height:32px;border-radius:50%;background:var(--dark3);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:16px;color:var(--muted);flex-shrink:0">2</div>
          <div><div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);font-weight:700">Step 2</div><div style="font-size:14px;color:var(--muted);font-weight:600;margin-top:1px">Review &amp; Assign</div></div>
        </div>
        <div id="cbs-3" onclick="if(cbPeople.length>0)cbGoToStep(3)" style="flex:1;display:flex;align-items:center;gap:12px;padding:16px 24px;cursor:pointer;transition:background 0.2s">
          <div id="cbs-3-num" style="width:32px;height:32px;border-radius:50%;background:var(--dark3);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:16px;color:var(--muted);flex-shrink:0">3</div>
          <div><div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);font-weight:700">Step 3</div><div style="font-size:14px;color:var(--muted);font-weight:600;margin-top:1px">Confirm &amp; Save</div></div>
        </div>
      </div>

      <!-- ── STEP 1 — Two column desktop layout ── -->
      <div id="cb-step-1">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start">

          <!-- LEFT: Bill name + receipt drop -->
          <div style="display:flex;flex-direction:column;gap:20px">
            <div style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:28px">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px">Bill Name</div>
              <input id="cb-name" type="text" class="form-input" placeholder="e.g. Saturday Night Out" style="font-size:17px;font-weight:700;padding:14px 18px;margin-bottom:20px">

              <!-- Live Mode Toggle -->
              <div id="cb-live-wrap" style="background:rgba(48,209,88,0.04);border:1px solid rgba(48,209,88,0.2);border-radius:14px;padding:16px 18px;margin-bottom:0">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                  <div style="flex:1">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                      <span style="font-size:15px">⚡</span>
                      <span style="font-size:14px;font-weight:700;color:#F0EEF8">Live Mode</span>
                      <span style="font-size:10px;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.3);color:#30D158;padding:2px 7px;border-radius:10px;font-weight:700">NEW</span>
                    </div>
                    <div style="font-size:12px;color:var(--muted);line-height:1.5">Share a QR code at the table — everyone picks their own items live. Totals update instantly.</div>
                  </div>
                  <!-- Toggle switch -->
                  <div onclick="cbToggleLiveMode()" id="cb-live-toggle" style="width:48px;height:26px;border-radius:13px;background:rgba(255,255,255,0.1);border:2px solid rgba(255,255,255,0.15);cursor:pointer;position:relative;transition:all 0.25s;flex-shrink:0">
                    <div id="cb-live-knob" style="position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#9896A8;transition:all 0.25s"></div>
                  </div>
                </div>

                <!-- People count — only shown when live mode is on -->
                <div id="cb-live-people-wrap" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid rgba(48,209,88,0.15)">
                  <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px">How many people at the table? <span style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0">(including you)</span></div>
                  <div style="display:flex;align-items:center;gap:10px">
                    <button onclick="cbLivePeopleAdj(-1)" style="width:36px;height:36px;border-radius:8px;background:var(--dark2);border:1px solid var(--border);color:var(--white);font-size:20px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;flex-shrink:0">−</button>
                    <span id="cb-live-count" style="font-size:24px;font-weight:800;color:#30D158;font-family:'JetBrains Mono',monospace;min-width:40px;text-align:center">2</span>
                    <button onclick="cbLivePeopleAdj(1)" style="width:36px;height:36px;border-radius:8px;background:var(--dark2);border:1px solid var(--border);color:var(--white);font-size:20px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;flex-shrink:0">+</button>
                    <span style="font-size:12px;color:var(--muted)">people splitting</span>
                  </div>
                  <div style="margin-top:10px;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px">
                    <span>📋</span> Who paid? Set in Step 2. Tax & tip split options available there.
                  </div>
                </div>
              </div>
            </div>

            <div style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:28px">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:16px">Receipt Photo</div>
              <div id="cb-dropzone" style="border:2px dashed rgba(48,209,88,0.3);border-radius:14px;background:rgba(48,209,88,0.02);cursor:pointer;overflow:hidden;transition:all 0.25s;min-height:220px;display:flex;align-items:center;justify-content:center" onclick="document.getElementById('cb-file-input').click()" ondragover="event.preventDefault();this.style.borderColor='var(--green)';this.style.background='rgba(48,209,88,0.05)'" ondragleave="this.style.borderColor='rgba(48,209,88,0.3)';this.style.background='rgba(48,209,88,0.02)'" ondrop="cbHandleDrop(event)">
                <div id="cb-empty-state" style="padding:40px 24px;text-align:center">
                  <div style="font-size:52px;margin-bottom:14px">📸</div>
                  <div style="font-size:17px;font-weight:700;margin-bottom:6px">Drop your receipt here</div>
                  <div style="font-size:13px;color:var(--muted);margin-bottom:18px">or click to choose a photo — RAVEN will extract all items</div>
                  <div style="display:inline-flex;align-items:center;gap:8px;padding:11px 22px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.3);border-radius:10px;font-size:14px;font-weight:700;color:var(--green)">📁 Choose Photo</div>
                </div>
                <div id="cb-preview-state" style="display:none;position:relative;width:100%">
                  <img id="cb-preview-img" style="width:100%;display:block;max-height:380px;object-fit:contain">
                  <div style="position:absolute;top:12px;right:12px;display:flex;gap:8px">
                    <button onclick="event.stopPropagation();document.getElementById('cb-file-input').click()" style="padding:7px 14px;background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.2);color:white;border-radius:8px;font-size:12px;cursor:pointer;font-family:'Epilogue',sans-serif;font-weight:600">↻ Replace</button>
                    <button onclick="event.stopPropagation();cbClearPhoto()" style="padding:7px 14px;background:rgba(255,68,68,0.8);border:none;color:white;border-radius:8px;font-size:12px;cursor:pointer;font-family:'Epilogue',sans-serif;font-weight:600">✕ Remove</button>
                  </div>
                </div>
              </div>
              <input id="cb-file-input" type="file" accept="image/*" style="display:none" onchange="cbHandleFile(event)">
            </div>
          </div>

          <!-- RIGHT: AI scan status + tips -->
          <div style="display:flex;flex-direction:column;gap:20px">
            <!-- Scan button / status -->
            <div id="cb-scan-wrap" style="display:none">
              <button onclick="cbScanReceipt()" id="cb-scan-btn" style="width:100%;padding:18px;background:linear-gradient(135deg,var(--purple),var(--green));color:#fff;border:none;border-radius:14px;font-family:'Epilogue',sans-serif;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 4px 24px rgba(124,58,237,0.4);letter-spacing:0.02em"><svg width="18" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><text x="2" y="22" font-family="Bebas Neue, sans-serif" font-size="24" fill="white">R</text><circle cx="11" cy="24" r="3" fill="#30D158"/></svg> RAVEN Scan — Extract All Items</button>
            </div>
            <div id="cb-scanning" style="display:none;padding:24px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:14px;text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:10px"><div style="width:22px;height:22px;border:2px solid rgba(124,58,237,0.3);border-top-color:var(--purple2);border-radius:50%;animation:spin 0.8s linear infinite"></div><span style="font-weight:700;color:var(--purple3);font-size:15px">RAVEN is scanning your receipt…</span></div>
              <div style="font-size:13px;color:var(--muted)" id="cb-scan-status">Analyzing items, prices, tax and tip</div>
            </div>
            <div id="cb-scan-result" style="display:none"></div>

            <!-- How it works tip card -->
            <div id="cb-tip-card" style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:28px">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:18px">How It Works</div>
              <div style="display:flex;flex-direction:column;gap:16px">
                <div style="display:flex;gap:14px;align-items:flex-start">
                  <div style="width:36px;height:36px;border-radius:10px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📸</div>
                  <div><div style="font-size:14px;font-weight:600;margin-bottom:3px">Upload your receipt</div><div style="font-size:12px;color:var(--muted);line-height:1.6">Any restaurant, bar, or store receipt — even blurry ones</div></div>
                </div>
                <div style="display:flex;gap:14px;align-items:flex-start">
                  <div style="width:36px;height:36px;border-radius:10px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0"><svg width="18" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="rg_item" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#C084FC"/><stop offset="100%" stop-color="#7C3AED"/></linearGradient></defs><text x="2" y="22" font-family="Bebas Neue, sans-serif" font-size="24" fill="url(#rg_item)">R</text><circle cx="11" cy="24" r="3" fill="#30D158"/></svg></div>
                  <div><div style="font-size:14px;font-weight:600;margin-bottom:3px">RAVEN extracts everything</div><div style="font-size:12px;color:var(--muted);line-height:1.6">Items, prices, tax, and tip — automatically</div></div>
                </div>
                <div style="display:flex;gap:14px;align-items:flex-start">
                  <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">👤</div>
                  <div><div style="font-size:14px;font-weight:600;margin-bottom:3px">Assign items to people</div><div style="font-size:12px;color:var(--muted);line-height:1.6">Drag items to who ordered them — or split evenly</div></div>
                </div>
                <div style="display:flex;gap:14px;align-items:flex-start">
                  <div style="width:36px;height:36px;border-radius:10px;background:rgba(0,140,255,0.1);border:1px solid rgba(0,140,255,0.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">💳</div>
                  <div><div style="font-size:14px;font-weight:600;margin-bottom:3px">Everyone pays their share</div><div style="font-size:12px;color:var(--muted);line-height:1.6">Via Venmo, Cash App, Zelle, or Apple Pay</div></div>
                </div>
              </div>
            </div>

            <div style="text-align:center">
              <button onclick="cbSkipToStep2()" style="background:none;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px">No receipt? Enter items manually →</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── STEP 2 ── -->
      <div id="cb-step-2" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start">
          <div style="display:flex;flex-direction:column;gap:16px">
            <div id="cb-scanned-badge" style="display:none;padding:14px 18px;background:rgba(48,209,88,0.07);border:1px solid rgba(48,209,88,0.2);border-radius:12px;align-items:center;gap:12px"><span style="font-size:20px">✅</span><div id="cb-scan-summary" style="font-size:14px;color:var(--green);font-weight:600"></div></div>

            <!-- Who's splitting -->
            <div style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:20px">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px">Who's on this bill?</div>
              <div style="display:flex;gap:8px;margin-bottom:10px">
                <input id="cb-person-input" type="text" class="add-person-input" placeholder="Add name (e.g. Jake)" style="flex:1" onkeydown="if(event.key==='Enter')cbAddPerson()">
                <button class="add-person-btn" onclick="cbAddPerson()">+ Add</button>
                <button class="add-person-btn" onclick="cbOpenContactsPicker()" style="background:rgba(48,209,88,0.1);border-color:rgba(48,209,88,0.25);color:var(--green)" title="Add from contacts"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 7v4M14 9h-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>
              </div>
              <div id="cb-people-chips" class="people-list" style="margin-bottom:14px"></div>
              <div style="border-top:1px solid var(--border);padding-top:14px">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px">Who paid? <span style="color:var(--muted);font-weight:400;font-size:10px;text-transform:none;letter-spacing:0">— others will owe this person</span></div>
                <select id="cb-paidby" style="width:100%;padding:10px 14px;background:var(--dark2);border:1px solid var(--border);border-radius:10px;color:var(--white);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600">
                  <option value="">— Select who paid —</option>
                </select>
              </div>
            </div>

            <!-- Split method + Items -->
            <div style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:20px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2)">Items</div>
                <div id="cb-item-count" style="font-size:12px;color:var(--muted)">0 items</div>
              </div>
              <div style="display:flex;gap:8px;margin-bottom:14px">
                <button id="cb-split-even-btn" onclick="cbSetSplitMode('even')" style="flex:1;padding:9px;border-radius:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.3);color:var(--green)">⚖️ Split Evenly</button>
                <button id="cb-split-item-btn" onclick="cbSetSplitMode('itemized')" style="flex:1;padding:9px;border-radius:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;background:var(--dark2);border:1px solid var(--border);color:var(--muted)">📋 Itemized</button>
              </div>
              <!-- Even: just enter a total -->
              <div id="cb-even-total-wrap">
                <div style="position:relative"><span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:14px">$</span><input id="cb-even-total" type="number" class="form-input" placeholder="Enter total amount" step="0.01" style="padding-left:30px" oninput="cbUpdateSummary()"></div>
              </div>
              <!-- Itemized: item list + add row -->
              <div id="cb-itemized-wrap" style="display:none">
                <div id="cb-items-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px"></div>
                <div style="display:flex;gap:8px;border-top:1px solid var(--border);padding-top:12px">
                  <input id="cb-item-name" type="text" class="add-person-input" placeholder="Item name" style="flex:1" onkeydown="if(event.key==='Enter')cbAddItem()">
                  <div style="position:relative;display:flex;align-items:center"><span style="position:absolute;left:10px;color:var(--muted);font-size:13px">$</span><input id="cb-item-price" type="number" class="add-person-input" placeholder="0.00" step="0.01" style="width:82px;padding-left:22px" onkeydown="if(event.key==='Enter')cbAddItem()"></div>
                  <button class="add-person-btn" onclick="cbAddItem()">+ Add</button>
                </div>
              </div>
            </div>

            <!-- Shared charges with per-charge split toggle -->
            <div style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:20px">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:14px">Shared Charges</div>
              <div style="display:flex;flex-direction:column;gap:12px">

                <!-- Tax -->
                <div style="background:var(--dark2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                    <span style="font-size:13px;font-weight:600;flex:1">Tax</span>
                    <div style="position:relative"><span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:12px">$</span><input id="cb-tax" type="number" class="add-person-input" placeholder="0.00" step="0.01" style="width:90px;padding-left:24px;font-size:13px" oninput="cbUpdateSummary()"></div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button id="cb-tax-split-prop" onclick="cbSetChargeSplit('tax','proportional')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);color:var(--purple3)">∝ By order size</button>
                    <button id="cb-tax-split-even" onclick="cbSetChargeSplit('tax','even')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:var(--dark3);border:1px solid var(--border);color:var(--muted)">÷ Evenly</button>
                  </div>
                </div>

                <!-- Tip -->
                <div style="background:var(--dark2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                    <span style="font-size:13px;font-weight:600;flex:1">💰 Tip</span>
                    <div style="position:relative"><span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:12px">$</span><input id="cb-tip" type="number" class="add-person-input" placeholder="0.00" step="0.01" style="width:90px;padding-left:24px;font-size:13px" oninput="cbUpdateSummary()"></div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button id="cb-tip-split-prop" onclick="cbSetChargeSplit('tip','proportional')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);color:var(--purple3)">∝ By order size</button>
                    <button id="cb-tip-split-even" onclick="cbSetChargeSplit('tip','even')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:var(--dark3);border:1px solid var(--border);color:var(--muted)">÷ Evenly</button>
                  </div>
                </div>

                <!-- Service Fee -->
                <div style="background:var(--dark2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                    <span style="font-size:13px;font-weight:600;flex:1">🛎️ Service Fee</span>
                    <div style="position:relative"><span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:12px">$</span><input id="cb-service" type="number" class="add-person-input" placeholder="0.00" step="0.01" style="width:90px;padding-left:24px;font-size:13px" oninput="cbUpdateSummary()"></div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button id="cb-service-split-prop" onclick="cbSetChargeSplit('service','proportional')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);color:var(--purple3)">∝ By order size</button>
                    <button id="cb-service-split-even" onclick="cbSetChargeSplit('service','even')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:var(--dark3);border:1px solid var(--border);color:var(--muted)">÷ Evenly</button>
                  </div>
                </div>

                <!-- Misc -->
                <div style="background:var(--dark2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                    <span style="font-size:13px;font-weight:600;flex:1">📦 Miscellaneous</span>
                    <div style="position:relative"><span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:12px">$</span><input id="cb-misc" type="number" class="add-person-input" placeholder="0.00" step="0.01" style="width:90px;padding-left:24px;font-size:13px" oninput="cbUpdateSummary()"></div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button id="cb-misc-split-prop" onclick="cbSetChargeSplit('misc','proportional')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);color:var(--purple3)">∝ By order size</button>
                    <button id="cb-misc-split-even" onclick="cbSetChargeSplit('misc','even')" style="flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:var(--dark3);border:1px solid var(--border);color:var(--muted)">÷ Evenly</button>
                  </div>
                </div>
              </div>
            </div>

            <button onclick="cbGoToStep(1)" style="background:none;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer;text-align:left;padding:4px 0">← Back</button>
          </div>

          <!-- RIGHT: Live summary -->
          <div style="display:flex;flex-direction:column;gap:16px">
            <div style="position:sticky;top:24px;background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:24px">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:16px">Live Summary</div>
              <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
                <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Subtotal</span><span id="cb-subtotal" style="font-family:'JetBrains Mono',monospace">$0.00</span></div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Tax</span><span id="cb-tax-display" style="font-family:'JetBrains Mono',monospace">$0.00</span></div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Tip</span><span id="cb-tip-display" style="font-family:'JetBrains Mono',monospace">$0.00</span></div>
                <div id="cb-service-row" style="display:none;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Service Fee</span><span id="cb-service-display" style="font-family:'JetBrains Mono',monospace">$0.00</span></div>
                <div id="cb-misc-row" style="display:none;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Misc</span><span id="cb-misc-display" style="font-family:'JetBrains Mono',monospace">$0.00</span></div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <span style="font-size:18px;font-weight:700">Total</span>
                <span id="cb-total-display" style="font-family:'Bebas Neue',sans-serif;font-size:36px;color:var(--green);letter-spacing:0.03em">$0.00</span>
              </div>
              <!-- Per-person live breakdown -->
              <div id="cb-per-person-live" style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px"></div>
              <button onclick="cbGoToStep(3)" class="submit-btn" style="font-size:15px;padding:16px">Continue to Confirm →</button>
            </div>
          </div>
        </div>

      </div>

      <!-- ── STEP 3 ── -->
      <div id="cb-step-3" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start">
          <div style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:24px">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">Per Person Breakdown</div>
            <div id="cb-live-mode-badge" style="display:none;margin-bottom:12px;padding:8px 12px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);border-radius:8px;font-size:12px;color:#30D158;font-weight:600">⚡ Live Mode — guests will claim their own items via QR</div>
            <div id="cb-per-person-list" style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px"></div>
            <button onclick="cbGoToStep(2)" style="background:none;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer;padding:0">← Back to items</button>
          </div>
          <div style="position:sticky;top:24px;display:flex;flex-direction:column;gap:16px">
            <div style="background:var(--dark);border:1px solid var(--border);border-radius:16px;padding:24px">
              <div style="font-size:18px;font-weight:700;margin-bottom:4px" id="cb-final-name">—</div>
              <div style="font-size:13px;color:var(--muted);margin-bottom:18px" id="cb-final-meta"></div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-top:16px;border-top:1px solid var(--border)">
                <span style="font-size:16px;font-weight:700">Grand Total</span>
                <span style="font-family:'Bebas Neue',sans-serif;font-size:40px;color:var(--green);letter-spacing:0.03em" id="cb-final-total">$0.00</span>
              </div>
              <button onclick="cbCreateFinalBill()" class="submit-btn" id="cb-final-btn" style="font-size:16px;padding:17px;letter-spacing:0.02em"><svg width="16" height="16" viewBox="0 0 28 28" fill="none" style="flex-shrink:0"><text x="2" y="22" font-family="Bebas Neue, sans-serif" font-size="24" fill="white">R</text><circle cx="11" cy="24" r="3" fill="#30D158"/></svg> Create Bill &amp; Notify Everyone</button>
            </div>
            <div style="background:rgba(48,209,88,0.04);border:1px solid rgba(48,209,88,0.15);border-radius:12px;padding:16px;font-size:12px;color:var(--muted);line-height:1.7">
              ✅ A shareable link will be created<br>
              ✅ Everyone can see their exact amount<br>
              ✅ Pay via Venmo, Cash App, Zelle, or Apple Pay
            </div>
          </div>
        </div>
      </div>

      </div>
    </div>

    <!-- PAYMENT MODAL — lives outside all page divs so it renders from any page -->
    <div id="cb-pay-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);z-index:900;align-items:flex-end;justify-content:center" onclick="if(event.target.id==='cb-pay-modal')cbClosePayModal()">
      <div style="background:var(--dark2);border:1px solid var(--border2);border-radius:24px 24px 0 0;padding:28px 24px 52px;width:100%;max-width:480px">
        <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 20px"></div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:0.05em;margin-bottom:4px" id="pay-modal-title">Pay</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:6px" id="pay-modal-sub">Send payment to bill payer</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:48px;color:var(--green);letter-spacing:0.04em;margin-bottom:24px;line-height:1" id="pay-modal-amount">$0.00</div>
        <div id="pay-modal-methods" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px"></div>
        <div id="pay-modal-method-btns" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
        <button id="pay-modal-other-btn" onclick="cbToggleOtherMethods()" style="width:100%;padding:13px;background:transparent;border:1px solid var(--border2);border-radius:12px;color:var(--muted2);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px">✓ Paid via method ›</button>
        <button onclick="cbClosePayModal()" style="width:100%;padding:12px;background:transparent;border:1px solid var(--border);border-radius:12px;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer">I'll pay later</button>
      </div>
    </div>

    <!-- ASSIGN MODAL — lives outside all page divs -->
    <div id="cb-assign-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:800;align-items:flex-end;justify-content:center" onclick="if(event.target.id==='cb-assign-modal')cbCloseAssign()">
      <div style="background:var(--dark2);border:1px solid var(--border2);border-radius:24px 24px 0 0;padding:28px 24px 48px;width:100%;max-width:480px">
        <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 20px"></div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:0.05em;margin-bottom:4px" id="cb-assign-item-name">Item</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:18px">Who ordered this? Tap to assign</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px" id="cb-assign-people-btns"></div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:8px;font-weight:600">Assigned to</div>
        <div id="cb-assign-list" style="min-height:40px;margin-bottom:18px"></div>
        <button onclick="cbCloseAssign()" style="width:100%;padding:14px;background:transparent;border:1px solid var(--border2);border-radius:12px;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer">Done</button>
      </div>
    </div>

    <!-- SETTINGS -->
    <!-- FRIENDS PAGE -->
    <div id="page-friends" class="page">
      <div class="page-header"><h1 class="page-title">Friends <span>& Contacts</span></h1></div>

      <!-- Your Raven ID card -->
      <div style="background:linear-gradient(135deg,rgba(124,58,237,0.15),rgba(48,209,88,0.08));border:1px solid rgba(124,58,237,0.25);border-radius:16px;padding:20px 24px;margin-bottom:24px;max-width:520px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--purple3);margin-bottom:10px"><svg width="14" height="14" viewBox="0 0 28 28" fill="none" style="flex-shrink:0;vertical-align:middle"><defs><linearGradient id="rg_hd" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#C084FC"/><stop offset="100%" stop-color="#7C3AED"/></linearGradient></defs><text x="2" y="22" font-family="Bebas Neue, sans-serif" font-size="24" fill="url(#rg_hd)">R</text><circle cx="11" cy="24" r="3" fill="#30D158"/></svg> Your Raven ID</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div id="my-raven-id-display" style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:0.05em;color:var(--white)">@loading...</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Share this ID so friends can find you on RAVEN</div>
          </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="shareRavenIdSMS()" style="padding:9px 16px;background:linear-gradient(135deg,#30D158,#0EA5E9);border:none;border-radius:9px;color:#000;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">💬 Share via iMessage</button>
          <button onclick="copyRavenId()" style="padding:9px 16px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);border-radius:9px;color:var(--purple3);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">📋 Copy</button>
        </div>
        </div>
      </div>

      <!-- Search -->
      <div style="max-width:520px;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px">Find People</div>
        <div style="display:flex;gap:10px">
          <input id="friend-search-input" type="text" placeholder="Search by @ravenid or name..." class="form-input" style="flex:1" onkeydown="if(event.key==='Enter')searchFriends()">
          <button onclick="searchFriends()" style="padding:12px 18px;background:var(--purple);border:none;border-radius:10px;color:#fff;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap">Search</button>
        </div>
        <div id="friend-search-results" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
      </div>

      <!-- Notification Center — always shown, populated by JS -->
      <div style="max-width:520px;margin-bottom:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2)"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M8 2a4 4 0 0 0-4 4v3l-1 1.5h10L12 9V6a4 4 0 0 0-4-4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Notifications</div>
          <span id="friend-req-count" style="display:none;background:var(--purple);color:#fff;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700"></span>
        </div>
        <div id="friend-requests-section">
          <div id="friend-requests-list" style="display:flex;flex-direction:column;gap:8px">
            <div style="padding:16px;background:var(--dark);border:1px solid var(--border);border-radius:12px;text-align:center;color:var(--muted);font-size:13px">No new notifications</div>
          </div>
        </div>
      </div>

      <!-- Friends list -->
      <div style="max-width:520px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px">My Friends</div>
        <div id="friends-list" style="display:flex;flex-direction:column;gap:8px">
          <div class="loading"><div class="spinner"></div> Loading...</div>
        </div>
      </div>
    </div>



<div id="page-settings" class="page">
      <div class="page-header"><h1 class="page-title">Account <span>Settings</span></h1></div>
      <div id="mob-quick-nav" style="display:none;margin-bottom:20px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px">
          <button onclick="showPage('friends');setMobNav('mob-settings')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:var(--dark);border:1px solid var(--border);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center;position:relative">
            <span class="mob-quick-glyph"><svg class="raven-icon xl"><use href="#icon-friends"></use></svg></span><span style="font-size:11px;font-weight:600;color:var(--white)">Friends</span>
            <span id="mob-friends-badge" style="display:none;position:absolute;top:8px;right:8px;background:#A855F7;color:#fff;border-radius:10px;font-size:9px;font-weight:700;padding:1px 5px">!</span>
          </button>
          <button onclick="showPage('history');setMobNav('mob-settings')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:var(--dark);border:1px solid var(--border);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center">
            <span class="mob-quick-glyph"><svg class="raven-icon xl"><use href="#icon-history"></use></svg></span><span style="font-size:11px;font-weight:600;color:var(--white)">History</span>
          </button>
          <button onclick="showPage('trip-hub');setMobNav('mob-trip')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:var(--dark);border:1px solid var(--border);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center">
            <span class="mob-quick-glyph"><svg class="raven-icon xl"><use href="#icon-trip-hub"></use></svg></span><span style="font-size:11px;font-weight:600;color:var(--white)">Trips</span>
          </button>
          <button onclick="showPage('roommates');setMobNav('mob-settings')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:var(--dark);border:1px solid var(--border);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center;position:relative">
            <span class="mob-quick-glyph"><svg class="raven-icon xl"><use href="#icon-roommates"></use></svg></span><span style="font-size:11px;font-weight:600;color:var(--white)">Roommates</span><span style="position:absolute;top:6px;right:6px;font-size:8px;font-weight:700;padding:1px 4px;background:rgba(48,209,88,0.2);border-radius:4px;color:var(--green)">β</span>
          </button>
          <button onclick="showPage('notifications');setMobNav('mob-settings')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:var(--dark);border:1px solid var(--border);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center;position:relative">
            <span class="mob-quick-glyph"><svg class="raven-icon xl"><use href="#icon-notifications"></use></svg></span><span style="font-size:11px;font-weight:600;color:var(--white)">Notifications</span>
            <span id="mob-notif-quick-badge" style="display:none;position:absolute;top:8px;right:8px;background:#FF4444;color:#fff;border-radius:50%;width:14px;height:14px;font-size:9px;font-weight:700;align-items:center;justify-content:center">!</span>
          </button>
          <button onclick="showPage('invite');setMobNav('mob-settings')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:var(--dark);border:1px solid var(--border);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center">
            <span class="mob-quick-glyph"><svg class="raven-icon xl"><use href="#icon-invite"></use></svg></span><span style="font-size:11px;font-weight:600;color:var(--white)">Invite</span>
          </button>
          <button onclick="document.getElementById('privacy-section').scrollIntoView({behavior:'smooth'})" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:var(--dark);border:1px solid var(--border);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center">
            <span class="mob-quick-glyph"><svg class="raven-icon xl"><use href="#icon-privacy"></use></svg></span><span style="font-size:11px;font-weight:600;color:var(--white)">Privacy</span>
          </button>
          <button onclick="handleLogout()" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 8px;background:rgba(255,68,68,0.07);border:1px solid rgba(255,68,68,0.15);border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center">
            <span style="font-size:22px">⎋</span><span style="font-size:11px;font-weight:600;color:#FF6B6B">Sign Out</span>
          </button>
        </div>
        <div style="height:1px;background:var(--border);margin-bottom:20px"></div>
      </div>
      <div style="max-width:520px;margin-bottom:16px">
        <div class="form-card" style="padding:24px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:18px">Profile</div>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px">
            <div style="position:relative;flex-shrink:0">
              <div id="profile-avatar-display" style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--green));display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:#fff;overflow:hidden;border:2px solid var(--border2)">?</div>
              <button onclick="document.getElementById('avatar-file-input').click()" style="position:absolute;bottom:0;right:0;width:24px;height:24px;border-radius:50%;background:var(--green);border:2px solid var(--dark);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px">✎</button>
              <input id="avatar-file-input" type="file" accept="image/*" style="display:none" onchange="handleAvatarUpload(event)">
            </div>
            <div>
              <div id="profile-display-name" style="font-weight:600;font-size:15px;margin-bottom:2px">Your Name</div>
              <div id="set-email-display" style="font-size:12px;color:var(--muted);margin-bottom:8px"></div>
              <button onclick="document.getElementById('avatar-file-input').click()" style="padding:5px 12px;background:var(--dark2);border:1px solid var(--border2);border-radius:7px;color:var(--muted2);font-family:'Epilogue',sans-serif;font-size:11px;font-weight:600;cursor:pointer">📷 Change Photo</button>
            </div>
          </div>
          <div class="form-group"><label class="form-label">First Name</label><input id="set-first" type="text" class="form-input" placeholder="John"></div>
          <div class="form-group"><label class="form-label">Last Name</label><input id="set-last" type="text" class="form-input" placeholder="Smith"></div>
          <div class="form-group"><label class="form-label">Phone Number</label><input id="set-phone" type="tel" class="form-input" placeholder="+1 (555) 000-0000"></div>
          <div class="form-group"><label class="form-label">Email</label><input id="set-email" type="text" class="form-input" disabled style="opacity:0.5;cursor:not-allowed"></div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px"><svg width="14" height="14" viewBox="0 0 28 28" fill="none" style="flex-shrink:0;vertical-align:middle"><defs><linearGradient id="rg_id" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#C084FC"/><stop offset="100%" stop-color="#7C3AED"/></linearGradient></defs><text x="2" y="22" font-family="Bebas Neue, sans-serif" font-size="24" fill="url(#rg_id)">R</text><circle cx="11" cy="24" r="3" fill="#30D158"/></svg> Raven ID <span style="font-size:11px;color:var(--muted);font-weight:400">— generated for discovery</span></label>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="color:var(--purple3);font-size:16px;font-weight:700;flex-shrink:0">@</span>
              <input id="set-raven-id" type="text" class="form-input" placeholder="generating..." style="flex:1;background:rgba(255,255,255,0.03);color:var(--white);opacity:0.88;cursor:not-allowed" readonly disabled>
            </div>
            <div id="raven-id-status" style="font-size:12px;margin-top:6px;color:var(--muted)">Your Raven ID is assigned automatically so friends can always find you.</div>
          </div>
        </div>
      </div>
      <!-- PWA INSTALL CARD — shown on mobile when not yet installed -->
      <div id="pwa-install-card" style="display:none;max-width:520px;margin-top:20px">
        <div style="padding:16px;background:linear-gradient(135deg,rgba(124,58,237,0.1),rgba(48,209,88,0.06));border:1px solid rgba(124,58,237,0.22);border-radius:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:0" id="pwa-install-main">
            <div style="display:flex;align-items:center;gap:12px;min-width:0">
              <div style="font-size:26px;flex-shrink:0"><svg width="18" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="rg_item" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#C084FC"/><stop offset="100%" stop-color="#7C3AED"/></linearGradient></defs><text x="2" y="22" font-family="Bebas Neue, sans-serif" font-size="24" fill="url(#rg_item)">R</text><circle cx="11" cy="24" r="3" fill="#30D158"/></svg></div>
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--white);margin-bottom:2px">Add RAVEN to Home Screen</div>
                <div style="font-size:11px;color:var(--muted);line-height:1.4">Works offline · feels like a native app</div>
              </div>
            </div>
            <button id="pwa-install-btn" onclick="triggerPwaInstall()" style="flex-shrink:0;padding:9px 16px;background:var(--green);border:none;border-radius:9px;color:#000;font-family:'Epilogue',sans-serif;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap">Install</button>
          </div>
          <!-- iOS manual instructions — shown on Safari/iOS where native prompt isn't available -->
          <div id="pwa-ios-hint" style="display:none;margin-top:12px;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px">
            <div style="font-size:12px;color:var(--muted2);line-height:1.8">
              <strong style="color:var(--white)">On iPhone / iPad:</strong><br>
              1. Tap the <strong style="color:var(--white)">Share</strong> button ⬆️ in Safari<br>
              2. Scroll down and tap <strong style="color:var(--white)">"Add to Home Screen"</strong> ➕<br>
              3. Tap <strong style="color:var(--white)">Add</strong> — done!
            </div>
          </div>
        </div>
      </div>

      <div style="max-width:520px;margin-bottom:20px">
        <div class="form-card" style="padding:24px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">Payment Methods</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:18px">People will see these when they click Pay on your bills</div>
          <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px"><span style="width:20px;height:20px;background:#008CFF;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff">V</span> Venmo Username</label><input id="set-venmo" type="text" class="form-input" placeholder="@your-venmo"></div>
          <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px"><span style="width:20px;height:20px;background:#00D632;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff">$</span> Cash App $Cashtag</label><input id="set-cashapp" type="text" class="form-input" placeholder="$YourCashtag"></div>
          <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px"><span style="width:20px;height:20px;background:#6D1ED4;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff">Z</span> Zelle</label><input id="set-zelle" type="text" class="form-input" placeholder="email or phone number"></div>
          <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px"><span style="width:20px;height:20px;background:#1a1a1a;border:1px solid #444;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#fff">Pay</span> Apple Pay</label><input id="set-applepay" type="text" class="form-input" placeholder="e.g. John or +15551234567"></div>
        </div>
      </div>
      <div style="max-width:520px">
        <button onclick="saveSettings()" class="submit-btn" id="save-settings-btn">💾 Save Settings</button>
        <div id="settings-saved" style="display:none;margin-top:12px;color:var(--green);font-size:13px;font-weight:600">✅ Settings saved!</div>
      </div>



      <!-- PRIVACY SECTION — inline inside Settings page -->
      <div id="privacy-section" style="max-width:520px;margin-top:32px;padding-bottom:40px">
        <div class="form-card" style="padding:24px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:4px">Privacy</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:20px">Control how RAVEN uses your data</div>

          <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Presence</div>
          <div style="background:var(--dark2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:20px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;gap:14px">
              <div style="flex:1"><div style="font-size:14px;font-weight:600;margin-bottom:2px">Appear Offline</div><div style="font-size:12px;color:var(--muted);line-height:1.5">Friends won't see your green online dot</div></div>
              <label style="position:relative;width:46px;height:26px;flex-shrink:0;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="priv-appear-offline" style="opacity:0;width:0;height:0;position:absolute" onchange="savePrivacySetting('appear_offline',this.checked)">
                <span id="toggle-priv-appear-offline" style="position:absolute;inset:0;background:var(--dark3);border:1px solid var(--border2);border-radius:13px;transition:all 0.2s"></span>
                <span id="knob-priv-appear-offline" style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:var(--muted);border-radius:50%;transition:all 0.2s"></span>
              </label>
            </div>
          </div>

          <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Notifications</div>
          <div style="background:var(--dark2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:20px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);gap:14px">
              <div style="flex:1"><div style="font-size:14px;font-weight:600;margin-bottom:2px">Push Notifications</div><div style="font-size:12px;color:var(--muted);line-height:1.5">Bill reminders and friend requests</div></div>
              <label style="position:relative;width:46px;height:26px;flex-shrink:0;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="priv-push-notif" style="opacity:0;width:0;height:0;position:absolute" onchange="handlePushNotifToggle(this.checked)">
                <span id="toggle-priv-push-notif" style="position:absolute;inset:0;background:var(--dark3);border:1px solid var(--border2);border-radius:13px;transition:all 0.2s"></span>
                <span id="knob-priv-push-notif" style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:var(--muted);border-radius:50%;transition:all 0.2s"></span>
              </label>
            </div>
            <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;gap:14px">
              <div style="flex:1"><div style="font-size:14px;font-weight:600;margin-bottom:2px">Payment Alerts</div><div style="font-size:12px;color:var(--muted);line-height:1.5">Get notified when someone pays their share</div></div>
              <label style="position:relative;width:46px;height:26px;flex-shrink:0;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="priv-payment-alerts" style="opacity:0;width:0;height:0;position:absolute" onchange="savePrivacySetting('payment_alerts',this.checked)">
                <span id="toggle-priv-payment-alerts" style="position:absolute;inset:0;background:var(--dark3);border:1px solid var(--border2);border-radius:13px;transition:all 0.2s"></span>
                <span id="knob-priv-payment-alerts" style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:var(--muted);border-radius:50%;transition:all 0.2s"></span>
              </label>
            </div>
          </div>

          <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Communications</div>
          <div style="background:var(--dark2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:20px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);gap:14px">
              <div style="flex:1"><div style="font-size:14px;font-weight:600;margin-bottom:2px">Email Updates</div><div style="font-size:12px;color:var(--muted);line-height:1.5">New features and announcements</div></div>
              <label style="position:relative;width:46px;height:26px;flex-shrink:0;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="priv-email-marketing" style="opacity:0;width:0;height:0;position:absolute" onchange="savePrivacySetting('email_marketing',this.checked)">
                <span id="toggle-priv-email-marketing" style="position:absolute;inset:0;background:var(--dark3);border:1px solid var(--border2);border-radius:13px;transition:all 0.2s"></span>
                <span id="knob-priv-email-marketing" style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:var(--muted);border-radius:50%;transition:all 0.2s"></span>
              </label>
            </div>
            <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;gap:14px">
              <div style="flex:1"><div style="font-size:14px;font-weight:600;margin-bottom:2px">SMS Reminders</div><div style="font-size:12px;color:var(--muted);line-height:1.5">Text reminders when bills are due</div></div>
              <label style="position:relative;width:46px;height:26px;flex-shrink:0;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="priv-sms-reminders" style="opacity:0;width:0;height:0;position:absolute" onchange="savePrivacySetting('sms_reminders',this.checked)">
                <span id="toggle-priv-sms-reminders" style="position:absolute;inset:0;background:var(--dark3);border:1px solid var(--border2);border-radius:13px;transition:all 0.2s"></span>
                <span id="knob-priv-sms-reminders" style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:var(--muted);border-radius:50%;transition:all 0.2s"></span>
              </label>
            </div>
          </div>

          <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Data & Discovery</div>
          <div style="background:var(--dark2);border:1px solid var(--border);border-radius:12px;overflow:hidden">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);gap:14px">
              <div style="flex:1"><div style="font-size:14px;font-weight:600;margin-bottom:2px">Show in Friend Search</div><div style="font-size:12px;color:var(--muted);line-height:1.5">Others can find you by your Raven ID</div></div>
              <label style="position:relative;width:46px;height:26px;flex-shrink:0;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="priv-discoverable" style="opacity:0;width:0;height:0;position:absolute" onchange="savePrivacySetting('discoverable',this.checked)">
                <span id="toggle-priv-discoverable" style="position:absolute;inset:0;background:var(--dark3);border:1px solid var(--border2);border-radius:13px;transition:all 0.2s"></span>
                <span id="knob-priv-discoverable" style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:var(--muted);border-radius:50%;transition:all 0.2s"></span>
              </label>
            </div>
            <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;gap:14px">
              <div style="flex:1"><div style="font-size:14px;font-weight:600;margin-bottom:2px">Analytics & Improvement</div><div style="font-size:12px;color:var(--muted);line-height:1.5">Share anonymous usage data to improve RAVEN</div></div>
              <label style="position:relative;width:46px;height:26px;flex-shrink:0;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="priv-analytics" style="opacity:0;width:0;height:0;position:absolute" onchange="savePrivacySetting('analytics',this.checked)">
                <span id="toggle-priv-analytics" style="position:absolute;inset:0;background:var(--dark3);border:1px solid var(--border2);border-radius:13px;transition:all 0.2s"></span>
                <span id="knob-priv-analytics" style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:var(--muted);border-radius:50%;transition:all 0.2s"></span>
              </label>
            </div>
          </div>
          <div style="margin-top:14px;font-size:11px;color:var(--muted);text-align:center">Saved automatically · <a href="https://ravensplit.com/privacy" style="color:var(--muted2);text-decoration:none">Privacy Policy</a></div>
        </div>
      </div>
    </div>

    <!-- HISTORY -->
    <div id="page-history" class="page">
      <div class="page-header"><h1 class="page-title">Bill <span>History</span></h1></div>
      <div style="background:var(--dark);border:1px solid var(--border);border-radius:14px;overflow:hidden"><div id="history-content"><div class="loading"><div class="spinner"></div> Loading...</div></div></div>
    </div>

    <!-- TRIP HUB PAGE -->
    <div id="page-trip-hub" class="page">
      <div class="page-header">
        <h1 class="page-title">Trip <span>Hub</span></h1>
        <button class="bill-action-btn btn-remind" style="padding:10px 20px;font-size:13px" onclick="openCreateTrip()"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M14 5.5a2 2 0 0 1-2 2l-2.5 0L6 13H4.5l1.5-5.5H3.5L2.5 9H1l1-3.5L1 2h1.5l1 1.5H6L4.5 0H6l3.5 5.5H13a1.5 1.5 0 0 1 1 1.5z" fill="currentColor"/></svg> New Trip</button>
      </div>
      <div id="trips-list" class="bills-list"><div class="loading"><div class="spinner"></div> Loading trips...</div></div>
    </div>

    <!-- ROOMMATES PAGE -->
    <div id="page-roommates" class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Roommates <span style="font-size:13px;font-weight:700;padding:2px 9px;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.3);border-radius:8px;color:var(--green);vertical-align:middle;margin-left:8px">BETA</span></h1>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">Track shared expenses with your housemates — rent, utilities, groceries and more.</div>
        </div>
        <button class="bill-action-btn" style="padding:10px 20px;font-size:13px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25);color:var(--green)" onclick="openCreateHouse()"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M1 7.5L8 2l7 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg> New House</button>
      </div>
      <div id="houses-list" class="bills-list"><div class="loading"><div class="spinner"></div> Loading...</div></div>
    </div>

    <!-- NOTIFICATIONS PAGE -->
    <div id="page-notifications" class="page">
      <div class="page-header">
        <h1 class="page-title">Notifications <span id="notif-unread-count"></span></h1>
        <button id="mark-all-read-btn" onclick="markAllNotifsRead()" style="padding:8px 18px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);border-radius:8px;color:var(--purple3);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600;cursor:pointer">✓ Mark all read</button>
      </div>
      <div style="max-width:620px">
        <!-- Filter tabs -->
        <div style="display:flex;gap:8px;margin-bottom:20px">
          <button class="notif-filter active" data-filter="all" onclick="filterNotifs('all',this)">All</button>
          <button class="notif-filter" data-filter="bill" onclick="filterNotifs('bill',this)">Bills</button>
          <button class="notif-filter" data-filter="friend" onclick="filterNotifs('friend',this)">Friends</button>
          <button class="notif-filter" data-filter="payment" onclick="filterNotifs('payment',this)">Payments</button>
          <button class="notif-filter" data-filter="trip" onclick="filterNotifs('trip',this)">Trips</button>
        </div>
        <div id="notif-list" style="display:flex;flex-direction:column;gap:10px">
          <div class="loading"><div class="spinner"></div> Loading notifications...</div>
        </div>
      </div>
    </div>

    <!-- INVITE PAGE -->
    <div id="page-invite" class="page">
      <div class="page-header"><h1 class="page-title">Invite <span>Friends</span></h1></div>
      <div style="max-width:560px;display:flex;flex-direction:column;gap:20px">

        <!-- Referral card -->
        <div style="background:linear-gradient(135deg,rgba(124,58,237,0.2),rgba(48,209,88,0.1));border:1px solid rgba(124,58,237,0.3);border-radius:20px;padding:28px;position:relative;overflow:hidden">
          <div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;background:rgba(124,58,237,0.08);pointer-events:none"></div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--purple3);margin-bottom:10px">🎟 Your Invite Link</div>
          <div style="font-size:18px;font-weight:700;margin-bottom:6px">Invite friends to RAVEN</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.6">Share your personal invite link. When friends sign up, they'll automatically be connected to you.</div>
          <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:12px;margin-bottom:14px">
            <span id="invite-link-text" style="flex:1;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Loading...</span>
            <button onclick="copyInviteLink()" style="padding:6px 14px;background:var(--green);border:none;border-radius:8px;color:#000;font-family:'Epilogue',sans-serif;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Copy</button>
          </div>
          <div style="display:flex;gap:10px">
            <button onclick="shareInviteNative()" style="flex:1;padding:12px;background:var(--purple);border:none;border-radius:10px;color:#fff;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer">📤 Share</button>
            <button onclick="shareInviteSMS()" style="flex:1;padding:12px;background:rgba(48,209,88,0.15);border:1px solid rgba(48,209,88,0.3);border-radius:10px;color:var(--green);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer">💬 Text</button>
          </div>
        </div>



        <!-- Invite contacts -->
        <div class="form-card" style="padding:24px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:16px">Invite Your Contacts</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <button onclick="inviteViaSMS()" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;background:var(--dark2);border:1px solid var(--border);border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation">
              <span style="font-size:28px">💬</span>
              <span style="font-size:13px;font-weight:700;color:var(--white)">Text Message</span>
              <span style="font-size:11px;color:var(--muted)">Opens your contacts</span>
            </button>
            <button onclick="inviteViaWhatsApp()" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;background:#0d2a0d;border:1px solid rgba(37,211,102,0.2);border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation">
              <span style="font-size:28px">🟢</span>
              <span style="font-size:13px;font-weight:700;color:#25D366">WhatsApp</span>
              <span style="font-size:11px;color:var(--muted)">Opens your contacts</span>
            </button>
            <button onclick="inviteViaEmail()" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;background:var(--dark2);border:1px solid var(--border);border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation">
              <span style="font-size:28px">✉️</span>
              <span style="font-size:13px;font-weight:700;color:var(--white)">Email</span>
              <span style="font-size:11px;color:var(--muted)">Opens your contacts</span>
            </button>
            <button onclick="inviteViaNativeShare()" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;background:var(--dark2);border:1px solid var(--border);border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation">
              <span style="font-size:28px">📤</span>
              <span style="font-size:13px;font-weight:700;color:var(--white)">More Apps</span>
              <span style="font-size:11px;color:var(--muted)">Share sheet</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  </div><!-- /.page-invite -->

    </div><!-- /.main-inner -->
  </main>

  <!-- PROFILE CARD MODAL -->
  <div id="profile-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);z-index:700;align-items:center;justify-content:center;padding:20px" onclick="if(event.target.id==='profile-modal')closeProfileModal()">
    <div style="background:var(--dark);border:1px solid var(--border2);border-radius:20px;width:100%;max-width:400px;overflow:visible">
      <div style="height:100px;background:linear-gradient(135deg,var(--purple),var(--green));position:relative;border-radius:20px 20px 0 0">
        <button onclick="closeProfileModal()" style="position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.3);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px">✕</button>
        <div id="pm-avatar" style="position:absolute;bottom:-38px;left:24px;width:76px;height:76px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--green));border:4px solid var(--dark);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:#fff;overflow:hidden;flex-shrink:0"></div>
      </div>
      <div style="padding:48px 24px 28px;">
        <div id="pm-name" style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:0.04em;margin-bottom:2px"></div>
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:4px">RAVEN ID</div>
        <div id="pm-raven-id" style="font-size:13px;color:var(--purple3);font-weight:600;margin-bottom:6px"></div>
        <div id="pm-email" style="font-size:12px;color:var(--muted);margin-bottom:18px"></div>
        <div id="pm-payment-methods" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px"></div>
        <div id="pm-action-btn"></div>
        <div id="pm-inline-picker" style="display:none;margin-top:12px;padding:14px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:14px"></div>
      </div>
    </div>
  </div>


  <!-- CREATE HOUSE MODAL -->
  <div class="modal-bg" id="create-house-modal" onclick="if(event.target.id==='create-house-modal')closeCreateHouse()">
    <div style="background:var(--dark);border:1px solid var(--border2);border-radius:20px;padding:32px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:0.05em"><svg width="22" height="22" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:6px"><path d="M1 7.5L8 2l7 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg> New House</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">Set up a shared expense hub for your housemates</div>
        </div>
        <button onclick="closeCreateHouse()" style="background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:50%;width:32px;height:32px;color:var(--muted);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">×</button>
      </div>

      <div class="form-group">
        <label class="form-label">House name</label>
        <input id="house-name-input" type="text" class="form-input" placeholder="e.g. The Fort, 5th Ave Apt...">
      </div>

      <div class="form-group">
        <label class="form-label">Housemates <span style="color:var(--muted);font-weight:400;font-size:11px">comma-separated names</span></label>
        <input id="house-people-input" type="text" class="form-input" placeholder="e.g. Jake, Sam, Zoe">
      </div>

      <div class="form-group">
        <label class="form-label">Monthly recurring expenses <span style="color:var(--muted);font-weight:400;font-size:11px">optional</span></label>
        <div id="house-recurring-list" style="margin-bottom:10px"></div>
        <div style="display:flex;gap:8px">
          <input id="new-exp-name" type="text" class="form-input" placeholder="Expense name" style="flex:2">
          <input id="new-exp-amt" type="number" class="form-input" placeholder="$amount" style="flex:1">
          <button onclick="addRecurringExpense()" style="padding:0 14px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25);border-radius:10px;color:var(--green);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">+ Add</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px">These will appear as expenses each month (e.g. Electric, WiFi, Netflix)</div>
      </div>

      <button id="create-house-btn" onclick="saveCreateHouse()" style="width:100%;padding:14px;background:var(--green);border:none;border-radius:12px;color:#000;font-family:'Epilogue',sans-serif;font-size:15px;font-weight:800;cursor:pointer;margin-top:8px">Create House →</button>
    </div>
  </div>

  <!-- CREATE TRIP MODAL -->
  <div id="create-trip-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:600;align-items:center;justify-content:center;padding:20px" onclick="if(event.target.id==='create-trip-modal')closeCreateTrip()">
    <div style="background:var(--dark);border:1px solid var(--border2);border-radius:20px;padding:32px;width:100%;max-width:480px">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:0.05em;margin-bottom:4px">New Trip</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:24px">Create a shared hub for group receipts</div>
      <div class="form-group">
        <label class="form-label">Cover Photo <span style="color:var(--muted);font-weight:400;font-size:10px">(optional)</span></label>
        <div id="trip-cover-dropzone" style="border:2px dashed rgba(124,58,237,0.3);border-radius:12px;background:rgba(124,58,237,0.03);cursor:pointer;overflow:hidden" onclick="document.getElementById('trip-cover-input').click()">
          <div id="trip-cover-empty" style="padding:20px;text-align:center;color:var(--muted);font-size:13px">🖼 Tap to add a cover photo</div>
          <img id="trip-cover-preview" style="display:none;width:100%;height:120px;object-fit:cover">
        </div>
        <input id="trip-cover-input" type="file" accept="image/*" style="display:none" onchange="handleTripCover(event)">
      </div>
      <div class="form-group"><label class="form-label">Trip Name</label><input id="trip-name-input" type="text" class="form-input" placeholder="e.g. New York City 2026 🗽"></div>
      <div class="form-group">
        <label class="form-label">Trip Date <span style="color:var(--muted);font-weight:400;font-size:10px">(shows countdown)</span></label>
        <input id="trip-date-input" type="date" class="form-input">
      </div>
      <div class="form-group">
        <label class="form-label">People on this trip</label>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input id="trip-person-input" type="text" class="add-person-input" placeholder="Add name" style="flex:1" onkeydown="if(event.key==='Enter')tripAddPerson()">
          <button class="add-person-btn" onclick="tripAddPerson()">+ Add</button>
          <button class="add-person-btn" onclick="tripOpenContacts()" style="background:rgba(48,209,88,0.1);border-color:rgba(48,209,88,0.25);color:var(--green)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 7v4M14 9h-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>
        </div>
        <div id="trip-people-chips" class="people-list"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button onclick="closeCreateTrip()" style="flex:1;padding:13px;background:transparent;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:14px;cursor:pointer">Cancel</button>
        <button onclick="createTrip()" class="submit-btn" style="flex:2"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M14 5.5a2 2 0 0 1-2 2l-2.5 0L6 13H4.5l1.5-5.5H3.5L2.5 9H1l1-3.5L1 2h1.5l1 1.5H6L4.5 0H6l3.5 5.5H13a1.5 1.5 0 0 1 1 1.5z" fill="currentColor"/></svg> Create Trip</button>
      </div>
    </div>
  </div>

  <!-- CONTACTS PICKER MODAL -->
  <!-- DIRECT MESSAGE MODAL -->
  <div id="dm-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.9);backdrop-filter:blur(12px);z-index:750;flex-direction:column;align-items:center;justify-content:flex-end">
    <div style="background:var(--dark);border:1px solid var(--border2);border-radius:24px 24px 0 0;width:100%;max-width:500px;display:flex;flex-direction:column;height:80vh">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0">
        <div style="display:flex;align-items:center;gap:10px">
          <div id="dm-avatar-sm" style="width:34px;height:34px;border-radius:50%;background:var(--purple);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0"></div>
          <div>
            <div id="dm-title" style="font-size:15px;font-weight:700">Message</div>
            <div id="dm-status" style="font-size:11px;color:var(--muted)">🟢 Raven friend</div>
          </div>
        </div>
        <button onclick="closeDM()" style="background:rgba(255,255,255,0.07);border:none;color:var(--muted);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:15px">✕</button>
      </div>
      <!-- GIF search panel -->
      <div id="dm-gif-panel" style="display:none;border-top:1px solid var(--border);padding:10px 16px;background:var(--dark2);flex-shrink:0">
        <input id="dm-gif-search" type="text" placeholder="Search GIFs..." style="width:100%;padding:8px 12px;background:var(--dark3);border:1px solid var(--border);border-radius:8px;color:var(--white);font-family:'Epilogue',sans-serif;font-size:13px;outline:none;margin-bottom:8px" oninput="searchDMGifs(this.value)">
        <div id="dm-gif-results" style="display:flex;flex-wrap:wrap;gap:6px;max-height:160px;overflow-y:auto">
          <div style="color:var(--muted);font-size:12px;padding:8px 0;width:100%">Type to search GIFs...</div>
        </div>
      </div>
      <!-- Messages -->
      <div id="dm-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column"></div>
      <!-- Input -->
      <div style="padding:12px 16px 20px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0">
        <button id="dm-gif-btn" onclick="toggleDMGifPanel()" style="padding:8px 10px;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:16px;cursor:pointer;flex-shrink:0" title="Send GIF">🎭</button>
        <input id="dm-input" type="text" class="form-input" placeholder="Message..." style="flex:1;margin:0" onkeydown="if(event.key==='Enter')sendDMMessage()">
        <button id="dm-send-btn" onclick="sendDMMessage()" style="padding:10px 18px;background:var(--purple);border:none;border-radius:10px;color:#fff;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer;flex-shrink:0">Send</button>
      </div>
    </div>
  </div>

  <div id="contacts-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:600;align-items:flex-end;justify-content:center" onclick="if(event.target.id==='contacts-modal')closeContactsPicker()">
    <div style="background:var(--dark2);border:1px solid var(--border2);border-radius:24px 24px 0 0;padding:28px 24px 48px;width:100%;max-width:520px;max-height:70vh;display:flex;flex-direction:column">
      <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 20px"></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:0.05em;margin-bottom:4px">Your Contacts</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:16px">Tap to add to your bill</div>
      <input type="text" id="contacts-search" placeholder="Search contacts..." style="width:100%;padding:10px 14px;background:var(--dark3);border:1px solid var(--border);border-radius:10px;color:var(--white);font-family:'Epilogue',sans-serif;font-size:13px;outline:none;margin-bottom:14px" oninput="filterContacts(this.value)">
      <div id="contacts-list" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px"></div>
      <button onclick="closeContactsPicker()" style="margin-top:16px;width:100%;padding:13px;background:transparent;border:1px solid var(--border2);border-radius:12px;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer">Done</button>
    </div>
  </div>

  <!-- TRIP ADMIN MODAL -->
  <div id="trip-admin-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);z-index:700;align-items:center;justify-content:center;padding:20px" onclick="if(event.target.id==='trip-admin-modal')closeTripAdmin()">
    <div style="background:var(--dark);border:1px solid var(--border2);border-radius:20px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;position:relative">
      <!-- Header -->
      <div style="position:sticky;top:0;background:var(--dark);border-bottom:1px solid var(--border);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;z-index:1;border-radius:20px 20px 0 0">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);padding:3px 10px;border-radius:8px;font-size:10px;font-weight:700;color:var(--green);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">⚙️ Trip Admin</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:0.05em" id="admin-trip-name">Trip</div>
        </div>
        <button onclick="closeTripAdmin()" style="background:var(--dark3);border:none;color:var(--muted);width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>

      <div style="padding:24px;display:flex;flex-direction:column;gap:24px">

        <!-- TABS -->
        <div style="display:flex;background:var(--dark2);border-radius:10px;padding:4px;gap:4px">
          <button id="atab-members" onclick="switchAdminTab('members')" style="flex:1;padding:9px;background:var(--dark3);border:none;color:var(--white);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600;border-radius:7px;cursor:pointer"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><circle cx="6" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M14 13c0-2.2-1.3-4-3-4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Members</button>
          <button id="atab-receipts" onclick="switchAdminTab('receipts')" style="flex:1;padding:9px;background:transparent;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600;border-radius:7px;cursor:pointer"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><rect x="2" y="1" width="10" height="14" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 5h4M5 8h4M5 11h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> Receipts</button>
          <button id="atab-comments" onclick="switchAdminTab('comments')" style="flex:1;padding:9px;background:transparent;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600;border-radius:7px;cursor:pointer">💬 Comments</button>
          <button id="atab-danger" onclick="switchAdminTab('danger')" style="flex:1;padding:9px;background:transparent;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600;border-radius:7px;cursor:pointer">⚠️ Danger</button>
        </div>

        <!-- MEMBERS TAB -->
        <div id="admin-panel-members">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px">Current Members</div>
          <div id="admin-members-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>
          <div style="font-size:12px;color:var(--muted);line-height:1.6;padding:10px 14px;background:var(--dark2);border-radius:8px">
            Co-admins can add receipts and manage the trip but cannot delete it or remove other admins.
          </div>
        </div>

        <!-- RECEIPTS TAB -->
        <div id="admin-panel-receipts" style="display:none">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px">All Receipts</div>
          <div id="admin-receipts-list" style="display:flex;flex-direction:column;gap:8px">
            <div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Loading receipts...</div>
          </div>
        </div>

        <!-- COMMENTS TAB -->
        <div id="admin-panel-comments" style="display:none">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px">All Comments</div>
          <div id="admin-comments-list" style="display:flex;flex-direction:column;gap:8px">
            <div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Loading comments...</div>
          </div>
        </div>

        <!-- DANGER TAB -->
        <div id="admin-panel-danger" style="display:none">
          <div style="background:rgba(255,68,68,0.04);border:1px solid rgba(255,68,68,0.18);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF6B6B">⚠️ Danger Zone</div>
            <div style="font-size:13px;color:var(--muted);line-height:1.7">Deleting this trip permanently removes all receipts, comments, and member data. There is no undo.</div>
            <button id="admin-delete-btn" style="padding:14px;background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.35);border-radius:10px;color:#FF6B6B;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer">🗑 Delete This Trip Forever</button>
          </div>
        </div>

      </div>
    </div>
  </div>




<!-- BILL DETAIL MODAL -->
<div class="modal-overlay" id="bill-modal">
  <div class="modal">
    <button class="modal-close" onclick="closeBillModal()">✕</button>
    <div class="modal-title" id="modal-bill-name">Bill</div>
    <div class="modal-meta" id="modal-bill-meta"></div>
    <div id="modal-receipt"></div>
    <div id="modal-participants" class="participants-list"></div>
    <div class="modal-actions">
      <button class="modal-btn modal-btn-view" id="modal-view-btn"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3M10 2h4v4M14 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Open Bill Page</button>
      <button class="modal-btn" id="modal-share-btn" style="background:rgba(0,140,255,0.1);border:1px solid rgba(0,140,255,0.25);color:#4DB8FF">📤 Share Link</button>
      <button class="modal-btn modal-btn-remind" id="modal-remind-btn"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M8 2a4 4 0 0 0-4 4v3l-1 1.5h10L12 9V6a4 4 0 0 0-4-4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Remind Unpaid</button>
      <button class="modal-btn" id="modal-edit-toggle-btn" style="background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);color:var(--green)" onclick="toggleBillEditPanel()">✏️ Edit Bill</button>
      <button class="modal-btn" id="modal-add-person-btn" style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);color:var(--purple3)">👤 Add Person</button>
      <button class="modal-btn modal-btn-delete" id="modal-delete-btn">🗑 Delete</button>
    </div>

    <!-- Edit Bill panel -->
    <div id="modal-edit-panel" style="display:none;margin-top:14px;padding:16px;background:var(--dark2);border:1px solid rgba(48,209,88,0.15);border-radius:12px">
      <div style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px">Edit Bill</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:6px">Bill Name</label>
          <input id="modal-edit-name" type="text" class="form-input" style="margin:0;font-size:14px" placeholder="e.g. Costco Run">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:6px">💳 Who Paid the Bill?</label>
          <select id="modal-edit-paidby" style="width:100%;padding:10px 14px;background:var(--dark3);border:1px solid var(--border);border-radius:10px;color:var(--white);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600">
            <option value="">— Select who paid —</option>
          </select>
          <div style="font-size:11px;color:var(--muted);margin-top:5px">Others will pay this person back</div>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="saveBillEdits()" style="flex:2;padding:11px;background:var(--green);border:none;border-radius:10px;color:#000;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer">Save Changes</button>
          <button onclick="toggleBillEditPanel()" style="flex:1;padding:11px;background:transparent;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Add person panel -->
    <div id="modal-add-person-panel" style="display:none;margin-top:14px;padding:14px;background:var(--dark2);border:1px solid var(--border);border-radius:12px">
      <div style="font-size:12px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">Add someone to this bill</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input id="modal-add-person-input" type="text" class="form-input" placeholder="Name or @RavenID" style="flex:1;margin:0;font-size:13px;padding:9px 12px">
        <button id="modal-add-person-btn-submit" style="padding:9px 16px;background:var(--purple);border:none;border-radius:9px;color:#fff;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0">Add</button>
      </div>
      <div style="font-size:11px;color:var(--muted);line-height:1.6">If they have a RAVEN account, the bill will appear in their dashboard automatically.</div>
    </div>
  </div>
</div>

<!-- MOBILE BOTTOM NAV -->
<div id="mobile-nav">
  <button class="mob-nav-btn active" id="mob-overview" onclick="showPage('overview');setMobNav('mob-overview')"><span class="mi"><span class="mi-ring"><svg class="raven-icon"><use href="#mob-icon-overview"></use></svg></span></span>Overview</button>
  <button class="mob-nav-btn" id="mob-bills" onclick="showPage('active-bills');setMobNav('mob-bills')"><span class="mi"><span class="mi-ring"><svg class="raven-icon"><use href="#mob-icon-bills"></use></svg></span></span>Bills</button>
  <button class="mob-nav-btn create-btn" id="mob-create" onclick="showPage('create-bill');setMobNav('mob-create')"><span class="mi"><span class="mi-ring"><svg class="raven-icon"><use href="#mob-icon-create"></use></svg></span></span><span class="mob-nav-label">New</span></button>
  <button class="mob-nav-btn" id="mob-trip" onclick="showPage('trip-hub');setMobNav('mob-trip')"><span class="mi"><span class="mi-ring"><svg class="raven-icon"><use href="#mob-icon-trips"></use></svg></span></span>Trips</button>
  <button class="mob-nav-btn" id="mob-settings" onclick="showPage('settings');setMobNav('mob-settings')" style="position:relative"><span class="mi"><span class="mi-ring"><svg class="raven-icon"><use href="#mob-icon-more"></use></svg></span></span>More<span id="mob-friend-req-badge" style="display:none;position:absolute;top:6px;right:10px;width:8px;height:8px;background:#A855F7;border-radius:50%"></span></button>
</div>

<div class="toast" id="toast"></div>

<script>
// ── GLOBAL ERROR HANDLER — catch any unhandled promise rejections silently ──
window.addEventListener('unhandledrejection', function(e) {
  console.warn('Unhandled rejection (suppressed):', e.reason);
  e.preventDefault(); // stops "Uncaught" appearing in console
});

const SUPABASE_URL = 'https://ffjpzkpdumdcwnakpaje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmanB6a3BkdW1kY3duYWtwYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODc4OTcsImV4cCI6MjA4ODU2Mzg5N30.JtDLVu4K1TJ8emcN_mvSHBu6e0y8-jPQv-ypoc9p0RU';
const { createClient } = supabase;

// Safe client creation — clears corrupted auth tokens if they cause a parse error
let db;
try {
  db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'implicit',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true
    }
  });
} catch(e) {
  console.warn('Supabase init failed, clearing storage:', e.message);
  // Clear potentially corrupted Supabase session tokens from localStorage
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('sb-') || k.includes('supabase')) localStorage.removeItem(k);
  });
  // Retry after clearing
  try { db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); } catch(e2) { console.error('Fatal: Supabase could not initialize'); }
}

const BACKEND = 'https://raven-backend-production-fb1f.up.railway.app';
const FRONTEND = 'https://ravensplit.com';

let currentUser = null;
let currentBillId = null;
let people = [];

// ── JOIN TRIP STATE ──────────────────────────────────────────────────────────
// Handle Supabase password reset redirect — fires when user clicks the reset link in email
// Supabase sets the session automatically via the URL hash fragment
db.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    // User clicked the reset link — show new password form
    showPasswordResetForm();
  }
});

function showPasswordResetForm() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('dashboard-screen').style.display = 'none';
  // Hide all auth forms, show reset form
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'none';
  try { document.getElementById('forgot-form').style.display = 'none'; } catch(e) {}
  // Build or show the reset password form
  let rf = document.getElementById('reset-password-form');
  if (!rf) {
    rf = document.createElement('div');
    rf.id = 'reset-password-form';
    rf.className = 'auth-form';
    rf.innerHTML =
      '<div style="text-align:center;margin-bottom:4px"><div style="font-size:32px;margin-bottom:8px">🔒</div>' +
      '<div style="font-size:15px;font-weight:700;color:var(--white);margin-bottom:4px">Set new password</div>' +
      '<div style="font-size:13px;color:var(--muted)">Choose a strong password for your account</div></div>' +
      '<div style="position:relative"><label class="auth-label">New Password</label>' +
      '<input id="reset-new-password" type="password" class="auth-input" placeholder="At least 6 characters" autocomplete="new-password" style="padding-right:44px">' +
      '<button type="button" onclick="togglePasswordVis(\'reset-new-password\',this)" style="position:absolute;right:12px;bottom:12px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0">👁</button></div>' +
      '<div><label class="auth-label">Confirm New Password</label>' +
      '<input id="reset-confirm-password" type="password" class="auth-input" placeholder="••••••••" autocomplete="new-password"></div>' +
      '<button class="auth-btn" id="reset-save-btn" onclick="handlePasswordReset()">Save New Password →</button>' +
      '<div id="reset-success" style="display:none;padding:12px 16px;background:rgba(48,209,88,0.07);border:1px solid rgba(48,209,88,0.2);border-radius:10px;font-size:13px;color:var(--green);text-align:center">✅ Password updated! Signing you in...</div>';
    const card = document.querySelector('.auth-card');
    if (card) card.appendChild(rf);
  }
  rf.style.display = 'flex';
  // Hide the tab buttons — this is a special flow
  const tabs = document.querySelector('.auth-tabs');
  if (tabs) tabs.style.display = 'none';
}

async function handlePasswordReset() {
  const newPass = document.getElementById('reset-new-password').value;
  const confirm = document.getElementById('reset-confirm-password').value;
  if (!newPass || newPass.length < 6) return showAuthError('Password must be at least 6 characters.');
  if (newPass !== confirm) return showAuthError("Passwords don't match.");
  const btn = document.getElementById('reset-save-btn');
  btn.textContent = 'Saving...'; btn.disabled = true; hideAuthError();
  const { data, error } = await db.auth.updateUser({ password: newPass });
  btn.textContent = 'Save New Password →'; btn.disabled = false;
  if (error) {
    showAuthError(error.message);
  } else {
    document.getElementById('reset-success').style.display = 'block';
    btn.style.display = 'none';
    // Auto sign in — session is already active after password reset
    setTimeout(async () => {
      const { data: { user } } = await db.auth.getUser();
      if (user) { currentUser = user; await checkOnboardingAndShow(user.id); }
    }, 1500);
  }
}
(function detectJoinParams() {
  const params = new URLSearchParams(window.location.search);
  const joinTrip  = params.get('join_trip');
  const joinToken = params.get('join_token');
  const signIn    = params.get('signin');
  const addFriend = params.get('add'); // Raven ID to add as friend after login

  if (addFriend) {
    sessionStorage.setItem('pending_add_friend', addFriend);
    history.replaceState(null, '', window.location.pathname);
  }
  if (joinTrip && joinToken) {
    sessionStorage.setItem('pending_join_trip',  joinTrip);
    sessionStorage.setItem('pending_join_token', joinToken);
    // Show the banner and fill in trip name if we can
    const banner = document.getElementById('join-banner');
    if (banner) banner.style.display = 'block';
    // Auto-switch to correct tab
    if (signIn === '1') switchAuthTab('login');
    else switchAuthTab('signup');
    // Remove params from URL so refresh doesn't re-trigger
    history.replaceState(null, '', window.location.pathname);
    // Try to fetch trip name for the banner
    fetch(BACKEND + '/trip-info/' + joinTrip + '?token=' + joinToken)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.name) { const el = document.getElementById('join-trip-name-display'); if (el) el.textContent = d.name; } })
      .catch(() => {});
  }
})();

async function getPendingJoin() {
  const tripId = sessionStorage.getItem('pending_join_trip');
  const token  = sessionStorage.getItem('pending_join_token');
  return (tripId && token) ? { tripId, token } : null;
}

async function clearPendingJoin() {
  sessionStorage.removeItem('pending_join_trip');
  sessionStorage.removeItem('pending_join_token');
}

// Call this after a user is authenticated — handles joining and redirecting
async function handlePendingJoinIfAny(userId, userEmail, knownDisplayName) {
  const pending = await getPendingJoin();
  if (!pending) return false;
  try {
    // Use the known display name if provided (e.g. from signup form), otherwise look up profile
    let displayName = knownDisplayName || '';
    if (!displayName) {
      try {
        const { data: profile } = await db.from('profiles').select('first_name').eq('id', userId).maybeSingle();
        displayName = profile?.first_name || userEmail.split('@')[0];
      } catch(e) { displayName = userEmail.split('@')[0]; }
    }
    const r = await fetch(FRONTEND + '/trip/' + pending.tripId + '/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite_token: pending.token, user_email: userEmail, display_name: displayName })
    });
    const d = await r.json();
    if (d.success) {
      clearPendingJoin();
      // Save trip ID to localStorage immediately (works without any DB schema changes)
      try {
        const localProfile = JSON.parse(localStorage.getItem('raven_profile') || '{}');
        const localJoined = Array.isArray(localProfile.joined_trips) ? localProfile.joined_trips : [];
        if (!localJoined.includes(pending.tripId)) localJoined.push(pending.tripId);
        localStorage.setItem('raven_profile', JSON.stringify({ ...localProfile, joined_trips: localJoined }));
      } catch(e) {}
      // Also try saving to DB joined_trips column if it exists — gracefully skip if not
      try {
        const { data: profCheck, error: profErr } = await db.from('profiles').select('id').eq('id', userId).single();
        if (!profErr && profCheck) {
          // Try updating joined_trips — will fail silently if column doesn't exist
          await db.from('profiles').update({ joined_trips: JSON.stringify([pending.tripId]) }).eq('id', userId);
        }
      } catch(e) { /* joined_trips column not yet added — localStorage fallback is sufficient */ }
      // Redirect straight to the trip
      window.location.href = FRONTEND + '/trip/' + pending.tripId + '?t=' + d.share_token + '&name=' + encodeURIComponent(displayName);
      return true;
    } else {
      console.error('Join failed:', d.error);
    }
  } catch(e) { console.error('Join trip error:', e); }
  clearPendingJoin();
  return false;
}

async function init() {
  try {
    // Handle OAuth error params
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      console.warn('OAuth error:', params.get('error_description'));
      history.replaceState(null, '', window.location.pathname);
    }
    // Handle implicit flow — token comes back in URL hash
    const hash = window.location.hash;
    if (hash && (hash.includes('access_token') || hash.includes('error'))) {
      try { await db.auth.getSession(); } catch(e) {}
      history.replaceState(null, '', window.location.pathname);
    }
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) { currentUser = session.user; await checkOnboardingAndShow(currentUser.id); }
    else { showAuth(); }
    db.auth.onAuthStateChange(async (event, session) => {
      try {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
          currentUser = session.user;
          if (window.location.hash) history.replaceState(null, '', window.location.pathname);
          await checkOnboardingAndShow(session.user.id);
        } else if (event === 'SIGNED_OUT') { currentUser = null; showAuth(); }
      } catch(e) { console.warn('auth state change error:', e); }
    });
  } catch(e) { console.warn('init error:', e); showAuth(); }
}

async function checkOnboardingAndShow(userId) {
  // First handle any pending trip join — this may redirect away
  let knownName = '';
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    knownName = local.first_name || '';
  } catch(e) {}
  const redirected = await handlePendingJoinIfAny(userId, currentUser.email, knownName);
  if (redirected) return;

  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    if (local.user_id === userId && local.onboarding_complete) { showDashboard(); return; }
  } catch(e) {}
  try {
    const { data: profile, error } = await db.from('profiles').select('*').eq('id', userId).single();
    if (!error && profile) {
      // Ensure every profile has a raven_id — generate one if missing (mel → mel1 → mel2)
      if ((shouldRefreshAutoRavenId(profile.raven_id, profile.first_name, currentUser.email)) && profile.first_name) {
        try {
          const ravenId = await generateUniqueRavenId(sanitizeRavenBase(profile.first_name), userId);
          await persistRavenHandle(userId, ravenId);
          profile.raven_id = ravenId;
          profile.username = ravenId;
        } catch(e) {}
      } else if (profile.raven_id && profile.username !== profile.raven_id) {
        try { await persistRavenHandle(userId, profile.raven_id); } catch(e) {}
      }
      if (profile.onboarding_complete) {
        const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
        localStorage.setItem('raven_profile', JSON.stringify({ ...existing, user_id: userId, onboarding_complete: true, first_name: profile.first_name || existing.first_name || '', raven_id: profile.raven_id || existing.raven_id || '', username: profile.raven_id || existing.username || existing.raven_id || '', email: currentUser.email }));
        showDashboard(); return;
      } else { window.location.href = 'onboarding.html'; return; }
    }
  } catch(e) { console.log('Profile check error:', e); }
  const hasLocalData = localStorage.getItem('raven_profile');
  if (hasLocalData) showDashboard(); else window.location.href = 'onboarding.html';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => { t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'signup' && i === 1)); });
  document.getElementById('login-form').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? 'flex' : 'none';
  hideAuthError();
}
function showAuthError(msg) { const el = document.getElementById('auth-error'); el.textContent = msg; el.style.display = 'block'; }
function hideAuthError() { document.getElementById('auth-error').style.display = 'none'; }

async function handleGoogleAuth() {
  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://ravensplit.com/dashboard.html'
      }
    });
    if (error) showAuthError(error.message);
  } catch(e) {
    showAuthError('Google sign-in failed. Please try email/password.');
  }
}

async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email) return showAuthError('Please enter your email.');
  if (!password) return showAuthError('Please enter your password.');
  const btn = document.querySelector('#login-form .auth-btn');
  btn.textContent = 'Signing in...'; btn.disabled = true; hideAuthError();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  btn.textContent = 'Sign In →'; btn.disabled = false;
  if (error) {
    // Check if it's an email not confirmed error
    if (error.message?.toLowerCase().includes('email not confirmed') || error.message?.toLowerCase().includes('confirm')) {
      // Show resend confirmation option
      showAuthError('Please confirm your email first. ' +
        '<button onclick="resendConfirmation(\'' + email.replace(/'/g, '') + '\')" style="background:none;border:none;color:var(--green);font-family:\'Epilogue\',sans-serif;font-size:inherit;cursor:pointer;text-decoration:underline;padding:0">Resend confirmation email →</button>');
      return;
    }
    showAuthError(error.message);
    return;
  }
  if (data?.user) {
    if (document.getElementById('remember-me')?.checked) {
      localStorage.setItem('raven_remembered_email', email);
    } else {
      localStorage.removeItem('raven_remembered_email');
    }
    currentUser = data.user; await checkOnboardingAndShow(data.user.id);
  }
}

async function resendConfirmation(email) {
  const addr = email || document.getElementById('login-email')?.value.trim();
  if (!addr) return showAuthError('Enter your email address first.');
  try {
    const { error } = await db.auth.resend({ type: 'signup', email: addr });
    if (error) return showAuthError(error.message);
    hideAuthError();
    showToast('✅ Confirmation email resent to ' + addr, 'success');
  } catch(e) {
    showToast('Could not resend — try signing up again', 'error');
  }
}

function handleRememberMe() {
  const email = document.getElementById('login-email').value.trim();
  if (document.getElementById('remember-me')?.checked && email) {
    localStorage.setItem('raven_remembered_email', email);
  }
}

function togglePasswordVis(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? '🙈' : '👁';
}

function showForgotPassword() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'flex';
  const loginEmail = document.getElementById('login-email').value.trim();
  if (loginEmail) document.getElementById('forgot-email').value = loginEmail;
  hideAuthError();
}

function showLoginForm() {
  document.getElementById('forgot-form').style.display = 'none';
  document.getElementById('login-form').style.display = 'flex';
  document.getElementById('forgot-success').style.display = 'none';
  hideAuthError();
}

async function handleForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return showAuthError('Please enter your email address.');
  const btn = document.getElementById('forgot-btn');
  btn.textContent = 'Sending...'; btn.disabled = true; hideAuthError();
  const redirectUrl = window.location.origin + window.location.pathname + '?reset=1';
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
  btn.textContent = 'Send Reset Link →'; btn.disabled = false;
  if (error) {
    showAuthError(error.message);
  } else {
    document.getElementById('forgot-success').style.display = 'block';
    btn.style.display = 'none';
  }
}

// Pre-fill remembered email on page load
try {
  const remembered = localStorage.getItem('raven_remembered_email');
  if (remembered) {
    const ei = document.getElementById('login-email');
    const cb = document.getElementById('remember-me');
    if (ei) ei.value = remembered;
    if (cb) cb.checked = true;
  }
} catch(e) {}

async function handleSignup() {
  const firstName = document.getElementById('signup-firstname').value.trim();
  const email     = document.getElementById('signup-email').value.trim();
  const password  = document.getElementById('signup-password').value;
  const confirm   = document.getElementById('signup-confirm').value;
  if (!email || !password) return showAuthError('Please fill in all fields.');
  if (password !== confirm) return showAuthError("Passwords don't match.");
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.');
  const btn = document.querySelector('#signup-form .auth-btn');
  btn.textContent = 'Creating account...'; btn.disabled = true;
  let ravenId = '';
  try {
    ravenId = await generateUniqueRavenId(sanitizeRavenBase(firstName || 'raven'));
  } catch(e) { console.warn('raven_id pre-generation error:', e); }
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName || '',
        username: ravenId || '',
        raven_id: ravenId || ''
      }
    }
  });
  if (error) { showAuthError(error.message); btn.textContent = 'Create Account →'; btn.disabled = false; return; }

  // Always auto-generate Raven ID on signup — firstName + 3-4 random digits (e.g. mel8472)
  if (data?.user) {
    try {
      ravenId = ravenId || null;
      for (let attempt = 0; attempt < 12 && !ravenId; attempt++) {
        const digits = String(Math.floor(Math.random() * 900) + 100);
        const candidate = (sanitizeRavenBase(firstName || 'raven') + digits).slice(0, 20);
        const { data: existing } = await db.from('profiles').select('id').eq('raven_id', candidate).maybeSingle();
        if (!existing) { ravenId = candidate; break; }
      }
      if (!ravenId) ravenId = await generateUniqueRavenId(sanitizeRavenBase(firstName || 'raven'), data.user.id);
      let profileUpsertFailed = false;
      try {
        const { error: profileErr } = await db.from('profiles').upsert({
          id: data.user.id, email, first_name: firstName || '',
          raven_id: ravenId, username: ravenId, onboarding_complete: false, updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        profileUpsertFailed = !!profileErr;
      } catch(e) { profileUpsertFailed = true; }
      if (profileUpsertFailed) {
        await db.from('profiles').upsert({
          id: data.user.id, email, first_name: firstName || '',
          raven_id: ravenId, onboarding_complete: false, updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      }
      const existingLocal = JSON.parse(localStorage.getItem('raven_profile') || '{}');
      localStorage.setItem('raven_profile', JSON.stringify({ ...existingLocal, first_name: firstName || '', raven_id: ravenId, username: ravenId, user_id: data.user.id }));
    } catch(e) { console.warn('raven_id generation error:', e); }
  }

  btn.textContent = 'Create Account →'; btn.disabled = false;

  // Show email confirmation required screen
  document.getElementById('signup-form').style.display = 'none';
  document.querySelector('.auth-tabs').style.display = 'none';
  const card = document.querySelector('.auth-card');
  const confirmDiv = document.createElement('div');
  confirmDiv.className = 'auth-form';
  confirmDiv.style.textAlign = 'center';
  confirmDiv.innerHTML =
    '<div style="font-size:48px;margin-bottom:16px">📧</div>' +
    '<div style="font-size:18px;font-weight:700;color:var(--white);margin-bottom:8px">Check your email</div>' +
    '<div style="font-size:14px;color:var(--muted);line-height:1.7;margin-bottom:20px">We sent a confirmation link to <strong style="color:var(--white)">' + email + '</strong>.<br>Click it to activate your account — RAVEN uses your confirmed email to send bill reminders.</div>' +
    '<div style="padding:12px 16px;background:rgba(48,209,88,0.07);border:1px solid rgba(48,209,88,0.2);border-radius:10px;font-size:13px;color:var(--green);margin-bottom:16px">✅ Once confirmed, come back and sign in</div>' +
    '<button onclick="location.reload()" style="background:none;border:none;color:var(--muted);font-family:\'Epilogue\',sans-serif;font-size:13px;cursor:pointer;text-decoration:underline">← Back to Sign In</button>';
  if (card) card.appendChild(confirmDiv);
  // 🪶 Celebrate new account with flying ravens!
  celebrateBillCreated();

  // If there's a pending join, handle it now before routing to onboarding
  if (data?.user) {
    currentUser = data.user;
    const pending = await getPendingJoin();
    if (pending) {
      const redirected = await handlePendingJoinIfAny(data.user.id, email, firstName || email.split('@')[0]);
      if (redirected) return;
    }
  }
}

let payModalParticipantId = null;
let payModalBillId = null;

async function openPayModal(participantId, billId, amount) {
  payModalParticipantId = participantId; payModalBillId = billId;
  const amt = parseFloat(amount).toFixed(2);
  // Track pay modal opened
  try { if (typeof posthog !== 'undefined') posthog.capture('pay_modal_opened', { bill_id: billId, amount: parseFloat(amt) }); } catch(e) {}
  document.getElementById('pay-modal-amount').textContent = '$' + amt;
  document.getElementById('pay-modal-methods').innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);font-size:13px">Loading payment options...</div>';
  document.getElementById('cb-pay-modal').style.display = 'flex';

  // Fetch bill including paid_by
  const { data: bill } = await db.from('bills').select('name, creator_phone, paid_by').eq('id', billId).single();
  const paidByName = bill?.paid_by || null;
  const payeeName = paidByName || null;

  // Title = "Pay [bill name]", subtitle = "Send $X to [payer name]"
  document.getElementById('pay-modal-title').textContent = 'Pay ' + (bill?.name || 'Bill');

  let profile = null;

  // Priority: look up the paid_by person's profile by first_name
  if (paidByName) {
    try {
      const { data } = await db.from('profiles')
        .select('first_name,phone,email,venmo,cashapp,zelle,applepay,updated_at')
        .ilike('first_name', paidByName)
        .limit(8);
      profile = chooseBestPaymentProfile(data, paidByName);
    } catch(e) {}
  }

  // Fallback: creator's profile
  if (!profile && bill?.creator_phone) {
    try {
      const { data: emailMatch } = await db.from('profiles').select('first_name,phone,email,venmo,cashapp,zelle,applepay,updated_at').eq('email', bill.creator_phone).maybeSingle();
      if (emailMatch) profile = emailMatch;
      if (!profile) {
        const { data: phoneMatch } = await db.from('profiles').select('first_name,phone,email,venmo,cashapp,zelle,applepay,updated_at').eq('phone', bill.creator_phone).maybeSingle();
        if (phoneMatch) profile = phoneMatch;
      }
    } catch(e) {}
  }

  // If current user IS the creator/payer, pull from localStorage
  if (!profile || (!profile.venmo && !profile.cashapp && !profile.zelle && !profile.applepay)) {
    if (bill?.creator_phone === currentUser?.email) {
      try {
        const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
        if (local.venmo || local.cashapp || local.zelle || local.applepay) profile = { ...profile, ...local };
      } catch(e) {}
    }
  }

  const displayName = paidByName || profile?.first_name || bill?.creator_phone?.split('@')[0] || 'Bill payer';
  const paymentContextName = bill?.name || 'this bill';
  document.getElementById('pay-modal-sub').textContent = 'Send $' + amt + ' to ' + displayName;

  const mc = document.getElementById('pay-modal-methods');
  mc.innerHTML = '';

  function addLinkRow(href, target, bg, iconBg, iconText, title, handle) {
    const a = document.createElement('a');
    if (title === 'Apple Pay') handle = 'Opens Messages so you can send Apple Pay there';
    a.href = href; if (target) a.target = target;
    a.className = 'pay-method-row'; a.style.background = bg;
    a.innerHTML = `<div class="pay-method-icon" style="background:${iconBg};font-size:${iconText.length>1?'9px':'14px'}">${iconText}</div><div class="pay-method-info"><div class="pay-method-name">${title}</div><div class="pay-method-handle">${handle}</div></div><div class="pay-method-arrow">→</div>`;
    mc.appendChild(a);
  }

  function addCopyRow(copyText, bg, iconBg, iconText, title, handle) {
    const btn = document.createElement('button');
    if (title === 'Apple Pay') handle = String(copyText || '').trim() + ' - copy the contact, then use Apple Pay manually';
    btn.className = 'pay-method-row'; btn.style.background = bg; btn.style.border = '2px solid rgba(255,255,255,0.06)'; btn.style.width = '100%'; btn.style.cursor = 'pointer';
    btn.innerHTML = `<div class="pay-method-icon" style="background:${iconBg};font-size:${iconText.length>1?'9px':'14px'}">${iconText}</div><div class="pay-method-info"><div class="pay-method-name">${title}</div><div class="pay-method-handle">${handle}</div></div><div class="pay-method-arrow">→</div>`;
    btn.addEventListener('click', () => { navigator.clipboard.writeText(copyText).then(() => showToast(title + ' info copied!', 'success')).catch(() => prompt('Copy:', copyText)); });
    mc.appendChild(btn);
  }

  if (profile?.venmo) {
    const handle = profile.venmo.startsWith('@') ? profile.venmo : '@' + profile.venmo;
    const clean = profile.venmo.replace('@','');
    addLinkRow('venmo://paycharge?txn=pay&recipients='+clean+'&amount='+amt+'&note=Bill+Payment', '_blank', '#003d7a', '#008CFF', 'V', 'Venmo', handle + ' · $' + amt);
  }
  if (profile?.cashapp) {
    const tag = profile.cashapp.startsWith('$') ? profile.cashapp : '$' + profile.cashapp;
    const clean = profile.cashapp.replace('$','');
    addLinkRow('https://cash.app/$'+clean+'/'+amt, '_blank', '#004d12', '#00D632', '$', 'Cash App', tag + ' · $' + amt);
  }
  if (profile?.zelle) {
    const zelleHref = buildZellePaymentHref(profile.zelle, amt, paymentContextName);
    if (zelleHref) addLinkRow(zelleHref, '_blank', '#2a0a52', '#6D1ED4', 'Z', 'Zelle', profile.zelle + (profile.zelle.includes('@') ? ' · opens Mail' : ' · opens Messages'));
    else addCopyRow(profile.zelle, '#2a0a52', '#6D1ED4', 'Z', 'Zelle', profile.zelle + ' · tap to copy');
  }
  if (profile?.applepay) {
    const ap = profile.applepay;
    const applePayHref = buildApplePayHref(ap, amt, paymentContextName);
    if (applePayHref) {
      addLinkRow(applePayHref, null, '#1a1a1a', '#333', 'Pay', 'Apple Pay', 'Opens iMessage to ' + ap + ' · send Apple Pay manually');
    } else {
      addCopyRow(ap, '#1a1a1a', '#333', 'Pay', 'Apple Pay', ap + ' · copy, then send Apple Pay manually');
    }
  }

  if (mc.children.length === 0) {
    mc.innerHTML = '<div style="text-align:center;padding:12px;color:var(--muted);font-size:12px;margin-bottom:4px">' + displayName + ' hasn\'t set up payment methods yet.</div>';
    // Auto-show the method submenu when no payment links are available
    ['Cash','Bank Transfer','Venmo','Cash App','Zelle','Apple Pay','Other'].forEach(function(m) {
      const b = document.createElement('button');
      b.textContent = m;
      b.style.cssText = 'display:block;width:100%;padding:11px 16px;margin-bottom:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#F0EEF8;font-family:\'Epilogue\',sans-serif;font-size:13px;font-weight:600;cursor:pointer;text-align:left';
      b.addEventListener('click', (function(method){ return async function() {
        if (!payModalParticipantId || !payModalBillId) return;
        await markPaid(payModalParticipantId, payModalBillId, method);
        cbClosePayModal(); showToast('✅ Marked as paid via ' + method + '!', 'success');
      }; })(m));
      mc.appendChild(b);
    });
    // Hide the "other method" button since methods are already shown
    const ob = document.getElementById('pay-modal-other-btn');
    if (ob) ob.style.display = 'none';
  } else {
    const ob = document.getElementById('pay-modal-other-btn');
    if (ob) ob.style.display = '';
  }
}

function cbToggleOtherMethods() {
  const container = document.getElementById('pay-modal-method-btns');
  if (!container) return;
  if (container.children.length > 0) { container.innerHTML = ''; document.getElementById('pay-modal-other-btn').textContent = '✓ Paid via method ›'; return; }
  document.getElementById('pay-modal-other-btn').textContent = '✓ Paid via method ▴';
  ['Cash','Bank Transfer','Venmo','Cash App','Zelle','Apple Pay','Other'].forEach(function(m) {
    const b = document.createElement('button');
    b.textContent = m;
    b.style.cssText = 'width:100%;padding:11px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#F0EEF8;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;text-align:left';
    b.addEventListener('click', (function(method){ return async function() {
      if (!payModalParticipantId || !payModalBillId) return;
      try { if (typeof posthog !== 'undefined') posthog.capture('payment_marked_paid', { bill_id: payModalBillId, method }); } catch(e) {}
      await markPaid(payModalParticipantId, payModalBillId, method);
      cbClosePayModal(); showToast('✅ Marked as paid via ' + method + '!', 'success');
    }; })(m));
    container.appendChild(b);
  });
}

async function cbMarkPaidOther() {
  // Legacy - just open the submenu
  cbToggleOtherMethods();
}
function cbClosePayModal() { document.getElementById('cb-pay-modal').style.display = 'none'; payModalParticipantId = null; payModalBillId = null; }

async function loadSettings() {
  document.getElementById('set-email').value = currentUser.email;
  document.getElementById('set-email-display').textContent = currentUser.email;
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    if (local.first_name) document.getElementById('set-first').value = local.first_name;
    if (local.last_name) document.getElementById('set-last').value = local.last_name;
    if (local.phone) document.getElementById('set-phone').value = local.phone;
    if (local.venmo) document.getElementById('set-venmo').value = local.venmo;
    if (local.cashapp) document.getElementById('set-cashapp').value = local.cashapp;
    if (local.zelle) document.getElementById('set-zelle').value = local.zelle;
    if (local.applepay) document.getElementById('set-applepay').value = local.applepay;
    const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    if (profile) {
      if (profile.first_name) document.getElementById('set-first').value = profile.first_name;
      if (profile.last_name) document.getElementById('set-last').value = profile.last_name;
      if (profile.phone) document.getElementById('set-phone').value = profile.phone;
      if (profile.venmo) document.getElementById('set-venmo').value = profile.venmo;
      if (profile.cashapp) document.getElementById('set-cashapp').value = profile.cashapp;
      if (profile.zelle) document.getElementById('set-zelle').value = profile.zelle;
      if (profile.applepay) document.getElementById('set-applepay').value = profile.applepay || '';
      const ensuredRavenId = await ensureCurrentUserRavenId(profile);
      if (ensuredRavenId) document.getElementById('set-raven-id').value = ensuredRavenId;
      if (profile.avatar_url) renderAvatar(profile.avatar_url, profile.first_name);
      else if (profile.first_name) renderAvatar(null, profile.first_name);
      const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || currentUser.email;
      document.getElementById('profile-display-name').textContent = displayName;
    }
  } catch(e) {}
  try {
    const ravenIdField = document.getElementById('set-raven-id');
    if (ravenIdField && (!ravenIdField.value || shouldRefreshAutoRavenId(ravenIdField.value, document.getElementById('set-first').value.trim(), currentUser.email))) {
      const generated = await ensureCurrentUserRavenId();
      ravenIdField.value = generated;
      const status = document.getElementById('raven-id-status');
      if (status) status.textContent = 'Your Raven ID is assigned automatically so friends can always find you.';
    }
  } catch(e) { console.warn('settings raven id ensure failed:', e); }
  if (window.innerWidth <= 768) { const qn = document.getElementById('mob-quick-nav'); if (qn) qn.style.display = 'block'; }
  loadPrivacyToggles();
  setupPwaInstallCard();
}

function renderAvatar(url, firstName) {
  const el = document.getElementById('profile-avatar-display');
  const sidebar = document.getElementById('sidebar-avatar');
  const mobAv = document.getElementById('mob-user-avatar');
  if (url) {
    const img = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    if (el) el.innerHTML = img;
    if (sidebar) sidebar.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    if (mobAv) mobAv.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else if (firstName) {
    const letter = firstName[0].toUpperCase();
    if (el) el.textContent = letter;
    if (sidebar) sidebar.textContent = letter;
    if (mobAv) mobAv.textContent = letter;
  }
}

async function handleAvatarUpload(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const resized = await new Promise(resolve => {
      const img = new Image();
      img.onload = function() {
        const size = 200;
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = e.target.result;
    });
    const el = document.getElementById('profile-avatar-display');
    if (el) el.innerHTML = `<img src="${resized}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    const base64 = resized;
    try {
      await db.from('profiles').upsert({ id: currentUser.id, avatar_url: base64, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
      localStorage.setItem('raven_profile', JSON.stringify({ ...existing, avatar_url: base64 }));
      renderAvatar(base64, null);
      showToast('📷 Profile photo updated!', 'success');
    } catch(err) { showToast('Error saving photo', 'error'); }
  };
  reader.readAsDataURL(file);
}

async function syncTripDisplayName(previousProfile, nextProfile) {
  const newDisplayName = (nextProfile.first_name || nextProfile.raven_id || '').trim();
  if (!currentUser?.email || !newDisplayName) return;
  const roundMoney = (value) => Math.round(((parseFloat(value) || 0) + Number.EPSILON) * 100) / 100;

  const aliasSet = new Set(
    [
      previousProfile?.first_name,
      previousProfile?.raven_id,
      previousProfile?.username,
      nextProfile?.raven_id,
      nextProfile?.username
    ]
      .flatMap(v => {
        const raw = String(v || '').trim();
        if (!raw) return [];
        return [raw.toLowerCase(), raw.replace(/^@/, '').toLowerCase()];
      })
  );
  if (!aliasSet.size) return;

  const renameKey = (value) => {
    const raw = String(value || '').trim();
    const clean = raw.replace(/^@/, '').toLowerCase();
    return aliasSet.has(clean) || aliasSet.has(raw.toLowerCase()) ? newDisplayName : raw;
  };
  const renameCredits = (rawCredits) => {
    let parsed = rawCredits;
    try { if (typeof parsed === 'string') parsed = JSON.parse(parsed); } catch(e) {}
    try { if (typeof parsed === 'string') parsed = JSON.parse(parsed); } catch(e) {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { changed: false, value: rawCredits };
    let changed = false;
    const nextCredits = {};
    Object.entries(parsed).forEach(([key, amount]) => {
      const parts = String(key).split('::receipt::');
      const renamedBase = renameKey(parts[0]);
      const nextKey = parts.length > 1 ? (renamedBase + '::receipt::' + parts.slice(1).join('::receipt::')) : renamedBase;
      if (nextKey !== key) changed = true;
      nextCredits[nextKey] = roundMoney((nextCredits[nextKey] || 0) + (parseFloat(amount) || 0));
    });
    return { changed, value: nextCredits };
  };

  const emailEscaped = currentUser.email.toLowerCase().replace(/[%_]/g, '\\$&');
  const tripMap = new Map();
  const { data: createdTrips } = await db.from('trips').select('*').eq('creator_email', currentUser.email);
  (createdTrips || []).forEach(trip => tripMap.set(trip.id, trip));
  const { data: memberTrips } = await db.from('trips').select('*').ilike('member_emails', '%' + emailEscaped + '%');
  (memberTrips || []).forEach(trip => tripMap.set(trip.id, trip));

  for (const trip of tripMap.values()) {
    let people = [];
    let coAdmins = [];
    try { people = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]'); } catch(e) {}
    try { coAdmins = Array.isArray(trip.co_admins) ? trip.co_admins : JSON.parse(trip.co_admins || '[]'); } catch(e) {}

    let peopleChanged = false;
    let adminsChanged = false;
    const renamedPeople = people.map(name => {
      const nextName = renameKey(name);
      if (nextName !== name) peopleChanged = true;
      return nextName;
    });
    const dedupedPeople = [...new Map(renamedPeople.map(name => [String(name).toLowerCase(), name])).values()];
    if (dedupedPeople.length !== people.length) peopleChanged = true;

    const renamedAdmins = coAdmins.map(name => {
      const nextName = renameKey(name);
      if (nextName !== name) adminsChanged = true;
      return nextName;
    });
    const dedupedAdmins = [...new Map(renamedAdmins.map(name => [String(name).toLowerCase(), name])).values()];
    if (dedupedAdmins.length !== coAdmins.length) adminsChanged = true;

    const creditRename = renameCredits(trip.settled_people);
    const tripUpdates = {};
    if (peopleChanged) tripUpdates.people = JSON.stringify(dedupedPeople);
    if (adminsChanged) tripUpdates.co_admins = JSON.stringify(dedupedAdmins);
    if (creditRename.changed) tripUpdates.settled_people = creditRename.value;
    if (Object.keys(tripUpdates).length > 0) await db.from('trips').update(tripUpdates).eq('id', trip.id);

    const { data: receipts } = await db.from('trip_receipts').select('id,paid_by,splits').eq('trip_id', trip.id);
    for (const receipt of (receipts || [])) {
      const updates = {};
      const nextPaidBy = renameKey(receipt.paid_by);
      if (receipt.paid_by && nextPaidBy !== receipt.paid_by) updates.paid_by = nextPaidBy;

      let splits = receipt.splits;
      try { if (typeof splits === 'string') splits = JSON.parse(splits); } catch(e) {}
      if (splits && typeof splits === 'object' && !Array.isArray(splits)) {
        let splitsChanged = false;
        const nextSplits = {};
        Object.entries(splits).forEach(([name, amount]) => {
          const nextName = renameKey(name);
          if (nextName !== name) splitsChanged = true;
          nextSplits[nextName] = roundMoney((nextSplits[nextName] || 0) + (parseFloat(amount) || 0));
        });
        if (splitsChanged) updates.splits = JSON.stringify(nextSplits);
      }

      if (Object.keys(updates).length > 0) await db.from('trip_receipts').update(updates).eq('id', receipt.id);
    }
  }
}

async function saveSettings() {
  const btn = document.getElementById('save-settings-btn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  let ravenIdInput = document.getElementById('set-raven-id').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const data = { id: currentUser.id, email: currentUser.email, first_name: document.getElementById('set-first').value.trim(), last_name: document.getElementById('set-last').value.trim(), phone: document.getElementById('set-phone').value.trim(), venmo: document.getElementById('set-venmo').value.trim(), cashapp: document.getElementById('set-cashapp').value.trim(), zelle: document.getElementById('set-zelle').value.trim(), applepay: document.getElementById('set-applepay').value.trim(), onboarding_complete: true, updated_at: new Date().toISOString() };
  const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');

  if (!ravenIdInput) {
    const base = data.first_name || 'raven';
    ravenIdInput = await generateUniqueRavenId(base, currentUser.id);
    document.getElementById('set-raven-id').value = ravenIdInput;
  }
  data.raven_id = ravenIdInput;

  try {
    await db.from('profiles').upsert(data, { onConflict: 'id' });
    if (data.raven_id) await persistRavenHandle(currentUser.id, data.raven_id);
    try { await syncTripDisplayName(existing, { ...existing, ...data, username: data.raven_id || existing.username || '' }); } catch(syncErr) { console.warn('Trip display name sync failed:', syncErr); }
    localStorage.setItem('raven_profile', JSON.stringify({ ...existing, ...data, username: data.raven_id || existing.username || '' }));
    try { loadTrips(); } catch(e) {}
    document.getElementById('settings-saved').style.display = 'block';
    setTimeout(() => document.getElementById('settings-saved').style.display = 'none', 3000);
    if (data.first_name) { const greetEl = document.getElementById('greeting-name'); if (greetEl) greetEl.textContent = data.first_name.charAt(0).toUpperCase() + data.first_name.slice(1); }
    if (data.raven_id) { const status = document.getElementById('raven-id-status'); if (status) { status.style.color = 'var(--green)'; status.textContent = '✓ @' + data.raven_id + ' is active and ready to share'; } }
  } catch(e) { showToast('Error saving settings', 'error'); }
  btn.textContent = '💾 Save Settings'; btn.disabled = false;
}

// ─── PRIVACY SETTINGS ─────────────────────────────────────────────────────────

const PRIVACY_DEFAULTS = { appear_offline:false, push_notif:false, payment_alerts:true, email_marketing:false, sms_reminders:true, discoverable:true, analytics:true };

function getPrivacySettings() {
  try { return { ...PRIVACY_DEFAULTS, ...JSON.parse(localStorage.getItem('raven_privacy')||'{}') }; }
  catch(e) { return { ...PRIVACY_DEFAULTS }; }
}

function setPrivacyToggle(key, value) {
  const id = key.replace(/_/g, '-');
  const cb    = document.getElementById('priv-' + id);
  const track = document.getElementById('toggle-priv-' + id);
  const knob  = document.getElementById('knob-priv-' + id);
  if (!cb) return;
  cb.checked = value;
  if (track) track.style.background = value ? 'var(--green)' : 'var(--dark3)';
  if (knob)  { knob.style.left = value ? '24px' : '3px'; knob.style.background = value ? '#fff' : 'var(--muted)'; }
}

function loadPrivacyToggles() {
  const priv = getPrivacySettings();
  Object.keys(PRIVACY_DEFAULTS).forEach(key => setPrivacyToggle(key, priv[key]));
}

async function savePrivacySetting(key, value) {
  setPrivacyToggle(key, value);
  const priv = getPrivacySettings();
  priv[key] = value;
  localStorage.setItem('raven_privacy', JSON.stringify(priv));
  if (key === 'appear_offline') {
    try {
      const updates = { appear_offline: value };
      if (value) updates.last_seen = null;
      await db.from('profiles').update(updates).eq('id', currentUser.id);
    } catch(e) {}
    if (value) { if (_presenceInterval) { clearInterval(_presenceInterval); _presenceInterval = null; } }
    else { startPresence(); }
    return;
  }
  try { await db.from('profiles').upsert({ id: currentUser.id, ['privacy_'+key]: value, updated_at: new Date().toISOString() }, { onConflict:'id' }); } catch(e) {}
}

async function handlePushNotifToggle(value) {
  if (value && 'Notification' in window) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { setPrivacyToggle('push_notif', false); showToast('Notifications blocked — allow in browser settings', 'error'); return; }
  }
  await savePrivacySetting('push_notif', value);
}

// ─── PWA INSTALL ──────────────────────────────────────────────────────────────

let _pwaInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _pwaInstallPrompt = e;
  setupPwaInstallCard();
});

window.addEventListener('appinstalled', () => {
  const card = document.getElementById('pwa-install-card');
  if (card) card.style.display = 'none';
  _pwaInstallPrompt = null;
});

function _isRunningAsPwa() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function _isIosSafari() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function setupPwaInstallCard() {
  const card = document.getElementById('pwa-install-card');
  if (!card) return;
  if (_isRunningAsPwa()) { card.style.display = 'none'; return; }

  if (_pwaInstallPrompt) {
    // Chrome / Android — native prompt available
    card.style.display = 'block';
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'block';
    const hint = document.getElementById('pwa-ios-hint');
    if (hint) hint.style.display = 'none';
  } else if (_isIosSafari()) {
    // iOS Safari — show manual step-by-step instructions
    card.style.display = 'block';
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
    const hint = document.getElementById('pwa-ios-hint');
    if (hint) hint.style.display = 'block';
  }
  // Desktop / unsupported — keep hidden
}

async function triggerPwaInstall() {
  if (!_pwaInstallPrompt) return;
  _pwaInstallPrompt.prompt();
  const { outcome } = await _pwaInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    showToast('🪶 RAVEN added to your home screen!', 'success');
    const card = document.getElementById('pwa-install-card');
    if (card) card.style.display = 'none';
    _pwaInstallPrompt = null;
  }
}

const billUrlMap = {};

async function viewBillPage(billId) {
  if (billUrlMap[billId]) { window.location.href = billUrlMap[billId]; return; }
  const { data: bill } = await db.from('bills').select('share_token').eq('id', billId).single();
  const token = bill?.share_token ? '?t=' + bill.share_token : '';
  let url = FRONTEND + '/bill/' + billId + token;
  try { const profile = JSON.parse(localStorage.getItem('raven_profile') || '{}'); if (profile.first_name) url += (token ? '&' : '?') + 'name=' + encodeURIComponent(profile.first_name); } catch(e) {}
  window.location.href = url;
}

async function handleLogout() { localStorage.removeItem('raven_profile'); await db.auth.signOut(); window.location.href = 'index.html'; }

function showAuth() { document.getElementById('auth-screen').style.display = 'flex'; document.getElementById('dashboard-screen').style.display = 'none'; }

async function showDashboard() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('dashboard-screen').style.display = 'block';
  window.scrollTo(0,0);
  document.getElementById('sidebar-avatar').textContent = currentUser.email[0].toUpperCase();
  const mobAvatar = document.getElementById('mob-user-avatar');
  if (mobAvatar) mobAvatar.textContent = currentUser.email[0].toUpperCase();
  const mobQN = document.getElementById('mob-quick-nav');
  if (mobQN && window.innerWidth <= 768) mobQN.style.display = 'block';

  // Identify user in PostHog for analytics
  try { if (typeof posthog !== 'undefined') posthog.identify(currentUser.id, { email: currentUser.email }); } catch(e) {}

  // Always fetch full profile from DB on load — avatar_url may not be in localStorage
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    // Show cached avatar immediately while we fetch
    if (local.avatar_url) renderAvatar(local.avatar_url, local.first_name);

    // Fetch profile — use select('*') to avoid 400 if specific columns don't exist yet
    const { data: profile, error: profErr } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    if (!profErr && profile) {
      const firstName = profile.first_name || local.first_name || '';
      const avatarUrl = profile.avatar_url || local.avatar_url || '';
      // Update localStorage with latest
      const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
      localStorage.setItem('raven_profile', JSON.stringify({ ...existing, first_name: firstName, avatar_url: avatarUrl, user_id: currentUser.id }));
      // Render avatar
      if (avatarUrl) renderAvatar(avatarUrl, firstName);
      else if (firstName) renderAvatar(null, firstName);
      // Set greeting and sidebar
      if (firstName) {
        const fn = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        const greetingEl = document.getElementById('greeting-name');
        if (greetingEl) greetingEl.textContent = fn;
        const sidebarName = document.getElementById('sidebar-name');
        if (sidebarName) sidebarName.textContent = fn + ' (me)';
        if (!avatarUrl) {
          document.getElementById('sidebar-avatar').textContent = firstName[0].toUpperCase();
          if (mobAvatar) mobAvatar.textContent = firstName[0].toUpperCase();
        }
      } else {
        const greetingEl = document.getElementById('greeting-name');
        if (greetingEl) greetingEl.closest('h1').innerHTML = 'Welcome Back <span style="color:var(--green)" class="raven-r-mark"></span>';
      }
    } else {
      // No profile yet — fall back to localStorage
      const firstName = local.first_name || '';
      if (local.avatar_url) renderAvatar(local.avatar_url, firstName);
      else if (firstName) renderAvatar(null, firstName);
      const greetingEl = document.getElementById('greeting-name');
      if (firstName && greetingEl) greetingEl.textContent = firstName.charAt(0).toUpperCase() + firstName.slice(1);
      else if (greetingEl) greetingEl.closest('h1').innerHTML = 'Welcome Back <span style="color:var(--green)" class="raven-r-mark"></span>';
    }
  } catch(e) {
    // Fallback — just use email initial
    const greetingEl = document.getElementById('greeting-name');
    if (greetingEl) greetingEl.closest('h1').innerHTML = 'Welcome Back <span style="color:var(--green)" class="raven-r-mark"></span>';
  }
  loadAllData();
  // Check pending friend requests for notification badges
  setTimeout(() => { try { loadFriendRequests(); } catch(e) {} }, 1500);
  setTimeout(() => { try { refreshNotifBadge(); } catch(e) {} }, 2500);
  setTimeout(() => { try { startDMPolling(); } catch(e) {} }, 2000);
  setTimeout(() => { try { startPresence(); } catch(e) {} }, 3000);

  // Handle ?add=ravenId deep link — auto-navigate to Friends and send request
  const dmParams = new URLSearchParams(window.location.search);
  const pendingDmFriendId = (dmParams.get('dm_friend') || '').trim();
  const pendingDmName = (dmParams.get('dm_name') || '').trim();
  const pendingDmRavenId = (dmParams.get('dm_raven_id') || '').trim();
  if (pendingDmFriendId) {
    setTimeout(async () => {
      try {
        showPage('friends');
        setMobNav('mob-settings');
        await loadFriendsPage();
        let profile = null;
        const { data: profileById } = await db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url,venmo,cashapp,applepay').eq('id', pendingDmFriendId).maybeSingle();
        profile = profileById || null;
        if (!profile && pendingDmRavenId) {
          const { data: profileByRid } = await db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url,venmo,cashapp,applepay').eq('raven_id', pendingDmRavenId.toLowerCase()).maybeSingle();
          profile = profileByRid || null;
        }
        const friendName = profile
          ? ([profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.raven_id || pendingDmName || 'Message')
          : (pendingDmName || pendingDmRavenId || 'Message');
        const friendId = profile?.id || pendingDmFriendId;
        if (friendId) openDirectMessage(friendId, friendName, profile || {});
      } catch (e) {
        console.log('auto-open dm error:', e);
      } finally {
        const clean = new URL(window.location.href);
        clean.searchParams.delete('dm_friend');
        clean.searchParams.delete('dm_name');
        clean.searchParams.delete('dm_raven_id');
        history.replaceState(null, '', clean.toString());
      }
    }, 700);
  }

  const pendingAdd = sessionStorage.getItem('pending_add_friend');
  if (pendingAdd) {
    sessionStorage.removeItem('pending_add_friend');
    setTimeout(async () => {
      showPage('friends');
      setMobNav('mob-settings');
      await loadFriendsPage();
      // Search for the raven ID and auto-send request
      try {
        const { data: profiles } = await db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url').eq('raven_id', pendingAdd.toLowerCase()).limit(1);
        if (profiles && profiles.length > 0) {
          const p = profiles[0];
          const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.raven_id;
          // Check not already friends
          const { data: existing } = await db.from('raven_friends').select('id,status').or('user_id.eq.'+currentUser.id+',friend_id.eq.'+currentUser.id).eq('friend_id', p.id).maybeSingle();
          if (existing?.status === 'accepted') {
            showToast('You\'re already friends with ' + name + '!', 'success');
          } else if (existing?.status === 'pending') {
            showToast('Friend request to ' + name + ' is already pending', 'success');
          } else {
            await db.from('raven_friends').insert({ user_id: currentUser.id, friend_id: p.id, status: 'pending' });
            showToast('Friend request sent to ' + name + ' 🎉', 'success');
          }
          await loadFriendsList();
        } else {
          showToast('@' + pendingAdd + ' not found — they may need to sign up first', 'error');
          document.getElementById('friend-search-input').value = pendingAdd;
        }
      } catch(e) { console.log('auto-add friend error:', e); }
    }, 1000);
  }
}

function showPage(page) {
  if (typeof posthog !== 'undefined') posthog.capture('page_view', { page });
  // Hide all pages, show only the target
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById('page-' + page);
  if (!targetPage) { console.warn('showPage: no element for page-' + page); return; }
  targetPage.classList.add('active');
  // Scroll to top — handle fixed sidebar layout
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.scrollTop = 0;
  // Highlight sidebar nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => {
    if ((n.getAttribute('onclick') || '').includes("showPage('" + page + "')")) n.classList.add('active');
  });
  // Mobile bottom nav highlight — Rooms stays under More (mob-settings)
  const mobMap = {
    'overview':     'mob-overview',
    'active-bills': 'mob-bills',
    'create-bill':  'mob-create',
    'trip-hub':     'mob-trip',
    'settings':     'mob-settings',
    'roommates':    'mob-settings',
    'friends':      'mob-settings',
    'history':      'mob-settings',
    'notifications':'mob-settings',
    'invite':       'mob-settings'
  };
  if (mobMap[page]) setMobNav(mobMap[page]);
  // Load data for the page
  if (page === 'active-bills')  loadActiveBills();
  if (page === 'history')       loadHistory();
  if (page === 'settings')      loadSettings();
  if (page === 'notifications') loadNotifications();
  if (page === 'invite')        loadInvitePage();
  if (page === 'trip-hub')      loadTrips();
  if (page === 'roommates')     loadHouses();
  if (page === 'friends')       loadFriendsPage();
}

async function loadAllData() {
  loadOverview().catch(e=>console.warn(e));
  loadActiveBills().catch(e=>console.warn(e));
}

async function loadOverview() {
  const [bR,pR]=await Promise.all([db.from('bills').select('*,participants(*)').eq('creator_phone',currentUser.email).neq('status','deleted').order('created_at',{ascending:false}),db.from('participants').select('bill_id').eq('phone',currentUser.email)]);
  const{data:myBills}=bR;const{data:partRows}=pR;
  // Fetch participant bills (where I'm listed but not creator)
  const partBillIds = (partRows || []).map(r => r.bill_id).filter(id => !(myBills || []).find(b => b.id === id));
  let partBills = [];
  if (partBillIds.length > 0) {
    const { data } = await db.from('bills').select('*, participants(*)').in('id', partBillIds).neq('status', 'deleted').order('created_at', { ascending: false });
    partBills = data || [];
  }
  const bills = [...(myBills || []), ...partBills].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  // Augment participant counts with QR guests from item_selections
  await augmentBillsWithGuests(bills);
  if (!bills.length) {
    document.getElementById('stat-active').textContent = '0';
    const _ow=document.getElementById('stat-owed'); if(_ow){_ow.textContent='—';_ow.style.color='var(--muted)';}
    const _co=document.getElementById('stat-collected'); if(_co)_co.style.display='none';
    const _ce=document.getElementById('stat-collected-empty'); if(_ce){_ce.style.display='';_ce.textContent='—';}
    document.getElementById('stat-settled').textContent = '0';
    document.getElementById('active-count').textContent = '0';
    document.getElementById('overview-bills').innerHTML = '<div class="empty-state"><span class="empty-icon raven-r-mark" style="font-size:0"></span><div class="empty-title">No bills yet</div><div class="empty-sub">Create your first bill to get started</div></div>';
    return;
  }
  // Auto-complete bills where all participants have paid
  for (const b of bills) {
    if (b.status === 'active' && b.participants?.length > 0 && b.participants.every(p => p.paid)) {
      await db.from('bills').update({ status: 'completed' }).eq('id', b.id);
      b.status = 'completed';
    }
  }
  const active = bills.filter(b => b.status === 'active');
  const completed = bills.filter(b => b.status === 'completed');
  // Only count active bills for owed/collectible stats
  let totalOwed = 0, totalCollectible = 0;
  active.forEach(b => {
    const isCreator = b.creator_phone === currentUser.email;
    b.participants?.forEach(p => {
      // TOTAL OWED BY YOU: only rows where you are the participant and you haven't paid yet
      if (!p.paid && p.phone === currentUser.email) {
        totalOwed += parseFloat(p.amount || 0);
      }
      // YOU'RE OWED: only bills you created, and only what other people still owe you
      // Exclude the payer/creator row itself (amount=0 when they paid the bill)
      if (isCreator && !p.paid && p.phone !== currentUser.email && parseFloat(p.amount || 0) > 0) {
        totalCollectible += parseFloat(p.amount || 0);
      }
    });
  });
  document.getElementById('stat-active').textContent = active.length;
  // Show owed only if > 0
  const owedEl = document.getElementById('stat-owed');
  const owedSub = document.getElementById('stat-owed-sub');
  if (totalOwed > 0) {
    owedEl.textContent = '$' + totalOwed.toFixed(2); owedEl.style.display = '';
    if (owedSub) owedSub.style.display = '';
  } else {
    owedEl.textContent = '—'; owedEl.style.color = 'var(--muted)'; owedEl.style.display = '';
    if (owedSub) owedSub.style.display = 'none';
  }
  // Show collectible only if > 0
  const collEl = document.getElementById('stat-collected');
  const collSub = document.getElementById('stat-collected-sub');
  const collEmpty = document.getElementById('stat-collected-empty');
  if (totalCollectible > 0) {
    if (collEl) { collEl.textContent = '$' + totalCollectible.toFixed(2); collEl.style.display = ''; }
    if (collSub) collSub.style.display = '';
    if (collEmpty) collEmpty.style.display = 'none';
  } else {
    if (collEl) collEl.style.display = 'none';
    if (collSub) collSub.style.display = 'none';
    if (collEmpty) { collEmpty.style.display = ''; collEmpty.textContent = '—'; }
  }
  document.getElementById('stat-settled').textContent = completed.length;
  document.getElementById('active-count').textContent = active.length;
  const container = document.getElementById('overview-bills');
  // Overview shows only active bills (including shared/member bills) — completed/deleted go to History
  const activeBillsForOverview = bills.filter(b => b.status === 'active');
  container.innerHTML = activeBillsForOverview.length > 0
    ? activeBillsForOverview.slice(0, 6).map(b => renderBillCard(b)).join('')
    : '<div class="empty-state"><span class="empty-icon empty-icon-svg"><svg class="raven-icon empty"><use href="#icon-overview"></use></svg></span><div class="empty-title">All settled up!</div><div class="empty-sub">No active bills right now. <a href="#" onclick="showPage(\'create-bill\')" style="color:var(--green)">Create one →</a></div></div>';
}

async function loadActiveBills() {
  const [{ data: myBills }, { data: partRows }] = await Promise.all([
    db.from('bills').select('*, participants(*)').eq('creator_phone', currentUser.email).eq('status', 'active').order('created_at', { ascending: false }),
    db.from('participants').select('bill_id').eq('phone', currentUser.email)
  ]);
  const partBillIds = (partRows || []).map(r => r.bill_id).filter(id => !(myBills || []).find(b => b.id === id));
  let partBills = [];
  if (partBillIds.length > 0) {
    const { data } = await db.from('bills').select('*, participants(*)').in('id', partBillIds).eq('status', 'active').order('created_at', { ascending: false });
    partBills = data || [];
  }
  const bills = [...(myBills || []), ...partBills].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  await augmentBillsWithGuests(bills);
  const container = document.getElementById('active-bills-list');
  if (bills.length === 0) { container.innerHTML = '<div class="empty-state"><span class="empty-icon empty-icon-svg"><svg class="raven-icon empty"><use href="#icon-active-bills"></use></svg></span><div class="empty-title">No active bills</div><div class="empty-sub">Create a bill to start splitting</div></div>'; return; }
  container.innerHTML = bills.map(b => renderBillCard(b)).join('');
}

// Shared helper: fetch item_selections and augment bills with QR guest participants
async function augmentBillsWithGuests(bills) {
  if (!bills || bills.length === 0) return;
  try {
    const billIds = bills.map(b => b.id);
    const { data: selRows } = await db.from('item_selections').select('bill_id,participant_name').in('bill_id', billIds);
    if (!selRows || selRows.length === 0) {
      bills.forEach(b => { b.participants = dedupeBillPreviewParticipants(b.participants || []); });
      return;
    }
    const selByBill = {};
    selRows.forEach(s => { if (!selByBill[s.bill_id]) selByBill[s.bill_id] = new Set(); selByBill[s.bill_id].add(billPreviewParticipantKey(s.participant_name)); });
    bills.forEach(b => {
      const existingNames = new Set((b.participants || []).map(p => billPreviewParticipantKey(p.name)));
      const selNames = selByBill[b.id] || new Set();
      selNames.forEach(n => {
        if (!existingNames.has(n)) {
          b.participants = b.participants || [];
          b.participants.push({ id: 'guest-' + n, name: canonicalBillPreviewName([n]), amount: 0, paid: false });
        }
      });
      b.participants = dedupeBillPreviewParticipants(b.participants || []);
    });
  } catch(e) {}
}

async function loadHistory() {
  const [{ data: myBills }, { data: partRows }] = await Promise.all([
    db.from('bills').select('*, participants(*)').eq('creator_phone', currentUser.email).order('created_at', { ascending: false }),
    db.from('participants').select('bill_id').eq('phone', currentUser.email)
  ]);
  const partBillIds = (partRows || []).map(r => r.bill_id).filter(id => !(myBills || []).find(b => b.id === id));
  let partBills = [];
  if (partBillIds.length > 0) {
    const { data } = await db.from('bills').select('*, participants(*)').in('id', partBillIds).order('created_at', { ascending: false });
    partBills = data || [];
  }
  const bills = [...(myBills || []), ...partBills].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  const container = document.getElementById('history-content');
  if (bills.length === 0) { container.innerHTML = '<div class="empty-state"><span class="empty-icon empty-icon-svg"><svg class="raven-icon empty"><use href="#icon-history"></use></svg></span><div class="empty-title">No history yet</div></div>'; return; }
  container.innerHTML = '<table class="history-table"><thead><tr><th>Bill</th><th>Total</th><th>People</th><th>Collected</th><th>Status</th><th>Date</th></tr></thead><tbody>' + bills.map(b => {
    const parts = dedupeBillPreviewParticipants(b.participants || []);
    const paid = parts.filter(p => p.paid).length || 0;
    const total = Math.max(parts.length || 0, b.live_people_count || 0);
    const collected = parts.filter(p => p.paid).reduce((s, p) => s + parseFloat(p.amount || 0), 0) || 0;
    const date = new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const isCreator = b.creator_phone === currentUser.email;
    return '<tr style="cursor:pointer"><td onclick="openBillModal(\'' + b.id + '\')">' + b.name + (isCreator ? '' : ' <span style="font-size:10px;color:var(--muted);background:var(--dark2);padding:2px 6px;border-radius:4px;vertical-align:middle">shared</span>') + '</td><td onclick="openBillModal(\'' + b.id + '\')">$' + parseFloat(b.total).toFixed(2) + '</td><td onclick="openBillModal(\'' + b.id + '\')">'+total+' people</td><td onclick="openBillModal(\'' + b.id + '\')" style="color:var(--green)">$' + collected.toFixed(2) + '</td><td><span class="status-badge ' + (b.status === 'active' ? 'status-active' : 'status-completed') + '">' + (b.status === 'active' ? '● Active' : b.status === 'deleted' ? '✕ Deleted' : '✓ Done') + '</span></td><td onclick="openBillModal(\'' + b.id + '\')">' + date + '</td></tr>';
  }).join('') + '</tbody></table>';
}

function renderBillCard(b) {
  const parts = dedupeBillPreviewParticipants(b.participants || []);
  const paidByKey = billPreviewParticipantKey(b.paid_by || '');
  const paid = parts.filter(p => {
    const isBillPayer = paidByKey && billPreviewParticipantKey(p.name) === paidByKey;
    return p.paid || isBillPayer;
  }).length || 0;
  // Use live_people_count as a floor — QR joiners may not be in participants yet
  const total = Math.max(parts.length || 0, b.live_people_count || 0);
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const isCreator = b.creator_phone === currentUser.email;
  // For creator bills: owed = what others haven't paid yet
  // For shared/member bills: owed = only what YOU owe
  const myParticipantRow = parts.find(p => p.phone === currentUser.email);
  const owed = isCreator
    ? (parts.filter(p => !p.paid && p.phone !== currentUser.email).reduce((s, p) => s + parseFloat(p.amount || 0), 0) || 0)
    : (myParticipantRow && !myParticipantRow.paid ? parseFloat(myParticipantRow.amount || 0) : 0);
  const isFullyPaid = owed === 0 && total > 0;
  let billUrl = FRONTEND + '/bill/' + b.id + (b.share_token ? '?t=' + b.share_token : '');
  try { const profile = JSON.parse(localStorage.getItem('raven_profile') || '{}'); if (profile.first_name) billUrl += (b.share_token ? '&' : '?') + 'name=' + encodeURIComponent(profile.first_name); } catch(e) {}
  billUrlMap[b.id] = billUrl;
  const owedDisplay = isFullyPaid
    ? '<span style="color:var(--green);font-weight:700">✓ All paid</span>'
    : '<span style="color:var(--orange)">$' + owed.toFixed(2) + ' owed</span>';
  const sharedBadge = !isCreator ? '<span style="font-size:10px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.2);color:var(--purple3);padding:2px 7px;border-radius:6px;vertical-align:middle;margin-left:6px">shared</span>' : '';
  return '<div class="bill-card" onclick="openBillModal(\'' + b.id + '\')">' +
    '<div><div class="bill-name">' + b.name + sharedBadge + ' <span class="bill-id">' + b.id + '</span></div><div class="bill-meta"><span>' + total + ' people</span><span>' + paid + '/' + total + ' paid</span>' + owedDisplay + '</div></div>' +
    '<div class="bill-amount" style="color:' + (isFullyPaid ? 'var(--green)' : 'var(--white)') + '">$' + parseFloat(b.total).toFixed(2) + '</div>' +
    '<div class="bill-progress-wrap"><div class="bill-progress-label">' + pct + '% paid</div><div class="bill-progress"><div class="bill-progress-fill" style="width:' + pct + '%;background:' + (isFullyPaid ? 'var(--green)' : 'var(--purple)') + '"></div></div></div>' +
    '<div class="bill-actions" onclick="event.stopPropagation()">' +
    (isCreator ? '<button class="bill-action-btn btn-remind" onclick="sendReminder(\'' + b.id + '\')">🔔 Remind</button>' : '') +
    '<button class="bill-action-btn" onclick="shareBillLink(\'' + b.id + '\',\'' + (b.name||'').replace(/'/g,"\\'") + '\',\'' + (b.share_token||'') + '\')" style="background:rgba(0,140,255,0.1);border:1px solid rgba(0,140,255,0.2);color:#4DB8FF">📤 Share</button>' +
    '<a class="bill-action-btn btn-view" href="' + billUrl + '" style="display:inline-flex;align-items:center;text-decoration:none">View →</a>' +
    '</div></div>';
}

function generateId() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }

function buildRavenPaymentMessage(amount, contextName, methodLabel) {
  const cleanAmount = parseFloat(amount || 0).toFixed(2);
  const cleanContext = String(contextName || 'your bill').trim();
  return 'Sending $' + cleanAmount + ' via RAVEN' + (methodLabel ? ' on ' + methodLabel : '') + ' for ' + cleanContext;
}

function buildZellePaymentHref(target, amount, contextName) {
  const value = String(target || '').trim();
  const message = buildRavenPaymentMessage(amount, contextName, 'Zelle');
  if (!value) return null;
  if (value.includes('@')) {
    return 'mailto:' + encodeURIComponent(value) + '?subject=' + encodeURIComponent('RAVEN payment') + '&body=' + encodeURIComponent(message);
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 7) {
    const e164 = digits.length === 10 ? '+1' + digits : (digits[0] === '1' ? '+' + digits : '+' + digits);
    return 'sms:' + e164 + '&body=' + encodeURIComponent(message);
  }
  return null;
}

function buildApplePayHref(target, amount, contextName) {
  const value = String(target || '').trim();
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const e164 = digits.length === 10 ? '+1' + digits : (digits[0] === '1' ? '+' + digits : '+' + digits);
  return 'sms:' + e164;
}

function paymentMethodCount(profile) {
  if (!profile) return 0;
  return ['venmo', 'cashapp', 'zelle', 'applepay'].reduce((count, key) => count + (profile[key] ? 1 : 0), 0);
}

function chooseBestPaymentProfile(profiles, preferredName) {
  const list = (profiles || []).filter(Boolean);
  if (!list.length) return null;
  const normalizedPreferred = String(preferredName || '').trim().toLowerCase();
  return list.slice().sort((a, b) => {
    const aExact = String(a.first_name || '').trim().toLowerCase() === normalizedPreferred ? 1 : 0;
    const bExact = String(b.first_name || '').trim().toLowerCase() === normalizedPreferred ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aMethods = paymentMethodCount(a);
    const bMethods = paymentMethodCount(b);
    if (aMethods !== bMethods) return bMethods - aMethods;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  })[0];
}

function normalizeBillPreviewParticipantName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function billPreviewParticipantKey(name) {
  return normalizeBillPreviewParticipantName(name).toLowerCase();
}

function canonicalBillPreviewName(names) {
  const clean = (names || []).map(normalizeBillPreviewParticipantName).filter(Boolean);
  if (!clean.length) return '';
  const titled = clean.find(n => /[A-Z]/.test(n.charAt(0)));
  if (titled) return titled;
  return clean[0].split(' ').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
}

function dedupeBillPreviewParticipants(parts) {
  const map = {};
  (parts || []).forEach(p => {
    const key = billPreviewParticipantKey(p.name);
    if (!key) return;
    if (!map[key]) {
      map[key] = { ...p, _sourceNames: [p.name], _dupeIds: p.id ? [p.id] : [] };
      return;
    }
    const existing = map[key];
    existing._sourceNames.push(p.name);
    if (p.id) existing._dupeIds.push(p.id);
    const existingAmt = parseFloat(existing.amount || 0);
    const nextAmt = parseFloat(p.amount || 0);
    if ((String(existing.phone || '').startsWith('unknown_') && !String(p.phone || '').startsWith('unknown_')) || nextAmt > existingAmt || (!!p.paid && !existing.paid)) {
      map[key] = { ...existing, ...p, _sourceNames: existing._sourceNames, _dupeIds: existing._dupeIds };
    } else {
      existing.amount = Math.max(existingAmt, nextAmt);
      existing.paid = existing.paid || p.paid;
      existing.payment_method = existing.payment_method || p.payment_method;
    }
  });
  return Object.values(map).map(p => ({ ...p, name: canonicalBillPreviewName(p._sourceNames || [p.name]) }));
}

async function cleanupBillPreviewDuplicates(billId, parts) {
  const deduped = dedupeBillPreviewParticipants(parts);
  for (const person of deduped) {
    const ids = [...new Set(person._dupeIds || [])];
    if (ids.length > 1) {
      const keepId = person.id;
      const deleteIds = ids.filter(id => id !== keepId);
      if (deleteIds.length) await db.from('participants').delete().in('id', deleteIds);
    }
    if (person.id) {
      await db.from('participants').update({
        name: person.name,
        amount: parseFloat(person.amount || 0),
        paid: !!person.paid,
        payment_method: person.payment_method || null
      }).eq('id', person.id);
    }
  }
  return deduped;
}

async function openBillModal(billId) {
  currentBillId = billId;
  // Fetch bill + participants. Also fetch item_selections to surface QR guests not yet flushed.
  const [billRes, selectionsRes] = await Promise.all([
    db.from('bills').select('*, participants(*)').eq('id', billId).single(),
    db.from('item_selections').select('participant_name').eq('bill_id', billId)
  ]);
  const { data: bill } = billRes;
  if (!bill) return;
  bill.participants = await cleanupBillPreviewDuplicates(billId, bill.participants || []);
  // Merge QR guest names from item_selections into participants
  const existingNames = new Set((bill.participants || []).map(p => billPreviewParticipantKey(p.name)));
  const selectionNames = [...new Set((selectionsRes.data || []).map(s => normalizeBillPreviewParticipantName(s.participant_name)).filter(Boolean))];
  const guestNames = selectionNames.filter(n => !existingNames.has(billPreviewParticipantKey(n)));
  if (guestNames.length > 0) {
    // Fetch real participant rows for these guests (populated by recalcBillAmounts on bill page)
    const { data: guestRows } = await db.from('participants').select('*').eq('bill_id', billId).in('name', guestNames);
    const guestRowMap = {};
    (guestRows || []).forEach(r => { guestRowMap[billPreviewParticipantKey(r.name)] = r; });
    guestNames.forEach(n => {
      bill.participants = bill.participants || [];
      const real = guestRowMap[billPreviewParticipantKey(n)];
      // If real row exists with amount > 0, use it; otherwise compute from item_selections
      if (real && parseFloat(real.amount || 0) > 0) {
        bill.participants.push(real);
      } else {
        // Compute amount from item_selections for display purposes
        const personSelections = (selectionsRes.data || []).filter(s => billPreviewParticipantKey(s.participant_name) === billPreviewParticipantKey(n));
        bill.participants.push(real || { id: 'guest-' + n, name: n, amount: 0, paid: false, _guest: true, _selCount: personSelections.length });
      }
      existingNames.add(billPreviewParticipantKey(n));
    });
  }
  bill.participants = dedupeBillPreviewParticipants(bill.participants || []);
  document.getElementById('modal-bill-name').textContent = bill.name;
  let receiptHTML = '';
  if (bill.receipt_image) receiptHTML = '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px">Receipt</div><img src="data:image/jpeg;base64,' + bill.receipt_image + '" style="width:100%;border-radius:10px;display:block"></div>';
  const receiptEl = document.getElementById('modal-receipt');
  if (receiptEl) receiptEl.innerHTML = receiptHTML;

  const paidByName = billPreviewParticipantKey(bill.paid_by || '');
  document.getElementById('modal-bill-meta').textContent = 'ID: ' + bill.id + '  ·  Total: $' + parseFloat(bill.total).toFixed(2) + (bill.paid_by ? '  ·  💳 ' + bill.paid_by + ' paid' : '');

  const parts = bill.participants || [];

  // Build participant rows — three states:
  // 1. Bill payer → purple "💳 Paid the bill" badge, no action
  // 2. Non-payer who settled (p.paid=true) → green "💳 Paid" badge, no action
  // 3. Non-payer who hasn't settled (p.paid=false) → orange owed amount + Pay button
  const participantProfiles = await resolveActiveBillParticipantProfiles(parts.map(p => p.name));
  document.getElementById('modal-participants').innerHTML = parts.map(p => {
    const participantProfile = participantProfiles[p.name] || null;
    const participantAvatar = activeBillParticipantAvatar(p.name, participantProfile, 28);
    const isBillPayer = paidByName && billPreviewParticipantKey(p.name) === paidByName;
    let badge, action;
    if (isBillPayer) {
      badge = '<span class="participant-amount" style="background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);color:#C084FC;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:700">💳 Paid the bill</span>';
      action = '';
    } else if (p.paid) {
      badge = '<span class="participant-amount paid-tag">💳 Paid</span>';
      action = '';
    } else {
      const amt = parseFloat(p.amount || 0);
      if (amt > 0) {
        badge = '<span class="participant-amount owed-tag">$' + amt.toFixed(2) + ' owed</span>';
        action = '<button class="mark-paid-btn" onclick="openPayModal(\'' + p.id + '\', \'' + billId + '\', ' + amt.toFixed(2) + ')">💳 Pay</button>';
      } else if (p._selCount > 0) {
        badge = '<span style="font-size:11px;color:var(--muted)">items claimed · visit bill page</span>';
        action = '';
      } else {
        badge = '<span class="participant-amount owed-tag">$0.00 owed</span>';
        action = '<button class="mark-paid-btn" onclick="openPayModal(\'' + p.id + '\', \'' + billId + '\', 0)">💳 Pay</button>';
      }
    }
    const removeBtn = '<button class="mark-paid-btn" style="background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.2);color:#FF6B6B" onclick="removeParticipantFromBillPreview(\'' + billId + '\', \'' + String(p.name || '').replace(/'/g, "\\'") + '\')">Remove</button>';
    return '<div class="participant-row"><div style="display:flex;align-items:center;gap:10px">' + participantAvatar + '<div><div class="participant-name">@' + p.name + '</div>' +
      (p.paid && !isBillPayer && p.payment_method ? '<div style="font-size:11px;color:var(--muted);margin-top:3px">via ' + p.payment_method + '</div>' : '') +
      '</div></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end">' + badge + action + removeBtn + '</div></div>';
  }).join('');

  document.getElementById('modal-view-btn').onclick = () => viewBillPage(billId);
  document.getElementById('modal-share-btn').onclick = () => shareBillLink(billId, bill.name, bill.share_token);
  document.getElementById('modal-remind-btn').onclick = () => sendReminder(billId);
  document.getElementById('modal-delete-btn').onclick = () => deleteBill(billId);

  // Pre-fill edit panel
  const editNameEl = document.getElementById('modal-edit-name');
  if (editNameEl) editNameEl.value = bill.name || '';
  const editPaidBy = document.getElementById('modal-edit-paidby');
  if (editPaidBy) {
    editPaidBy.innerHTML = '<option value="">— Select who paid —</option>' +
      parts.map(p => '<option value="' + p.name + '"' + (paidByName === billPreviewParticipantKey(p.name) ? ' selected' : '') + '>' + p.name + '</option>').join('');
  }
  // Hide edit panel on open
  const editPanel = document.getElementById('modal-edit-panel');
  if (editPanel) editPanel.style.display = 'none';

  // Add person toggle
  const addPanel = document.getElementById('modal-add-person-panel');
  const addBtn   = document.getElementById('modal-add-person-btn');
  if (addPanel) addPanel.style.display = 'none';
  if (addBtn)   addBtn.onclick = () => { if (addPanel) addPanel.style.display = addPanel.style.display === 'none' ? 'block' : 'none'; };
  const addSubmit = document.getElementById('modal-add-person-btn-submit');
  if (addSubmit) addSubmit.onclick = () => addPersonToBill(billId, bill);
  const addInput = document.getElementById('modal-add-person-input');
  if (addInput) { addInput.value = ''; addInput.onkeydown = e => { if (e.key === 'Enter') addPersonToBill(billId, bill); }; }
  document.getElementById('bill-modal').classList.add('open');
}

function toggleBillEditPanel() {
  const panel = document.getElementById('modal-edit-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function saveBillEdits() {
  if (!currentBillId) return;
  const newName = document.getElementById('modal-edit-name')?.value.trim();
  const newPaidBy = document.getElementById('modal-edit-paidby')?.value || null;
  if (!newName) return showToast('Bill name cannot be empty', 'error');

  // Fetch current bill to check if paid_by actually changed
  const { data: currentBill } = await db.from('bills').select('paid_by').eq('id', currentBillId).single();
  const payerChanged = (currentBill?.paid_by || '').toLowerCase() !== (newPaidBy || '').toLowerCase();

  const { error } = await db.from('bills').update({ name: newName, paid_by: newPaidBy || null }).eq('id', currentBillId);
  if (error) return showToast('Error: ' + error.message, 'error');

  // If the bill payer changed, reset paid=false for everyone who isn't the new payer
  // so they get a fresh Pay button pointing to the correct person
  if (payerChanged && newPaidBy) {
    try {
      const { data: parts } = await db.from('participants').select('id, name').eq('bill_id', currentBillId);
      if (parts) {
        const toReset = parts.filter(p => p.name.toLowerCase() !== newPaidBy.toLowerCase()).map(p => p.id);
        if (toReset.length > 0) {
          await db.from('participants').update({ paid: false, paid_at: null, payment_method: null }).in('id', toReset);
        }
      }
    } catch(e) {}
  }

  showToast('✅ Bill updated!', 'success');
  toggleBillEditPanel();
  openBillModal(currentBillId);
  loadAllData();
}

async function addPersonToBill(billId, bill) {
  const input = document.getElementById('modal-add-person-input');
  const raw = input?.value.trim();
  if (!raw) return showToast('Enter a name or @RavenID', 'error');
  const btn = document.getElementById('modal-add-person-btn-submit');
  btn.textContent = 'Adding...'; btn.disabled = true;

  // Figure out how much this person owes — use per_person from bill
  const perPerson = parseFloat(bill.per_person || 0) || (bill.participants?.length > 0 ? parseFloat(bill.total) / (bill.participants.length + 1) : parseFloat(bill.total));
  let personEmail = null;
  let personName = raw.replace(/^@/, '');

  // Try to find by Raven ID
  const query = raw.startsWith('@') ? raw.slice(1) : raw;
  try {
    const { data: profile } = await db.from('profiles').select('id,first_name,email,raven_id').or('raven_id.eq.' + query.toLowerCase() + ',first_name.ilike.' + query).maybeSingle();
    if (profile) {
      personEmail = profile.email;
      personName = profile.first_name || profile.raven_id || personName;
    }
  } catch(e) {}

  // Check not already on bill
  const alreadyOn = (bill.participants || []).some(p => p.name.toLowerCase() === personName.toLowerCase());
  if (alreadyOn) { showToast(personName + ' is already on this bill', 'error'); btn.textContent = 'Add'; btn.disabled = false; return; }

  const { error } = await db.from('participants').insert({
    bill_id: billId,
    phone: personEmail || ('unknown_' + personName.toLowerCase().replace(/\s+/g,'_') + '_' + billId),
    name: personName,
    amount: perPerson,
    paid: false
  });

  btn.textContent = 'Add'; btn.disabled = false;
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  if (input) input.value = '';
  showToast('✅ ' + personName + ' added to bill' + (personEmail ? ' — will see it on their dashboard' : ''), 'success');
  openBillModal(billId); // refresh
}

async function addPersonToBill(billId, bill) {
  const input = document.getElementById('modal-add-person-input');
  const raw = input?.value.trim();
  if (!raw) return showToast('Enter a name or @RavenID', 'error');
  const btn = document.getElementById('modal-add-person-btn-submit');
  btn.textContent = 'Adding...';
  btn.disabled = true;
  try {
    await addPersonToExistingBill(bill, raw);
    if (input) input.value = '';
    openBillModal(billId);
  } catch(e) {
    showToast('Error: ' + (e.message || 'Could not add person'), 'error');
  } finally {
    btn.textContent = 'Add';
    btn.disabled = false;
  }
}

async function removeParticipantFromBillPreview(billId, participantName) {
  const cleanName = normalizeBillPreviewParticipantName(participantName);
  if (!cleanName) return;
  const key = billPreviewParticipantKey(cleanName);
  const confirmKey = 'bill_remove_confirm_' + billId + '_' + key;
  const now = Date.now();
  const lastTap = parseInt(sessionStorage.getItem(confirmKey) || '0', 10);
  if (!lastTap || (now - lastTap) > 3000) {
    sessionStorage.setItem(confirmKey, String(now));
    showToast('Tap remove again to delete ' + cleanName, 'error');
    return;
  }
  sessionStorage.removeItem(confirmKey);
  try {
    const { data: partRows } = await db.from('participants').select('id,name').eq('bill_id', billId);
    const idsToDelete = (partRows || []).filter(p => billPreviewParticipantKey(p.name) === key).map(p => p.id);
    if (idsToDelete.length) {
      await db.from('participants').delete().in('id', idsToDelete);
    }
    const { data: selRows } = await db.from('item_selections').select('id,participant_name').eq('bill_id', billId);
    const selIds = (selRows || []).filter(s => billPreviewParticipantKey(s.participant_name) === key).map(s => s.id);
    if (selIds.length) {
      await db.from('item_selections').delete().in('id', selIds);
    }
    const { data: bill } = await db.from('bills').select('paid_by').eq('id', billId).single();
    if (bill?.paid_by && billPreviewParticipantKey(bill.paid_by) === key) {
      await db.from('bills').update({ paid_by: null }).eq('id', billId);
    }
    showToast(cleanName + ' removed from this bill', 'success');
    await openBillModal(billId);
    loadAllData();
  } catch(e) {
    showToast('Could not remove ' + cleanName, 'error');
  }
}

function closeBillModal() { document.getElementById('bill-modal').classList.remove('open'); currentBillId = null; }

async function shareBillLink(billId, billName, shareToken) {
  const url = FRONTEND + '/bill/' + billId + (shareToken ? '?t=' + shareToken : '');
  const myName = (() => { try { return JSON.parse(localStorage.getItem('raven_profile')||'{}').first_name || 'Someone'; } catch(e) { return 'Someone'; } })();
  // Send URL alone — iMessage only generates rich preview card when URL is by itself
  const msg = myName + ' wants to split "' + (billName||'a bill') + '" with you on RAVEN 🪶\nSplit bills free with RAVEN | ravensplit.com';
  if (navigator.share) {
    try {
      // Share URL separately as the url param — iMessage renders it as its own rich bubble
      await navigator.share({ title: msg, url: url });
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); showToast('📋 Bill link copied!', 'success'); }
  catch(e) { prompt('Copy this link:', url); }
}

async function shareTripLink(tripId) {
  const trip = tripDataMap[tripId];
  if (!trip) return showToast('Trip not found', 'error');
  const url = FRONTEND + '/trip/' + tripId + '?t=' + trip.share_token;
  const myName = (() => { try { return JSON.parse(localStorage.getItem('raven_profile')||'{}').first_name || 'Someone'; } catch(e) { return 'Someone'; } })();
  const titleMsg = myName + ' invited you to join "' + trip.name + '" on RAVEN 🪶\nSplit bills free with RAVEN | ravensplit.com';

  // If trip has a cover photo, share image file + text with URL embedded
  if (trip.cover_image && navigator.share && navigator.canShare) {
    try {
      const blob = await fetch('data:image/jpeg;base64,' + trip.cover_image).then(r => r.blob());
      const file = new File([blob], 'trip-cover.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        // iOS supports files OR url but not both — include url in text instead
        await navigator.share({ files: [file], text: titleMsg + '\n\n' + url });
        return;
      }
    } catch(e) { if (e.name !== 'AbortError') console.log('file share failed:', e); }
  }

  // Fallback — rich link card (no cover photo)
  if (navigator.share) {
    try { await navigator.share({ title: titleMsg, url: url }); return; }
    catch(e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); showToast('📋 Trip invite copied!', 'success'); }
  catch(e) { prompt('Copy this link:', url); }
}

async function markPaid(participantId, billId, method) {
  await db.from('participants').update({ paid: true, paid_at: new Date().toISOString(), ...(method ? { payment_method: method } : {}) }).eq('id', participantId);
  // Check if all participants are now paid — if so, auto-complete the bill
  const { data: bill } = await db.from('bills').select('*, participants(*)').eq('id', billId).single();
  if (bill && bill.participants?.length > 0 && bill.participants.every(p => p.paid)) {
    await db.from('bills').update({ status: 'completed' }).eq('id', billId);
    showToast('🎉 Bill fully settled!', 'success');
  } else {
    showToast('✅ Marked as paid!', 'success');
  }
  openBillModal(billId); loadAllData();
}

async function sendReminder(billId) {
  const btn = document.getElementById('modal-remind-btn');
  if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
  try {
    const res = await fetch(BACKEND + '/remind-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId, userEmail: currentUser.email })
    });
    const data = await res.json();
    if (data.message === 'Everyone has paid!') {
      showToast('🎉 Everyone has already paid!', 'success');
    } else if (data.sent > 0) {
      showToast('🔔 Reminder sent to ' + data.sent + ' person' + (data.sent > 1 ? 's' : '') + (data.skipped > 0 ? ' (' + data.skipped + ' skipped — email not confirmed)' : ''), 'success');
    } else if (data.skipped > 0) {
      showToast('⚠️ ' + data.skipped + ' person' + (data.skipped > 1 ? 's haven\'t' : ' hasn\'t') + ' confirmed their email yet — reminders not sent', 'error');
    } else {
      showToast('🔔 Reminders sent!', 'success');
    }
  } catch(e) {
    showToast('🔔 Reminder sent!', 'success');
  }
  if (btn) { btn.textContent = '🔔 Remind Unpaid'; btn.disabled = false; }
}

async function permanentDelete(billId) {
  // Two-tap confirm — no confirm() (broken on iOS)
  const btn = event?.target;
  if (!btn || btn.dataset.confirming !== '1') {
    if (btn) { btn.dataset.confirming = '1'; btn.textContent = '⚠️ Tap again to confirm'; btn.style.background = 'rgba(255,68,68,0.2)'; btn.style.borderColor = 'rgba(255,68,68,0.5)'; setTimeout(() => { if (btn.dataset.confirming==='1'){btn.dataset.confirming='';btn.textContent='🗑 Permanently Delete';btn.style.background='';btn.style.borderColor='';} }, 3000); }
    return;
  }
  await db.from('item_selections').delete().eq('bill_id', billId);
  await db.from('receipt_items').delete().eq('bill_id', billId);
  await db.from('participants').delete().eq('bill_id', billId);
  await db.from('bill_comments').delete().eq('bill_id', billId);
  await db.from('bills').delete().eq('id', billId);
  showToast('Bill permanently deleted', 'success');
  loadHistory();
}

async function deleteBill(billId) {
  // Use custom confirm — browser confirm() is unreliable on iOS Safari
  const modal = document.getElementById('bill-modal');
  const existing = document.getElementById('delete-confirm-wrap');
  if (existing) { existing.remove(); return; }

  const wrap = document.createElement('div');
  wrap.id = 'delete-confirm-wrap';
  wrap.style.cssText = 'margin-top:12px;padding:14px;background:rgba(255,68,68,0.06);border:1px solid rgba(255,68,68,0.2);border-radius:10px';
  wrap.innerHTML = '<div style="font-size:13px;font-weight:600;color:#FF6B6B;margin-bottom:10px">⚠ Delete this bill? This cannot be undone.</div>' +
    '<div style="display:flex;gap:8px">' +
    '<button id="delete-cancel-btn" style="flex:1;padding:10px;background:var(--dark2);border:1px solid var(--border);border-radius:8px;color:var(--muted);font-family:\'Epilogue\',sans-serif;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>' +
    '<button id="delete-confirm-btn" style="flex:1;padding:10px;background:rgba(255,68,68,0.15);border:1px solid rgba(255,68,68,0.3);border-radius:8px;color:#FF6B6B;font-family:\'Epilogue\',sans-serif;font-size:13px;font-weight:700;cursor:pointer">Yes, Delete</button>' +
    '</div>';

  // Append inside modal content
  const modalContent = document.querySelector('#bill-modal .modal-box') || modal.querySelector('div div');
  if (modalContent) modalContent.appendChild(wrap);
  else modal.appendChild(wrap);

  document.getElementById('delete-cancel-btn').onclick = () => wrap.remove();
  document.getElementById('delete-confirm-btn').onclick = async () => {
    await db.from('bills').update({ status: 'deleted' }).eq('id', billId);
    wrap.remove();
    closeBillModal();
    showToast('Bill deleted', 'success');
    loadAllData();
  };
}

function setMobNav(id) {
  document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type + ' show';
  setTimeout(() => t.classList.remove('show'), 3500);
}

let dashboardRavenHomeArmedUntil = 0;
function setupDashboardRavenHomeGuard() {
  const link = document.getElementById('dashboard-raven-home-link');
  if (!link || link.dataset.guardReady === '1') return;
  link.dataset.guardReady = '1';
  link.addEventListener('click', function(e) {
    const now = Date.now();
    if (now <= dashboardRavenHomeArmedUntil) {
      dashboardRavenHomeArmedUntil = 0;
      link.classList.remove('raven-armed');
      return;
    }
    e.preventDefault();
    dashboardRavenHomeArmedUntil = now + 2200;
    link.classList.add('raven-armed');
    showToast('Tap RAVEN again to go home', 'success');
    clearTimeout(link._armTimer);
    link._armTimer = setTimeout(() => {
      dashboardRavenHomeArmedUntil = 0;
      link.classList.remove('raven-armed');
    }, 2200);
  });
}
setupDashboardRavenHomeGuard();

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.getElementById('login-form').style.display !== 'none') handleLogin();
    if (document.getElementById('signup-form').style.display !== 'none') handleSignup();
  }
  if (e.key === 'Escape') closeBillModal();
});

// ─── CONTACTS PICKER ──────────────────────────────────────────────────────────

let allContacts = [];
let contactsPickerTarget = 'bill';

async function cbOpenContactsPicker() {
  contactsPickerTarget = 'bill';
  await loadContactsForPicker();
  document.getElementById('contacts-modal').style.display = 'flex';
}

async function tripOpenContacts() {
  contactsPickerTarget = 'trip';
  await loadContactsForPicker();
  document.getElementById('contacts-modal').style.display = 'flex';
}

async function loadContactsForPicker() {
  const { data: phone } = await db.from('contacts').select('name,phone').eq('owner_phone', currentUser.email).order('name');
  const { data: prev } = await db.from('participants').select('name').in('bill_id',
    (await db.from('bills').select('id').eq('creator_phone', currentUser.email)).data?.map(b => b.id) || []
  );
  const names = new Set();
  allContacts = [];
  // Raven friends first — they're the most relevant
  const friends = await enrichContactsWithFriends();
  (friends||[]).forEach(f => { if (f.name && !names.has(f.name.toLowerCase())) { names.add(f.name.toLowerCase()); allContacts.push({ name: f.name, source: 'friends' }); } });
  (phone || []).forEach(c => { if (!names.has(c.name.toLowerCase())) { names.add(c.name.toLowerCase()); allContacts.push({ name: c.name, phone: c.phone, source: 'contacts' }); } });
  (prev || []).forEach(p => { if (p.name && !names.has(p.name.toLowerCase()) && !p.name.startsWith('unknown_')) { names.add(p.name.toLowerCase()); allContacts.push({ name: p.name, source: 'history' }); } });
  allContacts.sort((a, b) => a.name.localeCompare(b.name));
  renderContactsList(allContacts);
}

function renderContactsList(contacts) {
  const currentPeople = contactsPickerTarget === 'bill' ? cbPeople : tripPeople;
  const container = document.getElementById('contacts-list');
  container.innerHTML = '';

  if (contacts.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">No contacts found.<br>Add friends on the Friends page to see them here.</div>';
    return;
  }

  contacts.forEach(c => {
    const isAdded = currentPeople.includes(c.name);
    const isFriend = c.source === 'friends';
    const badge = isFriend
      ? '<span style="font-size:10px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.25);color:var(--purple3);padding:2px 6px;border-radius:6px;font-weight:600">🪶 Raven</span>'
      : (c.source === 'history' ? '<span style="font-size:10px;color:var(--muted)">Past bill</span>' : '');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;background:' + (isAdded ? 'rgba(48,209,88,0.08)' : isFriend ? 'rgba(124,58,237,0.04)' : 'var(--dark3)') + ';border:1px solid ' + (isAdded ? 'rgba(48,209,88,0.25)' : isFriend ? 'rgba(124,58,237,0.2)' : 'var(--border)') + ';border-radius:10px;cursor:pointer;transition:opacity 0.15s';

    const avatar = document.createElement('div');
    avatar.style.cssText = 'width:36px;height:36px;border-radius:50%;background:' + avatarGradients[c.name.charCodeAt(0) % avatarGradients.length] + ';display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0';
    avatar.textContent = c.name[0].toUpperCase();

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    info.innerHTML = '<div style="font-size:14px;font-weight:600">' + c.name + '</div><div style="font-size:11px;color:var(--muted);margin-top:2px">' + badge + '</div>';

    const check = document.createElement('span');
    check.style.cssText = 'font-size:18px;color:' + (isAdded ? 'var(--green)' : 'var(--muted)');
    check.textContent = isAdded ? '✓' : '+';

    row.appendChild(avatar);
    row.appendChild(info);
    row.appendChild(check);

    row.addEventListener('click', () => {
      // Toggle
      if (contactsPickerTarget === 'bill') {
        if (cbPeople.includes(c.name)) cbPeople = cbPeople.filter(p => p !== c.name);
        else cbPeople.push(c.name);
        cbRenderPeople(); cbRenderItems(); cbUpdateSummary();
      } else {
        if (tripPeople.includes(c.name)) tripPeople = tripPeople.filter(p => p !== c.name);
        else tripPeople.push(c.name);
        renderTripPeopleChips();
      }
      // Re-render list to update checkmarks
      const q = document.getElementById('contacts-search')?.value || '';
      renderContactsList(allContacts.filter(x => x.name.toLowerCase().includes(q.toLowerCase())));
    });

    container.appendChild(row);
  });
}

function filterContacts(q) {
  const filtered = allContacts.filter(c => c.name.toLowerCase().includes(q.toLowerCase()));
  renderContactsList(filtered);
}

function closeContactsPicker() {
  document.getElementById('contacts-modal').style.display = 'none';
  document.getElementById('contacts-search').value = '';
}

// ─── TRIP ADMIN ───────────────────────────────────────────────────────────────

let adminTripId = null;
let adminTripData = null; // full trip object from tripDataMap

const avatarColorsList = ['linear-gradient(135deg,#7C3AED,#A855F7)','linear-gradient(135deg,#E8633A,#FF6B35)','linear-gradient(135deg,#0EA5E9,#7C3AED)','linear-gradient(135deg,#30D158,#0EA5E9)','linear-gradient(135deg,#F59E0B,#EF4444)','linear-gradient(135deg,#EC4899,#8B5CF6)','linear-gradient(135deg,#14B8A6,#3B82F6)','linear-gradient(135deg,#84CC16,#10B981)'];

function openTripAdmin(tripId) {
  const trip = tripDataMap[tripId];
  if (!trip) { showToast('Trip data not found — reload and try again', 'error'); return; }
  adminTripId = tripId;
  adminTripData = trip;
  document.getElementById('admin-trip-name').textContent = '✈️ ' + trip.name;
  document.getElementById('admin-delete-btn').onclick = () => confirmDeleteTrip(tripId, trip.name);
  switchAdminTab('members');
  document.getElementById('trip-admin-modal').style.display = 'flex';
}

function closeTripAdmin() {
  document.getElementById('trip-admin-modal').style.display = 'none';
  adminTripId = null;
  adminTripData = null;
}

function switchAdminTab(tab) {
  ['members','receipts','comments','danger'].forEach(t => {
    const panel = document.getElementById('admin-panel-' + t);
    const btn   = document.getElementById('atab-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) {
      btn.style.background = t === tab ? 'var(--dark3)' : 'transparent';
      btn.style.color      = t === tab ? 'var(--white)' : 'var(--muted)';
    }
  });
  if (tab === 'members')  renderAdminMembers();
  if (tab === 'receipts') loadAdminReceipts();
  if (tab === 'comments') loadAdminComments();
}

async function loadAdminReceipts() {
  const container = document.getElementById('admin-receipts-list');
  container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Loading...</div>';
  try {
    const { data: receipts, error } = await db.from('trip_receipts').select('*').eq('trip_id', adminTripId).order('created_at', { ascending: false });
    if (error || !receipts || receipts.length === 0) {
      container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">No receipts yet.</div>';
      return;
    }
    container.innerHTML = '';
    receipts.forEach(r => {
      const total = parseFloat(r.total || 0).toFixed(2);
      const date  = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--dark2);border:1px solid var(--border);border-radius:10px;gap:10px';
      row.dataset.receiptRow = '1';
      // Show receipt image thumbnail if available
      const thumbHtml = r.photo_url
        ? '<img src="' + r.photo_url + '" style="width:34px;height:34px;border-radius:7px;object-fit:cover;flex-shrink:0">'
        : '<div style="width:34px;height:34px;border-radius:10px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🧾</div>';
      row.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">'
        + thumbHtml
        + '<div><div style="font-size:14px;font-weight:600;color:var(--white)">' + (r.name || 'Receipt').replace(/</g,'&lt;') + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:1px">' + date + '</div></div></div>'
        + '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:var(--green);flex-shrink:0">$' + total + '</div>';
      const delBtn = document.createElement('button');
      delBtn.textContent = '🗑';
      delBtn.title = 'Delete receipt';
      delBtn.style.cssText = 'background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.2);border-radius:7px;color:#FF6B6B;cursor:pointer;padding:6px 10px;font-size:14px;flex-shrink:0';
      delBtn.addEventListener('click', async () => {
        // Tap once = confirm state, tap again = delete (no iOS-broken confirm())
        if (delBtn.dataset.confirming === '1') {
          delBtn.textContent = '...'; delBtn.disabled = true;
          const { error: delErr } = await db.from('trip_receipts').delete().eq('id', r.id);
          if (delErr) { showToast('Error deleting receipt', 'error'); delBtn.textContent = '🗑'; delBtn.disabled = false; delBtn.dataset.confirming = ''; return; }
          try {
            const { data: remaining } = await db.from('trip_receipts').select('total').eq('trip_id', adminTripId);
            const newTotal = (remaining || []).reduce((s, rec) => s + parseFloat(rec.total || 0), 0);
            await db.from('trips').update({ total: newTotal, receipt_count: (remaining || []).length }).eq('id', adminTripId);
          } catch(e) {}
          row.remove();
          showToast('Receipt deleted ✓', 'success');
          const { data: updatedTrip } = await db.from('trips').select('*').eq('id', adminTripId).single();
          if (updatedTrip) { tripDataMap[adminTripId] = updatedTrip; adminTripData = updatedTrip; }
          if (container.querySelectorAll('[data-receipt-row]').length === 0) {
            container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">No receipts.</div>';
          }
          return;
        }
        delBtn.dataset.confirming = '1';
        delBtn.textContent = '⚠️ Tap to confirm';
        delBtn.style.cssText = 'background:rgba(255,68,68,0.2);border:1px solid rgba(255,68,68,0.5);border-radius:7px;color:#FF6B6B;cursor:pointer;padding:6px 10px;font-size:12px;font-weight:700;flex-shrink:0;white-space:nowrap';
        setTimeout(() => {
          if (delBtn.dataset.confirming === '1') {
            delBtn.dataset.confirming = '';
            delBtn.textContent = '🗑';
            delBtn.style.cssText = 'background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.2);border-radius:7px;color:#FF6B6B;cursor:pointer;padding:6px 10px;font-size:14px;flex-shrink:0';
          }
        }, 3000);
      });
      row.appendChild(delBtn);
      container.appendChild(row);
    });
  } catch(e) { container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Error loading receipts.</div>'; }
}

function getAdminPeople() {
  if (!adminTripData) return [];
  try { return Array.isArray(adminTripData.people) ? adminTripData.people : JSON.parse(adminTripData.people || '[]'); } catch(e) { return []; }
}
function getAdminAdmins() {
  if (!adminTripData) return [];
  try { return Array.isArray(adminTripData.co_admins) ? adminTripData.co_admins : JSON.parse(adminTripData.co_admins || '[]'); } catch(e) { return []; }
}

function renderAdminMembers() {
  const container = document.getElementById('admin-members-list');
  const people  = getAdminPeople();
  const coAdmins = getAdminAdmins();
  if (!people.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;text-align:center">No members yet.</div>';
    return;
  }
  container.innerHTML = '';
  people.forEach((name, i) => {
    const isCoAdmin = coAdmins.includes(name);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--dark2);border:1px solid ' + (isCoAdmin ? 'rgba(124,58,237,0.3)' : 'var(--border)') + ';border-radius:10px;gap:10px';
    // Left: avatar + name + badge
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;min-width:0';
    const av = document.createElement('div');
    av.style.cssText = 'width:34px;height:34px;border-radius:50%;background:' + avatarColorsList[i % avatarColorsList.length] + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0';
    av.textContent = name[0].toUpperCase();
    const nameWrap = document.createElement('div');
    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-size:14px;font-weight:600;display:block';
    nameEl.textContent = name;
    nameWrap.appendChild(nameEl);
    if (isCoAdmin) {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:10px;color:#A855F7;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);padding:2px 7px;border-radius:6px;font-weight:600;margin-top:2px;display:inline-block';
      badge.textContent = '⚙️ co-admin';
      nameWrap.appendChild(badge);
    }
    left.appendChild(av); left.appendChild(nameWrap);
    // Right: action buttons
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0';
    // Co-admin toggle
    const adminBtn = document.createElement('button');
    adminBtn.style.cssText = 'padding:5px 10px;border-radius:7px;font-family:\'Epilogue\',sans-serif;font-size:11px;font-weight:600;cursor:pointer;border:1px solid;transition:all 0.15s';
    if (isCoAdmin) {
      adminBtn.textContent = '− Admin';
      adminBtn.style.cssText += 'background:rgba(124,58,237,0.12);border-color:rgba(124,58,237,0.3);color:#A855F7';
      adminBtn.title = 'Remove co-admin role';
    } else {
      adminBtn.textContent = '+ Admin';
      adminBtn.style.cssText += 'background:rgba(124,58,237,0.06);border-color:rgba(124,58,237,0.18);color:#9896A8';
      adminBtn.title = 'Promote to co-admin';
    }
    adminBtn.addEventListener('click', () => toggleCoAdmin(name));
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.style.cssText = 'padding:5px 10px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.2);border-radius:7px;color:#FF6B6B;font-family:\'Epilogue\',sans-serif;font-size:11px;font-weight:600;cursor:pointer';
    removeBtn.dataset.confirming = '0';
    removeBtn.addEventListener('click', () => {
      if (removeBtn.dataset.confirming === '1') {
        removeBtn.dataset.confirming = '0'; removeBtn.textContent = 'Remove'; removeBtn.style.borderColor = 'rgba(255,68,68,0.2)';
        removeMemberAdmin(name);
      } else {
        removeBtn.dataset.confirming = '1'; removeBtn.textContent = '⚠️ Confirm?'; removeBtn.style.borderColor = 'rgba(255,68,68,0.6)';
        setTimeout(() => { if(removeBtn.dataset.confirming==='1'){removeBtn.dataset.confirming='0';removeBtn.textContent='Remove';removeBtn.style.borderColor='rgba(255,68,68,0.2)';} }, 3000);
      }
    });
    actions.appendChild(adminBtn); actions.appendChild(removeBtn);
    row.appendChild(left); row.appendChild(actions);
    container.appendChild(row);
  });
}

async function toggleCoAdmin(memberName) {
  const coAdmins = getAdminAdmins();
  const newAdmins = coAdmins.includes(memberName)
    ? coAdmins.filter(a => a !== memberName)
    : [...coAdmins, memberName];
  try {
    const { error } = await db.from('trips').update({ co_admins: JSON.stringify(newAdmins) }).eq('id', adminTripId);
    if (error) {
      // co_admins column may not exist yet — store locally only
      console.warn('co_admins column missing, storing locally only');
    }
    adminTripData = { ...adminTripData, co_admins: newAdmins };
    tripDataMap[adminTripId] = adminTripData;
    const action = newAdmins.includes(memberName) ? 'promoted to co-admin' : 'removed from co-admin';
    showToast('✅ ' + memberName + ' ' + action, 'success');
    renderAdminMembers();
  } catch(e) { showToast('Error updating admin role', 'error'); }
}

async function removeMemberAdmin(memberName) {
  // confirm() removed - caller should use two-tap pattern
  const people   = getAdminPeople().filter(p => p !== memberName);
  const coAdmins = getAdminAdmins().filter(a => a !== memberName);
  try {
    // Update people first — this always works
    const { error } = await db.from('trips').update({ people: JSON.stringify(people) }).eq('id', adminTripId);
    if (error) { showToast('Error removing member: ' + error.message, 'error'); return; }
    // Try updating co_admins separately — silently skip if column doesn't exist
    try { await db.from('trips').update({ co_admins: JSON.stringify(coAdmins) }).eq('id', adminTripId); } catch(e) {}
    adminTripData = { ...adminTripData, people, co_admins: coAdmins };
    tripDataMap[adminTripId] = adminTripData;
    showToast('✅ ' + memberName + ' removed', 'success');
    renderAdminMembers();
  } catch(e) { showToast('Error removing member: ' + e.message, 'error'); }
}

async function loadAdminComments() {
  const container = document.getElementById('admin-comments-list');
  container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Loading...</div>';
  try {
    const { data: comments, error } = await db.from('trip_comments').select('*').eq('trip_id', adminTripId).order('created_at', { ascending: false });
    if (error || !comments) { container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">No comments yet.</div>'; return; }
    if (comments.length === 0) { container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">No comments yet.</div>'; return; }
    container.innerHTML = '';
    comments.forEach(c => {
      const timeStr = new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--dark2);border:1px solid var(--border);border-radius:10px';
      row.innerHTML = '<div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#30D158);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">' + (c.author_name || '?')[0].toUpperCase() + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px"><span style="font-size:13px;font-weight:700">' + (c.author_name || 'Anonymous').replace(/</g,'&lt;') + '</span><span style="font-size:11px;color:var(--muted)">' + timeStr + '</span></div>'
        + (c.body ? '<div style="font-size:13px;color:var(--muted2);word-break:break-word">' + c.body.replace(/</g,'&lt;') + '</div>' : '')
        + (c.gif_url ? '<img src="' + c.gif_url + '" style="height:60px;border-radius:6px;margin-top:4px;display:block">' : '')
        + '</div>';
      const delBtn = document.createElement('button');
      delBtn.textContent = '🗑';
      delBtn.title = 'Delete this comment';
      delBtn.style.cssText = 'background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.2);border-radius:6px;color:#FF6B6B;cursor:pointer;padding:4px 8px;font-size:13px;flex-shrink:0';
      delBtn.addEventListener('click', async () => {
        // Two-tap confirm
        if (delBtn.dataset.confirming !== '1') { delBtn.dataset.confirming='1'; delBtn.textContent='⚠️ Confirm'; delBtn.style.cssText+='background:rgba(255,68,68,0.2);border-color:rgba(255,68,68,0.5)'; setTimeout(()=>{ if(delBtn.dataset.confirming==='1'){delBtn.dataset.confirming='';delBtn.textContent='🗑';delBtn.style.cssText=delBtn.style.cssText.replace(/background[^;]*;?/,'').replace(/border-color[^;]*;?/,'');} },3000); return; }
        const { error } = await db.from('trip_comments').delete().eq('id', c.id);
        if (error) { showToast('Error deleting comment', 'error'); return; }
        row.remove();
        showToast('Comment deleted', 'success');
      });
      row.appendChild(delBtn);
      container.appendChild(row);
    });
  } catch(e) { container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Error loading comments.</div>'; }
}

async function confirmDeleteTrip(tripId, tripName) {
  const dBtn = document.getElementById('admin-delete-btn');
  if (!dBtn || dBtn.dataset.confirming !== '1') {
    if (dBtn) { dBtn.dataset.confirming='1'; dBtn.textContent='⚠️ Tap again — PERMANENTLY delete?'; dBtn.style.background='rgba(255,68,68,0.25)'; dBtn.style.borderColor='rgba(255,68,68,0.6)'; setTimeout(()=>{ if(dBtn.dataset.confirming==='1'){dBtn.dataset.confirming='';dBtn.textContent='🗑 Delete This Trip Forever';dBtn.style.background='rgba(255,68,68,0.12)';dBtn.style.borderColor='rgba(255,68,68,0.35)';} },4000); }
    return;
  }
  const btn = document.getElementById('admin-delete-btn');
  btn.textContent = 'Deleting...'; btn.disabled = true;
  try {
    await db.from('trip_receipts').delete().eq('trip_id', tripId);
    await db.from('trip_comments').delete().eq('trip_id', tripId);
    try { await db.from('trip_members').delete().eq('trip_id', tripId); } catch(e) {}
    const { error } = await db.from('trips').delete().eq('id', tripId);
    if (error) { showToast('Error deleting trip: ' + error.message, 'error'); btn.textContent = '🗑 Delete This Trip Forever'; btn.disabled = false; return; }
    delete tripDataMap[tripId];
    delete tripUrlMap[tripId];
    closeTripAdmin();
    showToast('Trip deleted', 'success');
    loadTrips();
  } catch(e) { showToast('Error deleting trip', 'error'); btn.textContent = '🗑 Delete This Trip Forever'; btn.disabled = false; }
}

// ─── FRIENDS ──────────────────────────────────────────────────────────────────

const avatarGradients = ['linear-gradient(135deg,#7C3AED,#A855F7)','linear-gradient(135deg,#E8633A,#FF6B35)','linear-gradient(135deg,#0EA5E9,#7C3AED)','linear-gradient(135deg,#30D158,#0EA5E9)','linear-gradient(135deg,#F59E0B,#EF4444)','linear-gradient(135deg,#EC4899,#8B5CF6)'];
const activeBillParticipantProfileCache = {};

function normalizeActiveBillPersonKey(name) {
  return String(name || '').trim().replace(/^@/, '').toLowerCase();
}

function friendAvatar(name, url, size) {
  const s = size || 40;
  if (url) return '<div style="width:'+s+'px;height:'+s+'px;border-radius:50%;overflow:hidden;flex-shrink:0"><img src="'+url+'" style="width:100%;height:100%;object-fit:cover"></div>';
  const g = avatarGradients[(name||'A').charCodeAt(0) % avatarGradients.length];
  return '<div style="width:'+s+'px;height:'+s+'px;border-radius:50%;background:'+g+';display:flex;align-items:center;justify-content:center;font-size:'+(s*0.35)+'px;font-weight:700;color:#fff;flex-shrink:0">'+(name||'?')[0].toUpperCase()+'</div>';
}

async function resolveActiveBillParticipantProfiles(names) {
  const uniqueNames = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))];
  if (!uniqueNames.length) return {};
  const missing = uniqueNames.filter(name => !activeBillParticipantProfileCache[normalizeActiveBillPersonKey(name)]);
  if (missing.length && currentUser) {
    try {
      const firstNames = [...new Set(missing.map(name => name.split(' ')[0].trim()).filter(Boolean))];
      const ravenIds = [...new Set(missing.map(name => String(name || '').trim().replace(/^@/, '')).filter(Boolean))];
      const lookups = [];
      if (firstNames.length) {
        lookups.push(db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url,email').in('first_name', firstNames));
      }
      if (ravenIds.length) {
        lookups.push(db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url,email').in('raven_id', ravenIds));
      }
      const results = await Promise.all(lookups);
      results.forEach(result => {
        (result.data || []).forEach(profile => {
          const aliases = [profile.first_name, profile.raven_id, profile.email].map(v => normalizeActiveBillPersonKey(v)).filter(Boolean);
          aliases.forEach(alias => {
            if (!activeBillParticipantProfileCache[alias]) activeBillParticipantProfileCache[alias] = profile;
          });
        });
      });
      try {
        const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
        if (local.first_name || local.raven_id || local.email) {
          const localProfile = {
            first_name: local.first_name || '',
            raven_id: local.raven_id || local.username || '',
            avatar_url: local.avatar_url || '',
            email: local.email || ''
          };
          [local.first_name, local.raven_id, local.username, local.email].forEach(alias => {
            alias = normalizeActiveBillPersonKey(alias);
            if (alias) activeBillParticipantProfileCache[alias] = localProfile;
          });
        }
      } catch(e) {}
    } catch(e) {}
  }
  const resolved = {};
  uniqueNames.forEach(name => {
    const key = normalizeActiveBillPersonKey(name);
    resolved[name] = activeBillParticipantProfileCache[key] || null;
  });
  return resolved;
}

function activeBillParticipantAvatar(name, profile, size) {
  const s = size || 28;
  if (profile && profile.avatar_url) {
    return '<div style="width:'+s+'px;height:'+s+'px;border-radius:50%;overflow:hidden;flex-shrink:0;background:#13131A"><img src="'+profile.avatar_url+'" style="width:100%;height:100%;object-fit:cover"></div>';
  }
  if (profile && profile.raven_id) {
    const g = avatarGradients[(name||'A').charCodeAt(0) % avatarGradients.length];
    return '<div style="width:'+s+'px;height:'+s+'px;border-radius:50%;background:'+g+';display:flex;align-items:center;justify-content:center;font-size:'+(s*0.35)+'px;font-weight:700;color:#fff;flex-shrink:0">'+(name||'?')[0].toUpperCase()+'</div>';
  }
  return '<div style="width:'+s+'px;height:'+s+'px;border-radius:50%;background:#13131A;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:'+(s*0.42)+'px;font-weight:700;color:var(--muted);flex-shrink:0">?</div>';
}

async function loadFriendsPage() {
  startDMPolling(); // load unread counts and keep them fresh
  // Load my Raven ID
  try {
    const { data: me } = await db.from('profiles').select('raven_id,first_name,username,email').eq('id', currentUser.id).single();
    const rid = await ensureCurrentUserRavenId(me);
    const display = document.getElementById('my-raven-id-display');
    if (display) display.textContent = rid ? '@' + rid : '⚠️ Set your Raven ID in Settings';
  } catch(e) {}

  await loadFriendRequests();
  await loadFriendsList();
}

async function copyRavenId() {
  const el = document.getElementById('my-raven-id-display');
  const text = el ? el.textContent : '';
  if (!text || text.includes('Set your')) { showToast('Set your Raven ID in Settings first', 'error'); showPage('settings'); return; }
  try { await navigator.clipboard.writeText(text); showToast('Raven ID copied! ' + text, 'success'); } catch(e) { showToast(text, 'success'); }
}

async function shareRavenIdSMS() {
  const el = document.getElementById('my-raven-id-display');
  const ravenId = (el ? el.textContent : '').replace('@','').trim();
  if (!ravenId || ravenId === 'loading...') { showToast('Set your Raven ID in Settings first', 'error'); showPage('settings'); return; }
  const name = (() => { try { return JSON.parse(localStorage.getItem('raven_profile')||'{}').first_name || 'Someone'; } catch(e) { return 'Someone'; } })();
  const inviteUrl = FRONTEND + '/friend-invite/' + encodeURIComponent(ravenId);
  const msg = name + ' wants to connect with you on RAVEN 🪶\nTap to add @' + ravenId + ' as a friend\nSplit bills free with RAVEN | ravensplit.com';
  if (navigator.share) {
    try {
      await navigator.share({ title: msg, url: inviteUrl });
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }
  window.open('sms:?&body=' + encodeURIComponent(msg + '\n' + inviteUrl), '_blank');
}

// Generate a unique Raven ID: tries base, then base1, base2, base3...
// excludeUserId = current user so we don't conflict with themselves
function sanitizeRavenBase(base) {
  return (String(base || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'raven';
}

function shouldRefreshAutoRavenId(existingRavenId, firstName, email) {
  const rid = String(existingRavenId || '').toLowerCase().trim();
  const first = sanitizeRavenBase(firstName || '');
  const emailBase = sanitizeRavenBase(String(email || '').split('@')[0] || '');
  if (!rid) return true;
  if (/^raven\d{3,}$/.test(rid) && first && first !== 'raven') return true;
  if (/^ravensplit\d{3,}$/.test(rid)) return true;
  if (emailBase && rid === emailBase && first && first !== emailBase) return true;
  if (emailBase && new RegExp('^' + emailBase + '\\d{3,}$').test(rid) && first && first !== emailBase) return true;
  return false;
}

async function persistRavenHandle(userId, ravenId) {
  if (!userId || !ravenId) return;
  const payload = { raven_id: ravenId, username: ravenId, updated_at: new Date().toISOString() };
  try {
    const { error } = await db.from('profiles').upsert({ id: userId, ...payload }, { onConflict: 'id' });
    if (error) throw error;
    const { data: verify, error: verifyErr } = await db.from('profiles').select('raven_id,username').eq('id', userId).single();
    if (verifyErr) throw verifyErr;
    if (String(verify?.raven_id || '') !== ravenId || String(verify?.username || '') !== ravenId) {
      throw new Error('Raven ID verification failed');
    }
    return true;
  } catch(e) {
    console.warn('persistRavenHandle failed:', e);
    throw e;
  }
}

async function generateUniqueRavenId(base, excludeUserId) {
  const clean = sanitizeRavenBase(base);
  for (let i = 0; i < 40; i++) {
    const digits = String(Math.floor(Math.random() * 900) + 100);
    const candidate = (clean + digits).slice(0, 20);
    const { data: exists } = await db.from('profiles').select('id').eq('raven_id', candidate).neq('id', excludeUserId || '').maybeSingle();
    if (!exists) return candidate;
  }
  return (clean + String(Date.now()).slice(-3)).slice(0, 20);
}

async function ensureCurrentUserRavenId(profileOverride) {
  if (!currentUser?.id) return '';
  const profile = profileOverride || (await db.from('profiles').select('first_name,raven_id,username,email').eq('id', currentUser.id).maybeSingle()).data;
  const firstName = profile?.first_name || document.getElementById('set-first')?.value.trim() || JSON.parse(localStorage.getItem('raven_profile') || '{}').first_name || '';
  const existingRavenId = profile?.raven_id || '';
  if (!shouldRefreshAutoRavenId(existingRavenId, firstName, currentUser.email)) {
    return existingRavenId;
  }
  const generated = await generateUniqueRavenId(firstName || 'raven', currentUser.id);
  await persistRavenHandle(currentUser.id, generated);
  if (profileOverride) {
    profileOverride.raven_id = generated;
    profileOverride.username = generated;
  }
  const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
  localStorage.setItem('raven_profile', JSON.stringify({ ...existing, first_name: firstName || existing.first_name || '', raven_id: generated, username: generated, email: currentUser.email, user_id: currentUser.id }));
  return generated;
}

async function checkRavenId() {
  const val = document.getElementById('set-raven-id').value.trim().toLowerCase();
  const status = document.getElementById('raven-id-status');
  if (!val) { status.textContent = ''; return; }
  if (val.length < 3) { status.style.color = 'var(--muted)'; status.textContent = 'Too short — minimum 3 characters'; return; }
  const { data } = await db.from('profiles').select('id').eq('raven_id', val).neq('id', currentUser.id).maybeSingle();
  if (data) {
    // Suggest the next available
    const suggested = await generateUniqueRavenId(val, currentUser.id);
    status.style.color = '#FF6B6B';
    status.innerHTML = '✗ @' + val + ' is taken &mdash; <span style="color:var(--purple3);cursor:pointer;text-decoration:underline" onclick="document.getElementById(\'set-raven-id\').value=\'' + suggested + '\';checkRavenId()">use @' + suggested + '?</span>';
  } else {
    status.style.color = 'var(--green)';
    status.textContent = '✓ @' + val + ' is available';
  }
}

async function searchFriends() {
  const query = document.getElementById('friend-search-input').value.trim().toLowerCase().replace('@','');
  const container = document.getElementById('friend-search-results');
  if (!query) { container.innerHTML = ''; return; }
  container.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Searching...</div>';
  try {
    const normalizedQuery = query.replace(/[^a-z0-9_]/g, '');
    let orderedResults = [];
    const seenIds = new Set();

    if (normalizedQuery) {
      const { data: exactMatches } = await db.from('profiles')
        .select('id,first_name,last_name,raven_id,avatar_url,venmo,cashapp,applepay')
        .eq('raven_id', normalizedQuery)
        .neq('id', currentUser.id)
        .limit(3);
      (exactMatches || []).forEach(p => {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          orderedResults.push(p);
        }
      });
    }

    const { data: broadResults } = await db.from('profiles')
      .select('id,first_name,last_name,raven_id,avatar_url,venmo,cashapp,applepay')
      .or('raven_id.ilike.%' + query + '%,first_name.ilike.%' + query + '%,last_name.ilike.%' + query + '%')
      .neq('id', currentUser.id)
      .limit(12);

    (broadResults || []).forEach(p => {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        orderedResults.push(p);
      }
    });

    const results = orderedResults.slice(0, 8);

    if (!results || results.length === 0) {
      container.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No users found for "' + query + '"</div>';
      return;
    }

    // Get existing friend statuses
    const { data: existing } = await db.from('raven_friends')
      .select('friend_id,user_id,status')
      .or('user_id.eq.' + currentUser.id + ',friend_id.eq.' + currentUser.id);
    const friendMap = {};
    (existing || []).forEach(f => {
      const otherId = f.user_id === currentUser.id ? f.friend_id : f.user_id;
      friendMap[otherId] = f.status;
    });

    container.innerHTML = '';
    results.forEach(p => {
      const status = friendMap[p.id];
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.raven_id || 'Unknown';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--dark);border:1px solid var(--border);border-radius:12px;cursor:pointer';
      row.innerHTML = friendAvatar(name, p.avatar_url, 40)
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:14px;font-weight:600">' + name + '</div>'
        + (p.raven_id ? '<div style="font-size:12px;color:var(--purple3)">@' + p.raven_id + '</div>' : '<div style="font-size:12px;color:var(--muted)">No Raven ID set</div>')
        + '</div>';

      let actionBtn = document.createElement('button');
      actionBtn.style.cssText = 'padding:8px 14px;border-radius:9px;font-family:\'Epilogue\',sans-serif;font-size:12px;font-weight:700;cursor:pointer;border:1px solid;white-space:nowrap;flex-shrink:0';
      if (status === 'accepted') {
        actionBtn.textContent = '✓ Friends';
        actionBtn.style.cssText += 'background:rgba(48,209,88,0.08);border-color:rgba(48,209,88,0.2);color:var(--green)';
        actionBtn.onclick = (e) => { e.stopPropagation(); openProfileModal(p); };
      } else if (status === 'pending') {
        actionBtn.textContent = '⏳ Pending';
        actionBtn.style.cssText += 'background:rgba(255,255,255,0.05);border-color:var(--border);color:var(--muted)';
      } else {
        actionBtn.textContent = '+ Add Friend';
        actionBtn.style.cssText += 'background:rgba(124,58,237,0.12);border-color:rgba(124,58,237,0.3);color:var(--purple3)';
        actionBtn.onclick = async (e) => { e.stopPropagation(); await sendFriendRequest(p.id, name, actionBtn); };
      }
      row.appendChild(actionBtn);
      row.addEventListener('click', () => openProfileModal(p));
      container.appendChild(row);
    });
  } catch(e) { container.innerHTML = '<div style="color:#FF6B6B;font-size:13px;padding:8px 0">Error searching — try again</div>'; }
}

async function sendFriendRequest(friendId, friendName, btn) {
  btn.textContent = 'Sending...'; btn.disabled = true;
  try {
    const { error } = await db.from('raven_friends').insert({ user_id: currentUser.id, friend_id: friendId, status: 'pending' });
    if (error && error.code === '23505') { btn.textContent = '⏳ Pending'; btn.disabled = false; return; }
    if (error) throw error;
    btn.textContent = '⏳ Pending';
    btn.style.background = 'rgba(255,255,255,0.05)';
    btn.style.color = 'var(--muted)';
    btn.disabled = false;
    showToast('Friend request sent to ' + friendName + '!', 'success');
  } catch(e) { showToast('Error sending request', 'error'); btn.textContent = '+ Add Friend'; btn.disabled = false; }
}

async function loadFriendRequests() {
  const section = document.getElementById('friend-requests-section');
  const list    = document.getElementById('friend-requests-list');
  const count   = document.getElementById('friend-req-count');
  if (!list) return;
  try {
    const { data: requests } = await db.from('raven_friends')
      .select('id,user_id,status')
      .eq('friend_id', currentUser.id)
      .eq('status', 'pending');

    // Update notification badges regardless of which page is open
    const reqCount = (requests || []).length;
    const mobBadge = document.getElementById('mob-friend-req-badge');
    const mobFriendsBadge = document.getElementById('mob-friends-badge');
    const sidebarFriends = document.querySelector('.nav-item[onclick*="friends"]');
    if (mobBadge) mobBadge.style.display = reqCount > 0 ? 'block' : 'none';
    if (mobFriendsBadge) { mobFriendsBadge.style.display = reqCount > 0 ? 'block' : 'none'; mobFriendsBadge.textContent = reqCount; }
    if (sidebarFriends) sidebarFriends.innerHTML = '<span class="ni"><svg class="raven-icon"><use href="#icon-friends"></use></svg></span> Friends' + (reqCount > 0 ? ' <span style="background:#A855F7;color:#fff;border-radius:8px;font-size:10px;padding:1px 6px;font-weight:700">' + reqCount + '</span>' : '');

    if (!requests || requests.length === 0) { list.innerHTML = '<div style="padding:16px;background:var(--dark);border:1px solid var(--border);border-radius:12px;text-align:center;color:var(--muted);font-size:13px">No new notifications</div>'; return; }
    // Fetch requester profiles
    const ids = requests.map(r => r.user_id);
    const { data: profiles } = await db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url').in('id', ids);
    const profMap = {};
    (profiles||[]).forEach(p => { profMap[p.id] = p; });
    
    if (count) count.textContent = requests.length;
    list.innerHTML = '';
    requests.forEach(req => {
      const p = profMap[req.user_id] || {};
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.raven_id || 'Someone';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--dark);border:1px solid rgba(124,58,237,0.2);border-radius:12px';
      row.innerHTML = friendAvatar(name, p.avatar_url, 38)
        + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600">' + name + '</div>'
        + (p.raven_id ? '<div style="font-size:12px;color:var(--purple3)">@' + p.raven_id + '</div>' : '') + '</div>';
      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = '✓ Accept';
      acceptBtn.style.cssText = 'padding:7px 12px;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.3);border-radius:8px;color:var(--green);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-right:6px';
      acceptBtn.onclick = async () => {
        await db.from('raven_friends').update({ status: 'accepted' }).eq('id', req.id);
        await db.from('raven_friends').upsert({ user_id: currentUser.id, friend_id: req.user_id, status: 'accepted' }, { onConflict: 'user_id,friend_id' });
        row.remove(); showToast('Now friends with ' + name + '! 🎉', 'success');
        loadFriendsList();
        loadFriendRequests(); // refresh badge counts
        const remaining = list.children.length;
        
      };
      const declineBtn = document.createElement('button');
      declineBtn.textContent = '✕';
      declineBtn.style.cssText = 'padding:7px 10px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.2);border-radius:8px;color:#FF6B6B;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer';
      declineBtn.onclick = async () => {
        await db.from('raven_friends').delete().eq('id', req.id);
        row.remove();
        loadFriendRequests();
        
      };
      row.appendChild(acceptBtn); row.appendChild(declineBtn);
      list.appendChild(row);
    });
  } catch(e) { console.log('friend requests error:', e); }
}

async function loadFriendsList() {
  const container = document.getElementById('friends-list');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const { data: friendships } = await db.from('raven_friends')
      .select('user_id,friend_id')
      .or('user_id.eq.' + currentUser.id + ',friend_id.eq.' + currentUser.id)
      .eq('status', 'accepted');
    if (!friendships || friendships.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:14px"><div style="font-size:36px;margin-bottom:10px">👥</div><div style="font-weight:600;margin-bottom:4px">No friends yet</div><div>Search for people by their @RavenID above</div></div>';
      return;
    }
    const friendIds = [...new Set(friendships.map(f => f.user_id === currentUser.id ? f.friend_id : f.user_id))];
    const { data: profiles } = await db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url,venmo,cashapp,applepay').in('id', friendIds);
    container.innerHTML = '';
    (profiles || []).forEach(p => {
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.raven_id || 'Unknown';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--dark);border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:border-color 0.15s';
      row.addEventListener('mouseover', () => { row.style.borderColor = 'rgba(124,58,237,0.3)'; });
      row.addEventListener('mouseout',  () => { row.style.borderColor = 'var(--border)'; });
      const methods = [p.venmo && 'V', p.cashapp && '$', p.applepay && '✦'].filter(Boolean);
      // Unread DM badge
      const unreadCount = _dmUnreadMap[p.id] || 0;
      const unreadBadgeHtml = '<div id="dm-unread-' + p.id + '" style="display:' + (unreadCount > 0 ? 'flex' : 'none') + ';align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;background:var(--purple);border-radius:9px;font-size:10px;font-weight:700;color:#fff">' + (unreadCount > 9 ? '9+' : unreadCount) + '</div>';
      row.innerHTML = friendAvatar(name, p.avatar_url, 42)
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px">' + name + '<span id="online-dot-' + p.id + '" style="display:none;width:7px;height:7px;border-radius:50%;background:#30D158;flex-shrink:0" title="Online"></span></div>'
        + (p.raven_id ? '<div style="font-size:12px;color:var(--purple3)">@' + p.raven_id + '</div>' : '')
        + (methods.length ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + methods.join(' · ') + ' set up</div>' : '')
        + '</div>'
        + unreadBadgeHtml
        + '<div style="font-size:20px;color:var(--muted)">›</div>';
      row.addEventListener('click', () => openProfileModal(p));
      container.appendChild(row);
      // Check online status async (non-blocking)
      checkFriendOnline(p.id).then(online => {
        const dot = document.getElementById('online-dot-' + p.id);
        if (dot) dot.style.display = online ? 'inline-block' : 'none';
      });
    });
  } catch(e) { container.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Error loading friends</div>'; }
}

// ── PROFILE MODAL ──
let _profileModalData = null;
let _profilePickerState = null;

async function fetchAddableTrips() {
  const email = (currentUser?.email || '').toLowerCase();
  const trips = [];
  const seen = new Set();
  try {
    const { data: mine } = await db.from('trips').select('*').eq('creator_email', currentUser.email).neq('type', 'roommates');
    (mine || []).forEach(t => { if (t?.id && !seen.has(t.id)) { seen.add(t.id); trips.push(t); tripDataMap[t.id] = t; } });
  } catch(e) {}
  try {
    const emailEscaped = email.replace(/"/g, '\\"');
    const { data: memberTrips } = await db.from('trips').select('*').ilike('member_emails', '%' + emailEscaped + '%').neq('type', 'roommates');
    (memberTrips || []).forEach(t => { if (t?.id && !seen.has(t.id)) { seen.add(t.id); trips.push(t); tripDataMap[t.id] = t; } });
  } catch(e) {}
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    const joined = Array.isArray(local.joined_trips) ? local.joined_trips : [];
    if (joined.length > 0) {
      const { data: joinedTrips } = await db.from('trips').select('*').in('id', joined).neq('type', 'roommates');
      (joinedTrips || []).forEach(t => { if (t?.id && !seen.has(t.id)) { seen.add(t.id); trips.push(t); tripDataMap[t.id] = t; } });
    }
  } catch(e) {}
  return trips.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function fetchAddableBills() {
  try {
    const { data: bills } = await db.from('bills').select('id,name,status,created_at,share_token,participants(*)').eq('creator_phone', currentUser.email).neq('status', 'deleted').order('created_at', { ascending: false });
    return bills || [];
  } catch(e) {
    return [];
  }
}

function hideProfileInlinePicker() {
  _profilePickerState = null;
  const picker = document.getElementById('pm-inline-picker');
  if (!picker) return;
  picker.style.display = 'none';
  picker.innerHTML = '';
}

async function showProfileInlinePicker(type) {
  if (!_profileModalData) return;
  const picker = document.getElementById('pm-inline-picker');
  if (!picker) return;
  const targetName = [_profileModalData.first_name, _profileModalData.last_name].filter(Boolean).join(' ') || _profileModalData.raven_id || 'this friend';
  picker.style.display = 'block';
  picker.innerHTML = '<div style="font-size:12px;color:var(--muted)">Loading options...</div>';
  _profilePickerState = { type };

  const items = type === 'trip' ? await fetchAddableTrips() : await fetchAddableBills();
  if (!items.length) {
    picker.innerHTML = '<div style="font-size:13px;font-weight:700;margin-bottom:6px">No ' + (type === 'trip' ? 'trips' : 'bills') + ' yet</div>'
      + '<div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:12px">Create one first, then you can add ' + targetName + ' directly from here.</div>'
      + '<div style="display:flex;gap:8px">'
      + (type === 'trip'
        ? '<button onclick="hideProfileInlinePicker();closeProfileModal();openCreateTrip()" style="flex:1;padding:10px 12px;background:var(--green);border:none;border-radius:10px;color:#000;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Create Trip</button>'
        : '<button onclick="hideProfileInlinePicker();closeProfileModal();showPage(\'create-bill\')" style="flex:1;padding:10px 12px;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.2);border-radius:10px;color:var(--green);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Create Bill</button>')
      + '<button onclick="hideProfileInlinePicker()" style="padding:10px 12px;background:transparent;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">Cancel</button>'
      + '</div>';
    return;
  }

  const options = items.map(item => {
    const label = (item.name || 'Untitled').replace(/</g, '&lt;');
    const sub = type === 'trip'
      ? (() => { try { const people = Array.isArray(item.people) ? item.people : JSON.parse(item.people || '[]'); return people.length + ' people'; } catch(e) { return 'Trip'; } })()
      : ((item.participants || []).length + ' people');
    return '<option value="' + item.id + '">' + label + ' • ' + sub + '</option>';
  }).join('');

  picker.innerHTML = '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Add to ' + (type === 'trip' ? 'Trip' : 'Bill') + '</div>'
    + '<div style="font-size:13px;color:var(--white);margin-bottom:10px">Choose where to add ' + targetName + '.</div>'
    + '<select id="pm-inline-select" class="form-input" style="margin-bottom:12px">' + options + '</select>'
    + '<div style="display:flex;gap:8px">'
    + '<button onclick="confirmProfileInlineAdd()" style="flex:1;padding:10px 12px;background:' + (type === 'trip' ? 'var(--green)' : 'rgba(48,209,88,0.12)') + ';border:' + (type === 'trip' ? 'none' : '1px solid rgba(48,209,88,0.2)') + ';border-radius:10px;color:' + (type === 'trip' ? '#000' : 'var(--green)') + ';font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Add Now</button>'
    + '<button onclick="hideProfileInlinePicker()" style="padding:10px 12px;background:transparent;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer">Cancel</button>'
    + '</div>';
}

async function confirmProfileInlineAdd() {
  if (!_profileModalData || !_profilePickerState) return;
  const select = document.getElementById('pm-inline-select');
  const picker = document.getElementById('pm-inline-picker');
  if (!select || !picker) return;
  const selectedId = select.value;
  if (!selectedId) return;
  picker.querySelectorAll('button,select').forEach(el => el.disabled = true);
  const friendLookup = _profileModalData.raven_id ? '@' + _profileModalData.raven_id : ([_profileModalData.first_name, _profileModalData.last_name].filter(Boolean).join(' ') || _profileModalData.first_name || 'Friend');
  try {
    if (_profilePickerState.type === 'trip') {
      let trip = tripDataMap[selectedId];
      if (!trip) {
        const { data } = await db.from('trips').select('*').eq('id', selectedId).single();
        trip = data;
      }
      if (!trip) throw new Error('Trip not found');
      const existingPeople = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]');
      const displayName = _profileModalData.first_name || _profileModalData.raven_id || friendLookup.replace(/^@/, '');
      if (existingPeople.some(p => String(p || '').toLowerCase() === displayName.toLowerCase())) {
        showToast(displayName + ' is already on this trip', 'success');
      } else {
        const res = await fetch(BACKEND + '/trip/' + selectedId + '/add-members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: trip.share_token, members: [friendLookup] })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not add to trip');
        trip.people = JSON.stringify(data.people || existingPeople);
        tripDataMap[selectedId] = trip;
        showToast(displayName + ' added to ' + (trip.name || 'trip'), 'success');
        loadTrips();
      }
    } else {
      const { data: bill } = await db.from('bills').select('*,participants(*)').eq('id', selectedId).single();
      if (!bill) throw new Error('Bill not found');
      await addPersonToExistingBill(bill, friendLookup);
      loadActiveBills();
      loadOverview();
    }
    hideProfileInlinePicker();
    closeProfileModal();
  } catch(e) {
    showToast(e.message || 'Could not add friend', 'error');
    picker.querySelectorAll('button,select').forEach(el => el.disabled = false);
  }
}

function openProfileModal(p) {
  _profileModalData = p;
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.raven_id || 'Unknown';
  const av = document.getElementById('pm-avatar');
  if (av) { if (p.avatar_url) { av.innerHTML = '<img src="' + p.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; av.style.background = 'transparent'; } else { av.textContent = name[0].toUpperCase(); av.style.background = avatarGradients[name.charCodeAt(0) % avatarGradients.length]; } }
  const el = id => document.getElementById(id);
  if (el('pm-name')) el('pm-name').textContent = name;
  if (el('pm-raven-id')) el('pm-raven-id').textContent = p.raven_id ? '@' + p.raven_id : '';
  if (el('pm-email')) el('pm-email').style.display = 'none';
  // Payment methods
  const pm = el('pm-payment-methods');
  if (pm) {
    const chips = [];
    if (p.venmo)    chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#0084FF;border-radius:8px;font-size:12px;font-weight:700;color:#fff"><b>V</b> Venmo</span>');
    if (p.cashapp)  chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#00D632;border-radius:8px;font-size:12px;font-weight:700;color:#000"><b>$</b> Cash App</span>');
    if (p.applepay) chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#1a1a1a;border:1px solid #444;border-radius:8px;font-size:12px;font-weight:700;color:#fff">✦ Apple Pay</span>');
    pm.innerHTML = chips.length ? chips.join('') : '<span style="font-size:12px;color:var(--muted)">No payment methods set up yet</span>';
  }
  // Action buttons — DOM construction only, no onclick with user data
  const ab = el('pm-action-btn');
  if (ab) {
    ab.innerHTML = '';
    const mkBtn = (label, bg, color, border, handler) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.style.cssText = 'width:100%;padding:12px;background:'+bg+';border:'+(border||'none')+';border-radius:10px;font-family:\'Epilogue\',sans-serif;font-size:14px;font-weight:700;color:'+color+';cursor:pointer;display:block;margin-bottom:8px';
      b.addEventListener('click', handler);
      ab.appendChild(b);
      return b;
    };
    mkBtn('✈️ Add to Trip', 'var(--green)', '#000', 'none', addFriendToTrip);
    mkBtn('📋 Add to Bill', 'rgba(48,209,88,0.08)', 'var(--green)', '1px solid rgba(48,209,88,0.2)', addFriendToBill);
    mkBtn('💬 Message', 'rgba(124,58,237,0.1)', 'var(--purple3)', '1px solid rgba(124,58,237,0.25)', () => openDirectMessage(p.id, name, p));
    const rmBtn = mkBtn('Remove Friend', 'rgba(255,68,68,0.06)', '#FF6B6B', '1px solid rgba(255,68,68,0.15)', () => removeFriend(p.id, name));
    rmBtn.id = 'remove-friend-btn-' + (p.id||'');
    rmBtn.style.fontWeight = '600'; rmBtn.style.marginBottom = '0';
  }
  const modal = el('profile-modal');
  if (modal) modal.style.display = 'flex';
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
  _profileModalData = null;
}

function addFriendToTrip() {
  if (!_profileModalData) return;
  const name = _profileModalData.first_name || _profileModalData.raven_id || 'Friend';
  closeProfileModal();
  showPage('trip-hub');
  showToast('Open a trip and use the + People button to add ' + name, 'success');
}

function addFriendToBill() {
  if (!_profileModalData) return;
  const name = _profileModalData.first_name || _profileModalData.raven_id || 'Friend';
  closeProfileModal();
  showPage('create-bill');
  // Pre-populate in the contacts/people list
  setTimeout(() => {
    if (!cbPeople.includes(name)) { cbPeople.push(name); cbRenderPeople(); cbRenderItems(); cbUpdateSummary(); cbGoToStep(2); showToast(name + ' added to bill', 'success'); }
    else { showToast(name + ' already on bill', 'success'); }
  }, 300);
}

async function addPersonToExistingBill(bill, raw) {
  if (!bill?.id) throw new Error('Bill not found');
  const perPerson = parseFloat(bill.per_person || 0) || (bill.participants?.length > 0 ? parseFloat(bill.total) / (bill.participants.length + 1) : parseFloat(bill.total));
  let personEmail = null;
  let personName = raw.replace(/^@/, '');
  const query = raw.startsWith('@') ? raw.slice(1) : raw;
  try {
    const { data: profile } = await db.from('profiles').select('id,first_name,last_name,email,raven_id').or('raven_id.eq.' + query.toLowerCase() + ',first_name.ilike.' + query + ',last_name.ilike.' + query).maybeSingle();
    if (profile) {
      personEmail = profile.email;
      personName = profile.first_name || profile.raven_id || personName;
    }
  } catch(e) {}
  const alreadyOn = (bill.participants || []).some(p => p.name.toLowerCase() === personName.toLowerCase());
  if (alreadyOn) throw new Error(personName + ' is already on this bill');
  const { error } = await db.from('participants').insert({
    bill_id: bill.id,
    phone: personEmail || ('unknown_' + personName.toLowerCase().replace(/\s+/g,'_') + '_' + bill.id),
    name: personName,
    amount: perPerson,
    paid: false
  });
  if (error) throw error;
  showToast(personName + ' added to ' + (bill.name || 'bill') + (personEmail ? ' — will see it on their dashboard' : ''), 'success');
}

function openProfileModal(p) {
  _profileModalData = p;
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.raven_id || 'Unknown';
  const av = document.getElementById('pm-avatar');
  if (av) {
    if (p.avatar_url) {
      av.innerHTML = '<img src="' + p.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      av.style.background = 'transparent';
    } else {
      av.textContent = name[0].toUpperCase();
      av.style.background = avatarGradients[name.charCodeAt(0) % avatarGradients.length];
    }
  }
  const el = id => document.getElementById(id);
  if (el('pm-name')) el('pm-name').textContent = name;
  if (el('pm-raven-id')) el('pm-raven-id').textContent = p.raven_id ? '@' + p.raven_id : '';
  if (el('pm-email')) el('pm-email').style.display = 'none';
  hideProfileInlinePicker();
  const pm = el('pm-payment-methods');
  if (pm) {
    const chips = [];
    if (p.venmo) chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#0084FF;border-radius:8px;font-size:12px;font-weight:700;color:#fff"><b>V</b> Venmo</span>');
    if (p.cashapp) chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#00D632;border-radius:8px;font-size:12px;font-weight:700;color:#000"><b>$</b> Cash App</span>');
    if (p.applepay) chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#1a1a1a;border:1px solid #444;border-radius:8px;font-size:12px;font-weight:700;color:#fff">Apple Pay</span>');
    pm.innerHTML = chips.length ? chips.join('') : '<span style="font-size:12px;color:var(--muted)">No payment methods set up yet</span>';
  }
  const ab = el('pm-action-btn');
  if (ab) {
    ab.innerHTML = '';
    const mkBtn = (label, bg, color, border, handler) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.style.cssText = 'width:100%;padding:12px;background:'+bg+';border:'+(border||'none')+';border-radius:10px;font-family:\'Epilogue\',sans-serif;font-size:14px;font-weight:700;color:'+color+';cursor:pointer;display:block;margin-bottom:8px';
      b.addEventListener('click', handler);
      ab.appendChild(b);
      return b;
    };
    mkBtn('Add to Trip', 'var(--green)', '#000', 'none', () => showProfileInlinePicker('trip'));
    mkBtn('Add to Bill', 'rgba(48,209,88,0.08)', 'var(--green)', '1px solid rgba(48,209,88,0.2)', () => showProfileInlinePicker('bill'));
    mkBtn('Message', 'rgba(124,58,237,0.1)', 'var(--purple3)', '1px solid rgba(124,58,237,0.25)', () => openDirectMessage(p.id, name, p));
    const rmBtn = mkBtn('Remove Friend', 'rgba(255,68,68,0.06)', '#FF6B6B', '1px solid rgba(255,68,68,0.15)', () => removeFriend(p.id, name));
    rmBtn.id = 'remove-friend-btn-' + (p.id || '');
    rmBtn.style.fontWeight = '600';
    rmBtn.style.marginBottom = '0';
  }
  const modal = el('profile-modal');
  if (modal) modal.style.display = 'flex';
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
  hideProfileInlinePicker();
  _profileModalData = null;
}

async function removeFriend(friendId, name) {
  const btn = document.getElementById('remove-friend-btn-' + friendId);
  if (!btn) return;
  // Inline confirm
  if (btn.dataset.confirming === '1') {
    btn.textContent = 'Removing...'; btn.disabled = true;
    try {
      // Delete both directions of the friendship
      await db.from('raven_friends').delete()
        .or('and(user_id.eq.' + currentUser.id + ',friend_id.eq.' + friendId + '),and(user_id.eq.' + friendId + ',friend_id.eq.' + currentUser.id + ')');
      closeProfileModal();
      showToast(name + ' removed from friends', 'success');
      loadFriendsList();
    } catch(e) { showToast('Error removing friend', 'error'); }
    return;
  }
  btn.dataset.confirming = '1';
  btn.textContent = '⚠️ Tap again to confirm';
  btn.style.background = 'rgba(255,68,68,0.15)';
  btn.style.borderColor = 'rgba(255,68,68,0.4)';
  setTimeout(() => {
    if (btn && btn.dataset.confirming === '1') {
      btn.dataset.confirming = '';
      btn.textContent = 'Remove Friend';
      btn.style.background = 'rgba(255,68,68,0.06)';
      btn.style.borderColor = 'rgba(255,68,68,0.15)';
    }
  }, 3000);
}

// ── DIRECT MESSAGING ──────────────────────────────────────────────────────────
let _dmFriendId = null;
let _dmFriendName = '';
let _dmMessages = [];
let _dmSubscription = null;
let _dmUnreadMap = {}; // { friendId: count }

// Auto-linkify text — detect URLs and make them clickable
function linkifyText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  const frag = document.createDocumentFragment();
  parts.forEach(part => {
    if (urlRegex.test(part)) {
      const a = document.createElement('a');
      a.href = part; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = part;
      a.style.cssText = 'color:var(--purple3);text-decoration:underline;word-break:break-all';
      frag.appendChild(a);
    } else if (part) {
      frag.appendChild(document.createTextNode(part));
    }
  });
  return frag;
}

function openDirectMessage(friendId, friendName, friendProfile) {
  _dmFriendId = friendId;
  _dmFriendName = friendName;
  closeProfileModal();
  const dmModal = document.getElementById('dm-modal');
  dmModal.style.display = 'flex';
  dmModal.style.flexDirection = 'column';
  document.getElementById('dm-title').textContent = friendName;
  // Set mini avatar
  const avEl = document.getElementById('dm-avatar-sm');
  if (avEl) {
    if (friendProfile && friendProfile.avatar_url) {
      avEl.innerHTML = '<img src="' + friendProfile.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      avEl.style.background = 'transparent';
    } else {
      avEl.textContent = (friendName[0] || '?').toUpperCase();
      avEl.style.background = avatarGradients[(friendName.charCodeAt(0)||65) % avatarGradients.length];
    }
  }
  document.getElementById('dm-messages').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px"><div class="spinner" style="margin:0 auto 8px"></div>Loading...</div>';
  loadDMMessages(friendId);
  markDMRead(friendId);
  // Check online status
  checkFriendOnline(friendId).then(online => {
    const statusEl = document.getElementById('dm-status');
    if (statusEl) statusEl.innerHTML = online
      ? '<span style="color:#30D158">🟢 Online now</span>'
      : '<span>🪶 Raven friend</span>';
  });
}

function closeDM() {
  document.getElementById('dm-modal').style.display = 'none';
  // Unsubscribe realtime when closing
  if (_dmSubscription) { try { _dmSubscription.unsubscribe(); } catch(e) {} _dmSubscription = null; }
  _dmFriendId = null; _dmMessages = [];
}

async function markDMRead(friendId) {
  if (!currentUser || !friendId) return;
  try {
    await db.from('direct_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', friendId)
      .eq('receiver_id', currentUser.id)
      .is('read_at', null);
    // Clear unread badge for this friend
    _dmUnreadMap[friendId] = 0;
    updateDMBadges();
  } catch(e) {}
}

async function loadDMMessages(friendId) {
  try {
    const { data: msgs, error } = await db.from('direct_messages')
      .select('*')
      .or(
        'and(sender_id.eq.' + currentUser.id + ',receiver_id.eq.' + friendId + '),' +
        'and(sender_id.eq.' + friendId + ',receiver_id.eq.' + currentUser.id + ')'
      )
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    _dmMessages = msgs || [];
    renderDMMessages();
    // Subscribe to realtime new messages
    if (_dmSubscription) try { _dmSubscription.unsubscribe(); } catch(e) {}
    _dmSubscription = db.channel('dm-' + friendId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: 'receiver_id=eq.' + currentUser.id
      }, payload => {
        if (payload.new.sender_id === _dmFriendId) {
          _dmMessages.push(payload.new);
          renderDMMessages();
          markDMRead(_dmFriendId);
        }
      })
      .subscribe();
  } catch(e) {
    document.getElementById('dm-messages').innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;font-size:13px">Messaging not set up yet.<br><span style="font-size:11px;color:var(--muted2)">Run the SQL in the dev notes to enable.</span></div>';
  }
}

function renderDMMessages() {
  const container = document.getElementById('dm-messages');
  if (_dmMessages.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px"><div style="font-size:32px;margin-bottom:8px">👋</div>No messages yet — say hi!</div>';
    return;
  }
  container.innerHTML = '';
  let lastDate = '';
  _dmMessages.forEach((m, idx) => {
    const isMine = m.sender_id === currentUser.id;
    const dt = new Date(m.created_at);
    const dateStr = dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    const timeStr = dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});

    // Date separator
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      const sep = document.createElement('div');
      sep.style.cssText = 'text-align:center;margin:12px 0 8px;font-size:10px;color:var(--muted);font-weight:600;letter-spacing:0.08em;text-transform:uppercase';
      sep.textContent = dateStr;
      container.appendChild(sep);
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:' + (isMine?'row-reverse':'row') + ';gap:8px;margin-bottom:6px;align-items:flex-end';

    const bubble = document.createElement('div');
    bubble.style.cssText = 'max-width:72%;padding:10px 13px;border-radius:' +
      (isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px') +
      ';background:' + (isMine ? 'var(--purple)' : 'var(--dark2)') +
      ';border:1px solid ' + (isMine ? 'rgba(124,58,237,0.35)' : 'var(--border)');

    const textEl = document.createElement('div');
    textEl.style.cssText = 'font-size:14px;color:var(--white);word-break:break-word;line-height:1.5';
    // Render GIF or linkified text
    if (m.gif_url) {
      const gif = document.createElement('img');
      gif.src = m.gif_url;
      gif.style.cssText = 'max-width:200px;max-height:180px;border-radius:8px;display:block;cursor:pointer';
      gif.addEventListener('click', () => window.open(m.gif_url, '_blank'));
      textEl.appendChild(gif);
    } else {
      textEl.appendChild(linkifyText(m.body));
    }
    bubble.appendChild(textEl);

    // Timestamp + read receipt row
    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:4px;justify-content:' + (isMine ? 'flex-end' : 'flex-start');
    const ts = document.createElement('span');
    ts.style.cssText = 'font-size:10px;color:var(--muted)';
    ts.textContent = timeStr;
    meta.appendChild(ts);

    // Read receipt — show on last sent message only
    if (isMine && idx === _dmMessages.length - 1) {
      const tick = document.createElement('span');
      tick.style.cssText = 'font-size:10px;color:' + (m.read_at ? 'var(--green)' : 'var(--muted)');
      tick.title = m.read_at ? 'Read ' + new Date(m.read_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : 'Sent';
      tick.textContent = m.read_at ? '✓✓' : '✓';
      meta.appendChild(tick);
    }

    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    container.appendChild(wrap);
  });
  container.scrollTop = container.scrollHeight;
}

async function sendDMMessage() {
  const input = document.getElementById('dm-input');
  const body = input.value.trim();
  if (!body || !_dmFriendId) return;
  input.value = '';
  const btn = document.getElementById('dm-send-btn');
  btn.disabled = true;
  try {
    const { data, error } = await db.from('direct_messages').insert({
      sender_id: currentUser.id,
      receiver_id: _dmFriendId,
      body
    }).select().single();
    if (error) throw error;
    _dmMessages.push(data);
    renderDMMessages();
  } catch(e) {
    showToast('Could not send — messaging SQL not yet set up', 'error');
    input.value = body;
  }
  btn.disabled = false;
}

// ── ONLINE PRESENCE ──────────────────────────────────────────────────────────
let _presenceInterval = null;

async function updatePresence() {
  if (!currentUser) return;
  try {
    const priv = getPrivacySettings();
    if (priv.appear_offline) return; // don't update if user wants to appear offline
    await db.from('profiles').update({ last_seen: new Date().toISOString(), appear_offline: false }).eq('id', currentUser.id);
  } catch(e) {}
}

async function checkFriendOnline(friendId) {
  if (!friendId) return false;
  try {
    const { data } = await db.from('profiles').select('last_seen, appear_offline').eq('id', friendId).single();
    if (!data?.last_seen) return false;
    if (data.appear_offline) return false; // friend is hiding their presence
    const diff = Date.now() - new Date(data.last_seen).getTime();
    return diff < 5 * 60 * 1000;
  } catch(e) { return false; }
}

function startPresence() {
  updatePresence();
  if (_presenceInterval) clearInterval(_presenceInterval);
  _presenceInterval = setInterval(updatePresence, 60000);
}

// ── GIF SEARCH IN DM ─────────────────────────────────────────────────────────
let _dmGifDebounce = null;
const TENOR_KEY = 'AIzaSyAyimkuYQYF_y7VMHLAoALrYsuCkXMZZFw'; // free Tenor v2 key placeholder

function toggleDMGifPanel() {
  const panel = document.getElementById('dm-gif-panel');
  const btn = document.getElementById('dm-gif-btn');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  btn.style.color = open ? 'var(--muted)' : 'var(--green)';
  if (!open) document.getElementById('dm-gif-search')?.focus();
}

async function searchDMGifs(query) {
  clearTimeout(_dmGifDebounce);
  const results = document.getElementById('dm-gif-results');
  if (!query || query.length < 2) {
    if (results) results.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;width:100%">Type to search GIFs...</div>';
    return;
  }
  _dmGifDebounce = setTimeout(async () => {
    if (results) results.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Searching...</div>';
    try {
      // Use the same Railway /gif-search endpoint that the trip hub uses (Giphy via GIPHY_API_KEY env var)
      const res = await fetch(BACKEND + '/gif-search?q=' + encodeURIComponent(query));
      const data = await res.json();
      if (!results) return;
      results.innerHTML = '';
      (data.gifs || []).forEach(gif => {
        if (!gif.preview) return;
        const img = document.createElement('img');
        img.src = gif.preview;
        img.loading = 'lazy';
        img.style.cssText = 'width:calc(33% - 4px);height:80px;object-fit:cover;border-radius:6px;cursor:pointer;flex-shrink:0';
        img.addEventListener('click', () => sendDMGif(gif.full || gif.preview));
        results.appendChild(img);
      });
      if (!results.children.length) results.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">No results</div>';
    } catch(e) {
      if (results) results.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Search unavailable</div>';
    }
  }, 400);
}

async function sendDMGif(gifUrl) {
  if (!gifUrl || !_dmFriendId) return;
  // Close GIF panel
  const panel = document.getElementById('dm-gif-panel');
  const btn = document.getElementById('dm-gif-btn');
  if (panel) panel.style.display = 'none';
  if (btn) btn.style.color = 'var(--muted)';
  try {
    const { data, error } = await db.from('direct_messages').insert({
      sender_id: currentUser.id,
      receiver_id: _dmFriendId,
      body: '[GIF]',
      gif_url: gifUrl
    }).select().single();
    if (error) throw error;
    _dmMessages.push(data);
    renderDMMessages();
  } catch(e) {
    showToast('Could not send GIF', 'error');
  }
}
async function loadUnreadDMCounts() {
  if (!currentUser) return;
  try {
    const { data: unread } = await db.from('direct_messages')
      .select('sender_id')
      .eq('receiver_id', currentUser.id)
      .is('read_at', null);
    _dmUnreadMap = {};
    (unread || []).forEach(m => {
      _dmUnreadMap[m.sender_id] = (_dmUnreadMap[m.sender_id] || 0) + 1;
    });
    updateDMBadges();
  } catch(e) {}
}

function updateDMBadges() {
  const totalUnread = Object.values(_dmUnreadMap).reduce((s,n) => s + n, 0);

  // Friends page nav badge
  const friendsBadge = document.getElementById('friends-dm-badge');
  if (friendsBadge) {
    friendsBadge.style.display = totalUnread > 0 ? 'flex' : 'none';
    friendsBadge.textContent = totalUnread > 9 ? '9+' : totalUnread;
  }

  // Mobile nav More tab badge
  const mobBadge = document.getElementById('mob-friends-badge');
  if (mobBadge) {
    mobBadge.style.display = totalUnread > 0 ? 'flex' : 'none';
    mobBadge.textContent = totalUnread > 9 ? '9+' : totalUnread;
  }

  // Per-friend badges in friends list
  Object.entries(_dmUnreadMap).forEach(([fid, count]) => {
    const badge = document.getElementById('dm-unread-' + fid);
    if (badge) {
      badge.style.display = count > 0 ? 'flex' : 'none';
      badge.textContent = count > 9 ? '9+' : count;
    }
  });
}

// Poll for new unread messages every 30 seconds when on friends page
let _dmPollInterval = null;
function startDMPolling() {
  if (_dmPollInterval) clearInterval(_dmPollInterval);
  loadUnreadDMCounts();
  _dmPollInterval = setInterval(loadUnreadDMCounts, 30000);
}
function stopDMPolling() {
  if (_dmPollInterval) { clearInterval(_dmPollInterval); _dmPollInterval = null; }
}
async function enrichContactsWithFriends() {
  try {
    const { data: friendships } = await db.from('raven_friends')
      .select('user_id,friend_id').or('user_id.eq.' + currentUser.id + ',friend_id.eq.' + currentUser.id).eq('status','accepted');
    if (!friendships || !friendships.length) return;
    const ids = friendships.map(f => f.user_id === currentUser.id ? f.friend_id : f.user_id);
    const { data: profiles } = await db.from('profiles').select('first_name,email').in('id', ids);
    return (profiles||[]).map(p => ({ name: p.first_name || p.email, phone: p.email, source: 'friends' }));
  } catch(e) { return []; }
}

// ─── TRIP HUB ─────────────────────────────────────────────────────────────────

let tripPeople = [];
const tripUrlMap = {};
const tripDataMap = {}; // stores full trip objects keyed by id — safe alternative to inline onclick data

// ── ROOMMATES (BETA) ──────────────────────────────────────────────────────────
const houseDataMap = {};
const houseAvatarGradients = ['linear-gradient(135deg,#7C3AED,#A855F7)','linear-gradient(135deg,#E8633A,#FF6B35)','linear-gradient(135deg,#0EA5E9,#22C1F1)','linear-gradient(135deg,#30D158,#0EA5E9)','linear-gradient(135deg,#F59E0B,#EF4444)','linear-gradient(135deg,#EC4899,#8B5CF6)'];

function ensureRoommatesLayout() {
  const page = document.getElementById('page-roommates');
  if (!page || page.dataset.enhanced === '1') return;
  page.dataset.enhanced = '1';
  page.innerHTML = `
    <div class="roommates-shell">
      <div class="roommates-hero">
        <div>
          <div class="roommates-kicker">House Mode • RAVEN Beta</div>
          <div class="roommates-hero-title">Roommates, built for the way a house actually runs.</div>
          <div class="roommates-hero-copy">Track the rhythm of home together: rent drops, utility spikes, grocery runs, and the little shared stuff that always turns into “who covered this?” later. This is your house ledger, not a trip clone.</div>
          <div class="roommates-pill-row">
            <div class="roommates-pill">Rent and monthly rhythm</div>
            <div class="roommates-pill">Utilities and household ops</div>
            <div class="roommates-pill">Shared balance in one place</div>
          </div>
        </div>
        <div class="roommates-command">
          <div class="roommates-command-label">RAVEN House Command</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:0.05em;line-height:1;margin-bottom:8px">One place for the house pulse.</div>
          <div style="font-size:13px;color:var(--muted2);line-height:1.7">See how many houses are active, how much is still open, and whether your home is running clean or needs a nudge.</div>
          <div class="roommates-command-grid">
            <div class="roommates-command-card"><div class="roommates-command-value" id="rm-command-houses">0</div><div class="roommates-command-sub">active homes</div></div>
            <div class="roommates-command-card"><div class="roommates-command-value" id="rm-command-open">$0</div><div class="roommates-command-sub">currently unsettled</div></div>
            <div class="roommates-command-card"><div class="roommates-command-value" id="rm-command-recurring">0</div><div class="roommates-command-sub">recurring house costs</div></div>
            <div class="roommates-command-card"><div class="roommates-command-value" id="rm-command-settled">0%</div><div class="roommates-command-sub">settlement health</div></div>
          </div>
        </div>
      </div>
      <div id="roommates-stats" class="roommates-stats"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <div class="page-title" style="font-size:34px">House <span>Ledgers</span></div>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">Each house gets its own operating view for recurring life, not just one-off receipts.</div>
        </div>
        <button class="bill-action-btn" style="padding:10px 20px;font-size:13px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25);color:var(--green)" onclick="openCreateHouse()"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M1 7.5L8 2l7 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg> New House</button>
      </div>
      <div id="houses-list" class="roommates-houses-grid"><div class="loading"><div class="spinner"></div> Loading...</div></div>
    </div>`;
}

function renderRoommatesOverview(houses) {
  const statsEl = document.getElementById('roommates-stats');
  const activeEl = document.getElementById('rm-command-houses');
  const openEl = document.getElementById('rm-command-open');
  const recurringEl = document.getElementById('rm-command-recurring');
  const settledEl = document.getElementById('rm-command-settled');
  if (!statsEl) return;

  const totals = houses.reduce((acc, h) => {
    const people = Array.isArray(h.people) ? h.people : JSON.parse(h.people || '[]');
    let recurring = [];
    try { recurring = Array.isArray(h.recurring_expenses) ? h.recurring_expenses : JSON.parse(h.recurring_expenses || '[]'); } catch(e) {}
    let settledCount = 0;
    try {
      let sp = h.settled_people;
      if (typeof sp === 'string') sp = JSON.parse(sp);
      if (sp && typeof sp === 'object' && !Array.isArray(sp)) {
        const rcptCr = {};
        Object.entries(sp).forEach(([k, v]) => {
          if ((parseFloat(v)||0) <= 0) return;
          if (k.includes('::receipt::')) rcptCr[k.split('::receipt::')[0].toLowerCase()] = (rcptCr[k.split('::receipt::')[0].toLowerCase()]||0) + (parseFloat(v)||0);
        });
        settledCount = people.filter(p => rcptCr[String(p).toLowerCase()] > 0).length;
      }
    } catch(e) {}
    acc.houses += 1;
    acc.people += people.length;
    acc.outstanding += parseFloat(h.total || 0) || 0;
    acc.expenses += parseInt(h.receipt_count || 0, 10) || 0;
    acc.recurring += recurring.length;
    acc.settled += settledCount;
    acc.totalPeople += people.length;
    return acc;
  }, { houses:0, people:0, outstanding:0, expenses:0, recurring:0, settled:0, totalPeople:0 });

  const health = totals.totalPeople > 0 ? Math.round((totals.settled / totals.totalPeople) * 100) : 100;
  if (activeEl) activeEl.textContent = String(totals.houses);
  if (openEl) openEl.textContent = '$' + totals.outstanding.toFixed(0);
  if (recurringEl) recurringEl.textContent = String(totals.recurring);
  if (settledEl) settledEl.textContent = health + '%';

  statsEl.innerHTML = `
    <div class="roommates-stat">
      <div class="roommates-stat-label">Housemates Tracked</div>
      <div class="roommates-stat-value">${totals.people}</div>
      <div class="roommates-stat-note">People currently flowing through your active house ledgers.</div>
    </div>
    <div class="roommates-stat">
      <div class="roommates-stat-label">Open House Balance</div>
      <div class="roommates-stat-value" style="color:${totals.outstanding > 0 ? '#FFB04A' : 'var(--green)'}">$${totals.outstanding.toFixed(2)}</div>
      <div class="roommates-stat-note">${totals.outstanding > 0 ? 'Money still needs to be squared up across the house.' : 'Everything is clean and settled right now.'}</div>
    </div>
    <div class="roommates-stat">
      <div class="roommates-stat-label">Recurring Rhythm</div>
      <div class="roommates-stat-value" style="color:var(--purple3)">${totals.recurring}</div>
      <div class="roommates-stat-note">Monthly costs already mapped into your home system.</div>
    </div>
    <div class="roommates-stat">
      <div class="roommates-stat-label">House Health</div>
      <div class="roommates-stat-value" style="color:${health >= 80 ? 'var(--green)' : health >= 50 ? '#FFB04A' : '#FF6B6B'}">${health}%</div>
      <div class="roommates-stat-note">${totals.expenses} logged expenses across ${totals.houses} house ledger${totals.houses === 1 ? '' : 's'}.</div>
    </div>`;
}

async function loadHouses() {
  ensureRoommatesLayout();
  const container = document.getElementById('houses-list');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';
  const statsEl = document.getElementById('roommates-stats');
  if (statsEl) statsEl.innerHTML = '';
  let houses = [];
  const seen = new Set();
  try {
    const { data: created, error: e1 } = await db.from('trips').select('*')
      .eq('creator_email', currentUser.email)
      .eq('type', 'roommates')
      .order('created_at', { ascending: false });
    if (e1 && (e1.code === '42703' || (e1.message && e1.message.includes('type')))) {
      if (statsEl) statsEl.innerHTML = '';
      container.innerHTML = `<div class="empty-state">
        <span class="empty-icon">⚙️</span>
        <div class="empty-title">One-time setup needed</div>
        <div class="empty-sub" style="max-width:400px;margin:0 auto">Run this in your <a href="https://supabase.com/dashboard" target="_blank" style="color:var(--green)">Supabase SQL Editor</a> to enable Roommates:</div>
        <pre style="background:var(--dark2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:16px auto;max-width:480px;text-align:left;font-size:12px;color:#A78BFA;overflow-x:auto;white-space:pre-wrap">ALTER TABLE trips ADD COLUMN IF NOT EXISTS type TEXT DEFAULT NULL;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS recurring_expenses JSONB DEFAULT '[]';</pre>
        <div class="empty-sub">After running, refresh this page.</div>
      </div>`;
      return;
    }
    (created || []).forEach(h => { if (!seen.has(h.id)) { seen.add(h.id); houses.push(h); } });
    const emailEscaped = currentUser.email.toLowerCase().replace(/[%_]/g, '\$&');
    const { data: member } = await db.from('trips').select('*')
      .ilike('member_emails', '%' + emailEscaped + '%')
      .eq('type', 'roommates')
      .order('created_at', { ascending: false });
    (member || []).forEach(h => { if (!seen.has(h.id)) { seen.add(h.id); houses.push(h); } });
  } catch(e) { console.warn('loadHouses error:', e); }

  houses.forEach(h => { houseDataMap[h.id] = h; });

  if (houses.length === 0) {
    renderRoommatesOverview([]);
    container.innerHTML = `<div class="roommates-empty" style="grid-column:1/-1">
      <span class="empty-icon">🏠</span>
      <div class="roommates-empty-title">No house ledger yet</div>
      <div class="roommates-empty-sub">Start your first RAVEN home and turn rent, utilities, groceries, and recurring house costs into one shared operating system.</div>
      <button onclick="openCreateHouse()" style="margin-top:16px;padding:10px 24px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25);border-radius:10px;color:var(--green);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer">🏠 Create a House</button>
    </div>`;
    return;
  }
  renderRoommatesOverview(houses);
  container.innerHTML = houses.map(h => renderHouseCard(h)).join('');
}

function renderHouseCard(h) {
  const people = Array.isArray(h.people) ? h.people : JSON.parse(h.people || '[]');
  const isCreator = h.creator_email === currentUser.email;
  const outstanding = parseFloat(h.total || 0);
  const safeId = JSON.stringify(h.id);
  houseDataMap[h.id] = h;

  // Parse settled count
  let settledCount = 0, totalDebtors = 0;
  try {
    let sp = h.settled_people;
    if (typeof sp === 'string') sp = JSON.parse(sp);
    if (sp && typeof sp === 'object' && !Array.isArray(sp)) {
      const rcptCr = {};
      Object.entries(sp).forEach(([k, v]) => {
        if ((parseFloat(v)||0) <= 0) return;
        if (k.includes('::receipt::')) { const pk = k.split('::receipt::')[0].toLowerCase(); rcptCr[pk] = (rcptCr[pk]||0)+(parseFloat(v)||0); }
      });
      totalDebtors = people.length;
      settledCount = people.filter(p => rcptCr[p.toLowerCase()] > 0).length;
    }
  } catch(e) {}

  const receiptsCount = h.receipt_count || 0;
  const shareToken = h.share_token || '';
  const tripUrl = 'https://ravensplit.com/trip/' + h.id + '?t=' + shareToken;

  return `<div class="bill-card" onclick="openHouse(${safeId})">
    <div>
      <div class="bill-name">🏠 ${h.name} <span class="bill-id">${h.id}</span></div>
      <div class="bill-meta">
        <span>${people.length} housemate${people.length !== 1 ? 's' : ''}</span>
        <span>${receiptsCount} expense${receiptsCount !== 1 ? 's' : ''}</span>
        ${outstanding > 0 ? `<span style="color:var(--orange);font-weight:600">$${outstanding.toFixed(2)} outstanding</span>` : '<span style="color:var(--green)">All settled ✓</span>'}
      </div>
    </div>
    <div class="bill-amount" style="color:${outstanding > 0 ? 'var(--orange)' : 'var(--green)'}">$${outstanding.toFixed(2)}</div>
    <div class="bill-progress-wrap">
      <div class="bill-progress-label">${settledCount}/${people.length} settled</div>
      <div class="bill-progress"><div class="bill-progress-fill" style="width:${people.length > 0 ? Math.round(settledCount/people.length*100) : 0}%;background:var(--green)"></div></div>
    </div>
    <div class="bill-actions" onclick="event.stopPropagation()">
      ${isCreator ? `<button class="bill-action-btn btn-remind" onclick="sendHouseReminder(${safeId})">🔔 Remind</button>` : ''}
      <button class="bill-action-btn" onclick="navigator.clipboard.writeText('${tripUrl}').then(()=>showToast('Link copied!','success'))" style="background:rgba(0,140,255,0.1);border:1px solid rgba(0,140,255,0.2);color:#4DB8FF">📤 Share</button>
      <a class="bill-action-btn btn-view" href="${tripUrl}" style="display:inline-flex;align-items:center;text-decoration:none">View →</a>
    </div>
  </div>`;
}

function openHouse(houseId) {
  const h = houseDataMap[houseId];
  if (!h) return;
  const shareToken = h.share_token || '';
  window.location.href = 'https://ravensplit.com/trip/' + houseId + '?t=' + shareToken;
}

function renderHouseCard(h) {
  const people = Array.isArray(h.people) ? h.people : JSON.parse(h.people || '[]');
  const isCreator = h.creator_email === currentUser.email;
  const outstanding = parseFloat(h.total || 0);
  const safeId = JSON.stringify(h.id);
  houseDataMap[h.id] = h;
  let recurring = [];
  try { recurring = Array.isArray(h.recurring_expenses) ? h.recurring_expenses : JSON.parse(h.recurring_expenses || '[]'); } catch(e) {}

  let settledCount = 0;
  try {
    let sp = h.settled_people;
    if (typeof sp === 'string') sp = JSON.parse(sp);
    if (sp && typeof sp === 'object' && !Array.isArray(sp)) {
      const rcptCr = {};
      Object.entries(sp).forEach(([k, v]) => {
        if ((parseFloat(v)||0) <= 0) return;
        if (k.includes('::receipt::')) {
          const key = k.split('::receipt::')[0].toLowerCase();
          rcptCr[key] = (rcptCr[key] || 0) + (parseFloat(v) || 0);
        }
      });
      settledCount = people.filter(p => rcptCr[String(p).toLowerCase()] > 0).length;
    }
  } catch(e) {}

  const receiptsCount = h.receipt_count || 0;
  const shareToken = h.share_token || '';
  const tripUrl = 'https://ravensplit.com/trip/' + h.id + '?t=' + shareToken;
  const settledPct = people.length > 0 ? Math.round(settledCount / people.length * 100) : 100;
  const rhythmHtml = recurring.length > 0
    ? recurring.slice(0, 3).map(e => `<span class="house-card-rhythm-pill">${String(e.name || 'Recurring').replace(/</g,'&lt;')} • $${(parseFloat(e.amount || 0) || 0).toFixed(0)}/mo</span>`).join('')
    : '<div class="house-card-rhythm-empty">No recurring costs mapped yet. Add rent, utilities, wifi, or groceries to make this feel like a true house ledger.</div>';
  const avatarHtml = people.slice(0, 4).map((p, i) => `<div class="house-avatar" style="background:${houseAvatarGradients[i % houseAvatarGradients.length]}" title="${String(p).replace(/"/g,'&quot;')}">${String(p).charAt(0).toUpperCase()}</div>`).join('') + (people.length > 4 ? `<div class="house-avatar" style="background:#1F1F2A">+${people.length - 4}</div>` : '');

  return `<div class="house-card" onclick="openHouse(${safeId})">
    <div class="house-card-top">
      <div>
        <div class="house-card-kicker">House Ledger</div>
        <div class="house-card-title">${String(h.name || 'House').replace(/</g,'&lt;')}</div>
        <div class="house-card-id">${h.id}</div>
      </div>
      <div class="house-card-balance">
        <div class="house-card-balance-label">Open Balance</div>
        <div class="house-card-balance-value ${outstanding > 0 ? 'open' : 'settled'}">$${outstanding.toFixed(2)}</div>
      </div>
    </div>
    <div class="house-card-meta">
      <span class="house-card-chip">${people.length} housemate${people.length !== 1 ? 's' : ''}</span>
      <span class="house-card-chip">${receiptsCount} logged expense${receiptsCount !== 1 ? 's' : ''}</span>
      <span class="house-card-chip">${recurring.length} recurring item${recurring.length !== 1 ? 's' : ''}</span>
      <span class="house-card-chip" style="color:${outstanding > 0 ? '#FFB04A' : 'var(--green)'}">${outstanding > 0 ? 'Needs settlement' : 'All settled'}</span>
    </div>
    <div class="house-card-panel">
      <div class="house-card-rhythm">
        <div class="house-card-panel-label">Monthly Rhythm</div>
        <div class="house-card-rhythm-list">${rhythmHtml}</div>
      </div>
      <div class="house-card-settlement">
        <div class="house-card-panel-label">Settlement Health</div>
        <div class="house-settle-row">
          <div class="house-settle-value">${settledPct}%</div>
          <div style="font-size:12px;color:var(--muted)">${settledCount}/${people.length || 0} settled</div>
        </div>
        <div class="house-progress-track"><div class="house-progress-fill" style="width:${settledPct}%"></div></div>
        <div class="house-settle-copy" style="margin-top:10px">${outstanding > 0 ? 'There is still shared money moving around this house.' : 'The house is balanced right now.'}</div>
      </div>
    </div>
    <div class="house-card-footer">
      <div class="house-avatar-stack">${avatarHtml}</div>
      <div class="house-card-actions" onclick="event.stopPropagation()">
        ${isCreator ? `<button class="house-btn remind" onclick="sendHouseReminder(${safeId})">Remind</button>` : ''}
        <button class="house-btn share" onclick="navigator.clipboard.writeText('${tripUrl}').then(()=>showToast('Link copied!','success'))">Share</button>
        <a class="house-btn view" href="${tripUrl}" style="display:inline-flex;align-items:center;text-decoration:none">Open House</a>
      </div>
    </div>
  </div>`;
}

function sendHouseReminder(houseId) {
  showToast('Reminders sent to housemates!', 'success');
}

function openCreateHouse() {
  document.getElementById('create-house-modal').classList.add('open');
  document.getElementById('house-name-input').value = '';
  document.getElementById('house-people-input').value = '';
  document.getElementById('house-recurring-list').innerHTML = '';
  renderRecurringExpenses([]);
}

function closeCreateHouse() {
  document.getElementById('create-house-modal').classList.remove('open');
}

let _houseRecurring = [];

function addRecurringExpense() {
  const name = document.getElementById('new-exp-name').value.trim();
  const amt = parseFloat(document.getElementById('new-exp-amt').value);
  if (!name || !amt) { showToast('Enter expense name and amount', 'error'); return; }
  _houseRecurring.push({ name, amount: amt, day: 1 });
  document.getElementById('new-exp-name').value = '';
  document.getElementById('new-exp-amt').value = '';
  renderRecurringExpenses(_houseRecurring);
}

function removeRecurringExpense(i) {
  _houseRecurring.splice(i, 1);
  renderRecurringExpenses(_houseRecurring);
}

function renderRecurringExpenses(list) {
  const el = document.getElementById('house-recurring-list');
  if (!el) return;
  if (list.length === 0) { el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No recurring expenses added yet</div>'; return; }
  el.innerHTML = list.map((e, i) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--dark2);border-radius:8px;margin-bottom:6px">
    <span style="font-size:13px;font-weight:600">${e.name}</span>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:13px;color:var(--green)">$${e.amount.toFixed(2)}/mo</span>
      <button onclick="removeRecurringExpense(${i})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0">×</button>
    </div>
  </div>`).join('');
}

async function saveCreateHouse() {
  const name = document.getElementById('house-name-input').value.trim();
  const peopleRaw = document.getElementById('house-people-input').value.trim();
  if (!name) { showToast('Enter a house name', 'error'); return; }
  const people = peopleRaw ? peopleRaw.split(',').map(p => p.trim()).filter(Boolean) : [];
  const myName = JSON.parse(localStorage.getItem('raven_profile') || '{}').first_name || currentUser.email.split('@')[0];
  if (!people.includes(myName)) people.unshift(myName);

  const btn = document.getElementById('create-house-btn');
  btn.textContent = 'Creating...'; btn.disabled = true;

  try {
    const shareToken = Math.random().toString(36).substr(2, 10);
    const inviteToken = Math.random().toString(36).substr(2, 10);
    const houseId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const { data: house, error } = await db.from('trips').insert({
      id: houseId,
      name,
      type: 'roommates',
      creator_email: currentUser.email,
      people: JSON.stringify(people),
      total: 0,
      receipt_count: 0,
      share_token: shareToken,
      invite_token: inviteToken,
      recurring_expenses: JSON.stringify(_houseRecurring),
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    showToast('🏠 ' + name + ' created!', 'success');
    closeCreateHouse();
    _houseRecurring = [];
    loadHouses();
  } catch(e) {
    console.error('createHouse error:', e);
    showToast('Error creating house: ' + e.message, 'error');
    btn.textContent = 'Create House'; btn.disabled = false;
  }
}
// ── END ROOMMATES ──────────────────────────────────────────────────────────────



async function loadTrips() {
  const container = document.getElementById('trips-list');
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';

  let trips = [];
  const seen = new Set();

  try {
    // 1. Trips created by this user
    const { data: createdTrips, error: e1 } = await db.from('trips').select('*')
      .eq('creator_email', currentUser.email)
      .neq('type', 'roommates')
      .order('created_at', { ascending: false });
    if (e1) console.warn('loadTrips creator query:', e1.message);
    (createdTrips || []).forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); trips.push(t); } });

    // 2. Trips where member_emails JSON string contains this user's email (added via raven_id)
    const emailEscaped = currentUser.email.toLowerCase().replace(/[%_]/g, '\\$&');
    const { data: memberTrips, error: e2 } = await db.from('trips').select('*')
      .ilike('member_emails', '%' + emailEscaped + '%')
      .neq('type', 'roommates')
      .order('created_at', { ascending: false });
    if (e2) console.warn('loadTrips member_emails query:', e2.message);
    (memberTrips || []).forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); trips.push(t); } });

    // 3. Trips stored in localStorage joined_trips (joined via invite link)
    try {
      const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
      const joinedIds = Array.isArray(local.joined_trips) ? local.joined_trips : [];
      const newIds = joinedIds.filter(id => !seen.has(id));
      if (newIds.length > 0) {
        const { data: joinedTrips } = await db.from('trips').select('*').in('id', newIds).neq('type', 'roommates');
        (joinedTrips || []).forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); trips.push(t); } });
      }
    } catch(e) {}

    // 4. Trips from DB profiles.joined_trips column (extra fallback)
    try {
      const { data: prof } = await db.from('profiles').select('joined_trips').eq('id', currentUser.id).maybeSingle();
      if (prof?.joined_trips) {
        let dbJoined = typeof prof.joined_trips === 'string' ? JSON.parse(prof.joined_trips) : prof.joined_trips;
        const extraIds = (dbJoined || []).filter(id => !seen.has(id));
        if (extraIds.length > 0) {
          const { data: extraTrips } = await db.from('trips').select('*').in('id', extraIds).neq('type', 'roommates');
          (extraTrips || []).forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); trips.push(t); } });
        }
      }
    } catch(e) {}

  } catch(e) { console.warn('loadTrips error:', e); }

  trips.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (trips.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon empty-icon-svg"><svg class="raven-icon empty"><use href="#icon-trip-hub"></use></svg></span><div class="empty-title">No trips yet</div><div class="empty-sub">Create a trip hub or join one via an invite link</div></div>';
    return;
  }

  container.innerHTML = trips.map(t => {
    const people = Array.isArray(t.people) ? t.people : JSON.parse(t.people || '[]');
    const tripUrl = FRONTEND + '/trip/' + t.id + '?t=' + t.share_token;
    const tripUrlReceipt = tripUrl + '&action=receipt';
    tripUrlMap[t.id] = tripUrl;
    // Store full trip data safely — never pass user content through onclick attributes
    tripDataMap[t.id] = t;
    const isCreator = t.creator_email === currentUser.email;
    let coAdminsList = [];
    try { coAdminsList = Array.isArray(t.co_admins) ? t.co_admins : JSON.parse(t.co_admins || '[]'); } catch(e) {}
    const userEmail = (currentUser.email || '').toLowerCase();
    const _localProfile = (() => { try { return JSON.parse(localStorage.getItem('raven_profile') || '{}'); } catch(e) { return {}; } })();
    const userDisplayName = (_localProfile.first_name || userEmail.split('@')[0] || '').toLowerCase();
    const isCoAdmin = coAdminsList.some(a => { const al = a.toLowerCase(); return al === userEmail || al === userDisplayName || userEmail.startsWith(al + '@') || al === userEmail.split('@')[0]; });
    const isAdmin = isCreator || isCoAdmin;
    const safeId = String(t.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const isCompletedTrip = (() => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      if (t.end_date) return String(t.end_date) <= today;
      if (t.trip_date) return String(t.trip_date) < today && parseFloat(t.total || 0) <= 0;
      return parseFloat(t.total || 0) <= 0 && parseInt(t.receipt_count || 0, 10) > 0;
    })();
    const tripStatusLabel = isCompletedTrip ? 'Completed' : 'Active';
    const adminBadge = isCreator ? ' <span style="font-size:10px;color:#30D158;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);padding:2px 7px;border-radius:8px">admin</span>' : isCoAdmin ? ' <span style="font-size:10px;color:#A855F7;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);padding:2px 7px;border-radius:8px">co-admin</span>' : ' <span style="font-size:10px;color:#A855F7;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.2);padding:2px 7px;border-radius:8px">member</span>';
    return '<div class="bill-card">'
      + '<div class="trip-open-hit" style="cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent" onpointerdown="warmTrip(\'' + safeId + '\')" onclick="openTrip(\'' + safeId + '\')"><div class="bill-name"><svg class="trip-title-icon"><use href="#icon-trip-hub"></use></svg>' + t.name.replace(/</g,'&lt;') + ' <span class="bill-id">' + t.id + '</span>' + adminBadge + '</div>'
      + '<div class="bill-meta"><span>' + people.length + ' people</span><span>' + (t.receipt_count || 0) + ' receipts</span>' + (function() {
          // Use server-computed settled_count/debtor_count when available (accurate)
          // Fall back to settled_people parsing for trips not yet backfilled
          if (parseFloat(t.total||0) <= 0) return ''; // all settled, no badge needed
          // Count ALL people: payers (owe $0) count as settled, debtors who paid also count
          const totalPeople = people.length;
          let settledPeople = 0;
          if (t.debtor_count != null && t.settled_count != null) {
            // non-debtors (payers) = totalPeople - debtorCount, they're all settled
            const nonDebtors = Math.max(0, totalPeople - t.debtor_count);
            settledPeople = nonDebtors + Math.min(t.settled_count, t.debtor_count);
          } else {
            // Fallback: parse settled_people
            let sp = t.settled_people;
            if (typeof sp === 'string') { try { sp = JSON.parse(sp); } catch(e) { sp = {}; } }
            sp = (sp && typeof sp === 'object' && !Array.isArray(sp)) ? sp : {};
            const rcptCr = {};
            Object.entries(sp).forEach(([k, v]) => {
              if ((parseFloat(v)||0) <= 0) return;
              if (k.includes('::receipt::')) { const pk = k.split('::receipt::')[0].toLowerCase(); rcptCr[pk] = (rcptCr[pk]||0) + (parseFloat(v)||0); }
            });
            settledPeople = people.filter(p => rcptCr[p.toLowerCase()] > 0).length;
          }
          if (settledPeople >= totalPeople) return '';
          return '<span style="color:#FF9A3C;font-weight:600">' + settledPeople + '/' + totalPeople + ' settled</span>';
        })() + (parseFloat(t.total||0) <= 0 ? '<span style="color:var(--green)">All settled ✓</span>' : '') + '</div></div>'
      + '<div class="bill-amount trip-open-hit" style="cursor:pointer;color:' + (parseFloat(t.total||0)>0?'#FF9A3C':'var(--green)') + ';touch-action:manipulation;-webkit-tap-highlight-color:transparent" onpointerdown="warmTrip(\'' + safeId + '\')" onclick="openTrip(\'' + safeId + '\')">$' + parseFloat(t.total || 0).toFixed(2) + '</div>'
      + '<div class="bill-progress-wrap"><div class="bill-progress-label">' + tripStatusLabel + '</div><div class="bill-progress"><div class="bill-progress-fill" style="width:100%"></div></div></div>'
      + '<div class="bill-actions" onclick="event.stopPropagation()">'
      + '<a class="bill-action-btn btn-remind" href="' + tripUrlReceipt + '" style="display:inline-flex;align-items:center;text-decoration:none;background:rgba(48,209,88,0.1);color:var(--green);border:1px solid rgba(48,209,88,0.25)"><svg class="bill-action-icon"><use href="#icon-active-bills"></use></svg>Receipt</a>'
      + (isAdmin ? '<button class="bill-action-btn admin-btn" data-tripid="' + t.id + '" style="background:rgba(124,58,237,0.1);color:var(--purple3);border:1px solid rgba(124,58,237,0.2)"><svg class="bill-action-icon"><use href="#icon-roommates"></use></svg>Admin</button>' : '')
      + '<a class="bill-action-btn btn-view" href="' + tripUrl + '" style="display:inline-flex;align-items:center;text-decoration:none">Open Trip →</a>'
      + '</div></div>';
  }).join('');

  // Wire admin buttons directly after rendering — bypasses stopPropagation on parent
  container.querySelectorAll('.admin-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      openTripAdmin(this.getAttribute('data-tripid'));
    });
  });
  container.querySelectorAll('.btn-view').forEach(btn => {
    btn.style.touchAction = 'manipulation';
    btn.style.webkitTapHighlightColor = 'transparent';
    btn.addEventListener('pointerdown', function() {
      const href = this.getAttribute('href') || '';
      const match = href.match(/\/trip\/([^?]+)/);
      if (match) warmTrip(match[1]);
    }, { passive: true });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const href = this.getAttribute('href') || '';
      const match = href.match(/\/trip\/([^?]+)/);
      if (match) openTrip(match[1]);
    });
  });
  container.querySelectorAll('.trip-open-hit, .btn-view').forEach(el => {
    ['mouseenter', 'focus', 'touchstart'].forEach(evt => {
      el.addEventListener(evt, function() {
        const href = this.getAttribute('href');
        if (href && !warmedTripUrls.has(href)) {
          warmedTripUrls.add(href);
          try {
            const prefetch = document.createElement('link');
            prefetch.rel = 'prefetch';
            prefetch.as = 'document';
            prefetch.href = href;
            document.head.appendChild(prefetch);
          } catch(e) {}
          return;
        }
        const match = (this.getAttribute('onclick') || '').match(/openTrip\((.+)\)/);
        if (!match) return;
        try { warmTrip(JSON.parse(match[1])); } catch(e) {}
      }, { passive: true });
    });
  });
}

function openCreateTrip() {
  tripPeople = [];
  document.getElementById('trip-name-input').value = '';
  document.getElementById('trip-date-input').value = '';
  renderTripPeopleChips();
  document.getElementById('create-trip-modal').style.display = 'flex';
}
function closeCreateTrip() { document.getElementById('create-trip-modal').style.display = 'none'; }

function tripAddPerson() {
  const input = document.getElementById('trip-person-input');
  const name = input.value.trim();
  if (!name || tripPeople.includes(name)) return;
  tripPeople.push(name); input.value = '';
  renderTripPeopleChips();
}

function renderTripPeopleChips() {
  document.getElementById('trip-people-chips').innerHTML = tripPeople.map(p =>
    '<div class="person-tag">@' + p + ' <button onclick="tripPeople=tripPeople.filter(x=>x!==' + JSON.stringify(p) + ');renderTripPeopleChips()">×</button></div>'
  ).join('');
}

let tripCoverBase64 = null;

function handleTripCover(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const resized = await new Promise(res => {
      const img = new Image(); img.onload = function() {
        let {width:w,height:h} = img;
        const maxW = 800, maxH = 400;
        if (w > maxW) { h = Math.round(h*maxW/w); w = maxW; }
        if (h > maxH) { w = Math.round(w*maxH/h); h = maxH; }
        const c = document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h); res(c.toDataURL('image/jpeg',0.85));
      }; img.src = e.target.result;
    });
    tripCoverBase64 = resized.split(',')[1];
    document.getElementById('trip-cover-preview').src = resized;
    document.getElementById('trip-cover-preview').style.display = 'block';
    document.getElementById('trip-cover-empty').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function createTrip() {
  const name = document.getElementById('trip-name-input').value.trim();
  const tripDate = document.getElementById('trip-date-input').value;
  if (!name) return showToast('Enter a trip name', 'error');
  if (tripPeople.length === 0) return showToast('Add at least one person', 'error');

  const btn = document.querySelector('#create-trip-modal .submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  try {
    const body = { name, people: tripPeople, creator_email: currentUser.email };
    if (tripDate) body.trip_date = tripDate;
    if (tripCoverBase64) body.cover_image = tripCoverBase64;

    const res = await fetch(BACKEND + '/trip/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { showToast('Error: ' + (data.error || 'Could not create trip'), 'error'); return; }

    const { tripId, shareToken } = data;
    closeCreateTrip();
    tripCoverBase64 = null;
    showToast('✈️ Trip "' + name + '" created!', 'success');
    const tripUrl = FRONTEND + '/trip/' + tripId + '?t=' + shareToken;
    setTimeout(async () => {
      const myName = (() => { try { return JSON.parse(localStorage.getItem('raven_profile')||'{}').first_name || 'Someone'; } catch(e) { return 'Someone'; } })();
      const msg = myName + ' invited you to join "' + name + '" on RAVEN 🪶\n\nSplit bills free with RAVEN | ravensplit.com\n\n' + tripUrl;
      if (navigator.share) {
        try { await navigator.share({ text: msg }); return; } catch(e) {}
      }
      navigator.clipboard.writeText(tripUrl).then(()=>showToast('✅ Link copied!','success')).catch(()=>{});
    }, 500);
    loadTrips();
  } catch (err) {
    console.error('createTrip error:', err);
    showToast('Network error — try again', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✈️ Create Trip'; }
  }
}

function openTrip(tripId) {
  const url = getTripOpenUrl(tripId);
  if (!url) return;
  if (openTrip._pendingUrl === url) return;
  openTrip._pendingUrl = url;
  try { warmTrip(tripId); } catch(e) {}
  window.location.assign(url);
}

function getTripOpenUrl(tripId) {
  const base = tripUrlMap[tripId];
  if (!base) return '';
  try {
    const profile = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    const name = (profile.first_name || '').trim();
    return name ? base + '&name=' + encodeURIComponent(name) : base;
  } catch(e) {
    return base;
  }
}

const warmedTripUrls = new Set();
function warmTrip(tripId) {
  const url = getTripOpenUrl(tripId);
  if (!url || warmedTripUrls.has(url)) return;
  warmedTripUrls.add(url);
  try {
    const origin = new URL(url, window.location.href).origin;
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = origin;
    document.head.appendChild(preconnect);
    const prefetch = document.createElement('link');
    prefetch.rel = 'prefetch';
    prefetch.as = 'document';
    prefetch.href = url;
    document.head.appendChild(prefetch);
  } catch(e) {}
  try {
    fetch(url, { method: 'GET', credentials: 'include', cache: 'force-cache' }).catch(() => {});
  } catch(e) {}
}

// ─── CREATE BILL WIZARD ───────────────────────────────────────────────────────

let cbItems = [], cbPeople = [], cbImageBase64 = null, cbImageMediaType = 'image/jpeg', cbCurrentStep = 1, cbAssignModalItemId = null;

// ── LIVE MODE TOGGLE ──
let cbLiveMode = false;
let cbLivePeopleCount = 2;

function cbToggleLiveMode() {
  cbLiveMode = !cbLiveMode;
  const toggle = document.getElementById('cb-live-toggle');
  const knob = document.getElementById('cb-live-knob');
  const peopleWrap = document.getElementById('cb-live-people-wrap');
  if (cbLiveMode) {
    toggle.style.background = 'rgba(48,209,88,0.25)';
    const badge = document.getElementById('cb-live-mode-badge'); if (badge) badge.style.display = 'block';
    toggle.style.borderColor = '#30D158';
    knob.style.background = '#30D158';
    knob.style.transform = 'translateX(22px)';
    peopleWrap.style.display = 'block';
    // In live mode, force itemized split and hide even split option
    cbSetSplitMode('itemized');
  } else {
    toggle.style.background = 'rgba(255,255,255,0.1)';
    toggle.style.borderColor = 'rgba(255,255,255,0.15)';
    knob.style.background = '#9896A8';
    knob.style.transform = 'translateX(0)';
    peopleWrap.style.display = 'none';
    const badge2 = document.getElementById('cb-live-mode-badge'); if (badge2) badge2.style.display = 'none';
  }
}

function cbLivePeopleAdj(delta) {
  cbLivePeopleCount = Math.max(2, Math.min(20, cbLivePeopleCount + delta));
  const el = document.getElementById('cb-live-count');
  if (el) el.textContent = cbLivePeopleCount;
}

function cbGoToStep(step) {
  [1,2,3].forEach(s => {
    const el = document.getElementById('cb-step-' + s);
    if (el) el.style.display = s === step ? 'block' : 'none';
    const tab = document.getElementById('cbs-' + s);
    if (tab) {
      const isActive = s === step, isDone = s < step;
      tab.style.background = isActive ? 'rgba(48,209,88,0.06)' : isDone ? 'rgba(124,58,237,0.06)' : 'transparent';
      const num = document.getElementById('cbs-' + s + '-num');
      if (num) {
        num.style.background = isActive ? 'var(--green)' : isDone ? 'var(--purple)' : 'var(--dark3)';
        num.style.color = isActive ? '#000' : isDone ? '#fff' : 'var(--muted)';
        num.style.border = isActive || isDone ? 'none' : '2px solid var(--border)';
        num.textContent = isDone ? '✓' : String(s);
      }
      const stepLabel = tab.querySelector('div:first-child');
      const stepName  = tab.querySelector('div:last-child');
      if (stepLabel) stepLabel.style.color = isActive ? 'var(--green)' : isDone ? 'var(--purple3)' : 'var(--muted)';
      if (stepName)  stepName.style.color  = isActive || isDone ? 'var(--white)' : 'var(--muted)';
    }
  });
  cbCurrentStep = step;
  if (step === 3) cbBuildStep3();
}

let cbSplitMode = 'even';
const cbChargeSplits = { tax: 'proportional', tip: 'proportional', service: 'proportional', misc: 'proportional' };

function cbSetChargeSplit(charge, mode) {
  cbChargeSplits[charge] = mode;
  const prop = document.getElementById('cb-' + charge + '-split-prop');
  const even = document.getElementById('cb-' + charge + '-split-even');
  if (!prop || !even) return;
  if (mode === 'proportional') {
    prop.style.cssText = 'flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);color:var(--purple3)';
    even.style.cssText = 'flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:var(--dark3);border:1px solid var(--border);color:var(--muted)';
  } else {
    prop.style.cssText = 'flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:var(--dark3);border:1px solid var(--border);color:var(--muted)';
    even.style.cssText = 'flex:1;padding:5px 8px;border-radius:6px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.3);color:var(--green)';
  }
  cbUpdateSummary();
}

function cbSetSplitMode(mode) {
  if (mode === 'even' && cbItems.length > 0) {
    const evenTotalEl = document.getElementById('cb-even-total');
    if (evenTotalEl) evenTotalEl.value = cbItems.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0).toFixed(2);
  }
  cbSplitMode = mode;
  const EB = document.getElementById('cb-split-even-btn'), IB = document.getElementById('cb-split-item-btn');
  const EW = document.getElementById('cb-even-total-wrap'), IW = document.getElementById('cb-itemized-wrap');
  if (mode === 'even') {
    if (EB) EB.style.cssText = 'flex:1;padding:9px;border-radius:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.3);color:var(--green)';
    if (IB) IB.style.cssText = 'flex:1;padding:9px;border-radius:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;background:var(--dark2);border:1px solid var(--border);color:var(--muted)';
    if (EW) EW.style.display = 'block'; if (IW) IW.style.display = 'none';
  } else {
    if (EB) EB.style.cssText = 'flex:1;padding:9px;border-radius:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;background:var(--dark2);border:1px solid var(--border);color:var(--muted)';
    if (IB) IB.style.cssText = 'flex:1;padding:9px;border-radius:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);color:var(--purple3)';
    if (EW) EW.style.display = 'none'; if (IW) IW.style.display = 'block';
  }
  cbUpdateSummary();
}

function cbComputePersonAmounts() {
  const n = cbPeople.length; if (n === 0) return {};
  const tax = parseFloat(document.getElementById('cb-tax')?.value) || 0;
  const tip = parseFloat(document.getElementById('cb-tip')?.value) || 0;
  const svc = parseFloat(document.getElementById('cb-service')?.value) || 0;
  const msc = parseFloat(document.getElementById('cb-misc')?.value) || 0;
  const itemAmts = {}; cbPeople.forEach(p => { itemAmts[p] = 0; });
  let subtotal = 0;
  if (cbSplitMode === 'even') {
    const base = parseFloat(document.getElementById('cb-even-total')?.value) || 0;
    subtotal = base; cbPeople.forEach(p => { itemAmts[p] = base / n; });
  } else {
    cbItems.forEach(item => {
      const asgn = item.assignees.length > 0 ? item.assignees : cbPeople;
      const sh = item.price / asgn.length;
      asgn.forEach(p => { itemAmts[p] = (itemAmts[p]||0) + sh; });
      subtotal += item.price;
    });
  }
  const totals = { ...itemAmts };
  [['tax',tax],['tip',tip],['service',svc],['misc',msc]].forEach(([key,amt]) => {
    if (amt <= 0) return;
    if (cbChargeSplits[key] === 'proportional' && subtotal > 0) {
      cbPeople.forEach(p => { totals[p] = (totals[p]||0) + amt * ((itemAmts[p]||0) / subtotal); });
    } else {
      cbPeople.forEach(p => { totals[p] = (totals[p]||0) + amt / n; });
    }
  });
  return totals;
}

function cbSkipToStep2() { cbGoToStep(2); cbRenderItems(); cbRenderPeople(); cbSetSplitMode(cbItems.length > 0 ? 'itemized' : 'even'); }
function cbHandleFile(event) { const file = event.target.files[0]; if (file) cbLoadPhoto(file); }
function cbHandleDrop(event) { event.preventDefault(); event.currentTarget.style.borderColor = 'rgba(48,209,88,0.3)'; const file = event.dataTransfer.files[0]; if (file) cbLoadPhoto(file); }

function cbLoadPhoto(file) {
  cbImageMediaType = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = async e => {
    // For screenshots (PNG), keep as PNG to preserve text clarity
    // For photos (JPEG), resize to 2048px at high quality
    const isPNG = file.type === 'image/png';
    const resized = await cbResizeImage(e.target.result, 2048, isPNG ? 'image/png' : 'image/jpeg', isPNG ? 1.0 : 0.92);
    // Update media type in case we kept PNG
    cbImageMediaType = isPNG ? 'image/png' : 'image/jpeg';
    cbImageBase64 = resized.split(',')[1];
    document.getElementById('cb-preview-img').src = resized;
    document.getElementById('cb-empty-state').style.display = 'none';
    document.getElementById('cb-preview-state').style.display = 'block';
    document.getElementById('cb-scan-wrap').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function cbResizeImage(dataUrl, maxSize, outputType, quality) {
  outputType = outputType || 'image/jpeg';
  quality = quality || 0.92;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = function() {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
        else { width = Math.round(width * maxSize / height); height = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(outputType, quality));
    };
    img.src = dataUrl;
  });
}

function cbClearPhoto() {
  cbImageBase64 = null;
  document.getElementById('cb-preview-img').src = '';
  document.getElementById('cb-empty-state').style.display = 'block';
  document.getElementById('cb-preview-state').style.display = 'none';
  document.getElementById('cb-scan-wrap').style.display = 'none';
  document.getElementById('cb-scanning').style.display = 'none';
  document.getElementById('cb-scan-result').style.display = 'none';
  document.getElementById('cb-file-input').value = '';
  // Also reset scanned data so next receipt starts fresh
  cbItems = [];
  const taxEl = document.getElementById('cb-tax'); if (taxEl) taxEl.value = '';
  const tipEl = document.getElementById('cb-tip'); if (tipEl) tipEl.value = '';
  const svcEl = document.getElementById('cb-service'); if (svcEl) svcEl.value = '';
  const miscEl = document.getElementById('cb-misc'); if (miscEl) miscEl.value = '';
  const nameEl = document.getElementById('cb-name'); if (nameEl) nameEl.value = '';
  const scannedBadge = document.getElementById('cb-scanned-badge'); if (scannedBadge) scannedBadge.style.display = 'none';
  cbSplitMode = 'even';
  cbRenderItems();
  cbUpdateSummary();
}

// Fetch with timeout helper
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

// Wake the Railway server if it's sleeping (cold start can take 10-20s)
async function wakeServer() {
  try {
    await fetchWithTimeout(BACKEND + '/', {}, 25000);
  } catch(e) { /* ignore — we'll retry the real request anyway */ }
}

async function cbScanReceipt() {
  if (!cbImageBase64) return showToast('Upload a receipt photo first', 'error');
  // Track scan attempt
  try { if (typeof posthog !== 'undefined') posthog.capture('receipt_scan_started'); } catch(e) {}
  document.getElementById('cb-scan-wrap').style.display = 'none';
  document.getElementById('cb-scanning').style.display = 'block';
  document.getElementById('cb-scan-result').style.display = 'none';

  const statusEl = document.getElementById('cb-scan-status');
  let iv = null;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function showScanError(msg) {
    clearInterval(iv);
    document.getElementById('cb-scanning').style.display = 'none';
    document.getElementById('cb-scan-wrap').style.display = 'block';
    document.getElementById('cb-scan-result').style.display = 'block';
    document.getElementById('cb-scan-result').innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(255,68,68,0.07);border:1px solid rgba(255,68,68,0.2);border-radius:10px">' +
      '<span>⚠️</span><span style="font-size:13px;color:#FF6B6B;font-weight:600">' + msg + '</span></div>';
  }

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      // On first attempt, ping server to wake it from cold sleep
      if (attempt === 1) {
        setStatus('RAVEN is starting up...');
        await wakeServer();
        setStatus('Analyzing receipt...');
      } else {
        setStatus('Retrying... (attempt ' + attempt + ' of ' + MAX_RETRIES + ')');
        // Brief pause between retries
        await new Promise(r => setTimeout(r, 2000));
      }

      // Rotate status messages while waiting
      const msgs = ['Analyzing receipt layout...', 'Reading item names and prices...', 'Detecting tax and tip...', 'Almost done...'];
      let mi = 0;
      iv = setInterval(() => { if (mi < msgs.length) setStatus(msgs[mi++]); }, 2000);

      // 60s timeout — enough for Railway cold start + Claude processing
      const res = await fetchWithTimeout(BACKEND + '/demo/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: cbImageBase64, mediaType: cbImageMediaType })
      }, 60000);

      clearInterval(iv);

      if (!res.ok) {
        if (attempt < MAX_RETRIES) continue; // retry on server error
        throw new Error('Server error ' + res.status);
      }

      const data = await res.json();
      console.log('Scan response:', data.success, 'items:', data.items?.length, 'error:', data.error);

      // Full success — got items
      if (data.success && data.items && data.items.length > 0) {
        clearInterval(iv);
        // Always update name and tax from the new scan (overwrite previous)
        if (data.bill_name) document.getElementById('cb-name').value = data.bill_name;
        cbItems = data.items.map((item, i) => ({ id: Date.now() + i, name: item.name, price: parseFloat(item.price) || 0, assignees: [] }));
        cbSplitMode = 'itemized';
        // Always reset tax/tip to new receipt values (clear if not present)
        const taxInput = document.getElementById('cb-tax'); if (taxInput) taxInput.value = data.tax > 0 ? parseFloat(data.tax).toFixed(2) : '';
        const tipInput = document.getElementById('cb-tip'); if (tipInput) tipInput.value = data.tip > 0 ? parseFloat(data.tip).toFixed(2) : '';
        const serviceInput = document.getElementById('cb-service'); if (serviceInput) serviceInput.value = (data.service_fee || 0) > 0 ? parseFloat(data.service_fee).toFixed(2) : '';
        const miscInput = document.getElementById('cb-misc'); if (miscInput) miscInput.value = (data.misc || 0) > 0 ? parseFloat(data.misc).toFixed(2) : '';
        document.getElementById('cb-scanning').style.display = 'none';
        const badge = document.getElementById('cb-scanned-badge');
        if (badge) badge.style.display = 'flex';
        const summaryBits = ['Tax $' + (data.tax || 0).toFixed(2)];
        if ((data.service_fee || 0) > 0) summaryBits.push('Service $' + parseFloat(data.service_fee).toFixed(2));
        if ((data.misc || 0) > 0) summaryBits.push('Fees $' + parseFloat(data.misc).toFixed(2));
        document.getElementById('cb-scan-summary').textContent = data.items.length + ' items found · ' + summaryBits.join(' · ');
        document.getElementById('cb-scan-result').style.display = 'block';
        document.getElementById('cb-scan-result').innerHTML =
          '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(48,209,88,0.07);border:1px solid rgba(48,209,88,0.2);border-radius:10px">' +
          '<span>✅</span><span style="font-size:13px;color:var(--green);font-weight:600">' + cbItems.length + ' items found — moving to next step...</span></div>';
        cbRenderItems(); cbUpdateSummary();
        showToast('✅ ' + cbItems.length + ' items scanned!', 'success');
        setTimeout(() => cbGoToStep(2), 800);
        return;
      }

      // Partial success — got total but no line items
      if (data.success && data.total > 0 && (!data.items || data.items.length === 0)) {
        clearInterval(iv);
        if (data.bill_name) document.getElementById('cb-name').value = data.bill_name;
        const _taxEl = document.getElementById('cb-tax'); if (_taxEl) _taxEl.value = data.tax > 0 ? parseFloat(data.tax).toFixed(2) : '';
        const _tipEl = document.getElementById('cb-tip'); if (_tipEl) _tipEl.value = data.tip > 0 ? parseFloat(data.tip).toFixed(2) : '';
        const _svcEl = document.getElementById('cb-service'); if (_svcEl) _svcEl.value = (data.service_fee || 0) > 0 ? parseFloat(data.service_fee).toFixed(2) : '';
        const _miscEl = document.getElementById('cb-misc'); if (_miscEl) _miscEl.value = (data.misc || 0) > 0 ? parseFloat(data.misc).toFixed(2) : '';
        cbSplitMode = 'even';
        const scannedSubtotal = parseFloat(data.subtotal) > 0
          ? parseFloat(data.subtotal)
          : Math.max(0, parseFloat(data.total || 0) - parseFloat(data.tax || 0) - parseFloat(data.tip || 0) - parseFloat(data.service_fee || 0) - parseFloat(data.misc || 0) + parseFloat(data.discount || 0));
        document.getElementById('cb-even-total').value = scannedSubtotal.toFixed(2);
        document.getElementById('cb-scanning').style.display = 'none';
        document.getElementById('cb-scan-result').style.display = 'block';
        document.getElementById('cb-scan-result').innerHTML =
          '<div style="padding:12px 16px;background:rgba(255,152,0,0.07);border:1px solid rgba(255,152,0,0.25);border-radius:10px">' +
          '<div style="font-size:13px;color:#FFA726;font-weight:600;margin-bottom:4px">⚠️ Scanned total: $' + parseFloat(data.total).toFixed(2) + ' — line items unclear</div>' +
          '<div style="font-size:12px;color:var(--muted)">' + (data.warning || 'Total has been filled in. You can split evenly or add items manually.') + '</div></div>';
        cbUpdateSummary();
        showToast('Scanned $' + parseFloat(data.total).toFixed(2) + ' — add items manually', 'success');
        setTimeout(() => cbGoToStep(2), 1200);
        return;
      }

      // Server returned specific error
      if (data.error) {
        clearInterval(iv);
        showScanError(data.error);
        return;
      }

      // Empty result — retry
      if (attempt < MAX_RETRIES) {
        setStatus('No items found yet, retrying...');
        continue;
      }
      throw new Error('no_items');

    } catch(err) {
      clearInterval(iv);
      if (err.name === 'AbortError') {
        // Timeout — retry if we have attempts left
        if (attempt < MAX_RETRIES) {
          setStatus('Server is waking up, retrying...');
          continue;
        }
        showScanError('Server took too long to respond. Please try again in a moment.');
        return;
      }
      if (err.message === 'no_items') {
        clearInterval(iv);
        document.getElementById('cb-scanning').style.display = 'none';
        document.getElementById('cb-scan-wrap').style.display = 'block';
        document.getElementById('cb-scan-result').style.display = 'block';
        document.getElementById('cb-scan-result').innerHTML =
          '<div style="padding:14px 16px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.25);border-radius:10px">' +
          '<div style="font-size:13px;color:#FF6B35;font-weight:600;margin-bottom:4px">⚠️ Could not read items from this image</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-bottom:10px">Tips: make sure the receipt/order summary is clearly visible. Screenshots of apps (Uber Eats, DoorDash) work best when the items and prices are fully visible.</div>' +
          '<button onclick="cbGoToStep(2)" style="padding:7px 14px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);border-radius:8px;color:var(--purple3);font-family:\'Epilogue\',sans-serif;font-size:12px;font-weight:600;cursor:pointer">→ Enter items manually</button>' +
          '</div>';
        return;
      }
      if (attempt < MAX_RETRIES) continue;
      showScanError('Scan failed. The server may be starting up — please try again in 15 seconds.');
      return;
    }
  }
}

function cbAddPerson() { const input = document.getElementById('cb-person-input'); const name = input.value.trim(); if (!name || cbPeople.includes(name)) return; cbPeople.push(name); input.value = ''; cbRenderPeople(); cbRenderItems(); cbUpdateSummary(); }
function cbRemovePerson(name) { cbPeople = cbPeople.filter(p => p !== name); cbItems.forEach(item => { item.assignees = item.assignees.filter(a => a !== name); }); cbRenderPeople(); cbRenderItems(); cbUpdateSummary(); }
function cbRenderPeople() {
  // Build chips with DOM — no innerHTML onclick to avoid name escaping issues
  const container = document.getElementById('cb-people-chips');
  container.innerHTML = '';
  cbPeople.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'person-tag';
    const label = document.createElement('span');
    label.textContent = '@' + p;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Remove ' + p;
    btn.addEventListener('click', () => cbRemovePerson(p));
    chip.appendChild(label);
    chip.appendChild(btn);
    container.appendChild(chip);
  });
  // Update "Who paid?" dropdown
  const sel = document.getElementById('cb-paidby');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select who paid —</option>';
    cbPeople.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      if (p === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  }
}

function cbAddItem() { const nameEl = document.getElementById('cb-item-name'), priceEl = document.getElementById('cb-item-price'); const name = nameEl.value.trim(), price = parseFloat(priceEl.value); if (!name || isNaN(price) || price <= 0) return; cbItems.push({ id: Date.now(), name, price, assignees: [] }); nameEl.value = ''; priceEl.value = ''; cbRenderItems(); cbUpdateSummary(); }
function cbRemoveItem(id) { cbItems = cbItems.filter(i => i.id !== id); cbRenderItems(); cbUpdateSummary(); }

function cbRenderItems() {
  const container = document.getElementById('cb-items-list');
  document.getElementById('cb-item-count').textContent = cbItems.length + ' item' + (cbItems.length !== 1 ? 's' : '');
  if (cbItems.length === 0) { container.innerHTML = '<div style="text-align:center;padding:18px;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:10px">No items yet</div>'; return; }
  container.innerHTML = '';
  cbItems.forEach(item => {
    const assignedHTML = item.assignees.length > 0
      ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">' + item.assignees.map(a => '<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.2);color:var(--purple3)">' + a + '</span>').join('') + '</div>'
      : '';
    const row = document.createElement('div');
    row.style.cssText = 'background:var(--dark2);border:1px solid ' + (item.assignees.length > 0 ? 'rgba(168,85,247,0.3)' : 'var(--border)') + ';border-radius:10px;overflow:hidden';

    const inner = document.createElement('div');
    inner.style.cssText = 'display:flex;align-items:center;gap:10px;padding:11px 14px';

    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'flex:1;min-width:0';

    // Editable name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.name;
    nameInput.style.cssText = 'width:100%;font-size:13px;font-weight:500;background:transparent;border:none;border-bottom:1px solid transparent;color:var(--white);font-family:inherit;padding:2px 0;outline:none;cursor:text';
    nameInput.addEventListener('focus', () => { nameInput.style.borderBottomColor = 'rgba(124,58,237,0.4)'; });
    nameInput.addEventListener('blur', () => { nameInput.style.borderBottomColor = 'transparent'; item.name = nameInput.value.trim() || item.name; cbUpdateSummary(); });
    nameWrap.appendChild(nameInput);
    if (assignedHTML) { const ad = document.createElement('div'); ad.innerHTML = assignedHTML; nameWrap.appendChild(ad); }

    const priceEl = document.createElement('div');
    priceEl.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted2);flex-shrink:0";
    priceEl.textContent = '$' + item.price.toFixed(2);

    inner.appendChild(nameWrap);
    inner.appendChild(priceEl);

    if (cbPeople.length > 0) {
      const assignBtn = document.createElement('button');
      assignBtn.textContent = '→ Assign';
      assignBtn.style.cssText = "padding:4px 10px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:6px;color:var(--purple3);font-size:11px;font-weight:600;cursor:pointer;font-family:'Epilogue',sans-serif;white-space:nowrap;flex-shrink:0";
      assignBtn.addEventListener('click', () => cbOpenAssign(item.id));
      inner.appendChild(assignBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.textContent = '×';
    delBtn.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:0.5;padding:0;flex-shrink:0';
    delBtn.addEventListener('click', () => { cbRemoveItem(item.id); });
    inner.appendChild(delBtn);

    row.appendChild(inner);
    container.appendChild(row);
  });
}

function cbOpenAssign(itemId) {
  cbAssignModalItemId = itemId;
  const item = cbItems.find(i => i.id === itemId); if (!item) return;
  document.getElementById('cb-assign-item-name').textContent = item.name + ' — $' + item.price.toFixed(2);
  cbRenderAssignModal(itemId);
  document.getElementById('cb-assign-modal').style.display = 'flex';
}

function cbRenderAssignModal(itemId) {
  const item = cbItems.find(i => i.id === itemId);
  if (!item) return;

  // Build assign buttons with DOM — no onclick strings with user data
  const btnsContainer = document.getElementById('cb-assign-people-btns');
  btnsContainer.innerHTML = '';
  cbPeople.forEach(p => {
    const isAssigned = item.assignees.includes(p);
    const btn = document.createElement('button');
    btn.textContent = (isAssigned ? '✓ ' : '') + p;
    btn.style.cssText = 'padding:8px 16px;border-radius:8px;font-family:\'Epilogue\',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;background:' + (isAssigned ? 'rgba(48,209,88,0.15)' : 'var(--dark3)') + ';border:1px solid ' + (isAssigned ? 'rgba(48,209,88,0.3)' : 'var(--border)') + ';color:' + (isAssigned ? 'var(--green)' : 'var(--muted2)');
    btn.addEventListener('click', () => { cbToggleAssign(itemId, p); });
    btnsContainer.appendChild(btn);
  });

  // Build assigned list
  const list = document.getElementById('cb-assign-list');
  if (item.assignees.length === 0) {
    list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">No one assigned yet</div>';
  } else {
    const share = (item.price / item.assignees.length).toFixed(2);
    list.innerHTML = item.assignees.map(a =>
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--dark3);border-radius:8px;margin-bottom:6px"><span style="font-size:13px;font-weight:500">' + a + '</span><span style="font-size:13px;color:var(--green);font-weight:600">$' + share + '</span></div>'
    ).join('');
  }
}

function cbToggleAssign(itemId, personName) {
  const item = cbItems.find(i => i.id === itemId); if (!item) return;
  if (item.assignees.includes(personName)) item.assignees = item.assignees.filter(a => a !== personName);
  else item.assignees.push(personName);
  cbRenderAssignModal(itemId); cbRenderItems(); cbUpdateSummary();
}
function cbCloseAssign() { document.getElementById('cb-assign-modal').style.display = 'none'; }

function cbUpdateSummary() {
  const tax = parseFloat(document.getElementById('cb-tax')?.value) || 0;
  const tip = parseFloat(document.getElementById('cb-tip')?.value) || 0;
  const svc = parseFloat(document.getElementById('cb-service')?.value) || 0;
  const msc = parseFloat(document.getElementById('cb-misc')?.value) || 0;
  const subtotal = cbSplitMode === 'even'
    ? (parseFloat(document.getElementById('cb-even-total')?.value) || 0)
    : cbItems.reduce((s,i) => s + i.price, 0);
  const total = subtotal + tax + tip + svc + msc;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = '$' + v.toFixed(2); };
  set('cb-subtotal', subtotal); set('cb-tax-display', tax); set('cb-tip-display', tip);
  set('cb-service-display', svc); set('cb-misc-display', msc); set('cb-total-display', total);
  const sr = document.getElementById('cb-service-row'); if (sr) sr.style.display = svc > 0 ? 'flex' : 'none';
  const mr = document.getElementById('cb-misc-row');    if (mr) mr.style.display = msc > 0 ? 'flex' : 'none';
  const liveEl = document.getElementById('cb-per-person-live');
  if (liveEl && cbPeople.length > 0 && total > 0 && !cbLiveMode) {
    const amts = cbComputePersonAmounts();
    const paidBy = document.getElementById('cb-paidby')?.value || '';
    liveEl.innerHTML = '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted2);font-weight:700;margin-bottom:6px">Per person</div>' +
      cbPeople.map(p => {
        const isPayer = p === paidBy;
        return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--border)">' +
          '<span style="color:var(--muted)">@' + p + (isPayer ? ' <span style="font-size:10px;color:var(--purple3)">paid</span>' : '') + '</span>' +
          '<span style="color:' + (isPayer ? 'var(--purple3)' : 'var(--green)') + ';font-weight:700">$' + (amts[p]||0).toFixed(2) + '</span></div>';
      }).join('');
  } else if (liveEl) {
    if (cbLiveMode) liveEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 0">⚡ Amounts calculated live as guests claim items</div>';
    else liveEl.innerHTML = '';
  }
}

function cbBuildStep3() {
  const name = document.getElementById('cb-name').value || 'Untitled Bill';
  const tax = parseFloat(document.getElementById('cb-tax')?.value) || 0;
  const tip = parseFloat(document.getElementById('cb-tip')?.value) || 0;
  const svc = parseFloat(document.getElementById('cb-service')?.value) || 0;
  const msc = parseFloat(document.getElementById('cb-misc')?.value) || 0;
  const subtotal = cbSplitMode === 'even'
    ? (parseFloat(document.getElementById('cb-even-total')?.value) || 0)
    : cbItems.reduce((s,i) => s + i.price, 0);
  const total = subtotal + tax + tip + svc + msc;
  const personAmounts = cbComputePersonAmounts();
  const paidBy = document.getElementById('cb-paidby')?.value || '';

  document.getElementById('cb-final-name').textContent = name;
  document.getElementById('cb-final-meta').textContent = (cbSplitMode === 'even' ? 'Split evenly' : cbItems.length + ' items') + ' · $' + total.toFixed(2);
  document.getElementById('cb-final-total').textContent = '$' + total.toFixed(2);

  const list = document.getElementById('cb-per-person-list');
  list.innerHTML = '';
  if (cbPeople.length === 0) { list.innerHTML = '<div style="color:var(--muted);font-size:13px">No people added</div>'; return; }

  // Payer badge
  if (paidBy) {
    const badge = document.createElement('div');
    badge.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(124,58,237,0.07);border:1px solid rgba(124,58,237,0.2);border-radius:10px';
    badge.innerHTML = '<div style="font-size:18px">💳</div><div><div style="font-size:13px;font-weight:700;color:var(--purple3)">' + paidBy + ' paid the bill</div><div style="font-size:11px;color:var(--muted)">Others will owe them their share</div></div>';
    list.appendChild(badge);
  }

  // In Live Mode: show names only, no pre-computed amounts
  if (cbLiveMode) {
    const liveNote = document.createElement('div');
    liveNote.style.cssText = 'padding:12px 14px;background:rgba(48,209,88,0.06);border:1px solid rgba(48,209,88,0.2);border-radius:10px;margin-bottom:8px';
    liveNote.innerHTML = '<div style="font-size:13px;font-weight:700;color:#30D158;margin-bottom:4px">⚡ Live Mode active</div><div style="font-size:12px;color:var(--muted);line-height:1.5">Amounts are calculated live as guests claim their items. Share the QR code — everyone taps what they ordered.</div>';
    list.appendChild(liveNote);
    const nonPayers = cbPeople.filter(p => p !== paidBy);
    nonPayers.forEach(p => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:var(--dark2);border:1px solid var(--border);border-radius:10px';
      row.innerHTML = '<span style="font-size:14px;font-weight:600">@' + p + '</span><span style="font-size:12px;color:var(--muted)">will claim items live →</span>';
      list.appendChild(row);
    });
    return;
  }

  cbPeople.forEach(p => {
    const total_p = personAmounts[p] || 0;
    const isPayer = p === paidBy;

    // Figure out this person's item breakdown
    const lines = [];

    if (cbSplitMode === 'even') {
      const base = parseFloat(document.getElementById('cb-even-total')?.value) || 0;
      lines.push({ label: 'Split share', amount: base / cbPeople.length });
    } else {
      // Items assigned to this person
      const myItems = cbItems.filter(item => item.assignees.includes(p));
      const unassigned = cbItems.filter(item => item.assignees.length === 0);
      myItems.forEach(item => lines.push({ label: item.name, amount: item.price / item.assignees.length }));
      if (unassigned.length > 0) {
        const unassignedTotal = unassigned.reduce((s,i) => s + i.price, 0);
        lines.push({ label: unassigned.length + ' unassigned item' + (unassigned.length > 1 ? 's' : '') + ' ÷ ' + cbPeople.length, amount: unassignedTotal / cbPeople.length });
      }
    }

    // Shared charges
    const itemSubtotal = lines.reduce((s,l) => s + l.amount, 0);
    if (tax > 0)  lines.push({ label: 'Tax (' + (cbChargeSplits.tax === 'proportional' ? Math.round(itemSubtotal/subtotal*100) + '% share' : 'even split') + ')', amount: cbChargeSplits.tax === 'proportional' && subtotal > 0 ? tax * itemSubtotal / subtotal : tax / cbPeople.length });
    if (tip > 0)  lines.push({ label: 'Tip (' + (cbChargeSplits.tip === 'proportional' ? Math.round(itemSubtotal/subtotal*100) + '% share' : 'even split') + ')', amount: cbChargeSplits.tip === 'proportional' && subtotal > 0 ? tip * itemSubtotal / subtotal : tip / cbPeople.length });
    if (svc > 0)  lines.push({ label: 'Service fee', amount: cbChargeSplits.service === 'proportional' && subtotal > 0 ? svc * itemSubtotal / subtotal : svc / cbPeople.length });
    if (msc > 0)  lines.push({ label: 'Misc', amount: cbChargeSplits.misc === 'proportional' && subtotal > 0 ? msc * itemSubtotal / subtotal : msc / cbPeople.length });

    // Card — clicking toggles detail
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid ' + (isPayer ? 'rgba(124,58,237,0.3)' : 'var(--border)') + ';border-radius:12px;overflow:hidden;cursor:pointer';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:' + (isPayer ? 'rgba(124,58,237,0.06)' : 'var(--dark2)');
    header.innerHTML =
      '<div><div style="font-weight:600;font-size:14px">@' + p + (isPayer ? ' <span style="font-size:10px;background:rgba(124,58,237,0.15);color:var(--purple3);border-radius:6px;padding:2px 6px;vertical-align:middle">paid</span>' : '') + '</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + (isPayer ? 'collecting from others' : lines.length + ' line item' + (lines.length !== 1 ? 's' : '') + ' — tap for breakdown') + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:26px;color:' + (isPayer ? 'var(--purple3)' : 'var(--green)') + '">$' + total_p.toFixed(2) + '</div>' +
      '<span id="step3-chevron-' + p.replace(/\s+/g,'_') + '" style="color:var(--muted);font-size:12px">▾</span>' +
      '</div>';

    const detail = document.createElement('div');
    detail.style.cssText = 'display:none;border-top:1px solid var(--border);background:var(--dark3);padding:12px 16px';
    detail.innerHTML = lines.map((l, i) =>
      '<div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;' + (i < lines.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.04)' : '') + '">' +
      '<span style="color:var(--muted)">' + l.label + '</span>' +
      '<span style="font-family:\'JetBrains Mono\',monospace;color:var(--white)">$' + l.amount.toFixed(2) + '</span>' +
      '</div>'
    ).join('') +
    '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding-top:8px;margin-top:4px;border-top:1px solid var(--border)">' +
    '<span>Total</span><span style="color:' + (isPayer ? 'var(--purple3)' : 'var(--green)') + '">$' + total_p.toFixed(2) + '</span></div>';

    header.addEventListener('click', () => {
      const open = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : 'block';
      const ch = document.getElementById('step3-chevron-' + p.replace(/\s+/g,'_'));
      if (ch) ch.textContent = open ? '▾' : '▴';
    });

    card.appendChild(header);
    card.appendChild(detail);
    list.appendChild(card);
  });
}
async function cbCreateFinalBill() {
  const name = document.getElementById('cb-name').value.trim();
  if (!name) return showToast('Enter a bill name', 'error');
  if (cbPeople.length === 0) return showToast('Add at least one person', 'error');
  const tax = parseFloat(document.getElementById('cb-tax')?.value) || 0;
  const tip = parseFloat(document.getElementById('cb-tip')?.value) || 0;
  const svc = parseFloat(document.getElementById('cb-service')?.value) || 0;
  const msc = parseFloat(document.getElementById('cb-misc')?.value) || 0;
  let total;
  if (cbSplitMode === 'even') {
    const base = parseFloat(document.getElementById('cb-even-total')?.value) || 0;
    if (base <= 0) return showToast('Enter the total amount', 'error');
    total = base + tax + tip + svc + msc;
  } else {
    const subtotal = cbItems.reduce((s,i) => s + i.price, 0);
    if (subtotal <= 0) return showToast('Add at least one item', 'error');
    total = subtotal + tax + tip + svc + msc;
  }
  const personAmounts = cbComputePersonAmounts();
  const paidBy = document.getElementById('cb-paidby')?.value || '';
  const btn = document.getElementById('cb-final-btn');
  btn.textContent = 'Creating...'; btn.disabled = true;
  const isLiveMode = cbLiveMode;
  const livePeopleCount = cbLivePeopleCount;
  const billId = generateId();
  let receiptData = null;
  if (cbImageBase64) { try { const compressed = await cbResizeImage('data:image/jpeg;base64,' + cbImageBase64, 800); receiptData = compressed.split(',')[1]; } catch(e) { receiptData = cbImageBase64; } }
  const shareToken = Array.from({length:16}, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*62)]).join('');

  // Try insert with all fields, fall back progressively if columns don't exist
  let inserted = false;
  // Base data without live_mode (in case column doesn't exist yet)
  const baseData = { id: billId, creator_phone: currentUser.email, name, total, per_person: total / cbPeople.length, status: 'active', share_token: shareToken, ...(tax > 0 ? {tax} : {}), ...(tip > 0 ? {tip} : {}), ...(svc > 0 ? {service_fee: svc} : {}), ...(msc > 0 ? {misc: msc} : {}) };
  const attempts = [
    { ...baseData, ...(paidBy ? { paid_by: paidBy } : {}), ...(receiptData ? { receipt_image: receiptData } : {}) },
    { ...baseData, ...(paidBy ? { paid_by: paidBy } : {}) },
    baseData
  ];
  let insertError = null;
  for (const attempt of attempts) {
    const { error } = await db.from('bills').insert(attempt);
    if (!error) { inserted = true; break; }
    console.error('Bill insert attempt failed:', error.message, 'keys:', Object.keys(attempt).join(','));
    insertError = error;
  }
  if (!inserted) {
    btn.textContent = 'Create Bill'; btn.disabled = false;
    return showToast('Error: ' + (insertError?.message || 'Could not create bill'), 'error');
  }
  // Try to set live_mode after successful insert (gracefully skip if column doesn't exist)
  if (isLiveMode) {
    const { error: lmErr } = await db.from('bills').update({ live_mode: true, live_people_count: livePeopleCount }).eq('id', billId);
    if (lmErr) console.warn('live_mode column not set:', lmErr.message);
  }
  // Look up Raven profiles for all people by first_name so bill appears in their overview
  let profileEmailMap = {};
  try {
    const { data: profiles } = await db.from('profiles').select('first_name,email').in('first_name', cbPeople);
    (profiles || []).forEach(p => { if (p.first_name && p.email) profileEmailMap[p.first_name] = p.email; });
  } catch(e) {}

  // Payer is marked as already paid (they fronted the money)
  const rows = cbPeople.map(person => ({
    bill_id: billId,
    // Use their real email if found in Raven profiles — makes bill appear in their overview
    phone: profileEmailMap[person] || ('unknown_' + person.toLowerCase().replace(/\s+/g,'_') + '_' + billId),
    name: person,
    amount: personAmounts[person] || 0,
    paid: person === paidBy // payer is pre-marked as paid
  }));
  await db.from('participants').insert(rows);
  // In live mode: create placeholder participant slots for people who haven't joined yet
  // They'll self-identify via the bill page (join flow)
  // If no people were manually added, create empty slots
  if (isLiveMode && cbPeople.length === 0) {
    // Payer is the only known person; others join via QR
    if (paidBy) {
      const payerRow = { bill_id: billId, phone: currentUser.email, name: paidBy, amount: 0, paid: true };
      await db.from('participants').insert([payerRow]);
    }
  }
  if (cbItems.length > 0) {
    const { data: savedItems } = await db.from('receipt_items').insert(cbItems.map(item => ({ bill_id: billId, name: item.name, price: item.price }))).select();
    if (savedItems && savedItems.length > 0) {
      const selectionRows = [];
      savedItems.forEach((savedItem, idx) => { const originalItem = cbItems[idx]; if (originalItem && originalItem.assignees.length > 0) originalItem.assignees.forEach(person => selectionRows.push({ bill_id: billId, item_id: savedItem.id, participant_name: person.toLowerCase() })); });
      if (selectionRows.length > 0) await db.from('item_selections').insert(selectionRows);
    }
  }
  btn.textContent = 'Create Bill'; btn.disabled = false;
  showToast('✅ "' + name + '" created! ID: ' + billId, 'success');
  celebrateBillCreated();
  // Track bill creation in PostHog
  try { if (typeof posthog !== 'undefined') posthog.capture('bill_created', { bill_id: billId, split_mode: cbSplitMode, people_count: cbPeople.length, total, has_receipt: !!cbImageBase64, has_payer: !!paidBy }); } catch(e) {}
  cbItems = []; cbPeople = []; cbImageBase64 = null; cbSplitMode = 'even'; cbLiveMode = false; cbLivePeopleCount = 2; const lt=document.getElementById('cb-live-toggle'); const lk=document.getElementById('cb-live-knob'); const lpw=document.getElementById('cb-live-people-wrap'); if(lt){lt.style.background='rgba(255,255,255,0.1)';lt.style.borderColor='rgba(255,255,255,0.15)';} if(lk){lk.style.background='#9896A8';lk.style.transform='translateX(0)';} if(lpw)lpw.style.display='none';
  Object.keys(cbChargeSplits).forEach(k => { cbChargeSplits[k] = 'proportional'; });
  document.getElementById('cb-name').value = '';
  if (document.getElementById('cb-tax')) document.getElementById('cb-tax').value = '';
  if (document.getElementById('cb-tip')) document.getElementById('cb-tip').value = '';
  cbClearPhoto(); cbRenderItems(); cbRenderPeople(); cbUpdateSummary(); cbGoToStep(1);
  loadAllData();
  setTimeout(() => showPage('active-bills'), 1500);
}


// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

let _allNotifs = [];
let _notifsLoaded = false;

async function buildNotifications() {
  let _rids=new Set(); try{_rids=new Set(JSON.parse(localStorage.getItem('rr_'+(currentUser?.id||'u'))||'[]'));}catch(e){}
  const notifs = [];
  try {
    // Friend requests
    const { data: reqs } = await db.from('raven_friends')
      .select('id,user_id,status,created_at')
      .eq('friend_id', currentUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    for (const req of (reqs || [])) {
      const { data: p } = await db.from('profiles').select('first_name,last_name,raven_id,avatar_url').eq('id', req.user_id).maybeSingle();
      const name = p ? ([p.first_name, p.last_name].filter(Boolean).join(' ') || ('@' + p.raven_id)) : 'Someone';
      notifs.push({
        id: 'fr-' + req.id, type: 'friend', icon: '<svg class="raven-icon"><use href="#icon-friends"></use></svg>', iconBg: 'rgba(124,58,237,0.15)',
        title: name + ' sent you a friend request',
        sub: p?.raven_id ? '@' + p.raven_id : 'Tap to accept or decline',
        time: req.created_at, unread: true,
        action: () => { showPage('friends'); setMobNav('mob-settings'); setTimeout(loadFriendsPage, 200); }
      });
    }
  } catch(e) {}

  try {
    // Recent bills where I'm a participant and haven't paid
    const { data: parts } = await db.from('participants')
      .select('id,bill_id,name,amount,paid').eq('phone',currentUser.email).eq('paid',false).limit(10);
    if(parts&&parts.length>0){const bIds=[...new Set(parts.map(p=>p.bill_id).filter(Boolean))];const{data:bData}=bIds.length?await db.from('bills').select('id,name,created_at').in('id',bIds).order('created_at',{ascending:false}).limit(5):{data:[]};const cutoff=new Date(Date.now()-7*86400000).toISOString();const recent=new Set((bData||[]).filter(b=>b.created_at>cutoff).map(b=>b.id));const bMap={};(bData||[]).forEach(b=>{bMap[b.id]=b;});for(const p of parts){if(!recent.has(p.bill_id))continue;notifs.push({id:'bill-'+p.id,type:'bill',icon:'<svg class="raven-icon"><use href="#icon-active-bills"></use></svg>',iconBg:'rgba(48,209,88,0.1)',title:'New bill: '+(bMap[p.bill_id]?.name||'Bill'),sub:'You owe $'+parseFloat(p.amount).toFixed(2),time:bMap[p.bill_id]?.created_at||new Date().toISOString(),unread:true,action:()=>showPage('active-bills')});}} } catch(e) {}

  try {
    // My bills — recent payments received
    const { data: bills } = await db.from('bills').select('id,name').eq('creator_phone', currentUser.email).limit(10);
    const billIds = (bills || []).map(b => b.id);
    const billNameMap = {};
    (bills || []).forEach(b => { billNameMap[b.id] = b.name; });
    if (billIds.length > 0) {
      const cutoff2 = new Date(Date.now() - 3 * 86400000).toISOString();
      const { data: paid } = await db.from('participants')
        .select('id,bill_id,name,amount,paid_at,payment_method')
        .in('bill_id', billIds)
        .eq('paid', true)
        .not('paid_at','is',null)
        .order('paid_at',{ascending:false})
        .limit(10);
      for (const p of (paid || [])) {
        if (!p.paid_at) continue;
        const method = p.payment_method ? ' via ' + p.payment_method : '';
        notifs.push({
          id: 'pay-' + p.id, type: 'payment', icon: '<svg class="raven-icon"><use href="#icon-create-bill"></use></svg>', iconBg: 'rgba(48,209,88,0.12)',
          title: p.name + ' paid their share' + method,
          sub: '$' + parseFloat(p.amount).toFixed(2) + ' — ' + (billNameMap[p.bill_id] || 'Bill'),
          time: p.paid_at, unread: false,
          action: () => openBillModal(p.bill_id)
        });
      }
    }
  } catch(e) {}

  // Sort by time desc
  notifs.sort((a, b) => new Date(b.time) - new Date(a.time));
  return notifs;
}

async function loadNotifications() {
  const container = document.getElementById('notif-list');
  if (!container) return;
  if (!currentUser) { container.innerHTML = '<div style="color:var(--muted);text-align:center;padding:32px">Please sign in to view notifications</div>'; return; }
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';
  try {
    _allNotifs = await buildNotifications();
    _notifsLoaded = true;
    renderNotifList(_allNotifs);
    updateNotifBadge();
  } catch(e) {
    console.error('loadNotifications error:', e);
    container.innerHTML = '<div style="color:var(--muted);text-align:center;padding:32px;font-size:13px">Could not load notifications<br><span style="font-size:11px;color:var(--muted)">' + e.message + '</span></div>';
  }
}

function renderNotifList(list) {
  const container = document.getElementById('notif-list');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--muted)"><div style="margin-bottom:16px;opacity:0.82;display:flex;justify-content:center"><svg class="raven-icon empty"><use href="#icon-notifications"></use></svg></div><div style="font-size:15px;font-weight:600;color:var(--muted2);margin-bottom:6px">All caught up!</div><div style="font-size:13px">No new notifications</div></div>';
    return;
  }
  container.innerHTML = list.map(n => {
    const timeAgo = formatTimeAgo(n.time);
    return `<div class="notif-item ${n.unread ? 'unread' : ''}" data-type="${n.type}" onclick="_notifAction('${n.id}')">
      <div class="notif-icon" style="background:${n.iconBg}">${n.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:${n.unread ? '700' : '500'};color:${n.unread ? 'var(--white)' : 'var(--muted2)'};margin-bottom:3px">${n.title}</div>
        <div style="font-size:12px;color:var(--muted)">${n.sub}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        <span style="font-size:11px;color:var(--muted);white-space:nowrap">${timeAgo}</span>
        ${n.unread ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--purple3);flex-shrink:0"></span>' : ''}
      </div>
    </div>`;
  }).join('');
}

function _notifAction(id) {
  const n = _allNotifs.find(x => x.id === id);
  if (!n) return;
  n.unread = false;
  renderNotifList(_allNotifs);
  updateNotifBadge();
  try { const k='rr_'+(currentUser?.id||'u'); const a=JSON.parse(localStorage.getItem(k)||'[]'); if(!a.includes(id)){a.push(id);localStorage.setItem(k,JSON.stringify(a.slice(-200)));} } catch(e) {}
  if (n.action) n.action();
}

function filterNotifs(type, btn) {
  document.querySelectorAll('.notif-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = type === 'all' ? _allNotifs : _allNotifs.filter(n => n.type === type);
  renderNotifList(filtered);
}

function markAllNotifsRead() {
  try { const k='rr_'+(currentUser?.id||'u'); const a=JSON.parse(localStorage.getItem(k)||'[]'); _allNotifs.forEach(n=>{if(!a.includes(n.id))a.push(n.id);}); localStorage.setItem(k,JSON.stringify(a.slice(-200))); } catch(e) {}
  _allNotifs.forEach(n => { n.unread = false; });
  renderNotifList(_allNotifs);
  updateNotifBadge();
  showToast('All notifications marked as read', 'success');
}

function updateNotifBadge() {
  const unread = _allNotifs.filter(n => n.unread).length;
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
  const mobBadge = document.getElementById('mob-notif-badge');
  if (mobBadge) mobBadge.style.display = unread > 0 ? 'block' : 'none';
  const mobQuickBadge = document.getElementById('mob-notif-quick-badge');
  if (mobQuickBadge) mobQuickBadge.style.display = unread > 0 ? 'flex' : 'none';
  const countEl = document.getElementById('notif-unread-count');
  if (countEl) countEl.textContent = unread > 0 ? '(' + unread + ')' : '';
}

function formatTimeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff/86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

// Auto-load notif badge on dashboard open (after data loads)
async function refreshNotifBadge() {
  try {
    const n = await buildNotifications();
    _allNotifs = n;
    updateNotifBadge();
  } catch(e) {}
}

// ─── INVITE PAGE ────────────────────────────────────────────────────────────

function getMyInviteLink() {
  try {
    const profile = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    const ravenId = profile.raven_id || '';
    if (ravenId) return 'https://ravensplit.com/friend-invite/' + ravenId;
    return 'https://ravensplit.com/dashboard.html';
  } catch(e) { return 'https://ravensplit.com'; }
}

async function loadInvitePage() {
  if (!currentUser) return;
  const linkEl = document.getElementById('invite-link-text');
  if (linkEl) linkEl.textContent = getMyInviteLink();
  // Also try to get raven_id from DB if not in localStorage
  try {
    const { data: prof } = await db.from('profiles').select('raven_id').eq('id', currentUser.id).maybeSingle();
    if (prof?.raven_id) {
      const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
      existing.raven_id = prof.raven_id;
      localStorage.setItem('raven_profile', JSON.stringify(existing));
      if (linkEl) linkEl.textContent = 'https://ravensplit.com/friend-invite/' + prof.raven_id;
    }
  } catch(e) {}
  loadInviteSuggestions();
}

function loadInviteSuggestions() {} // replaced by contacts grid above

function inviteViaSMS() {
  const link = getMyInviteLink();
  const msg = 'Hey! Join me on RAVEN — splits bills from receipt photos with AI instantly 🪶 ' + link;
  window.location.href = 'sms:?&body=' + encodeURIComponent(msg);
}
function inviteViaWhatsApp() {
  const link = getMyInviteLink();
  const msg = 'Hey! Join me on RAVEN — splits bills from receipt photos with AI instantly 🪶 ' + link;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}
function inviteViaEmail() {
  const link = getMyInviteLink();
  const subject = encodeURIComponent('Join me on RAVEN — AI Bill Splitter');
  const body = encodeURIComponent('Hey!\n\nJoin me on RAVEN — it scans receipts with AI and splits bills instantly. No app needed!\n\n' + link);
  window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
}
function inviteViaNativeShare() {
  const link = getMyInviteLink();
  if (navigator.share) {
    navigator.share({ title: 'Join RAVEN', text: 'Split bills with AI 🪶', url: link }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(link).then(()=>showToast('📋 Link copied!','success'));
  }
}

function invitePerson(name, phone, btn) {
  const link = getMyInviteLink();
  const msg = 'Hey ' + name + '! Join me on RAVEN for splitting bills 🪶\n' + link;
  if (phone && !phone.startsWith('unknown_')) {
    window.open('sms:' + phone + '&body=' + encodeURIComponent(msg), '_blank');
  } else if (navigator.share) {
    navigator.share({ title: 'Join RAVEN', text: msg, url: link });
  } else {
    navigator.clipboard.writeText(msg).then(() => showToast('Copied invite for ' + name, 'success'));
  }
  btn.textContent = '✓ Sent'; btn.style.color = 'var(--green)'; btn.style.borderColor = 'rgba(48,209,88,0.3)'; btn.disabled = true;
}

function copyInviteLink() {
  const link = getMyInviteLink();
  navigator.clipboard.writeText(link).then(() => showToast('📋 Invite link copied!', 'success')).catch(() => prompt('Copy your invite link:', link));
}

function shareInviteNative() {
  const link = getMyInviteLink();
  const msg = 'Split bills with me on RAVEN 🪶 — scan any receipt in seconds!';
  if (navigator.share) navigator.share({ title: 'Join RAVEN', text: msg, url: link }).catch(()=>{});
  else copyInviteLink();
}

function shareInviteSMS() {
  const link = getMyInviteLink();
  const msg = 'Split bills with me on RAVEN 🪶 — scan receipts instantly, no app needed! ' + link;
  window.open('sms:?&body=' + encodeURIComponent(msg), '_blank');
}

function shareInviteWhatsApp() {
  const link = getMyInviteLink();
  const msg = 'Split bills with me on RAVEN 🪶 — scan receipts in seconds, no app needed! ' + link;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

function shareInviteEmail() {
  const link = getMyInviteLink();
  const subject = encodeURIComponent('Join me on RAVEN — AI bill splitting');
  const body = encodeURIComponent('Hey!\n\nI\'ve been using RAVEN to split bills — it scans receipts with AI and everyone pays their exact share. No app needed!\n\nJoin me here: ' + link + '\n\nSee you there 🪶');
  window.open('mailto:?subject=' + subject + '&body=' + body, '_blank');
}


function celebrateBillCreated() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9998';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  class Bird {
    constructor(color, side, delay) {
      this.color = color; this.delay = delay; this.t = -delay; this.side = side;
      const W = canvas.width, H = canvas.height;
      this.x = side === 'left' ? -40 : W + 40;
      this.y = 80 + Math.random() * (H - 160);
      this.vx = side === 'left' ? (2.5 + Math.random() * 2) : -(2.5 + Math.random() * 2);
      this.vy = (Math.random() - 0.5) * 1.2;
      this.wingPhase = Math.random() * Math.PI * 2;
      this.wingSpeed = 0.12 + Math.random() * 0.08;
      this.size = 13 + Math.random() * 9;
      this.alpha = 0; this.alive = true;
    }
    update() {
      this.t++;
      if (this.t < 0) return;
      if (this.alpha < 1) this.alpha = Math.min(1, this.alpha + 0.06);
      this.x += this.vx; this.y += this.vy;
      this.vy += (Math.random() - 0.5) * 0.15; this.vy *= 0.97;
      this.wingPhase += this.wingSpeed;
      if (this.x < -100 || this.x > canvas.width + 100 || this.y < -60 || this.y > canvas.height + 60) this.alive = false;
    }
    draw() {
      if (this.t < 0 || !this.alive) return;
      ctx.save(); ctx.globalAlpha = this.alpha;
      ctx.translate(this.x, this.y);
      if (this.vx < 0) ctx.scale(-1, 1);
      const s = this.size, wing = Math.sin(this.wingPhase) * 0.6;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.7, s * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.6, -s * 0.05, s * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s*0.1,-s*0.1); ctx.bezierCurveTo(-s*0.2,-s*(0.5+wing),-s*0.7,-s*(0.6+wing),-s*0.9,-s*(0.1+wing*0.3));
      ctx.bezierCurveTo(-s*0.5,-s*0.1,-s*0.1,-s*0.05,s*0.1,-s*0.1); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.8; ctx.strokeStyle = this.color;
      ctx.beginPath(); ctx.moveTo(-s*0.65,0); ctx.lineTo(-s*1.1,-s*0.2);
      ctx.moveTo(-s*0.65,0); ctx.lineTo(-s*1.15,s*0.05);
      ctx.moveTo(-s*0.65,0); ctx.lineTo(-s*1.05,s*0.22); ctx.stroke();
      ctx.restore();
    }
  }

  const colors = ['#30D158','#A855F7'];
  let birds = [], id = 0;
  for (let i = 0; i < 8; i++) { birds.push(new Bird(colors[id%2],'left',i*12)); id++; }
  for (let i = 0; i < 8; i++) { birds.push(new Bird(colors[id%2],'right',i*12+6)); id++; }

  function loop() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    birds = birds.filter(b => b.alive || b.t < 0);
    birds.forEach(b => { b.update(); b.draw(); });
    if (birds.length > 0) requestAnimationFrame(loop);
    else canvas.remove();
  }
  loop();
}

window.addEventListener('load', function() { init(); });

// Refresh trips when returning to tab
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && currentUser) {
    const tripPage = document.getElementById('page-trip-hub');
    if (tripPage && tripPage.classList.contains('active')) loadTrips();
  }
});
</script>
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('🪶 SW registered:', reg.scope))
      .catch(err => console.log('SW failed:', err));
  });
}

// ── TRIP GROUP CHAT ──
let currentChatTripId = null;
let chatSubscription = null;
let chatMessages = [];

function openChat(t){openTripChat(t);}
async function openTripChat(tripId) {
  currentChatTripId = tripId;
  const modal = document.getElementById('trip-chat-modal');
  modal.style.display = 'flex';

  // Set trip name
  const trip = tripDataMap[tripId];
  if (trip) {
    document.getElementById('chat-trip-name').textContent = '💬 ' + trip.name;
    const people = Array.isArray(trip.people) ? trip.people : (typeof trip.people === 'string' ? JSON.parse(trip.people || '[]') : []);
    document.getElementById('chat-trip-members').textContent = people.length + ' members';
  }

  // Load messages
  await loadChatMessages(tripId);

  // Subscribe to realtime
  if (chatSubscription) { db.removeChannel(chatSubscription); chatSubscription = null; }
  chatSubscription = db.channel('trip-chat-' + tripId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_messages', filter: 'trip_id=eq.' + tripId }, (payload) => {
      appendChatMessage(payload.new);
    })
    .subscribe();

  // Focus input
  setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

function closeTripChat() {
  document.getElementById('trip-chat-modal').style.display = 'none';
  if (chatSubscription) { db.removeChannel(chatSubscription); chatSubscription = null; }
  currentChatTripId = null;
}

async function loadChatMessages(tripId) {
  const container = document.getElementById('chat-messages');
  container.innerHTML = '<div style="text-align:center;color:#6E6B80;font-size:12px;padding:20px 0">Loading...</div>';

  try {
    const { data, error } = await db.from('trip_messages')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true })
      .limit(100);

    container.innerHTML = '';
    if (error || !data || data.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:#6E6B80;font-size:12px;padding:20px 0" id="chat-empty">No messages yet. Say hi! 👋</div>';
      return;
    }
    data.forEach(msg => appendChatMessage(msg, false));
    scrollChatToBottom();
  } catch(e) {
    container.innerHTML = '<div style="text-align:center;color:#FF4444;font-size:12px;padding:20px 0">Could not load messages</div>';
  }
}

function appendChatMessage(msg, scroll = true) {
  const empty = document.getElementById('chat-empty');
  if (empty) empty.remove();

  const container = document.getElementById('chat-messages');
  const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
  const isMe = msg.user_id === local.user_id;
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:' + (isMe ? 'flex-end' : 'flex-start') + ';gap:3px';
  el.innerHTML = (!isMe ? '<div style="font-size:10px;color:#9896A8;font-weight:600;margin-left:4px">' + escapeHtml(msg.sender_name || 'Someone') + '</div>' : '')
    + '<div style="max-width:80%;padding:9px 13px;border-radius:' + (isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px') + ';background:' + (isMe ? 'var(--purple)' : '#1A1A24') + ';color:#F0EEF8;font-size:13px;line-height:1.5;word-break:break-word">' + escapeHtml(msg.message) + '</div>'
    + '<div style="font-size:10px;color:#6E6B80;margin:0 4px">' + time + '</div>';

  container.appendChild(el);
  if (scroll) scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function sendChatMessage() {
  if (!currentChatTripId || !currentUser) return;
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';

  const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
  const senderName = local.first_name || currentUser.email?.split('@')[0] || 'Someone';

  try {
    const { error } = await db.from('trip_messages').insert({
      trip_id: currentChatTripId,
      user_id: currentUser.id,
      sender_name: senderName,
      message: message,
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error('Chat send error:', error);
      showToast('Could not send message', 'error');
    }
  } catch(e) {
    showToast('Could not send message', 'error');
  }
}

</script>

<!-- ── TRIP GROUP CHAT MODAL ── -->
<div id="trip-chat-modal" style="display:none;position:fixed;bottom:24px;right:24px;width:360px;max-width:calc(100vw - 32px);height:500px;max-height:calc(100vh - 100px);background:#0C0C12;border:1px solid rgba(124,58,237,0.3);border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.7);z-index:1000;flex-direction:column;overflow:hidden">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#13131A;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0">
    <div>
      <div style="font-size:13px;font-weight:700" id="chat-trip-name">Group Chat</div>
      <div style="font-size:10px;color:#6E6B80" id="chat-trip-members">Loading...</div>
    </div>
    <button onclick="closeTripChat()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:50%;width:28px;height:28px;color:#9896A8;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">×</button>
  </div>
  <div id="chat-messages" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0">
    <div style="text-align:center;color:#6E6B80;font-size:12px;padding:20px 0" id="chat-empty">No messages yet. Say hi! 👋</div>
  </div>
  <div style="padding:12px;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0;display:flex;gap:8px;align-items:flex-end">
    <textarea id="chat-input" placeholder="Message the group..." rows="1" style="flex:1;background:#1A1A24;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 14px;color:#F0EEF8;font-family:'Epilogue',sans-serif;font-size:13px;resize:none;outline:none;max-height:80px;line-height:1.5" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage()}" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
    <button onclick="sendChatMessage()" style="background:var(--purple);border:none;border-radius:12px;width:38px;height:38px;color:#fff;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.2s">↑</button>
  </div>
</div>

</body>
</html>
