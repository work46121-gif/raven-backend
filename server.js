<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>🪶 RAVEN — Demo Bill</title>
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Epilogue:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --black: #06060A;
      --dark: #0C0C12;
      --dark2: #13131A;
      --dark3: #1A1A24;
      --border: rgba(255,255,255,0.07);
      --border2: rgba(255,255,255,0.12);
      --white: #F0EEF8;
      --muted: #6E6B80;
      --muted2: #9896A8;
      --raven: #7C3AED;
      --raven2: #A855F7;
      --raven3: #C084FC;
      --sms: #30D158;
      --sms-glow: rgba(48,209,88,0.25);
    }
    html { scroll-behavior: smooth; }
    body { font-family: 'Epilogue', sans-serif; background: var(--black); color: var(--white); min-height: 100vh; padding-bottom: 140px; }
    body::after { content: ''; position: fixed; inset: 0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E"); pointer-events: none; z-index: 900; opacity: 0.35; }

    /* DEMO BANNER */
    .demo-banner { background: linear-gradient(90deg, rgba(124,58,237,0.15), rgba(48,209,88,0.1)); border-bottom: 1px solid rgba(124,58,237,0.3); padding: 10px 20px; text-align: center; font-size: 12px; color: var(--raven3); letter-spacing: 0.04em; }
    .demo-banner strong { color: var(--white); }
    .demo-banner a { color: var(--sms); text-decoration: none; font-weight: 600; }

    /* HEADER */
    .header { position: sticky; top: 0; z-index: 100; background: rgba(6,6,10,0.95); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); padding: 0 20px; }
    .header-inner { max-width: 480px; margin: 0 auto; height: 60px; display: flex; align-items: center; justify-content: space-between; }
    .header-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; }
    .header-logo { font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 0.2em; background: linear-gradient(135deg, var(--white) 20%, var(--raven3)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .header-bill-id { font-size: 11px; color: var(--muted); background: var(--dark3); border: 1px solid var(--border); padding: 4px 10px; border-radius: 20px; letter-spacing: 0.08em; font-weight: 600; }

    /* TAB SWITCHER */
    .tab-switcher { max-width: 480px; margin: 20px auto 0; padding: 0 20px; }
    .tab-switcher-inner { display: flex; background: var(--dark2); border: 1px solid var(--border); border-radius: 14px; padding: 4px; gap: 4px; }
    .tab-btn { flex: 1; padding: 11px 8px; border: none; border-radius: 10px; background: transparent; color: var(--muted); font-family: 'Epilogue', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .tab-btn.active { background: var(--dark3); color: var(--white); box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* SHARED STYLES */
    .bill-info { max-width: 480px; margin: 0 auto; padding: 20px 20px 0; }
    .bill-name { font-family: 'Bebas Neue', sans-serif; font-size: 34px; letter-spacing: 0.04em; line-height: 1; margin-bottom: 6px; }
    .bill-meta { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .bill-tag { font-size: 12px; color: var(--muted); }
    .bill-tag span { color: var(--white); font-weight: 600; }

    .section-wrap { max-width: 480px; margin: 0 auto; padding: 20px 20px 0; }
    .section-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .section-label-text { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-weight: 600; }
    .section-count { font-size: 11px; color: var(--muted); }
    .section-count span { color: var(--sms); font-weight: 700; }

    /* NAME INPUT */
    .name-input { width: 100%; padding: 14px 16px; background: var(--dark2); border: 1px solid var(--border2); border-radius: 12px; color: var(--white); font-family: 'Epilogue', sans-serif; font-size: 16px; font-weight: 500; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
    .name-input:focus { border-color: var(--sms); box-shadow: 0 0 0 3px rgba(48,209,88,0.1); }
    .name-input::placeholder { color: var(--muted); font-weight: 400; }

    /* HINT BOX */
    .hint-box { max-width: 480px; margin: 12px auto 0; padding: 0 20px; }
    .hint-inner { background: rgba(124,58,237,0.06); border: 1px solid rgba(124,58,237,0.2); border-radius: 10px; padding: 10px 14px; font-size: 12px; color: var(--muted); display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; }
    .hint-inner .hi { color: var(--raven3); flex-shrink: 0; margin-top: 1px; }

    /* ITEMS */
    .items-list { max-width: 480px; margin: 10px auto 0; padding: 0 20px; display: flex; flex-direction: column; gap: 8px; }
    .item-card { background: var(--dark2); border: 2px solid var(--border); border-radius: 14px; overflow: hidden; transition: border-color 0.18s; }
    .item-card.claimed-solo { border-color: var(--sms); }
    .item-card.claimed-split { border-color: var(--raven2); }

    .item-main { display: flex; align-items: center; gap: 12px; padding: 14px 16px; cursor: pointer; -webkit-tap-highlight-color: transparent; user-select: none; }
    .item-main:active { opacity: 0.85; }

    .item-check { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--border2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.18s; font-size: 12px; color: transparent; font-weight: 700; }
    .claimed-solo .item-check { background: var(--sms); border-color: var(--sms); color: #000; }
    .claimed-split .item-check { background: var(--raven2); border-color: var(--raven2); color: #fff; font-size: 10px; }

    .item-body { flex: 1; min-width: 0; }
    .item-name { font-size: 15px; font-weight: 500; color: var(--white); }
    .item-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
    .chip { padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .chip-solo { background: rgba(48,209,88,0.12); border: 1px solid rgba(48,209,88,0.2); color: var(--sms); }
    .chip-split { background: rgba(168,85,247,0.12); border: 1px solid rgba(168,85,247,0.2); color: var(--raven3); }
    .chip-assigned { background: rgba(192,132,252,0.12); border: 1px solid rgba(192,132,252,0.25); color: var(--raven3); }

    .item-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
    .item-price { font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 0.04em; color: var(--raven3); }
    .claimed-solo .item-price { color: var(--sms); }
    .claimed-split .item-price { color: var(--raven2); }
    .item-share { font-size: 10px; color: var(--muted); }
    .item-share span { color: var(--sms); font-weight: 600; }
    .claimed-split .item-share span { color: var(--raven3); }

    /* SPLIT ACTION ROW */
    .item-actions { border-top: 1px solid var(--border); padding: 10px 16px; display: flex; gap: 8px; }
    .action-btn { flex: 1; padding: 8px 12px; border-radius: 8px; border: none; font-family: 'Epilogue', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.18s; -webkit-tap-highlight-color: transparent; }
    .action-solo { background: rgba(48,209,88,0.1); color: var(--sms); border: 1px solid rgba(48,209,88,0.2); }
    .action-solo:hover { background: rgba(48,209,88,0.18); }
    .action-split { background: rgba(168,85,247,0.1); color: var(--raven3); border: 1px solid rgba(168,85,247,0.2); }
    .action-split:hover { background: rgba(168,85,247,0.18); }
    .action-remove { background: rgba(255,255,255,0.04); color: var(--muted); border: 1px solid var(--border); }
    .action-remove:hover { background: rgba(255,68,68,0.08); color: #FF6B6B; border-color: rgba(255,68,68,0.2); }
    .action-assign { background: rgba(192,132,252,0.08); color: var(--raven3); border: 1px solid rgba(192,132,252,0.2); }
    .action-assign:hover { background: rgba(192,132,252,0.16); }

    /* SHARED CHARGES */
    .extras-card { background: var(--dark2); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
    .extra-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .extra-row:last-child { border-bottom: none; }
    .extra-label { font-size: 14px; color: var(--muted2); }
    .extra-note { font-size: 11px; color: var(--muted); }
    .extra-value { font-size: 14px; font-weight: 600; color: var(--white); }

    /* SUMMARY */
    .summary-card { background: var(--dark2); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
    .summary-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .summary-label { font-size: 14px; color: var(--muted2); }
    .summary-value { font-size: 14px; font-weight: 600; color: var(--white); }
    .summary-total { display: flex; justify-content: space-between; align-items: center; padding: 18px 16px; background: linear-gradient(135deg, rgba(48,209,88,0.06), rgba(124,58,237,0.06)); border-top: 1px solid var(--border); }
    .summary-total-label { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 0.08em; color: var(--muted2); }
    .summary-total-value { font-family: 'Bebas Neue', sans-serif; font-size: 32px; letter-spacing: 0.04em; color: var(--sms); }

    /* ── SIMPLE SPLIT TAB ── */
    .simple-total-card { background: var(--dark2); border: 1px solid var(--border2); border-radius: 16px; padding: 20px; }
    .simple-total-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 10px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
    .edit-badge { background: rgba(48,209,88,0.1); border: 1px solid rgba(48,209,88,0.2); color: var(--sms); font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; letter-spacing: 0.06em; }
    .total-input-wrap { display: flex; align-items: center; gap: 8px; }
    .total-dollar { font-family: 'Bebas Neue', sans-serif; font-size: 42px; color: var(--muted); letter-spacing: 0.04em; }
    .total-input { font-family: 'Bebas Neue', sans-serif; font-size: 42px; letter-spacing: 0.04em; color: var(--white); background: transparent; border: none; outline: none; width: 100%; min-width: 80px; caret-color: var(--sms); }
    .total-input::placeholder { color: var(--dark3); }

    .split-type-row { display: flex; gap: 8px; margin-top: 16px; }
    .split-type-btn { flex: 1; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-family: 'Epilogue', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.18s; text-align: center; }
    .split-type-btn.active { background: rgba(48,209,88,0.1); border-color: rgba(48,209,88,0.3); color: var(--sms); }

    .people-list { display: flex; flex-direction: column; gap: 8px; }
    .person-row { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--dark2); border: 1px solid var(--border); border-radius: 12px; transition: border-color 0.18s; }
    .person-row.is-you { border-color: rgba(48,209,88,0.25); background: rgba(48,209,88,0.04); }
    .person-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--raven), var(--raven2)); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; flex-shrink: 0; text-transform: uppercase; }
    .person-avatar.you-av { background: linear-gradient(135deg, var(--sms), #00a832); color: #000; }
    .person-name-wrap { flex: 1; }
    .person-name { font-size: 14px; font-weight: 600; color: var(--white); }
    .person-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
    .person-amount { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: var(--white); letter-spacing: 0.04em; }
    .person-amount.you-amt { color: var(--sms); }
    .custom-input { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: var(--sms); background: transparent; border: none; border-bottom: 1px solid rgba(48,209,88,0.3); outline: none; width: 80px; text-align: right; caret-color: var(--sms); }

    .add-person-btn { width: 100%; padding: 12px; background: transparent; border: 1px dashed var(--border2); border-radius: 12px; color: var(--muted); font-family: 'Epilogue', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.18s; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .add-person-btn:hover { border-color: var(--sms); color: var(--sms); background: rgba(48,209,88,0.04); }

    /* SUBMIT */
    .submit-wrap { position: fixed; bottom: 0; left: 0; right: 0; z-index: 200; padding: 16px 20px; background: linear-gradient(to top, rgba(6,6,10,1) 60%, transparent); }
    .submit-inner { max-width: 480px; margin: 0 auto; }
    .submit-btn { width: 100%; padding: 17px; background: var(--sms); border: none; border-radius: 14px; color: #000; font-family: 'Epilogue', sans-serif; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 8px 30px var(--sms-glow); display: flex; align-items: center; justify-content: center; gap: 8px; }
    .submit-btn:hover { background: #3ddd68; transform: translateY(-1px); }
    .submit-btn:disabled { background: var(--dark3); color: var(--muted); box-shadow: none; cursor: not-allowed; transform: none; }

    /* PAYMENT MODAL */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 800; display: flex; align-items: flex-end; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
    .modal-overlay.show { opacity: 1; pointer-events: all; }
    .modal { background: var(--dark2); border: 1px solid var(--border2); border-radius: 24px 24px 0 0; padding: 28px 24px 48px; width: 100%; max-width: 480px; transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
    .modal-overlay.show .modal { transform: translateY(0); }
    .modal-handle { width: 36px; height: 4px; background: var(--border2); border-radius: 2px; margin: 0 auto 24px; }
    .modal-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 0.04em; margin-bottom: 4px; }
    .modal-sub { font-size: 14px; color: var(--muted); margin-bottom: 16px; }
    .modal-amount { font-family: 'Bebas Neue', sans-serif; font-size: 52px; letter-spacing: 0.04em; color: var(--sms); margin-bottom: 28px; line-height: 1; }

    .pay-methods { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
    .pay-method { display: flex; align-items: center; gap: 14px; padding: 15px 16px; background: var(--dark3); border: 2px solid var(--border); border-radius: 14px; cursor: pointer; transition: all 0.18s; text-decoration: none; -webkit-tap-highlight-color: transparent; }
    .pay-method:hover { border-color: var(--border2); transform: translateX(3px); }
    .pay-icon { width: 42px; height: 42px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .pay-icon.cashapp { background: #00D632; }
    .pay-icon.zelle { background: #6D1ED4; }
    .pay-icon.applepay { background: #1a1a1a; border: 1px solid #333; }
    .pay-info { flex: 1; }
    .pay-name { font-size: 15px; font-weight: 600; color: var(--white); }
    .pay-handle { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .pay-arrow { font-size: 16px; color: var(--muted); }
    .modal-close { width: 100%; padding: 14px; background: transparent; border: 1px solid var(--border); border-radius: 12px; color: var(--muted); font-family: 'Epilogue', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    .modal-close:hover { border-color: var(--border2); color: var(--white); }

    /* TOAST */
    .toast { position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--dark3); border: 1px solid var(--border2); color: var(--white); padding: 12px 20px; border-radius: 24px; font-size: 14px; font-weight: 500; z-index: 999; opacity: 0; transition: all 0.3s ease; white-space: nowrap; box-shadow: 0 8px 30px rgba(0,0,0,0.5); pointer-events: none; }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .toast.error { border-color: rgba(255,68,68,0.4); color: #FF6B6B; }
    .toast.ok { border-color: rgba(48,209,88,0.4); color: var(--sms); }
    .toast.info { border-color: rgba(168,85,247,0.4); color: var(--raven3); }

    @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .animate-in { animation: slideUp 0.35s ease both; }
  </style>
</head>
<body>

  <div class="demo-banner">
    🪶 <strong>Live demo</strong> — interact with it! &nbsp;·&nbsp; <a href="index.html">← Back to home</a> &nbsp;·&nbsp; <a href="sms:+15163472607&body=SPLIT">Try the real thing →</a>
  </div>

  <div class="header">
    <div class="header-inner">
      <a class="header-brand" href="index.html">
        <svg width="22" height="22" viewBox="0 0 200 200" fill="none">
          <path d="M85 95 C70 90 45 88 28 78 C20 73 15 65 18 58 C22 50 32 48 42 52 C50 55 56 62 62 70 C68 78 74 86 85 95Z" fill="url(#hg)" opacity="0.8"/>
          <path d="M115 95 C130 90 155 88 172 78 C180 73 185 65 182 58 C178 50 168 48 158 52 C150 55 144 62 138 70 C132 78 126 86 115 95Z" fill="url(#hg)" opacity="0.8"/>
          <path d="M75 100 C68 108 65 118 66 128 C67 140 72 150 80 156 C87 161 93 160 100 158 C107 160 113 161 120 156 C128 150 133 140 134 128 C135 118 132 108 125 100 C118 92 108 88 100 88 C92 88 82 92 75 100Z" fill="url(#hg)"/>
          <path d="M78 72 C76 60 80 48 88 40 C94 34 100 32 106 34 C116 37 122 46 122 56 C122 66 118 76 112 83 C108 88 104 90 100 90 C93 90 86 85 82 80 C80 77 79 75 78 72Z" fill="url(#hg)"/>
          <path d="M78 72 C72 68 62 66 56 68 C52 70 51 74 54 77 C58 80 65 79 72 76Z" fill="#C084FC"/>
          <ellipse cx="97" cy="58" rx="5" ry="4.5" fill="#FF6B00" opacity="0.9"/>
          <defs><linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#A855F7"/><stop offset="100%" stop-color="#30D158"/></linearGradient></defs>
        </svg>
        <span class="header-logo">RAVEN</span>
      </a>
      <div class="header-bill-id">DEMO</div>
    </div>
  </div>

  <!-- TAB SWITCHER -->
  <div class="tab-switcher animate-in">
    <div class="tab-switcher-inner">
      <button class="tab-btn active" id="tab-dinner-btn" onclick="switchTab('dinner')">🍽 Itemized Dinner</button>
      <button class="tab-btn" id="tab-airbnb-btn" onclick="switchTab('airbnb')">🏠 Simple Split</button>
    </div>
  </div>

  <!-- ══════════ DINNER TAB ══════════ -->
  <div class="tab-content active" id="tab-dinner">

    <div class="bill-info animate-in">
      <div class="bill-name">Saturday Night Out</div>
      <div class="bill-meta">
        <div class="bill-tag">Total <span>$187.40</span></div>
        <div class="bill-tag">8 items</div>
        <div class="bill-tag" id="d-confirmed-tag">1 confirmed so far</div>
      </div>
    </div>

    <!-- RECEIPT PHOTO UPLOAD -->
    <div class="section-wrap animate-in">
      <div class="section-label-row"><div class="section-label-text">Receipt photo</div><span style="font-size:10px;color:var(--raven3);background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);padding:2px 8px;border-radius:10px;font-weight:600;">DEMO</span></div>
      <input type="file" id="receipt-upload" accept="image/*" style="display:none;" onchange="handlePhotoUpload(this)" />
      <div onclick="triggerPhotoUpload()" style="background:var(--dark2);border:2px dashed var(--border2);border-radius:14px;overflow:hidden;cursor:pointer;transition:border-color 0.18s;" onmouseover="this.style.borderColor='var(--raven2)'" onmouseout="this.style.borderColor='var(--border2)'">
        <div id="upload-placeholder" style="padding:24px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;">
          <div style="width:48px;height:48px;border-radius:12px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);display:flex;align-items:center;justify-content:center;font-size:22px;">📸</div>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--white);margin-bottom:4px;">Upload receipt photo</div>
            <div style="font-size:12px;color:var(--muted);">In the real app, Claude AI reads it automatically</div>
          </div>
          <div style="background:var(--raven);color:#fff;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;">Choose Photo</div>
        </div>
        <div id="receipt-preview-wrap" style="display:none;position:relative;">
          <img id="receipt-preview" style="width:100%;display:block;max-height:240px;object-fit:cover;" />
          <div style="position:absolute;bottom:10px;right:10px;" onclick="event.stopPropagation();triggerPhotoUpload()">
            <div style="background:rgba(0,0,0,0.7);color:#fff;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:600;backdrop-filter:blur(4px);">Replace photo ↑</div>
          </div>
          <div style="position:absolute;top:10px;left:10px;">
            <div style="background:rgba(168,85,247,0.9);color:#fff;padding:4px 10px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:0.06em;">📸 UPLOADED</div>
          </div>
        </div>
      </div>
    </div>

    <!-- STEP 1: HOW MANY PEOPLE -->
    <div class="section-wrap animate-in">
      <div class="section-label-row"><div class="section-label-text">How many people at the table?</div></div>
      <div style="display:flex;align-items:center;background:var(--dark2);border:1px solid var(--border2);border-radius:12px;overflow:hidden;">
        <button onclick="changePeople(-1)" style="width:52px;height:52px;background:transparent;border:none;color:var(--white);font-size:22px;cursor:pointer;transition:background 0.15s;flex-shrink:0;" onmouseover="this.style.background='var(--dark3)'" onmouseout="this.style.background='transparent'">−</button>
        <div style="flex:1;text-align:center;">
          <span style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:0.06em;color:var(--sms);" id="d-people-count">4</span>
          <span style="font-size:12px;color:var(--muted);margin-left:6px;">people</span>
        </div>
        <button onclick="changePeople(1)" style="width:52px;height:52px;background:transparent;border:none;color:var(--white);font-size:22px;cursor:pointer;transition:background 0.15s;flex-shrink:0;" onmouseover="this.style.background='var(--dark3)'" onmouseout="this.style.background='transparent'">+</button>
      </div>
    </div>

    <!-- STEP 2: WHO'S HERE -->
    <div class="section-wrap animate-in">
      <div class="section-label-row">
        <div class="section-label-text">Who's at the table?</div>
        <div class="section-count"><span id="d-names-count">0</span> added</div>
      </div>
      <div id="d-names-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="d-add-name-input" class="name-input" placeholder="Add a name..." autocomplete="off" autocorrect="off" style="flex:1;" onkeydown="if(event.key==='Enter')addDinnerPerson()" />
        <button onclick="addDinnerPerson()" style="padding:0 18px;background:var(--raven);border:none;border-radius:12px;color:#fff;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background 0.15s;" onmouseover="this.style.background='var(--raven2)'" onmouseout="this.style.background='var(--raven)'">+ Add</button>
      </div>
    </div>

    <!-- STEP 3: YOUR NAME -->
    <div class="section-wrap animate-in">
      <div class="section-label-row"><div class="section-label-text">Which one are you?</div></div>
      <input type="text" id="d-name" class="name-input" placeholder="Enter your name..." autocomplete="off" autocorrect="off" oninput="dinnerNameChange()" />
    </div>

    <div class="hint-box animate-in">
      <div class="hint-inner">
        <span class="hi">💡</span>
        <span>Tap an item to claim it solo. If others already claimed it, you'll see an option to <strong style="color:var(--raven3)">split it with them</strong> — costs divide equally between everyone who splits.</span>
      </div>
    </div>

    <div class="section-wrap animate-in">
      <div class="section-label-row">
        <div class="section-label-text">Menu items</div>
        <div class="section-count"><span id="d-count">0</span> claimed</div>
      </div>
    </div>

    <div class="items-list" id="d-items-list"></div>

    <div class="section-wrap animate-in">
      <div class="section-label-row"><div class="section-label-text">Shared charges</div></div>
      <div class="extras-card">
        <div class="extra-row">
          <div class="extra-label">Tax <span class="extra-note">(split evenly)</span></div>
          <div style="text-align:right;">
            <div class="extra-value">$14.40 total</div>
            <div style="font-size:11px;color:var(--sms);margin-top:2px;">$<span id="d-tax-share">3.60</span> / person</div>
          </div>
        </div>
        <div class="extra-row">
          <div class="extra-label">Tip <span class="extra-note">(split evenly)</span></div>
          <div style="text-align:right;">
            <div class="extra-value">$28.00 total</div>
            <div style="font-size:11px;color:var(--sms);margin-top:2px;">$<span id="d-tip-share">7.00</span> / person</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section-wrap animate-in">
      <div class="section-label-row"><div class="section-label-text">Your summary</div></div>
      <div class="summary-card">
        <div class="summary-row"><div class="summary-label">Your items</div><div class="summary-value" id="d-items-total">$0.00</div></div>
        <div class="summary-row"><div class="summary-label">Tax (your share)</div><div class="summary-value" id="d-tax-row">$3.60</div></div>
        <div class="summary-row"><div class="summary-label">Tip (your share)</div><div class="summary-value" id="d-tip-row">$7.00</div></div>
        <div class="summary-total">
          <div class="summary-total-label">Your Total</div>
          <div class="summary-total-value" id="d-my-total">$10.60</div>
        </div>
      </div>
    </div>

  </div><!-- end dinner tab -->

  <!-- ══════════ AIRBNB / SIMPLE SPLIT TAB ══════════ -->
  <div class="tab-content" id="tab-airbnb">

    <div class="bill-info animate-in">
      <div class="bill-name">Miami Airbnb 🌴</div>
      <div class="bill-meta">
        <div class="bill-tag">Created by <span>Jordan</span></div>
        <div class="bill-tag"><span id="a-people-count">4</span> people</div>
      </div>
    </div>

    <div class="section-wrap animate-in">
      <div class="section-label-row"><div class="section-label-text">Your name</div></div>
      <input type="text" id="a-name" class="name-input" placeholder="Enter your name..." autocomplete="off" autocorrect="off" oninput="airbnbNameChange()" />
    </div>

    <!-- EDITABLE TOTAL -->
    <div class="section-wrap animate-in">
      <div class="simple-total-card">
        <div class="simple-total-label">
          <span>Total Amount</span>
          <span class="edit-badge">✏️ EDITABLE</span>
        </div>
        <div class="total-input-wrap">
          <span class="total-dollar">$</span>
          <input type="number" id="a-total" class="total-input" value="540" min="0" step="0.01" oninput="airbnbRecalc()" placeholder="0" />
        </div>
        <div class="split-type-row">
          <button class="split-type-btn active" id="btn-equal" onclick="setSplitType('equal')">⚖️ Split equally</button>
          <button class="split-type-btn" id="btn-custom" onclick="setSplitType('custom')">✏️ Custom amounts</button>
        </div>
      </div>
    </div>

    <!-- PEOPLE LIST -->
    <div class="section-wrap animate-in">
      <div class="section-label-row">
        <div class="section-label-text">Who's splitting</div>
        <div class="section-count"><span id="a-people-count2">4</span> people</div>
      </div>
      <div class="people-list" id="a-people-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="a-add-input" class="name-input" placeholder="Add a person..." autocomplete="off" autocorrect="off" style="flex:1;" onkeydown="if(event.key==='Enter')addPerson()" />
        <button onclick="addPerson()" style="padding:0 18px;background:var(--raven);border:none;border-radius:12px;color:#fff;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background 0.15s;" onmouseover="this.style.background='var(--raven2)'" onmouseout="this.style.background='var(--raven)'">+ Add</button>
      </div>
    </div>

    <!-- SIMPLE SUMMARY -->
    <div class="section-wrap animate-in">
      <div class="summary-card">
        <div class="summary-total">
          <div class="summary-total-label">You Owe</div>
          <div class="summary-total-value" id="a-my-total">$135.00</div>
        </div>
      </div>
    </div>

  </div><!-- end airbnb tab -->

  <!-- SUBMIT -->
  <div class="submit-wrap">
    <div class="submit-inner">
      <button class="submit-btn" id="submitBtn" onclick="confirmOrder()">
        <span id="submitBtnText">Confirm & Pay</span>
      </button>
    </div>
  </div>

  <!-- ASSIGN MODAL -->
  <div class="modal-overlay" id="assignModal" onclick="if(event.target.id==='assignModal')closeAssignModal()">
    <div class="modal">
      <div class="modal-handle"></div>
      <div class="modal-title">Assign Item</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div class="modal-sub" style="margin:0;" id="assign-item-name">Item</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:var(--raven3);" id="assign-item-price">$0.00</div>
      </div>

      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:10px;font-weight:600;">Who ordered this?</div>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <input type="text" id="assign-name-input" placeholder="Enter their name..." style="flex:1;padding:12px 14px;background:var(--dark3);border:1px solid var(--border2);border-radius:10px;color:var(--white);font-family:'Epilogue',sans-serif;font-size:15px;outline:none;" onkeydown="if(event.key==='Enter')addAssigned()" />
        <button onclick="addAssigned()" style="padding:12px 18px;background:var(--raven);border:none;border-radius:10px;color:#fff;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer;">Assign</button>
      </div>

      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:10px;font-weight:600;">Assigned to</div>
      <div id="assigned-list" style="min-height:48px;margin-bottom:20px;"></div>

      <button class="modal-close" onclick="closeAssignModal()">Done</button>
    </div>
  </div>

  <!-- PAYMENT MODAL -->
  <div class="modal-overlay" id="payModal" onclick="closeModalOutside(event)">
    <div class="modal">
      <div class="modal-handle"></div>
      <div class="modal-title">Pay Jordan</div>
      <div class="modal-sub">Send your share to the bill creator</div>
      <div class="modal-amount" id="modal-amount">$135.00</div>
      <div class="pay-methods">
        <a class="pay-method" href="#" onclick="payClicked('Cash App'); return false;">
          <div class="pay-icon cashapp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm3.11 7.41l-.9 4.24h.96l-.29 1.35H13.9l-.16.77h-.01l-.84 3.9H11.4l.84-3.9h-.96l.29-1.35h.96l.16-.77.9-4.24H12.4l.29-1.35h3.72l-.29 1.35H15.1z"/></svg>
          </div>
          <div class="pay-info"><div class="pay-name">Cash App</div><div class="pay-handle">$JordanRaven</div></div>
          <div class="pay-arrow">→</div>
        </a>
        <a class="pay-method" href="#" onclick="payClicked('Zelle'); return false;">
          <div class="pay-icon zelle">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M13.618 2H10.38L2 12l8.382 10h3.236L5.236 12zm5.146 0h-3.236L23.764 12l-8.236 10H18.764L27 12z" transform="scale(0.8) translate(1.5,0)"/></svg>
          </div>
          <div class="pay-info"><div class="pay-name">Zelle</div><div class="pay-handle">jordan@raven.app</div></div>
          <div class="pay-arrow">→</div>
        </a>
        <a class="pay-method" href="#" onclick="payClicked('Apple Pay'); return false;">
          <div class="pay-icon applepay">
            <svg width="26" height="16" viewBox="0 0 50 30" fill="white"><text x="2" y="22" font-family="Arial" font-size="13" font-weight="bold"> Pay</text></svg>
          </div>
          <div class="pay-info"><div class="pay-name">Apple Pay</div><div class="pay-handle">Via iMessage · jordan</div></div>
          <div class="pay-arrow">→</div>
        </a>
      </div>
      <button class="modal-close" onclick="closeModal()">I'll pay later</button>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    // ── STATE ──
    let activeTab = 'dinner';
    let splitType = 'equal';

    function getDName() { return document.getElementById('d-name').value.trim().toLowerCase(); }
    function dinnerNameChange() { renderDinner(); dinnerCalc(); }

    // ── PHOTO UPLOAD ──
    function triggerPhotoUpload() {
      document.getElementById('receipt-upload').click();
    }

    function handlePhotoUpload(input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        document.getElementById('receipt-preview').src = e.target.result;
        document.getElementById('receipt-preview-wrap').style.display = 'block';
        document.getElementById('upload-placeholder').style.display = 'none';
        showToast('📸 Receipt uploaded! In the real app, AI would scan this now.', 'info');
      };
      reader.readAsDataURL(file);
    }
    const dItems = [
      { id: '1', name: 'Salmon Pasta',           price: 24, claimers: [] },
      { id: '2', name: 'Grilled Chicken',         price: 18, claimers: ['marcus'] },
      { id: '3', name: 'House Salad',             price: 14, claimers: [] },
      { id: '4', name: 'Ribeye Steak',            price: 22, claimers: [] },
      { id: '5', name: 'Malbec Glass × 2',        price: 16, claimers: ['priya'] },
      { id: '6', name: 'Truffle Fries',           price: 12, claimers: ['marcus', 'priya'] },
      { id: '7', name: 'Sparkling Water',         price: 9,  claimers: [] },
      { id: '8', name: 'Chocolate Lava Cake × 2', price: 28, claimers: [] },
    ];
    // dSelections[id] = { type: 'solo'|'split'|'assigned', assignedTo: 'name'|null }
    const dSelections = {};
    // assignedClaimers[id] = [names assigned by me]
    const dAssigned = {}; // id -> [name, name, ...]
    const D_TAX_TOTAL = 14.40, D_TIP_TOTAL = 28.00;
    let dPeopleCount = 4;

    function changePeople(delta) {
      dPeopleCount = Math.max(1, Math.min(20, dPeopleCount + delta));
      document.getElementById('d-people-count').textContent = dPeopleCount;
      const taxShare = (D_TAX_TOTAL / dPeopleCount).toFixed(2);
      const tipShare = (D_TIP_TOTAL / dPeopleCount).toFixed(2);
      document.getElementById('d-tax-share').textContent = taxShare;
      document.getElementById('d-tip-share').textContent = tipShare;
      dinnerCalc();
    }

    function getDTaxShare() { return D_TAX_TOTAL / dPeopleCount; }
    function getDTipShare() { return D_TIP_TOTAL / dPeopleCount; }
    let assignModalItemId = null;

    // ── DINNER PEOPLE LIST ──
    let dPeople = ['marcus', 'priya']; // pre-seeded from demo claimers

    function renderDinnerPeopleList() {
      const container = document.getElementById('d-names-list');
      if (!container) return;
      document.getElementById('d-names-count').textContent = dPeople.length;
      if (dPeople.length === 0) {
        container.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:8px 0;">No names added yet — add people above</div>`;
        return;
      }
      container.innerHTML = dPeople.map((name, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--dark2);border:1px solid var(--border);border-radius:10px;">
          <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--raven),var(--raven2));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;">${name[0].toUpperCase()}</div>
          <span style="flex:1;font-size:14px;font-weight:500;text-transform:capitalize;">${name}</span>
          <button onclick="removeDinnerPerson(${i})" style="background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.15);color:#FF6B6B;font-size:11px;padding:4px 10px;border-radius:8px;cursor:pointer;font-family:'Epilogue',sans-serif;font-weight:600;">Remove</button>
        </div>`).join('');
    }

    function addDinnerPerson() {
      const input = document.getElementById('d-add-name-input');
      const name = input?.value?.trim().toLowerCase();
      if (!name) { showToast('Enter a name ☝️', 'error'); return; }
      if (dPeople.includes(name)) { showToast(`${name} already added`, 'error'); return; }
      dPeople.push(name);
      input.value = '';
      // Auto-update people count
      dPeopleCount = Math.max(dPeopleCount, dPeople.length);
      document.getElementById('d-people-count').textContent = dPeopleCount;
      renderDinnerPeopleList();
      renderDinner();
      dinnerCalc();
      showToast(`${name} added ✓`, 'ok');
    }

    function removeDinnerPerson(idx) {
      const name = dPeople[idx];
      dPeople.splice(idx, 1);
      // Remove their claims
      Object.keys(dAssigned).forEach(id => {
        dAssigned[id] = (dAssigned[id] || []).filter(n => n !== name);
      });
      dPeopleCount = Math.max(1, dPeopleCount - 1);
      document.getElementById('d-people-count').textContent = dPeopleCount;
      renderDinnerPeopleList();
      renderDinner();
      dinnerCalc();
      showToast(`${name} removed`, 'ok');
    }

    function renderDinner() {
      const me = getDName();
      const list = document.getElementById('d-items-list');
      list.innerHTML = dItems.map((item, i) => {
        const sel = dSelections[item.id];
        const assigned = dAssigned[item.id] || [];
        // All people on this item: original claimers + me (if I claimed) + assigned by me
        const allClaimers = [...item.claimers];
        if (sel && sel.type !== 'assigned' && me && !allClaimers.includes(me)) allClaimers.push(me);
        assigned.forEach(a => { if (!allClaimers.includes(a)) allClaimers.push(a); });
        const hasOthers = item.claimers.length > 0 || assigned.length > 0;
        const splitCount = allClaimers.length || 1;
        const myShare = (sel && sel.type !== 'assigned' && me) ? (item.price / splitCount) : null;

        let cardClass = 'item-card';
        let checkTxt = '✓';
        if (sel) {
          if (sel.type === 'solo') { cardClass += ' claimed-solo'; }
          else if (sel.type === 'split') { cardClass += ' claimed-split'; checkTxt = '½'; }
          else if (sel.type === 'assigned') { cardClass += ' claimed-solo'; checkTxt = '→'; }
        }
        // Also highlight if I assigned someone even without claiming myself
        if (!sel && assigned.length > 0) cardClass += ' claimed-split';

        // Chips — show all claimers
        const chipsHTML = allClaimers.length > 0
          ? `<div class="item-chips">${allClaimers.map(c => {
              const isMe = c === me && sel && sel.type !== 'assigned';
              const isAssignedByMe = assigned.includes(c);
              let cls = 'chip chip-other';
              if (isMe) cls = sel.type === 'split' ? 'chip chip-split' : 'chip chip-solo';
              else if (isAssignedByMe) cls = 'chip chip-assigned';
              const label = isMe ? 'you' : (isAssignedByMe ? `${c} ✓` : c);
              return `<span class="${cls}">${label}</span>`;
            }).join('')}</div>` : '';

        // Action buttons
        let actionsHTML = '';
        const othersLabel = [...item.claimers, ...assigned].filter(Boolean).join(' & ');

        if (!sel && me) {
          if (hasOthers) {
            actionsHTML = `<div class="item-actions">
              <button class="action-btn action-solo" onclick="claimItem('${item.id}','solo')">✓ I ordered this ($${item.price})</button>
              <button class="action-btn action-split" onclick="claimItem('${item.id}','split')">½ Split with ${othersLabel}</button>
              <button class="action-btn action-assign" onclick="openAssignModal('${item.id}')">→ Assign to someone</button>
            </div>`;
          } else {
            // No one else yet — show assign option on unclaimed items too
            actionsHTML = `<div class="item-actions">
              <button class="action-btn action-assign" onclick="openAssignModal('${item.id}')">→ Assign to someone else</button>
            </div>`;
          }
        } else if (sel || assigned.length > 0) {
          actionsHTML = `<div class="item-actions" style="flex-wrap:wrap;">
            ${sel && sel.type === 'solo' && hasOthers ? `<button class="action-btn action-split" onclick="claimItem('${item.id}','split')">½ Split with ${othersLabel}</button>` : ''}
            ${sel && sel.type === 'split' ? `<button class="action-btn action-solo" onclick="claimItem('${item.id}','solo')">✓ Claim solo instead</button>` : ''}
            <button class="action-btn action-assign" onclick="openAssignModal('${item.id}')">→ Assign to someone</button>
            ${sel ? `<button class="action-btn action-remove" onclick="claimItem('${item.id}',null)">Remove my claim</button>` : ''}
          </div>`;
        }

        const shareHTML = myShare !== null
          ? `<div class="item-share">your share: <span>$${myShare.toFixed(2)}</span></div>` : '';
        const assignedShareHTML = assigned.length > 0 && !sel
          ? `<div class="item-share"><span style="color:var(--raven3)">${assigned.length} assigned</span></div>` : '';

        return `<div class="${cardClass}" style="animation-delay:${i*0.03}s">
          <div class="item-main" onclick="cardTap('${item.id}')">
            <div class="item-check">${checkTxt}</div>
            <div class="item-body">
              <div class="item-name">${item.name}</div>
              ${chipsHTML}
            </div>
            <div class="item-right">
              <div class="item-price">$${item.price.toFixed(2)}</div>
              ${shareHTML}${assignedShareHTML}
            </div>
          </div>
          ${actionsHTML}
        </div>`;
      }).join('');

      document.getElementById('d-count').textContent =
        Object.values(dSelections).filter(Boolean).length +
        Object.values(dAssigned).filter(a => a.length > 0).length;
    }

    function cardTap(id) {
      const me = getDName();
      if (!me) { showToast('Enter your name first ☝️', 'error'); document.getElementById('d-name').focus(); return; }
      const item = dItems.find(i => i.id === id);
      const sel = dSelections[id];
      if (!sel) {
        const hasOthers = item.claimers.length > 0 || (dAssigned[id] || []).length > 0;
        if (!hasOthers) { claimItem(id, 'solo'); }
        // else action buttons visible after re-render
      }
    }

    function claimItem(id, type) {
      const me = getDName();
      if (!me) { showToast('Enter your name first ☝️', 'error'); return; }
      if (type === null) {
        delete dSelections[id];
      } else {
        dSelections[id] = { type };
        const item = dItems.find(i => i.id === id);
        const others = [...item.claimers, ...(dAssigned[id]||[])];
        if (type === 'split' && others.length > 0) {
          const count = others.length + 1;
          showToast(`Splitting with ${others.join(' & ')} — $${(item.price/count).toFixed(2)} each 🤝`, 'info');
        } else if (type === 'solo') {
          showToast(`Claimed ${item.name} ✓`, 'ok');
        }
      }
      renderDinner(); dinnerCalc();
    }

    // ── ASSIGN MODAL ──
    function openAssignModal(itemId) {
      assignModalItemId = itemId;
      const item = dItems.find(i => i.id === itemId);
      const existing = dAssigned[itemId] || [];
      document.getElementById('assign-item-name').textContent = item.name;
      document.getElementById('assign-item-price').textContent = `$${item.price.toFixed(2)}`;
      document.getElementById('assign-name-input').value = '';
      renderAssignedList(itemId);
      document.getElementById('assignModal').classList.add('show');
    }

    function renderAssignedList(itemId) {
      const existing = dAssigned[itemId] || [];
      const container = document.getElementById('assigned-list');
      if (existing.length === 0) {
        container.innerHTML = `<div style="font-size:13px;color:var(--muted);text-align:center;padding:12px 0;">No one assigned yet</div>`;
        return;
      }
      container.innerHTML = existing.map(name => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--dark3);border-radius:10px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--raven),var(--raven2));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;">${name[0].toUpperCase()}</div>
            <span style="font-size:14px;font-weight:500;">${name}</span>
          </div>
          <button onclick="removeAssigned('${itemId}','${name}')" style="background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.2);color:#FF6B6B;font-size:11px;padding:4px 10px;border-radius:8px;cursor:pointer;font-family:'Epilogue',sans-serif;font-weight:600;">Remove</button>
        </div>`).join('');
    }

    function addAssigned() {
      const input = document.getElementById('assign-name-input');
      const name = input.value.trim().toLowerCase();
      if (!name) { showToast('Enter a name ☝️', 'error'); return; }
      if (!dAssigned[assignModalItemId]) dAssigned[assignModalItemId] = [];
      if (dAssigned[assignModalItemId].includes(name)) { showToast(`${name} already assigned`, 'error'); return; }
      dAssigned[assignModalItemId].push(name);
      input.value = '';
      renderAssignedList(assignModalItemId);
      showToast(`${name} assigned ✓`, 'ok');
    }

    function removeAssigned(itemId, name) {
      dAssigned[itemId] = (dAssigned[itemId] || []).filter(n => n !== name);
      renderAssignedList(itemId);
    }

    function closeAssignModal() {
      document.getElementById('assignModal').classList.remove('show');
      renderDinner();
      dinnerCalc();
    }

    function dinnerCalc() {
      const me = getDName();
      let itemsTotal = 0;
      dItems.forEach(item => {
        const sel = dSelections[item.id];
        if (sel && sel.type !== 'assigned') {
          const allClaimers = [...item.claimers, ...(dAssigned[item.id]||[])];
          if (me && !allClaimers.includes(me)) allClaimers.push(me);
          itemsTotal += item.price / Math.max(allClaimers.length, 1);
        }
      });
      const taxShare = getDTaxShare();
      const tipShare = getDTipShare();
      document.getElementById('d-items-total').textContent = '$' + itemsTotal.toFixed(2);
      document.getElementById('d-tax-row').textContent = '$' + taxShare.toFixed(2);
      document.getElementById('d-tip-row').textContent = '$' + tipShare.toFixed(2);
      document.getElementById('d-my-total').textContent = '$' + (itemsTotal + taxShare + tipShare).toFixed(2);
    }

    // ── AIRBNB STATE ──
    let aPeople = [
      { name: 'Jordan', isCreator: true },
      { name: 'Alex', isCreator: false },
      { name: 'Priya', isCreator: false },
      { name: 'Marcus', isCreator: false },
    ];
    let aCustomAmounts = {};
    let aEditingIdx = null;

    function airbnbNameChange() { renderAirbnb(); }
    function getATotal() { return parseFloat(document.getElementById('a-total').value) || 0; }
    function getAMe() { return document.getElementById('a-name').value.trim().toLowerCase(); }

    function setSplitType(type) {
      splitType = type;
      document.getElementById('btn-equal').classList.toggle('active', type === 'equal');
      document.getElementById('btn-custom').classList.toggle('active', type === 'custom');
      aCustomAmounts = {};
      renderAirbnb();
    }

    function airbnbRecalc() { renderAirbnb(); }

    function renderAirbnb() {
      const total = getATotal();
      const me = getAMe();
      const n = aPeople.length;
      const equalShare = n > 0 ? total / n : 0;

      document.getElementById('a-people-count').textContent = n;
      document.getElementById('a-people-count2').textContent = n;

      let myOwed = 0;
      const list = document.getElementById('a-people-list');

      list.innerHTML = aPeople.map((p, i) => {
        const pKey = p.name.toLowerCase();
        const isMe = me && pKey === me;
        const amount = splitType === 'equal' ? equalShare : (aCustomAmounts[i] !== undefined ? aCustomAmounts[i] : equalShare);
        if (isMe) myOwed = amount;
        const isEditing = aEditingIdx === i;

        const nameHTML = isEditing
          ? `<input type="text" id="edit-name-${i}" value="${p.name}" style="background:var(--dark2);border:1px solid var(--sms);border-radius:6px;color:var(--white);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;padding:4px 8px;outline:none;width:120px;" onkeydown="if(event.key==='Enter')saveEditName(${i})" />`
          : `<div class="person-name">${p.name}${p.isCreator ? ' <span style="font-size:10px;color:var(--muted)">creator</span>' : ''}${isMe ? ' <span style="font-size:10px;color:var(--sms)">· you</span>' : ''}</div>`;

        const amountHTML = splitType === 'custom'
          ? `<input type="number" class="custom-input" value="${amount.toFixed(2)}" min="0" step="0.01" oninput="setCustomAmount(${i}, this.value)" />`
          : `<div class="person-amount${isMe ? ' you-amt' : ''}">$${amount.toFixed(2)}</div>`;

        const actionsHTML = isEditing
          ? `<div style="display:flex;gap:6px;margin-top:6px;">
              <button onclick="saveEditName(${i})" style="padding:4px 10px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.2);color:var(--sms);border-radius:6px;font-family:'Epilogue',sans-serif;font-size:11px;font-weight:600;cursor:pointer;">Save</button>
              <button onclick="cancelEdit()" style="padding:4px 10px;background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:6px;font-family:'Epilogue',sans-serif;font-size:11px;font-weight:600;cursor:pointer;">Cancel</button>
            </div>`
          : `<div style="display:flex;gap:6px;margin-top:4px;">
              <button onclick="startEditName(${i})" style="padding:3px 8px;background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:6px;font-family:'Epilogue',sans-serif;font-size:10px;font-weight:600;cursor:pointer;">✏️ Edit</button>
              ${!p.isCreator ? `<button onclick="removePerson(${i})" style="padding:3px 8px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.15);color:#FF6B6B;border-radius:6px;font-family:'Epilogue',sans-serif;font-size:10px;font-weight:600;cursor:pointer;">Remove</button>` : ''}
            </div>`;

        return `<div class="person-row${isMe ? ' is-you' : ''}" style="flex-direction:column;align-items:flex-start;gap:4px;padding:12px 16px;">
          <div style="display:flex;align-items:center;gap:12px;width:100%;">
            <div class="person-avatar${isMe ? ' you-av' : ''}">${p.name[0].toUpperCase()}</div>
            <div style="flex:1;">${nameHTML}</div>
            ${amountHTML}
          </div>
          ${actionsHTML}
        </div>`;
      }).join('');

      if (!myOwed && me) myOwed = equalShare;
      document.getElementById('a-my-total').textContent = '$' + myOwed.toFixed(2);
      document.getElementById('modal-amount').textContent = '$' + myOwed.toFixed(2);
    }

    function startEditName(idx) { aEditingIdx = idx; renderAirbnb(); setTimeout(() => document.getElementById(`edit-name-${idx}`)?.focus(), 50); }
    function cancelEdit() { aEditingIdx = null; renderAirbnb(); }
    function saveEditName(idx) {
      const input = document.getElementById(`edit-name-${idx}`);
      const val = input?.value?.trim();
      if (val) { aPeople[idx].name = val; showToast(`Name updated ✓`, 'ok'); }
      aEditingIdx = null;
      renderAirbnb();
    }

    function setCustomAmount(idx, val) {
      aCustomAmounts[idx] = parseFloat(val) || 0;
      const me = getAMe();
      const p = aPeople[idx];
      if (p && p.name.toLowerCase() === me) {
        document.getElementById('a-my-total').textContent = '$' + (aCustomAmounts[idx] || 0).toFixed(2);
        document.getElementById('modal-amount').textContent = '$' + (aCustomAmounts[idx] || 0).toFixed(2);
      }
    }

    function addPerson() {
      const input = document.getElementById('a-add-input');
      const name = input?.value?.trim();
      if (!name) { showToast('Enter a name ☝️', 'error'); return; }
      aPeople.push({ name, isCreator: false });
      input.value = '';
      aCustomAmounts = {};
      renderAirbnb();
      showToast(`${name} added ✓`, 'ok');
    }

    function removePerson(idx) {
      const name = aPeople[idx].name;
      aPeople.splice(idx, 1);
      aCustomAmounts = {};
      renderAirbnb();
      showToast(`${name} removed`, 'ok');
    }

    // ── TAB SWITCHING ──
    function switchTab(tab) {
      activeTab = tab;
      document.getElementById('tab-dinner').classList.toggle('active', tab === 'dinner');
      document.getElementById('tab-airbnb').classList.toggle('active', tab === 'airbnb');
      document.getElementById('tab-dinner-btn').classList.toggle('active', tab === 'dinner');
      document.getElementById('tab-airbnb-btn').classList.toggle('active', tab === 'airbnb');
      document.getElementById('submitBtnText').textContent = tab === 'dinner' ? 'Confirm My Order' : 'Confirm & Pay';
    }

    // ── CONFIRM ──
    function confirmOrder() {
      if (activeTab === 'dinner') {
        const me = getDName();
        if (!me) { showToast('Enter your name first ☝️', 'error'); return; }
        const hasSel = Object.values(dSelections).some(Boolean);
        if (!hasSel) { showToast('Tap what you ordered 👆', 'error'); return; }
        // Set modal amount
        const tot = parseFloat(document.getElementById('d-my-total').textContent.replace('$',''));
        document.getElementById('modal-amount').textContent = '$' + tot.toFixed(2);
      } else {
        const me = getAMe();
        if (!me) { showToast('Enter your name first ☝️', 'error'); return; }
      }
      document.getElementById('payModal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('payModal').classList.remove('show');
      const btn = document.getElementById('submitBtn');
      btn.style.background = 'var(--raven)';
      btn.style.color = 'var(--white)';
      btn.style.boxShadow = '0 8px 30px rgba(124,58,237,0.3)';
      document.getElementById('submitBtnText').textContent = '✅ Confirmed!';
      btn.onclick = null;
      showToast('Your order is confirmed 🪶', 'ok');
    }

    function closeModalOutside(e) { if (e.target.id === 'payModal') closeModal(); }

    function payClicked(method) {
      showToast(`Opening ${method}... 💸`, 'ok');
      setTimeout(closeModal, 600);
    }

    function showToast(msg, type = '') {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = `toast show ${type}`;
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.className = 'toast'; }, 3000);
    }

    // ── INIT ──
    renderDinnerPeopleList();
    renderDinner();
    renderAirbnb();
  </script>
</body>
</html>
