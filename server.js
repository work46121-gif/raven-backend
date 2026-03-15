<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RAVEN — Dashboard</title>
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

/* ── AUTH SCREEN ── */
#auth-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
#auth-screen::before {
  content: '';
  position: absolute;
  top: -200px; left: 50%; transform: translateX(-50%);
  width: 800px; height: 600px;
  background: radial-gradient(ellipse, rgba(124,58,237,0.15) 0%, transparent 65%);
  pointer-events: none;
}
#auth-screen::after {
  content: '';
  position: absolute;
  bottom: -100px; right: -200px;
  width: 600px; height: 400px;
  background: radial-gradient(ellipse, rgba(48,209,88,0.08) 0%, transparent 65%);
  pointer-events: none;
}
.auth-grid {
  position: absolute; inset: 0;
  background-image: linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
}
.auth-box {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 420px;
  padding: 0 20px;
}
.auth-logo {
  text-align: center;
  margin-bottom: 36px;
}
.auth-logo-icon {
  font-size: 36px;
  display: block;
  margin-bottom: 8px;
  filter: drop-shadow(0 0 20px rgba(124,58,237,0.6));
}
.auth-logo-name {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 42px;
  letter-spacing: 0.15em;
  background: linear-gradient(135deg, var(--white) 30%, var(--purple3));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.auth-logo-sub {
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-top: 2px;
}
.auth-card {
  background: var(--dark);
  border: 1px solid var(--border2);
  border-radius: 20px;
  padding: 36px;
  box-shadow: 0 40px 100px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.1);
}
.auth-tabs {
  display: flex;
  gap: 4px;
  background: var(--dark2);
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 28px;
}
.auth-tab {
  flex: 1;
  padding: 9px;
  border: none;
  background: none;
  color: var(--muted);
  font-family: 'Epilogue', sans-serif;
  font-size: 13px;
  font-weight: 600;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.2s;
}
.auth-tab.active {
  background: var(--dark3);
  color: var(--white);
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.auth-form { display: flex; flex-direction: column; gap: 14px; }
.auth-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted2);
  margin-bottom: 6px;
  display: block;
}
.auth-input {
  width: 100%;
  padding: 13px 16px;
  background: var(--dark2);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--white);
  font-family: 'Epilogue', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.auth-input:focus {
  border-color: var(--purple);
  box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
}
.auth-btn {
  width: 100%;
  padding: 14px;
  background: var(--green);
  color: #000;
  border: none;
  border-radius: 10px;
  font-family: 'Epilogue', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 6px;
  box-shadow: 0 4px 20px var(--green-glow);
  letter-spacing: 0.02em;
}
.auth-btn:hover { background: #3ddd68; transform: translateY(-1px); box-shadow: 0 8px 30px var(--green-glow); }
.auth-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.auth-error {
  background: rgba(255,68,68,0.1);
  border: 1px solid rgba(255,68,68,0.25);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: #FF8888;
  display: none;
}
.auth-footer {
  text-align: center;
  margin-top: 20px;
  font-size: 12px;
  color: var(--muted);
}

/* ── DASHBOARD ── */
#dashboard-screen { display: none; min-height: 100vh; }

/* Sidebar */
.sidebar {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: 240px;
  background: var(--dark);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 100;
}
.sidebar-logo {
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}
.sidebar-logo-mark {
  font-size: 22px;
  filter: drop-shadow(0 0 10px rgba(124,58,237,0.5));
}
.sidebar-logo-text {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.15em;
  background: linear-gradient(135deg, var(--white), var(--purple3));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.sidebar-nav { flex: 1; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  text-decoration: none;
}
.nav-item:hover { background: var(--dark2); color: var(--white); }
.nav-item.active { background: rgba(124,58,237,0.15); color: var(--white); }
.nav-item .ni { font-size: 16px; width: 20px; text-align: center; }
.nav-badge {
  margin-left: auto;
  background: var(--purple);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
}
.sidebar-user {
  padding: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
}
.user-avatar {
  width: 34px; height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--purple), var(--green));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}
.user-info { flex: 1; min-width: 0; }
.user-email { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.logout-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  transition: color 0.2s;
  flex-shrink: 0;
}
.logout-btn:hover { color: var(--red); }

/* Main content */
.main {
  margin-left: 240px;
  min-height: 100vh;
  padding: 32px 36px;
}
.page { display: none; }
.page.active { display: block; }

/* Page header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
  flex-wrap: wrap;
  gap: 16px;
}
.page-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 38px;
  letter-spacing: 0.05em;
  line-height: 1;
}
.page-title span { color: var(--green); }

/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 32px;
}
.stat-card {
  background: var(--dark);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s;
}
.stat-card:hover { border-color: var(--border2); }
.stat-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--purple), var(--green));
  opacity: 0;
  transition: opacity 0.2s;
}
.stat-card:hover::before { opacity: 1; }
.stat-label { font-size: 11px; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 10px; }
.stat-value { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 0.03em; line-height: 1; }
.stat-value.green { color: var(--green); }
.stat-value.purple { color: var(--purple3); }
.stat-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }

/* Bills list */
.bills-list { display: flex; flex-direction: column; gap: 12px; }
.bill-card {
  background: var(--dark);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px 24px;
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: 20px;
  transition: all 0.2s;
  cursor: pointer;
}
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
.bill-action-btn {
  padding: 7px 14px;
  border-radius: 7px;
  font-family: 'Epilogue', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn-remind { background: rgba(124,58,237,0.15); color: var(--purple3); border: 1px solid rgba(124,58,237,0.25); }
.btn-remind:hover { background: rgba(124,58,237,0.3); }
.btn-view { background: var(--dark3); color: var(--muted2); border: 1px solid var(--border); }
.btn-view:hover { color: var(--white); border-color: var(--border2); }
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
}
.status-active { background: rgba(48,209,88,0.1); color: var(--green); border: 1px solid rgba(48,209,88,0.2); }
.status-completed { background: rgba(110,107,128,0.15); color: var(--muted2); border: 1px solid var(--border); }

/* Create bill form */
.form-card {
  background: var(--dark);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 32px;
  max-width: 600px;
}
.form-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 0.05em; margin-bottom: 24px; }
.form-group { margin-bottom: 20px; }
.form-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted2);
  margin-bottom: 8px;
}
.form-input {
  width: 100%;
  padding: 12px 16px;
  background: var(--dark2);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--white);
  font-family: 'Epilogue', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.form-input:focus { border-color: var(--purple); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.people-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.person-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(124,58,237,0.12);
  border: 1px solid rgba(124,58,237,0.25);
  border-radius: 20px;
  padding: 5px 12px;
  font-size: 13px;
  color: var(--purple3);
}
.person-tag button {
  background: none;
  border: none;
  color: var(--purple3);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
  opacity: 0.6;
  transition: opacity 0.15s;
}
.person-tag button:hover { opacity: 1; }
.add-person-row { display: flex; gap: 8px; }
.add-person-input {
  flex: 1;
  padding: 10px 14px;
  background: var(--dark2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--white);
  font-family: 'Epilogue', sans-serif;
  font-size: 13px;
  outline: none;
}
.add-person-input:focus { border-color: var(--purple); }
.add-person-btn {
  padding: 10px 16px;
  background: rgba(124,58,237,0.15);
  border: 1px solid rgba(124,58,237,0.3);
  border-radius: 8px;
  color: var(--purple3);
  font-family: 'Epilogue', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.add-person-btn:hover { background: rgba(124,58,237,0.3); }
.split-preview {
  background: var(--dark2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--muted2);
}
.split-preview strong { color: var(--green); font-family: 'Bebas Neue', sans-serif; font-size: 18px; }
.submit-btn {
  width: 100%;
  padding: 14px;
  background: var(--green);
  color: #000;
  border: none;
  border-radius: 10px;
  font-family: 'Epilogue', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 20px var(--green-glow);
}
.submit-btn:hover { background: #3ddd68; transform: translateY(-1px); }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

/* Bill detail modal */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(8px);
  z-index: 500;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.modal-overlay.open { display: flex; }
.modal {
  background: var(--dark);
  border: 1px solid var(--border2);
  border-radius: 20px;
  padding: 32px;
  width: 100%;
  max-width: 520px;
  max-height: 85vh;
  overflow-y: auto;
  position: relative;
}
.modal-close {
  position: absolute;
  top: 20px; right: 20px;
  background: var(--dark3);
  border: none;
  color: var(--muted);
  width: 32px; height: 32px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.modal-close:hover { background: var(--dark4); color: var(--white); }
.modal-title { font-family: 'Bebas Neue', sans-serif; font-size: 30px; letter-spacing: 0.05em; margin-bottom: 6px; }
.modal-meta { font-size: 13px; color: var(--muted); margin-bottom: 24px; }
.participants-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
.participant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--dark2);
  border-radius: 10px;
  border: 1px solid var(--border);
}
.participant-name { font-weight: 500; font-size: 14px; }
.participant-amount { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.paid-tag { color: var(--green); font-weight: 600; }
.owed-tag { color: var(--orange); }
.mark-paid-btn {
  padding: 5px 12px;
  background: rgba(48,209,88,0.1);
  border: 1px solid rgba(48,209,88,0.25);
  border-radius: 6px;
  color: var(--green);
  font-family: 'Epilogue', sans-serif;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.mark-paid-btn:hover { background: rgba(48,209,88,0.25); }
.modal-actions { display: flex; gap: 10px; }
.modal-btn {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  font-family: 'Epilogue', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
}
.modal-btn-remind { background: rgba(124,58,237,0.15); color: var(--purple3); border: 1px solid rgba(124,58,237,0.25); }
.modal-btn-remind:hover { background: rgba(124,58,237,0.3); }
.modal-btn-delete { background: rgba(255,68,68,0.1); color: var(--red); border: 1px solid rgba(255,68,68,0.2); }
.modal-btn-delete:hover { background: rgba(255,68,68,0.2); }

/* Empty state */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--muted);
}
.empty-icon { font-size: 48px; margin-bottom: 16px; display: block; opacity: 0.4; }
.empty-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: var(--muted2); margin-bottom: 8px; }
.empty-sub { font-size: 14px; }

/* Toast */
.toast {
  position: fixed;
  bottom: 24px; right: 24px;
  background: var(--dark2);
  border: 1px solid var(--border2);
  border-radius: 12px;
  padding: 14px 20px;
  font-size: 13px;
  color: var(--white);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  z-index: 1000;
  transform: translateY(80px);
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1);
  display: flex;
  align-items: center;
  gap: 10px;
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast.success { border-color: rgba(48,209,88,0.3); }
.toast.error { border-color: rgba(255,68,68,0.3); }

/* Loading */
.loading { display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--muted); gap: 10px; font-size: 13px; }
.spinner { width: 18px; height: 18px; border: 2px solid var(--border); border-top-color: var(--purple); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--dark4); border-radius: 2px; }

/* Section header */
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 0.06em; color: var(--muted2); }
.section-count { font-size: 12px; color: var(--muted); background: var(--dark3); padding: 3px 10px; border-radius: 10px; }

/* History table */
.history-table { width: 100%; border-collapse: collapse; }
.history-table th {
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0 16px 12px;
  border-bottom: 1px solid var(--border);
}
.history-table td {
  padding: 14px 16px;
  font-size: 13px;
  color: var(--muted2);
  border-bottom: 1px solid var(--border);
}
.history-table tr:last-child td { border-bottom: none; }
.history-table tr:hover td { background: var(--dark2); }
.history-table td:first-child { color: var(--white); font-weight: 500; }

@media(max-width: 768px) {
  .sidebar { transform: translateX(-100%); }
  .main { margin-left: 0; padding: 20px; }
  .stats-row { grid-template-columns: 1fr 1fr; }
  .bill-card { grid-template-columns: 1fr auto; }
  .bill-progress-wrap, .bill-actions { display: none; }
}

/* Create bill itemized interface */
.cb-item-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--dark2);
  border: 1px solid var(--border);
  border-radius: 10px;
  transition: border-color 0.2s;
}
.cb-item-row:hover { border-color: var(--border2); }
.cb-item-name-display { flex: 1; font-size: 13px; font-weight: 500; }
.cb-item-price-display { font-family: "JetBrains Mono", monospace; font-size: 13px; color: var(--muted2); }
.cb-item-assign {
  padding: 4px 10px;
  background: rgba(124,58,237,0.1);
  border: 1px solid rgba(124,58,237,0.2);
  border-radius: 6px;
  color: var(--purple3);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border-width: 1px;
  font-family: "Epilogue", sans-serif;
  transition: all 0.15s;
}
.cb-item-assign:hover { background: rgba(124,58,237,0.25); }
.cb-item-assign.assigned { background: rgba(48,209,88,0.1); border-color: rgba(48,209,88,0.25); color: var(--green); }
.cb-item-remove {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  padding: 0 2px;
  opacity: 0.5;
  transition: opacity 0.15s;
}
.cb-item-remove:hover { opacity: 1; color: var(--red); }


.pay-method-row { display:flex;align-items:center;gap:14px;padding:14px 16px;border:2px solid rgba(255,255,255,0.06);border-radius:14px;text-decoration:none;transition:all 0.18s;margin-bottom:0; }
.pay-method-row:hover { border-color:rgba(255,255,255,0.15);transform:translateX(3px); }
.pay-method-icon { width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;font-size:16px;color:#fff; }
.pay-method-info { flex:1; }
.pay-method-name { font-size:15px;font-weight:600;color:#fff; }
.pay-method-handle { font-size:12px;color:rgba(255,255,255,0.5);margin-top:2px; }
.pay-method-arrow { font-size:16px;color:rgba(255,255,255,0.4); }
</style>
</head>
<body>

<!-- AUTH SCREEN -->
<div id="auth-screen">
  <div class="auth-grid"></div>
  <div class="auth-box">
    <div class="auth-logo">
      <span class="auth-logo-icon">🪶</span>
      <div class="auth-logo-name">RAVEN</div>
      <div class="auth-logo-sub">Request Automatically Via Every Network</div>
    </div>
    <div class="auth-card">
      <div class="auth-tabs">
        <button class="auth-tab active" onclick="switchAuthTab('login')">Sign In</button>
        <button class="auth-tab" onclick="switchAuthTab('signup')">Create Account</button>
      </div>
      <div id="auth-error" class="auth-error"></div>

      <!-- LOGIN -->
      <div id="login-form" class="auth-form">
        <div>
          <label class="auth-label">Email</label>
          <input id="login-email" type="email" class="auth-input" placeholder="your@email.com" autocomplete="email">
        </div>
        <div>
          <label class="auth-label">Password</label>
          <input id="login-password" type="password" class="auth-input" placeholder="••••••••" autocomplete="current-password">
        </div>
        <button class="auth-btn" onclick="handleLogin()">Sign In →</button>
      </div>

      <!-- SIGNUP -->
      <div id="signup-form" class="auth-form" style="display:none">
        <div>
          <label class="auth-label">Email</label>
          <input id="signup-email" type="email" class="auth-input" placeholder="your@email.com" autocomplete="email">
        </div>
        <div>
          <label class="auth-label">Password</label>
          <input id="signup-password" type="password" class="auth-input" placeholder="At least 6 characters" autocomplete="new-password">
        </div>
        <div>
          <label class="auth-label">Confirm Password</label>
          <input id="signup-confirm" type="password" class="auth-input" placeholder="••••••••" autocomplete="new-password">
        </div>
        <button class="auth-btn" onclick="handleSignup()">Create Account →</button>
      </div>
    </div>
    <div class="auth-footer">
      <a href="index.html" style="color:var(--muted);text-decoration:none" onclick="localStorage.setItem('raven_logged_in','true')">← Back to getraven.app</a>
    </div>
  </div>
</div>

<!-- DASHBOARD SCREEN -->
<div id="dashboard-screen">
  <!-- Sidebar -->
  <aside class="sidebar">
    <a href="index.html" class="sidebar-logo">
      <span class="sidebar-logo-mark">🪶</span>
      <span class="sidebar-logo-text">RAVEN</span>
    </a>
    <nav class="sidebar-nav">
      <button class="nav-item active" onclick="showPage('overview')"><span class="ni">📊</span> Overview</button>
      <button class="nav-item" onclick="showPage('active-bills')"><span class="ni">📋</span> Active Bills <span class="nav-badge" id="active-count">0</span></button>
      <button class="nav-item" onclick="showPage('create-bill')"><span class="ni">➕</span> Create Bill</button>
      <button class="nav-item" onclick="showPage('history')"><span class="ni">🕐</span> History</button>
      <button class="nav-item" onclick="showPage('settings')"><span class="ni">⚙️</span> Settings</button>
    </nav>
    <div class="sidebar-user">
      <div class="user-avatar" id="user-avatar">?</div>
      <div class="user-info">
        <div class="user-email" id="user-email-display">Loading...</div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:8px">
        <button onclick="showPage('settings')" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;background:transparent;border:none;border-radius:10px;cursor:pointer;transition:background 0.2s;text-align:left" onmouseover="this.style.background='var(--dark3)'" onmouseout="this.style.background='transparent'">
          <div id="sidebar-avatar" style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--green));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">?</div>
          <div style="flex:1;min-width:0">
            <div id="sidebar-name" style="font-size:13px;font-weight:600;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">My Account</div>
            <div style="font-size:11px;color:var(--muted)">Settings & payments</div>
          </div>
        </button>
        <button class="logout-btn" onclick="handleLogout()" title="Sign out" style="width:100%;margin-top:4px">⎋ Sign Out</button>
      </div>
    </div>
  </aside>

  <!-- Main -->
  <main class="main">

    <!-- OVERVIEW PAGE -->
    <div id="page-overview" class="page active">
      <div class="page-header">
        <h1 class="page-title">Welcome, <span id="greeting-name"></span></h1>
      </div>
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Active Bills</div>
          <div class="stat-value purple" id="stat-active">—</div>
          <div class="stat-sub">currently open</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Owed to You</div>
          <div class="stat-value green" id="stat-owed">—</div>
          <div class="stat-sub">across all bills</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Collected</div>
          <div class="stat-value" id="stat-collected">—</div>
          <div class="stat-sub">payments received</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Bills Settled</div>
          <div class="stat-value" id="stat-settled">—</div>
          <div class="stat-sub">all time</div>
        </div>
      </div>
      <div class="section-header">
        <div class="section-title">Recent Bills</div>
        <button onclick="showPage('active-bills')" style="background:none;border:none;color:var(--purple3);font-size:13px;cursor:pointer;font-family:'Epilogue',sans-serif">View all →</button>
      </div>
      <div id="overview-bills" class="bills-list">
        <div class="loading"><div class="spinner"></div> Loading bills...</div>
      </div>
    </div>

    <!-- ACTIVE BILLS PAGE -->
    <div id="page-active-bills" class="page">
      <div class="page-header">
        <h1 class="page-title">Active <span>Bills</span></h1>
        <button class="bill-action-btn btn-remind" style="padding:10px 20px;font-size:13px" onclick="showPage('create-bill')">+ New Bill</button>
      </div>
      <div id="active-bills-list" class="bills-list">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
    </div>

    <!-- CREATE BILL PAGE -->
    <div id="page-create-bill" class="page">
      <div class="page-header">
        <h1 class="page-title">Create <span>Bill</span></h1>
      </div>

      <!-- STEP INDICATOR -->
      <div style="display:flex;gap:0;margin-bottom:28px;max-width:700px;border-bottom:1px solid var(--border)">
        <div id="cbs-1" style="flex:1;text-align:center;padding:10px 0;border-bottom:2px solid var(--green);margin-bottom:-1px;cursor:pointer" onclick="cbGoToStep(1)">
          <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--green);font-weight:700">Step 1</div>
          <div style="font-size:13px;color:var(--white);margin-top:2px">Snap Receipt</div>
        </div>
        <div id="cbs-2" style="flex:1;text-align:center;padding:10px 0;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer" onclick="if(cbItems.length>0)cbGoToStep(2)">
          <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);font-weight:700">Step 2</div>
          <div style="font-size:13px;color:var(--muted);margin-top:2px">Review &amp; Assign</div>
        </div>
        <div id="cbs-3" style="flex:1;text-align:center;padding:10px 0;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer" onclick="if(cbPeople.length>0)cbGoToStep(3)">
          <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);font-weight:700">Step 3</div>
          <div style="font-size:13px;color:var(--muted);margin-top:2px">Confirm &amp; Save</div>
        </div>
      </div>

      <!-- ── STEP 1: UPLOAD ── -->
      <div id="cb-step-1" style="max-width:640px">
        <div class="form-card" style="padding:20px 24px;margin-bottom:16px">
          <label class="form-label">Bill Name <span style="color:var(--muted);font-weight:400;font-size:10px">(auto-filled from receipt)</span></label>
          <input id="cb-name" type="text" class="form-input" placeholder="e.g. Saturday Night Out" style="margin-top:8px;font-size:15px;font-weight:600">
        </div>

        <div class="form-card" style="padding:24px;margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:16px">Receipt Photo</div>
          <div id="cb-dropzone" style="border:2px dashed rgba(48,209,88,0.3);border-radius:16px;background:rgba(48,209,88,0.02);transition:all 0.25s;cursor:pointer;overflow:hidden"
            onclick="document.getElementById('cb-file-input').click()"
            ondragover="event.preventDefault();this.style.borderColor='var(--green)';this.style.background='rgba(48,209,88,0.06)'"
            ondragleave="this.style.borderColor='rgba(48,209,88,0.3)';this.style.background='rgba(48,209,88,0.02)'"
            ondrop="cbHandleDrop(event)">
            <div id="cb-empty-state" style="padding:36px;text-align:center">
              <div style="font-size:40px;margin-bottom:10px">📸</div>
              <div style="font-size:15px;font-weight:600;margin-bottom:4px">Drop your receipt here</div>
              <div style="font-size:13px;color:var(--muted);margin-bottom:14px">or click to choose a photo</div>
              <div style="display:inline-flex;align-items:center;gap:8px;padding:9px 18px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25);border-radius:8px;font-size:13px;font-weight:600;color:var(--green)">📁 Choose Photo</div>
            </div>
            <div id="cb-preview-state" style="display:none;position:relative">
              <img id="cb-preview-img" style="width:100%;display:block">
              <div style="position:absolute;top:10px;right:10px;display:flex;gap:8px">
                <button onclick="event.stopPropagation();document.getElementById('cb-file-input').click()" style="padding:6px 12px;background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.2);color:white;border-radius:7px;font-size:12px;cursor:pointer;font-family:'Epilogue',sans-serif">↻ Replace</button>
                <button onclick="event.stopPropagation();cbClearPhoto()" style="padding:6px 12px;background:rgba(255,68,68,0.75);border:none;color:white;border-radius:7px;font-size:12px;cursor:pointer;font-family:'Epilogue',sans-serif">✕</button>
              </div>
            </div>
          </div>
          <input id="cb-file-input" type="file" accept="image/*" style="display:none" onchange="cbHandleFile(event)">

          <div id="cb-scan-wrap" style="display:none;margin-top:14px">
            <button onclick="cbScanReceipt()" id="cb-scan-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,var(--purple),var(--green));color:#fff;border:none;border-radius:10px;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(124,58,237,0.3)">
              ✨ Scan with AI — Extract All Items
            </button>
          </div>

          <div id="cb-scanning" style="display:none;margin-top:14px;padding:18px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:12px;text-align:center">
            <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:6px">
              <div style="width:18px;height:18px;border:2px solid rgba(124,58,237,0.3);border-top-color:var(--purple2);border-radius:50%;animation:spin 0.8s linear infinite"></div>
              <span style="font-weight:600;color:var(--purple3)">Claude AI is reading your receipt...</span>
            </div>
            <div style="font-size:12px;color:var(--muted)" id="cb-scan-status">Analyzing items, prices, tax and tip</div>
          </div>
          <div id="cb-scan-result" style="display:none;margin-top:14px"></div>
        </div>

        <div style="text-align:center;margin-bottom:16px">
          <button onclick="cbSkipToStep2()" style="background:none;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px">No receipt? Enter items manually →</button>
        </div>
      </div>

      <!-- ── STEP 2: REVIEW & ASSIGN ── -->
      <div id="cb-step-2" style="display:none;max-width:700px">
        <div style="display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start">
          <div style="display:flex;flex-direction:column;gap:14px">

            <!-- Scanned badge -->
            <div id="cb-scanned-badge" style="display:none;padding:12px 16px;background:rgba(48,209,88,0.07);border:1px solid rgba(48,209,88,0.2);border-radius:10px;display:flex;align-items:center;gap:10px">
              <span style="font-size:16px">✅</span>
              <div id="cb-scan-summary" style="font-size:13px;color:var(--green);font-weight:600"></div>
            </div>

            <!-- People -->
            <div class="form-card" style="padding:20px 24px">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">Who's at the table</div>
              <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Add everyone so you can assign items to them</div>
              <div style="display:flex;gap:8px;margin-bottom:10px">
                <input id="cb-person-input" type="text" class="add-person-input" placeholder="Add name (e.g. Jake)" style="flex:1" onkeydown="if(event.key==='Enter')cbAddPerson()">
                <button class="add-person-btn" onclick="cbAddPerson()">+ Add</button>
              </div>
              <div id="cb-people-chips" class="people-list"></div>
            </div>

            <!-- Items with assignment -->
            <div class="form-card" style="padding:20px 24px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2)">Menu Items</div>
                <div id="cb-item-count" style="font-size:12px;color:var(--muted)">0 items</div>
              </div>
              <div id="cb-items-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>
              <div style="display:flex;gap:8px;border-top:1px solid var(--border);padding-top:12px">
                <input id="cb-item-name" type="text" class="add-person-input" placeholder="Add item" style="flex:1" onkeydown="if(event.key==='Enter')cbAddItem()">
                <div style="position:relative;display:flex;align-items:center">
                  <span style="position:absolute;left:10px;color:var(--muted);font-size:13px">$</span>
                  <input id="cb-item-price" type="number" class="add-person-input" placeholder="0.00" step="0.01" style="width:88px;padding-left:22px" onkeydown="if(event.key==='Enter')cbAddItem()">
                </div>
                <button class="add-person-btn" onclick="cbAddItem()">+ Add</button>
              </div>
            </div>

            <!-- Shared charges -->
            <div class="form-card" style="padding:20px 24px">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:14px">Shared Charges <span style="color:var(--muted);font-weight:400;font-size:10px">(split evenly)</span></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div>
                  <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px">Tax</label>
                  <div style="position:relative">
                    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:13px">$</span>
                    <input id="cb-tax" type="number" class="form-input" placeholder="0.00" step="0.01" style="padding-left:28px" oninput="cbUpdateSummary()">
                  </div>
                </div>
                <div>
                  <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px">Tip</label>
                  <div style="position:relative">
                    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:13px">$</span>
                    <input id="cb-tip" type="number" class="form-input" placeholder="0.00" step="0.01" style="padding-left:28px" oninput="cbUpdateSummary()">
                  </div>
                </div>
              </div>
            </div>
            <button onclick="cbGoToStep(1)" style="background:none;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer;text-align:left;padding:0">← Back</button>
          </div>

          <!-- Summary sidebar -->
          <div style="position:sticky;top:24px">
            <div class="form-card" style="padding:22px">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:14px">Live Summary</div>
              <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
                <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Subtotal</span><span id="cb-subtotal">$0.00</span></div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Tax</span><span id="cb-tax-display">$0.00</span></div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Tip</span><span id="cb-tip-display">$0.00</span></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;margin-bottom:18px"><span>Total</span><span id="cb-total-display" style="color:var(--green)">$0.00</span></div>
              <button onclick="cbGoToStep(3)" class="submit-btn">Continue →</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── STEP 3: CONFIRM ── -->
      <div id="cb-step-3" style="display:none;max-width:700px">
        <div style="display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start">
          <div class="form-card" style="padding:24px">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:14px">Per Person Breakdown</div>
            <div id="cb-per-person-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px"></div>
            <button onclick="cbGoToStep(2)" style="background:none;border:none;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer;padding:0">← Back to items</button>
          </div>
          <div style="position:sticky;top:24px">
            <div class="form-card" style="padding:22px">
              <div style="font-size:16px;font-weight:700;margin-bottom:4px" id="cb-final-name">—</div>
              <div style="font-size:13px;color:var(--muted);margin-bottom:14px" id="cb-final-meta"></div>
              <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;margin-bottom:20px;padding-top:12px;border-top:1px solid var(--border)">
                <span>Total</span><span style="color:var(--green)" id="cb-final-total">$0.00</span>
              </div>
              <button onclick="cbCreateFinalBill()" class="submit-btn" id="cb-final-btn">🪶 Create Bill</button>
            </div>
          </div>
        </div>
      </div>


      <!-- PAYMENT MODAL -->
      <div id="cb-pay-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);z-index:900;align-items:flex-end;justify-content:center" onclick="if(event.target.id==='cb-pay-modal')cbClosePayModal()">
        <div style="background:var(--dark2);border:1px solid var(--border2);border-radius:24px 24px 0 0;padding:28px 24px 52px;width:100%;max-width:480px">
          <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 20px"></div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:0.05em;margin-bottom:4px" id="pay-modal-title">Pay</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:6px" id="pay-modal-sub">Send payment to bill creator</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:48px;color:var(--green);letter-spacing:0.04em;margin-bottom:24px;line-height:1" id="pay-modal-amount">$0.00</div>

          <div id="pay-modal-methods" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px"></div>

          <button onclick="cbMarkPaidOther()" style="width:100%;padding:13px;background:transparent;border:1px solid var(--border2);border-radius:12px;color:var(--muted2);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px;transition:all 0.15s" onmouseover="this.style.borderColor='var(--border2)';this.style.color='var(--white)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted2)'">✓ Mark as paid (other method)</button>
          <button onclick="cbClosePayModal()" style="width:100%;padding:12px;background:transparent;border:1px solid var(--border);border-radius:12px;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:13px;cursor:pointer">I'll pay later</button>
        </div>
      </div>
      <!-- ASSIGN MODAL -->
      <div id="cb-assign-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:800;align-items:flex-end;justify-content:center" onclick="if(event.target.id==='cb-assign-modal')cbCloseAssign()">
        <div style="background:var(--dark2);border:1px solid var(--border2);border-radius:24px 24px 0 0;padding:28px 24px 48px;width:100%;max-width:480px;transform:translateY(0)">
          <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 20px"></div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:0.05em;margin-bottom:4px" id="cb-assign-item-name">Item</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:18px">Assign this item to people at the table</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px" id="cb-assign-people-btns"></div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:8px;font-weight:600">Assigned to</div>
          <div id="cb-assign-list" style="min-height:40px;margin-bottom:18px"></div>
          <button onclick="cbCloseAssign()" style="width:100%;padding:14px;background:transparent;border:1px solid var(--border2);border-radius:12px;color:var(--muted);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer">Done</button>
        </div>
      </div>
    </div>


    <!-- SETTINGS PAGE -->
    <div id="page-settings" class="page">
      <div class="page-header">
        <h1 class="page-title">Account <span>Settings</span></h1>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:900px">

        <!-- Profile info -->
        <div class="form-card" style="padding:28px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:18px">Profile</div>
          <div class="form-group">
            <label class="form-label">First Name</label>
            <input id="set-first" type="text" class="form-input" placeholder="John">
          </div>
          <div class="form-group">
            <label class="form-label">Last Name</label>
            <input id="set-last" type="text" class="form-input" placeholder="Smith">
          </div>
          <div class="form-group">
            <label class="form-label">Phone Number</label>
            <input id="set-phone" type="tel" class="form-input" placeholder="+1 (555) 000-0000">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input id="set-email" type="text" class="form-input" disabled style="opacity:0.5;cursor:not-allowed">
          </div>
        </div>

        <!-- Payment methods -->
        <div class="form-card" style="padding:28px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">Payment Methods</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:18px">When people click Pay on your bills, they'll see these options</div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px">
              <span style="width:20px;height:20px;background:#008CFF;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px">V</span>
              Venmo Username
            </label>
            <input id="set-venmo" type="text" class="form-input" placeholder="@your-venmo">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px">
              <span style="width:20px;height:20px;background:#00D632;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px">$</span>
              Cash App $Cashtag
            </label>
            <input id="set-cashapp" type="text" class="form-input" placeholder="$YourCashtag">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px">
              <span style="width:20px;height:20px;background:#6D1ED4;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px">Z</span>
              Zelle (email or phone)
            </label>
            <input id="set-zelle" type="text" class="form-input" placeholder="email or phone number">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px">
              <span style="width:20px;height:20px;background:#1a1a1a;border:1px solid #444;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#fff">Pay</span>
              Apple Pay (your name/number)
            </label>
            <input id="set-applepay" type="text" class="form-input" placeholder="e.g. John or +15551234567">
          </div>
        </div>
      </div>

      <!-- Save button -->
      <div style="max-width:900px;margin-top:20px">
        <button onclick="saveSettings()" class="submit-btn" id="save-settings-btn" style="max-width:220px">💾 Save Settings</button>
        <div id="settings-saved" style="display:none;margin-top:12px;color:var(--green);font-size:13px;font-weight:600">✅ Settings saved!</div>
      </div>
    </div>

    <!-- HISTORY PAGE -->
    <div id="page-history" class="page">
      <div class="page-header">
        <h1 class="page-title">Bill <span>History</span></h1>
      </div>
      <div style="background:var(--dark);border:1px solid var(--border);border-radius:14px;overflow:hidden">
        <div id="history-content">
          <div class="loading"><div class="spinner"></div> Loading...</div>
        </div>
      </div>
    </div>

  </main>
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
      <button class="modal-btn" id="modal-share-btn" style="background:rgba(48,209,88,0.12);color:var(--green);border:1px solid rgba(48,209,88,0.25)">🔗 Share Bill</button>
      <button class="modal-btn modal-btn-remind" id="modal-remind-btn">🔔 Remind Unpaid</button>
      <button class="modal-btn modal-btn-delete" id="modal-delete-btn">🗑 Delete Bill</button>
    </div>
  </div>
</div>

<!-- TOAST -->
<div class="toast" id="toast"></div>

<script>
// ── SUPABASE ──
const SUPABASE_URL = 'https://ffjpzkpdumdcwnakpaje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmanB6a3BkdW1kY3duYWtwYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODc4OTcsImV4cCI6MjA4ODU2Mzg5N30.JtDLVu4K1TJ8emcN_mvSHBu6e0y8-jPQv-ypoc9p0RU';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BACKEND = 'https://raven-backend-production-fb1f.up.railway.app';

let currentUser = null;
let currentBillId = null;
let people = [];

// ── INIT ──
async function init() {
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    await db.auth.getSession();
    history.replaceState(null, '', window.location.pathname);
  }

  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    await checkOnboardingAndShow(currentUser.id);
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
      currentUser = session.user;
      if (window.location.hash) history.replaceState(null, '', window.location.pathname);
      await checkOnboardingAndShow(session.user.id);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      showAuth();
    }
  });
}

async function checkOnboardingAndShow(userId) {
  // 1. Check localStorage — fastest, most reliable
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    if (local.user_id === userId && local.onboarding_complete) {
      showDashboard();
      return;
    }
  } catch(e) {}

  // 2. Check Supabase profiles table
  try {
    const { data: profile, error } = await db
      .from('profiles')
      .select('onboarding_complete, first_name')
      .eq('id', userId)
      .single();

    if (!error && profile) {
      if (profile.onboarding_complete) {
        // Cache it locally
        const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
        localStorage.setItem('raven_profile', JSON.stringify({
          ...existing,
          user_id: userId,
          onboarding_complete: true,
          first_name: profile.first_name || existing.first_name || ''
        }));
        showDashboard();
        return;
      } else {
        // Profile exists but onboarding not done
        window.location.href = 'onboarding.html';
        return;
      }
    }
  } catch(e) {
    console.log('Profile check error:', e);
  }

  // 3. If no profile found at all → new user, send to onboarding
  // But if they've signed in before (have any local data), just show dashboard
  const hasLocalData = localStorage.getItem('raven_profile');
  if (hasLocalData) {
    showDashboard();
  } else {
    window.location.href = 'onboarding.html';
  }
}

// ── AUTH ──
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'signup' && i === 1));
  });
  document.getElementById('login-form').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? 'flex' : 'none';
  hideAuthError();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideAuthError() { document.getElementById('auth-error').style.display = 'none'; }

async function handleLogin() {
  const emailEl = document.getElementById('login-email');
  const passwordEl = document.getElementById('login-password');
  const email = emailEl.value.trim();
  const password = passwordEl.value;

  console.log('Login attempt:', email, password.length + ' chars');

  if (!email) return showAuthError('Please enter your email.');
  if (!password) return showAuthError('Please enter your password.');

  const btn = document.querySelector('#login-form .auth-btn');
  btn.textContent = 'Signing in...'; btn.disabled = true;
  hideAuthError();

  const { data, error } = await db.auth.signInWithPassword({ email, password });
  console.log('Login result:', data?.user?.email, error?.message);

  btn.textContent = 'Sign In →'; btn.disabled = false;

  if (error) {
    showAuthError(error.message);
  } else if (data?.user) {
    currentUser = data.user;
    await checkOnboardingAndShow(data.user.id);
  }
}

async function handleSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  if (!email || !password) return showAuthError('Please fill in all fields.');
  if (password !== confirm) return showAuthError("Passwords don't match.");
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.');
  const btn = document.querySelector('#signup-form .auth-btn');
  btn.textContent = 'Creating account...'; btn.disabled = true;
  const { data, error } = await db.auth.signUp({ email, password });
  btn.textContent = 'Create Account →'; btn.disabled = false;
  if (error) {
    showAuthError(error.message);
  } else {
    // Always go to onboarding after signup regardless of email confirmation state
    window.location.href = 'onboarding.html';
  }
}

// ─── PAYMENT MODAL ──────────────────────────────────────────────────────────

let payModalParticipantId = null;
let payModalBillId = null;

async function openPayModal(participantId, billId, amount) {
  payModalParticipantId = participantId;
  payModalBillId = billId;

  const amt = parseFloat(amount).toFixed(2);
  document.getElementById('pay-modal-amount').textContent = '$' + amt;

  const { data: bill } = await db.from('bills').select('name, creator_phone').eq('id', billId).single();
  document.getElementById('pay-modal-title').textContent = 'Pay for ' + (bill?.name || 'Bill');

  let profile = null;
  try {
    const res = await db.from('profiles').select('first_name,venmo,cashapp,zelle,applepay').eq('email', bill?.creator_phone).single();
    profile = res.data;
  } catch(e) {}

  const creatorName = profile?.first_name || 'the bill creator';
  document.getElementById('pay-modal-sub').textContent = 'Send $' + amt + ' to ' + creatorName;

  const methods = [];

  if (profile?.venmo) {
    const handle = profile.venmo.startsWith('@') ? profile.venmo : '@' + profile.venmo;
    const clean = profile.venmo.replace('@','');
    methods.push(`<a href="https://venmo.com/${clean}?txn=pay&note=Bill%20Payment&amount=${amt}" target="_blank" class="pay-method-row" style="background:#003d7a"><div class="pay-method-icon" style="background:#008CFF">V</div><div class="pay-method-info"><div class="pay-method-name">Venmo</div><div class="pay-method-handle">${handle}</div></div><div class="pay-method-arrow">→</div></a>`);
  }

  if (profile?.cashapp) {
    const tag = profile.cashapp.startsWith('$') ? profile.cashapp : '$' + profile.cashapp;
    const clean = profile.cashapp.replace('$','');
    methods.push(`<a href="https://cash.app/${clean}/${amt}" target="_blank" class="pay-method-row" style="background:#004d12"><div class="pay-method-icon" style="background:#00D632">$</div><div class="pay-method-info"><div class="pay-method-name">Cash App</div><div class="pay-method-handle">${tag}</div></div><div class="pay-method-arrow">→</div></a>`);
  }

  if (profile?.zelle) {
    const zel = profile.zelle;
    methods.push(`<a href="#" onclick="navigator.clipboard.writeText(${JSON.stringify(zel)}).then(()=>showToast('Zelle info copied!','success'));return false" class="pay-method-row" style="background:#2a0a52"><div class="pay-method-icon" style="background:#6D1ED4">Z</div><div class="pay-method-info"><div class="pay-method-name">Zelle</div><div class="pay-method-handle">${zel} &middot; tap to copy</div></div><div class="pay-method-arrow">→</div></a>`);
  }

  if (profile?.applepay) {
    const ap = profile.applepay;
    methods.push(`<a href="#" onclick="navigator.clipboard.writeText(${JSON.stringify(ap)}).then(()=>showToast('Apple Pay info copied!','success'));return false" class="pay-method-row" style="background:#1a1a1a"><div class="pay-method-icon" style="background:#333;border:1px solid #555;font-size:9px">Pay</div><div class="pay-method-info"><div class="pay-method-name">Apple Pay</div><div class="pay-method-handle">${ap} &middot; tap to copy</div></div><div class="pay-method-arrow">→</div></a>`);
  }

  if (methods.length === 0) {
    methods.push(`<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">No payment methods added yet.<br>Ask ${creatorName} to add them in Settings.</div>`);
  }

  document.getElementById('pay-modal-methods').innerHTML = methods.join('');
  document.getElementById('cb-pay-modal').style.display = 'flex';
}

async function cbMarkPaidOther() {
  if (!payModalParticipantId || !payModalBillId) return;
  await markPaid(payModalParticipantId, payModalBillId);
  cbClosePayModal();
  showToast('✅ Marked as paid!', 'success');
}

function cbClosePayModal() {
  document.getElementById('cb-pay-modal').style.display = 'none';
  payModalParticipantId = null;
  payModalBillId = null;
}


// ─── SETTINGS ────────────────────────────────────────────────────────────────

async function loadSettings() {
  document.getElementById('set-email').value = currentUser.email;
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    if (local.first_name) document.getElementById('set-first').value = local.first_name;
    if (local.last_name) document.getElementById('set-last').value = local.last_name;
    if (local.phone) document.getElementById('set-phone').value = local.phone;
    if (local.venmo) document.getElementById('set-venmo').value = local.venmo;
    if (local.cashapp) document.getElementById('set-cashapp').value = local.cashapp;
    if (local.zelle) document.getElementById('set-zelle').value = local.zelle;
    if (local.applepay) document.getElementById('set-applepay').value = local.applepay;

    // Also fetch fresh from Supabase
    const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    if (profile) {
      if (profile.first_name) document.getElementById('set-first').value = profile.first_name;
      if (profile.last_name) document.getElementById('set-last').value = profile.last_name;
      if (profile.phone) document.getElementById('set-phone').value = profile.phone;
      if (profile.venmo) document.getElementById('set-venmo').value = profile.venmo;
      if (profile.cashapp) document.getElementById('set-cashapp').value = profile.cashapp;
      if (profile.zelle) document.getElementById('set-zelle').value = profile.zelle;
      if (profile.applepay) document.getElementById('set-applepay').value = profile.applepay || '';
    }
  } catch(e) { console.log('loadSettings error:', e); }
}

async function saveSettings() {
  const btn = document.getElementById('save-settings-btn');
  btn.textContent = 'Saving...'; btn.disabled = true;

  const data = {
    id: currentUser.id,
    email: currentUser.email,
    first_name: document.getElementById('set-first').value.trim(),
    last_name: document.getElementById('set-last').value.trim(),
    phone: document.getElementById('set-phone').value.trim(),
    venmo: document.getElementById('set-venmo').value.trim(),
    cashapp: document.getElementById('set-cashapp').value.trim(),
    zelle: document.getElementById('set-zelle').value.trim(),
    applepay: document.getElementById('set-applepay').value.trim(),
    onboarding_complete: true,
    updated_at: new Date().toISOString()
  };

  try {
    await db.from('profiles').upsert(data, { onConflict: 'id' });
    // Update localStorage cache
    const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    localStorage.setItem('raven_profile', JSON.stringify({ ...existing, ...data }));
    document.getElementById('settings-saved').style.display = 'block';
    setTimeout(() => document.getElementById('settings-saved').style.display = 'none', 3000);
    // Update greeting
    if (data.first_name) {
      const greetEl = document.getElementById('greeting-name');
      if (greetEl) greetEl.textContent = data.first_name.charAt(0).toUpperCase() + data.first_name.slice(1);
    }
  } catch(e) { showToast('Error saving settings', 'error'); }

  btn.textContent = '💾 Save Settings'; btn.disabled = false;
}

async function shareBill(billId, billName) {
  // Fetch the share token for this bill
  let url = `https://raven-backend-production-fb1f.up.railway.app/bill/${billId}`;
  try {
    const { data: bill } = await db.from('bills').select('share_token').eq('id', billId).single();
    if (bill?.share_token) url += `?t=${bill.share_token}`;
  } catch(e) {}

  // Just share the URL — iMessage link preview handles the rich card
  if (navigator.share) {
    navigator.share({ url }).catch(() => cbCopyLink(url));
  } else {
    cbCopyLink(url);
  }
}

function cbCopyLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('🔗 Bill link copied! Send it to your group.', 'success');
  }).catch(() => {
    // Fallback — show the URL
    prompt('Copy this link and send to your group:', url);
  });
}

async function handleLogout() {
  localStorage.removeItem('raven_profile');
  await db.auth.signOut();
  window.location.href = 'index.html';
}

// ── SCREEN SWITCH ──
function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('dashboard-screen').style.display = 'none';
}
async function showDashboard() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('dashboard-screen').style.display = 'block';
  const email = currentUser.email;
  document.getElementById('user-email-display').textContent = email;
  document.getElementById('user-avatar').textContent = email[0].toUpperCase();

  // Update sidebar avatar
  document.getElementById('sidebar-avatar').textContent = currentUser.email[0].toUpperCase();

  // Get first name — check localStorage first, then Supabase
  let firstName = null;
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    if (local.first_name && local.user_id === currentUser.id) {
      firstName = local.first_name;
    } else {
      const { data: profile } = await db.from('profiles').select('first_name').eq('id', currentUser.id).single();
      if (profile?.first_name) {
        firstName = profile.first_name;
        const existing = JSON.parse(localStorage.getItem('raven_profile') || '{}');
        localStorage.setItem('raven_profile', JSON.stringify({ ...existing, first_name: firstName, user_id: currentUser.id }));
      }
    }
  } catch(e) {}

  // Show first name only — never show email
  const greetingEl = document.getElementById('greeting-name');
  if (firstName) {
    greetingEl.textContent = firstName.charAt(0).toUpperCase() + firstName.slice(1);
    document.getElementById('sidebar-name').textContent = firstName.charAt(0).toUpperCase() + firstName.slice(1) + ' (me)';
    document.getElementById('sidebar-avatar').textContent = firstName[0].toUpperCase();
  } else {
    greetingEl.closest('h1').innerHTML = 'Welcome Back <span style="color:var(--green)">🪶</span>';
  }
  loadAllData();
}

// ── NAVIGATION ──
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  const navMap = { 'overview': 0, 'active-bills': 1, 'create-bill': 2, 'history': 3, 'settings': 4 };
  document.querySelectorAll('.nav-item')[navMap[page]]?.classList.add('active');
  if (page === 'active-bills') loadActiveBills();
  if (page === 'history') loadHistory();
  if (page === 'settings') loadSettings();
}

// ── DATA LOADING ──
async function loadAllData() {
  await Promise.all([loadOverview(), loadActiveBills()]);
}

async function loadOverview() {
  const { data: bills } = await db.from('bills').select('*, participants(*)').eq('creator_phone', currentUser.email).order('created_at', { ascending: false }).limit(5);
  if (!bills) return;

  const active = bills.filter(b => b.status === 'active');
  const completed = bills.filter(b => b.status === 'completed');
  let totalOwed = 0, totalCollected = 0;

  bills.forEach(b => {
    b.participants?.forEach(p => {
      if (!p.paid) totalOwed += parseFloat(p.amount || 0);
      else totalCollected += parseFloat(p.amount || 0);
    });
  });

  document.getElementById('stat-active').textContent = active.length;
  document.getElementById('stat-owed').textContent = '$' + totalOwed.toFixed(2);
  document.getElementById('stat-collected').textContent = '$' + totalCollected.toFixed(2);
  document.getElementById('stat-settled').textContent = completed.length;
  document.getElementById('active-count').textContent = active.length;

  const container = document.getElementById('overview-bills');
  if (bills.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🪶</span><div class="empty-title">No bills yet</div><div class="empty-sub">Create your first bill to get started</div></div>`;
    return;
  }
  container.innerHTML = bills.slice(0, 4).map(b => renderBillCard(b)).join('');
}

async function loadActiveBills() {
  const { data: bills } = await db.from('bills').select('*, participants(*)').eq('creator_phone', currentUser.email).eq('status', 'active').order('created_at', { ascending: false });
  const container = document.getElementById('active-bills-list');
  if (!bills || bills.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><div class="empty-title">No active bills</div><div class="empty-sub">Create a bill to start splitting</div></div>`;
    return;
  }
  container.innerHTML = bills.map(b => renderBillCard(b)).join('');
}

async function loadHistory() {
  const { data: bills } = await db.from('bills').select('*, participants(*)').eq('creator_phone', currentUser.email).order('created_at', { ascending: false });
  const container = document.getElementById('history-content');
  if (!bills || bills.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🕐</span><div class="empty-title">No history yet</div></div>`;
    return;
  }
  container.innerHTML = `<table class="history-table">
    <thead><tr><th>Bill</th><th>Total</th><th>People</th><th>Collected</th><th>Status</th><th>Date</th></tr></thead>
    <tbody>${bills.map(b => {
      const paid = b.participants?.filter(p => p.paid).length || 0;
      const total = b.participants?.length || 0;
      const collected = b.participants?.filter(p => p.paid).reduce((s, p) => s + parseFloat(p.amount || 0), 0) || 0;
      const date = new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `<tr onclick="openBillModal('${b.id}')" style="cursor:pointer">
        <td>${b.name}</td>
        <td>$${parseFloat(b.total).toFixed(2)}</td>
        <td>${total} people</td>
        <td style="color:var(--green)">$${collected.toFixed(2)}</td>
        <td><span class="status-badge ${b.status === 'active' ? 'status-active' : 'status-completed'}">${b.status === 'active' ? '● Active' : '✓ Done'}</span></td>
        <td>${date}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function renderBillCard(b) {
  const paid = b.participants?.filter(p => p.paid).length || 0;
  const total = b.participants?.length || 0;
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const owed = b.participants?.filter(p => !p.paid).reduce((s, p) => s + parseFloat(p.amount || 0), 0) || 0;
  return `<div class="bill-card" onclick="openBillModal('${b.id}')">
    <div>
      <div class="bill-name">${b.name} <span class="bill-id">${b.id}</span></div>
      <div class="bill-meta">
        <span>${total} people</span>
        <span>${paid}/${total} paid</span>
        <span style="color:var(--orange)">$${owed.toFixed(2)} owed</span>
      </div>
    </div>
    <div class="bill-amount">$${parseFloat(b.total).toFixed(2)}</div>
    <div class="bill-progress-wrap">
      <div class="bill-progress-label">${pct}% paid</div>
      <div class="bill-progress"><div class="bill-progress-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="bill-actions" onclick="event.stopPropagation()">
      <button class="bill-action-btn btn-remind" onclick="sendReminder('${b.id}')">🔔 Remind</button>
      <button class="bill-action-btn btn-view" onclick="openBillModal('${b.id}')">View →</button>
    </div>
  </div>`;
}

// ── CREATE BILL ──
function addPerson() {
  const input = document.getElementById('person-input');
  const name = input.value.trim();
  if (!name || people.includes(name)) return;
  people.push(name);
  input.value = '';
  renderPeople();
  updateSplitPreview();
}

function removePerson(name) {
  people = people.filter(p => p !== name);
  renderPeople();
  updateSplitPreview();
}

function renderPeople() {
  document.getElementById('people-list').innerHTML = people.map(p =>
    `<div class="person-tag">@${p} <button onclick="removePerson('${p}')">×</button></div>`
  ).join('');
}

function updateSplitPreview() {
  const total = parseFloat(document.getElementById('bill-total').value) || 0;
  const preview = document.getElementById('split-preview');
  if (total > 0 && people.length > 0) {
    const per = (total / people.length).toFixed(2);
    preview.style.display = 'block';
    preview.innerHTML = `Each person owes <strong>$${per}</strong> — split equally between ${people.length} people`;
  } else {
    preview.style.display = 'none';
  }
}

async function createBill() {
  const name = document.getElementById('bill-name').value.trim();
  const total = parseFloat(document.getElementById('bill-total').value);
  if (!name) return showToast('Enter a bill name', 'error');
  if (!total || total <= 0) return showToast('Enter a valid amount', 'error');
  if (people.length === 0) return showToast('Add at least one person', 'error');

  const btn = document.getElementById('create-btn');
  btn.textContent = 'Creating...'; btn.disabled = true;

  const billId = generateId();
  const perPerson = total / people.length;

  const { error: billErr } = await db.from('bills').insert({
    id: billId,
    creator_phone: currentUser.email,
    name,
    total,
    per_person: perPerson,
    status: 'active'
  });

  if (billErr) { btn.textContent = '🪶 Create Bill'; btn.disabled = false; return showToast('Error creating bill', 'error'); }

  const rows = people.map(p => ({
    bill_id: billId,
    phone: `unknown_${p.toLowerCase()}_${billId}`,
    name: p,
    amount: perPerson,
    paid: false
  }));

  await db.from('participants').insert(rows);

  // Save receipt items and assignments to Supabase so bill page can show them
  if (cbItems.length > 0) {
    // Insert receipt_items and get back their IDs
    const { data: savedItems } = await db.from('receipt_items').insert(
      cbItems.map(item => ({ bill_id: billId, name: item.name, price: item.price }))
    ).select();

    // Save item_selections (who ordered what)
    if (savedItems && savedItems.length > 0) {
      const selectionRows = [];
      savedItems.forEach((savedItem, idx) => {
        const originalItem = cbItems[idx];
        if (originalItem && originalItem.assignees.length > 0) {
          originalItem.assignees.forEach(person => {
            selectionRows.push({
              bill_id: billId,
              item_id: savedItem.id,
              participant_name: person.toLowerCase()
            });
          });
        }
      });
      if (selectionRows.length > 0) {
        await db.from('item_selections').insert(selectionRows);
      }
    }
  }

  btn.textContent = '🪶 Create Bill'; btn.disabled = false;
  showToast(`✅ Bill "${name}" created! ID: ${billId}`, 'success');
  people = [];
  document.getElementById('bill-name').value = '';
  document.getElementById('bill-total').value = '';
  renderPeople();
  updateSplitPreview();
  loadAllData();
  setTimeout(() => showPage('active-bills'), 1500);
}

function generateId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── BILL MODAL ──
async function openBillModal(billId) {
  currentBillId = billId;
  const { data: bill } = await db.from('bills').select('*, participants(*)').eq('id', billId).single();
  if (!bill) return;

  document.getElementById('modal-bill-name').textContent = bill.name;

  // Show receipt image if available
  let receiptHTML = '';
  if (bill.receipt_image) {
    receiptHTML = `<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px">Receipt</div><img src="data:image/jpeg;base64,${bill.receipt_image}" style="width:100%;border-radius:10px;display:block" onerror="this.src='data:image/png;base64,'+this.src.split(',')[1]"></div>`;
  }
  const receiptEl = document.getElementById('modal-receipt');
  if (receiptEl) receiptEl.innerHTML = receiptHTML;
  document.getElementById('modal-bill-meta').textContent = `ID: ${bill.id}  ·  Total: $${parseFloat(bill.total).toFixed(2)}  ·  ${bill.participants?.length || 0} people`;

  const parts = bill.participants || [];
  const paid = parts.filter(p => p.paid).length;

  document.getElementById('modal-participants').innerHTML = parts.map(p => `
    <div class="participant-row">
      <div>
        <div class="participant-name">@${p.name}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="participant-amount ${p.paid ? 'paid-tag' : 'owed-tag'}">
          ${p.paid ? '✓ Paid' : '$' + parseFloat(p.amount).toFixed(2) + ' owed'}
        </span>
        ${!p.paid ? `<button class="mark-paid-btn" onclick="openPayModal('${p.id}', '${billId}', ${parseFloat(p.amount).toFixed(2)})">💳 Pay</button>` : ''}
      </div>
    </div>
  `).join('');

  document.getElementById('modal-share-btn').onclick = () => shareBill(billId, bill.name);
  document.getElementById('modal-remind-btn').onclick = () => sendReminder(billId);
  document.getElementById('modal-delete-btn').onclick = () => deleteBill(billId);
  document.getElementById('bill-modal').classList.add('open');
}

function closeBillModal() {
  document.getElementById('bill-modal').classList.remove('open');
  currentBillId = null;
}

async function markPaid(participantId, billId) {
  await db.from('participants').update({ paid: true, paid_at: new Date().toISOString() }).eq('id', participantId);
  showToast('✅ Marked as paid!', 'success');
  openBillModal(billId);
  loadAllData();
}

async function sendReminder(billId) {
  try {
    const res = await fetch(`${BACKEND}/remind-dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId, userEmail: currentUser.email })
    });
    showToast('🔔 Reminder sent to unpaid members!', 'success');
  } catch(e) {
    showToast('🔔 Reminder queued!', 'success');
  }
}

async function deleteBill(billId) {
  if (!confirm('Delete this bill? This cannot be undone.')) return;
  await db.from('bills').update({ status: 'deleted' }).eq('id', billId);
  closeBillModal();
  showToast('Bill deleted', 'success');
  loadAllData();
}

// ── TOAST ──
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── KEYBOARD ──
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.getElementById('login-form').style.display !== 'none') handleLogin();
    if (document.getElementById('signup-form').style.display !== 'none') handleSignup();
  }
  if (e.key === 'Escape') closeBillModal();
  if (document.getElementById('person-input') === document.activeElement && e.key === 'Enter') addPerson();
});

// ── START ──
window.addEventListener("load", function() { init(); });

// ─── CREATE BILL — FULL INTERFACE ──────────────────────────────────────────

let cbItems = [];
let cbPeople = [];
let cbImageBase64 = null;
let cbImageMediaType = 'image/jpeg';
let cbCurrentStep = 1;
let cbAssignModalItemId = null;

function cbGoToStep(step) {
  [1,2,3].forEach(s => {
    const el = document.getElementById('cb-step-' + s);
    if (el) el.style.display = s === step ? 'block' : 'none';
    const tab = document.getElementById('cbs-' + s);
    if (tab) {
      const isActive = s === step;
      const isDone = s < step;
      tab.style.borderBottomColor = isActive ? 'var(--green)' : isDone ? 'var(--purple)' : 'transparent';
      tab.querySelector('div:first-child').style.color = isActive ? 'var(--green)' : isDone ? 'var(--purple3)' : 'var(--muted)';
      tab.querySelector('div:last-child').style.color = isActive || isDone ? 'var(--white)' : 'var(--muted)';
    }
  });
  cbCurrentStep = step;
  if (step === 3) cbBuildStep3();
}

function cbSkipToStep2() {
  cbGoToStep(2);
  cbRenderItems();
  cbRenderPeople();
}

// ── PHOTO ──
function cbHandleFile(event) {
  const file = event.target.files[0];
  if (file) cbLoadPhoto(file);
}

function cbHandleDrop(event) {
  event.preventDefault();
  event.currentTarget.style.borderColor = 'rgba(48,209,88,0.3)';
  event.currentTarget.style.background = 'rgba(48,209,88,0.02)';
  const file = event.dataTransfer.files[0];
  if (file) cbLoadPhoto(file);
}

function cbLoadPhoto(file) {
  cbImageMediaType = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = async e => {
    // Resize for display + sending
    const resized = await cbResizeImage(e.target.result, 1600);
    cbImageBase64 = resized.split(',')[1];
    document.getElementById('cb-preview-img').src = resized;
    document.getElementById('cb-empty-state').style.display = 'none';
    document.getElementById('cb-preview-state').style.display = 'block';
    document.getElementById('cb-scan-wrap').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function cbResizeImage(dataUrl, maxSize) {
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
      resolve(canvas.toDataURL('image/jpeg', 0.88));
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
}

// ── AI SCAN ──
async function cbScanReceipt() {
  if (!cbImageBase64) return showToast('Upload a receipt photo first', 'error');
  document.getElementById('cb-scan-wrap').style.display = 'none';
  document.getElementById('cb-scanning').style.display = 'block';

  const msgs = ['Analyzing receipt layout...', 'Reading item names and prices...', 'Detecting tax and tip...', 'Finalizing...'];
  let mi = 0;
  const iv = setInterval(() => { if (mi < msgs.length) document.getElementById('cb-scan-status').textContent = msgs[mi++]; }, 1400);

  try {
    const res = await fetch('https://raven-backend-production-fb1f.up.railway.app/demo/scan-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: cbImageBase64, mediaType: cbImageMediaType })
    });
    clearInterval(iv);
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    if (!data.success || !data.items?.length) throw new Error(data.error || 'No items found');

    // Auto-fill bill name from receipt
    if (data.bill_name && !document.getElementById('cb-name').value) {
      document.getElementById('cb-name').value = data.bill_name;
    }

    cbItems = data.items.map((item, i) => ({
      id: Date.now() + i,
      name: item.name,
      price: parseFloat(item.price) || 0,
      assignees: []
    }));

    if (data.tax) document.getElementById('cb-tax').value = parseFloat(data.tax).toFixed(2);
    if (data.tip) document.getElementById('cb-tip').value = parseFloat(data.tip).toFixed(2);

    document.getElementById('cb-scanning').style.display = 'none';
    const badge = document.getElementById('cb-scanned-badge');
    badge.style.display = 'flex';
    document.getElementById('cb-scan-summary').textContent = `Found ${cbItems.length} items · Tax $${(data.tax||0).toFixed(2)} · Tip $${(data.tip||0).toFixed(2)}`;

    document.getElementById('cb-scan-result').style.display = 'block';
    document.getElementById('cb-scan-result').innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(48,209,88,0.07);border:1px solid rgba(48,209,88,0.2);border-radius:10px">
        <span>✅</span>
        <span style="font-size:13px;color:var(--green);font-weight:600">${cbItems.length} items found! Moving to next step...</span>
      </div>`;

    cbRenderItems();
    cbUpdateSummary();
    showToast(`✅ ${cbItems.length} items scanned!`, 'success');
    setTimeout(() => cbGoToStep(2), 800);

  } catch(err) {
    clearInterval(iv);
    document.getElementById('cb-scanning').style.display = 'none';
    document.getElementById('cb-scan-wrap').style.display = 'block';
    document.getElementById('cb-scan-result').style.display = 'block';
    document.getElementById('cb-scan-result').innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(255,68,68,0.07);border:1px solid rgba(255,68,68,0.2);border-radius:10px">
        <span>⚠️</span>
        <span style="font-size:13px;color:#FF6B6B;font-weight:600">Scan failed — try a clearer photo or add items manually</span>
      </div>`;
    console.error('Scan error:', err);
  }
}

// ── PEOPLE ──
function cbAddPerson() {
  const input = document.getElementById('cb-person-input');
  const name = input.value.trim();
  if (!name || cbPeople.includes(name)) return;
  cbPeople.push(name);
  input.value = '';
  cbRenderPeople();
  cbRenderItems();
  cbUpdateSummary();
}

function cbRemovePerson(name) {
  cbPeople = cbPeople.filter(p => p !== name);
  cbItems.forEach(item => { item.assignees = item.assignees.filter(a => a !== name); });
  cbRenderPeople();
  cbRenderItems();
  cbUpdateSummary();
}

function cbRenderPeople() {
  document.getElementById('cb-people-chips').innerHTML = cbPeople.map(p =>
    `<div class="person-tag">@${p} <button onclick="cbRemovePerson('${p}')">×</button></div>`
  ).join('');
}

// ── ITEMS ──
function cbAddItem() {
  const nameEl = document.getElementById('cb-item-name');
  const priceEl = document.getElementById('cb-item-price');
  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value);
  if (!name || isNaN(price) || price <= 0) return;
  cbItems.push({ id: Date.now(), name, price, assignees: [] });
  nameEl.value = ''; priceEl.value = '';
  cbRenderItems();
  cbUpdateSummary();
}

function cbRemoveItem(id) {
  cbItems = cbItems.filter(i => i.id !== id);
  cbRenderItems();
  cbUpdateSummary();
}

function cbRenderItems() {
  const container = document.getElementById('cb-items-list');
  document.getElementById('cb-item-count').textContent = cbItems.length + ' item' + (cbItems.length !== 1 ? 's' : '');
  if (cbItems.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:18px;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:10px">No items yet</div>';
    return;
  }
  container.innerHTML = cbItems.map(item => {
    const assignedHTML = item.assignees.length > 0
      ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">${item.assignees.map(a => `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.2);color:var(--purple3)">${a}</span>`).join('')}</div>` : '';
    const shareAmt = item.assignees.length > 0 ? (item.price / item.assignees.length).toFixed(2) : null;
    return `
      <div style="background:var(--dark2);border:1px solid ${item.assignees.length > 0 ? 'rgba(168,85,247,0.3)' : 'var(--border)'};border-radius:10px;overflow:hidden;transition:border-color 0.15s">
        <div style="display:flex;align-items:center;gap:10px;padding:11px 14px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${item.name}</div>
            ${assignedHTML}
          </div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted2)">$${item.price.toFixed(2)}</div>
          ${cbPeople.length > 0 ? `<button onclick="cbOpenAssign(${item.id})" style="padding:4px 10px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:6px;color:var(--purple3);font-size:11px;font-weight:600;cursor:pointer;font-family:'Epilogue',sans-serif;white-space:nowrap">→ Assign</button>` : ''}
          <button onclick="cbRemoveItem(${item.id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:0.5;padding:0" onmouseover="this.style.color='var(--red)';this.style.opacity='1'" onmouseout="this.style.color='var(--muted)';this.style.opacity='0.5'">×</button>
        </div>
        ${item.assignees.length > 0 && shareAmt ? `<div style="padding:6px 14px;background:rgba(168,85,247,0.05);border-top:1px solid rgba(168,85,247,0.12);font-size:11px;color:var(--purple3)">$${shareAmt} each · ${item.assignees.join(', ')}</div>` : ''}
      </div>`;
  }).join('');
}

// ── ASSIGN MODAL ──
function cbOpenAssign(itemId) {
  cbAssignModalItemId = itemId;
  const item = cbItems.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('cb-assign-item-name').textContent = item.name + ' — $' + item.price.toFixed(2);
  cbRenderAssignModal(itemId);
  const modal = document.getElementById('cb-assign-modal');
  modal.style.display = 'flex';
  setTimeout(() => modal.style.opacity = '1', 10);
}

function cbRenderAssignModal(itemId) {
  const item = cbItems.find(i => i.id === itemId);
  const btns = document.getElementById('cb-assign-people-btns');
  btns.innerHTML = cbPeople.map(p => {
    const isAssigned = item.assignees.includes(p);
    return `<button onclick="cbToggleAssign(${itemId},'${p}')" style="padding:8px 16px;border-radius:8px;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;background:${isAssigned ? 'rgba(48,209,88,0.15)' : 'var(--dark3)'};border:1px solid ${isAssigned ? 'rgba(48,209,88,0.3)' : 'var(--border)'};color:${isAssigned ? 'var(--green)' : 'var(--muted2)'}">${isAssigned ? '✓ ' : ''}${p}</button>`;
  }).join('');

  const list = document.getElementById('cb-assign-list');
  if (item.assignees.length === 0) {
    list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">No one assigned yet — tap names above</div>';
  } else {
    const share = (item.price / item.assignees.length).toFixed(2);
    list.innerHTML = item.assignees.map(a => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--dark3);border-radius:8px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:500">${a}</span>
        <span style="font-size:13px;color:var(--green);font-weight:600">$${share}</span>
      </div>`).join('');
  }
}

function cbToggleAssign(itemId, personName) {
  const item = cbItems.find(i => i.id === itemId);
  if (!item) return;
  if (item.assignees.includes(personName)) {
    item.assignees = item.assignees.filter(a => a !== personName);
  } else {
    item.assignees.push(personName);
  }
  cbRenderAssignModal(itemId);
  cbRenderItems();
  cbUpdateSummary();
}

function cbCloseAssign() {
  document.getElementById('cb-assign-modal').style.display = 'none';
}

// ── SUMMARY ──
function cbUpdateSummary() {
  const subtotal = cbItems.reduce((s, i) => s + i.price, 0);
  const tax = parseFloat(document.getElementById('cb-tax')?.value) || 0;
  const tip = parseFloat(document.getElementById('cb-tip')?.value) || 0;
  const total = subtotal + tax + tip;
  if (document.getElementById('cb-subtotal')) document.getElementById('cb-subtotal').textContent = '$' + subtotal.toFixed(2);
  if (document.getElementById('cb-tax-display')) document.getElementById('cb-tax-display').textContent = '$' + tax.toFixed(2);
  if (document.getElementById('cb-tip-display')) document.getElementById('cb-tip-display').textContent = '$' + tip.toFixed(2);
  if (document.getElementById('cb-total-display')) document.getElementById('cb-total-display').textContent = '$' + total.toFixed(2);
}

function cbBuildStep3() {
  const name = document.getElementById('cb-name').value || 'Untitled Bill';
  const subtotal = cbItems.reduce((s, i) => s + i.price, 0);
  const tax = parseFloat(document.getElementById('cb-tax')?.value) || 0;
  const tip = parseFloat(document.getElementById('cb-tip')?.value) || 0;
  const total = subtotal + tax + tip;
  const sharedPer = cbPeople.length > 0 ? (tax + tip) / cbPeople.length : 0;

  document.getElementById('cb-final-name').textContent = name;
  document.getElementById('cb-final-meta').textContent = cbItems.length + ' items · $' + total.toFixed(2);
  document.getElementById('cb-final-total').textContent = '$' + total.toFixed(2);

  const list = document.getElementById('cb-per-person-list');
  if (cbPeople.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px">No people added — go back and add people</div>';
    return;
  }

  list.innerHTML = cbPeople.map(person => {
    let personTotal = sharedPer;
    cbItems.forEach(item => {
      if (item.assignees.includes(person)) {
        personTotal += item.price / item.assignees.length;
      } else if (item.assignees.length === 0) {
        personTotal += item.price / cbPeople.length;
      }
    });
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--dark2);border:1px solid var(--border);border-radius:10px">
        <div>
          <div style="font-weight:600;font-size:14px">@${person}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">items + shared charges</div>
        </div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;color:var(--green)">$${personTotal.toFixed(2)}</div>
      </div>`;
  }).join('');
}

// ── CREATE BILL ──
async function cbCreateFinalBill() {
  const name = document.getElementById('cb-name').value.trim();
  if (!name) return showToast('Enter a bill name', 'error');
  if (cbPeople.length === 0) return showToast('Add at least one person', 'error');

  const subtotal = cbItems.reduce((s, i) => s + i.price, 0);
  const tax = parseFloat(document.getElementById('cb-tax')?.value) || 0;
  const tip = parseFloat(document.getElementById('cb-tip')?.value) || 0;
  const total = subtotal + tax + tip;
  const sharedPer = (tax + tip) / cbPeople.length;

  const btn = document.getElementById('cb-final-btn');
  btn.textContent = 'Creating...'; btn.disabled = true;

  const billId = generateId();

  // Store receipt image as base64 in the bill record if available
  // Compress receipt for storage - resize to max 800px
  let receiptData = null;
  if (cbImageBase64) {
    try {
      const compressed = await cbResizeImage('data:image/jpeg;base64,' + cbImageBase64, 800);
      receiptData = compressed.split(',')[1];
    } catch(e) { receiptData = cbImageBase64; }
  }

  // Generate a secure share token
  const shareToken = Array.from({length:16}, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*62)]).join('');

  const { error } = await db.from('bills').insert({
    id: billId,
    creator_phone: currentUser.email,
    name,
    total,
    per_person: total / cbPeople.length,
    status: 'active',
    receipt_image: receiptData,
    share_token: shareToken
  });

  if (error) {
    // receipt_image column might not exist yet — try without it
    const { error: err2 } = await db.from('bills').insert({
      id: billId,
      creator_phone: currentUser.email,
      name,
      total,
      per_person: total / cbPeople.length,
      status: 'active',
      share_token: shareToken
    });
    if (err2) {
      btn.textContent = '🪶 Create Bill'; btn.disabled = false;
      return showToast('Error creating bill', 'error');
    }
  }

  // Build participants with accurate per-person amounts
  const rows = cbPeople.map(person => {
    let personTotal = sharedPer;
    cbItems.forEach(item => {
      if (item.assignees.includes(person)) personTotal += item.price / item.assignees.length;
      else if (item.assignees.length === 0) personTotal += item.price / cbPeople.length;
    });
    return {
      bill_id: billId,
      phone: `unknown_${person.toLowerCase().replace(/\s+/g,'_')}_${billId}`,
      name: person,
      amount: personTotal,
      paid: false
    };
  });

  await db.from('participants').insert(rows);

  // Save receipt items and assignments to Supabase so bill page can show them
  if (cbItems.length > 0) {
    // Insert receipt_items and get back their IDs
    const { data: savedItems } = await db.from('receipt_items').insert(
      cbItems.map(item => ({ bill_id: billId, name: item.name, price: item.price }))
    ).select();

    // Save item_selections (who ordered what)
    if (savedItems && savedItems.length > 0) {
      const selectionRows = [];
      savedItems.forEach((savedItem, idx) => {
        const originalItem = cbItems[idx];
        if (originalItem && originalItem.assignees.length > 0) {
          originalItem.assignees.forEach(person => {
            selectionRows.push({
              bill_id: billId,
              item_id: savedItem.id,
              participant_name: person.toLowerCase()
            });
          });
        }
      });
      if (selectionRows.length > 0) {
        await db.from('item_selections').insert(selectionRows);
      }
    }
  }

  btn.textContent = '🪶 Create Bill'; btn.disabled = false;
  showToast(`✅ "${name}" created! ID: ${billId}`, 'success');

  // Reset
  cbItems = []; cbPeople = []; cbImageBase64 = null;
  document.getElementById('cb-name').value = '';
  if (document.getElementById('cb-tax')) document.getElementById('cb-tax').value = '';
  if (document.getElementById('cb-tip')) document.getElementById('cb-tip').value = '';
  cbClearPhoto();
  cbRenderItems(); cbRenderPeople(); cbUpdateSummary();
  cbGoToStep(1);
  loadAllData();
  setTimeout(() => showPage('active-bills'), 1500);
}


</script>
</body>
</html>
