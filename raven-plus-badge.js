/* RAVEN Plus Wingcheck — display only. NEVER use this roster for entitlements,
 * authorization, billing, upload limits, or payment status.
 * Account IDs were resolved from the owner's explicitly selected RAVEN IDs.
 * No display-name/handle fallback: renamed, deleted, or recreated accounts cannot
 * accidentally transfer this badge to another person.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RavenPlusBadge = api; api.install(); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const members = new Set([
    'dd58ecef-0b94-4c53-ac39-ddf573ad1efb', // @melad
    '0bba9a50-82f8-4a15-bc41-91654eef06f2', // @t
    'b72054bd-964c-483f-8f89-876fd0581f80', // @arsalan
    '739d2182-437d-488a-99b8-1acb004b3163', // @will
    '2b98cc1d-257b-4254-b589-98319cce1cb4'  // @nicholas110
  ]);
  const label = 'RAVEN Plus Member';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="wing" x1="5" y1="9" x2="22" y2="28" gradientUnits="userSpaceOnUse"><stop stop-color="#E2C5FF"/><stop offset=".5" stop-color="#C084FC"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs><path d="M2 15.5 7.1 16.6 12 21.5 28 3.5 24.2 14.6 21.3 13.7 20.5 18.2 17.7 17.3 16.7 22.4 12.1 27.7Z" fill="url(#wing)"/><path d="m12 21.5 16-18-10.3 13.8-1 5.1-4.6 5.3Z" fill="#7C3AED" opacity=".22"/><path d="M25.5 21v8M21.5 25h8" stroke="#30D158" stroke-width="2.6" stroke-linecap="round"/></svg>';
  // Inline, cache-independent artwork: no image fetch or duplicate SVG IDs.
  const image = '<img alt="" aria-hidden="true" width="22" height="22" src="data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27') + '">';
  function isMember(profile) {
    return !!profile && typeof profile.id === 'string' && members.has(profile.id.toLowerCase());
  }
  function html(profile, size) {
    if (!isMember(profile)) return '';
    return '<button type="button" class="raven-plus-badge' + (size === 'profile' ? ' raven-plus-badge-profile' : '') + '" data-raven-plus-badge="' + profile.id.toLowerCase() + '" aria-label="' + label + '" aria-haspopup="dialog" aria-expanded="false" title="' + label + '">' + image + '</button>';
  }
  function mount(element, profile, size) {
    if (!element) return;
    element.querySelectorAll('[data-raven-plus-badge]').forEach(node => node.remove());
    // Callers supply a name container, never a parent button or link.
    if (isMember(profile) && !element.closest('button,a')) element.insertAdjacentHTML('beforeend', html(profile, size));
  }
  function isCreator(profile) {
    return !!profile && profile.id === 'dd58ecef-0b94-4c53-ac39-ddf573ad1efb';
  }
  function mountProfile(element, profile) {
    if (!element) return;
    mount(element, profile, 'profile');
    element.querySelectorAll('[data-raven-creator]').forEach(node => node.remove());
    if (isCreator(profile)) element.insertAdjacentHTML('beforeend', '<span class="raven-creator-badge" data-raven-creator="1" aria-label="RAVEN Creator">CREATOR</span>');
  }
  const css = `
.raven-plus-badge.raven-plus-badge{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;flex:0 0 24px;width:24px;min-width:24px;height:24px;min-height:24px;padding:3px;margin:0 0 0 1px;border:0;border-radius:6px;background:transparent;color:#C084FC;box-shadow:none;cursor:pointer;line-height:1;touch-action:manipulation;box-sizing:border-box}
.raven-plus-badge.raven-plus-badge img{display:block;width:18px;height:18px;max-width:none;object-fit:contain;pointer-events:none}
.raven-plus-badge.raven-plus-badge-profile{width:28px;height:28px;flex-basis:28px}
.raven-plus-badge.raven-plus-badge-profile img{width:20px;height:20px}
.raven-plus-badge.raven-plus-badge:hover{background:rgba(192,132,252,.1)}
.raven-plus-badge.raven-plus-badge:focus-visible{outline:2px solid #C084FC;outline-offset:2px}
.raven-plus-identity{display:inline-flex;align-items:center;min-width:0;max-width:100%;gap:2px}
.raven-creator-badge{display:inline-flex;align-items:center;vertical-align:middle;margin-left:6px;padding:4px 8px;border:1px solid #ffd56899;border-radius:99px;background:linear-gradient(135deg,#fff3b0,#d89a18);color:#3b2400;font:800 10px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.1em;box-shadow:0 0 12px #f5b92c25;text-shadow:none;white-space:nowrap}
#raven-plus-info{position:fixed;inset:auto;margin:0;padding:10px 12px;box-sizing:border-box;max-width:calc(100vw - 16px);border:1px solid #6d4988;border-radius:14px;background:#15101e;color:#f0eef8;box-shadow:0 8px 28px #0006;z-index:2147483647;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:normal;text-transform:none}
#raven-plus-info[hidden]{display:none}
#raven-plus-info .raven-plus-info-inner{display:flex;align-items:center;gap:8px}
#raven-plus-info img{display:block;width:26px;height:26px}
#raven-plus-info button{flex:0 0 32px;width:32px;min-height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:#ddd0ea;font:22px/1 sans-serif;cursor:pointer}
#raven-plus-info button:focus-visible{outline:2px solid #C084FC}
`;
  let installed = false, popup = null, active = null;
  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    function close(restoreFocus) {
      if (!popup || popup.hidden) return;
      if (typeof popup.hidePopover === 'function') { try { popup.hidePopover(); } catch (_) {} }
      popup.hidden = true;
      if (active) {
        active.setAttribute('aria-expanded', 'false');
        if (restoreFocus && active.isConnected) active.focus({ preventScroll: true });
      }
      active = null;
    }
    function position() {
      if (!active || !popup || popup.hidden) return;
      if (!active.isConnected) { close(false); return; }
      const rect = active.getBoundingClientRect();
      const width = popup.offsetWidth, height = popup.offsetHeight;
      const viewport = window.visualViewport;
      const left = viewport ? viewport.offsetLeft : 0, top = viewport ? viewport.offsetTop : 0;
      const vw = viewport ? viewport.width : window.innerWidth, vh = viewport ? viewport.height : window.innerHeight;
      popup.style.left = Math.max(left + 8, Math.min(rect.left + rect.width / 2 - width / 2, left + vw - width - 8)) + 'px';
      const below = rect.bottom + 8;
      popup.style.top = Math.max(top + 8, Math.min(below + height <= top + vh - 8 ? below : rect.top - height - 8, top + vh - height - 8)) + 'px';
    }
    document.addEventListener('click', function (event) {
      const target = event.target instanceof Element ? event.target : null;
      const badge = target && target.closest('[data-raven-plus-badge]');
      if (badge) {
        event.preventDefault();
        event.stopImmediatePropagation(); // Never open a receipt/profile or trigger payment actions.
        if (active === badge) { close(true); return; }
        close(false);
        if (!popup) {
          popup = document.createElement('div');
          popup.id = 'raven-plus-info';
          popup.setAttribute('role', 'dialog');
          popup.setAttribute('aria-label', label);
          popup.setAttribute('popover', 'manual');
          popup.hidden = true;
          popup.innerHTML = '<div class="raven-plus-info-inner">' + image + '<span>' + label + '</span><button type="button" aria-label="Close membership information">×</button></div>';
          document.body.appendChild(popup);
        }
        active = badge;
        active.setAttribute('aria-expanded', 'true');
        active.setAttribute('aria-controls', popup.id);
        popup.hidden = false;
        if (typeof popup.showPopover === 'function') { try { popup.showPopover(); } catch (_) {} }
        position();
        popup.querySelector('button').focus({ preventScroll: true });
      } else if (popup && target && popup.contains(target)) {
        event.stopPropagation();
        if (target.closest('button')) close(true);
      } else close(false);
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && active) {
        event.preventDefault(); event.stopImmediatePropagation(); close(true);
      }
    }, true);
    document.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', position);
      window.visualViewport.addEventListener('scroll', position);
    }
  }
  return { isMember, isCreator, html, mount, mountProfile, install };
});
