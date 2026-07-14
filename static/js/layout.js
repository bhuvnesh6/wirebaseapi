const ICONS = {
  grid: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  key: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  power: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
  menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

const NAV_ITEMS = [
  { href: '/', icon: 'grid', label: 'Instances', match: (p) => p === '/' || p.startsWith('/instance') },
  { href: '/subadmins.html', icon: 'users', label: 'Sub-admins', adminOnly: true, match: (p) => p.startsWith('/subadmins') },
  { href: '/api-keys.html', icon: 'key', label: 'API Keys', match: (p) => p.startsWith('/api-keys') },
  { href: '/developers.html', icon: 'code', label: 'Developers', match: (p) => p.startsWith('/developers') },
];

function navHtml(account) {
  const path = window.location.pathname;
  return NAV_ITEMS.filter((item) => !item.adminOnly || account.role === 'admin')
    .map(
      (item) => `
      <a href="${item.href}" class="nav-item ${item.match(path) ? 'active' : ''}">
        <span class="icon">${ICONS[item.icon]}</span>${item.label}
      </a>`
    )
    .join('');
}

function sidebarInnerHtml(account) {
  const initial = (account.name || (account.role === 'admin' ? 'A' : '?')).charAt(0).toUpperCase();
  const subLabel = account.role === 'admin' ? 'Admin account' : account.email;
  return `
    <div class="sidebar-brand">
      <div class="logo-box">W</div>
      <span>Wirebase</span>
    </div>
    <nav class="sidebar-nav">${navHtml(account)}</nav>
    <div class="sidebar-footer">
      <div class="account-row">
        <div class="avatar">${initial}</div>
        <div class="account-meta">
          <p>${account.name || 'Admin'}</p>
          <p class="sub">${subLabel}</p>
        </div>
        <button class="logout-btn" id="logout-btn" title="Log out">${ICONS.power}</button>
      </div>
    </div>`;
}

async function logout() {
  try {
    await api.post('/auth/logout');
  } catch (_) {
    /* ignore */
  }
  window.location.href = '/login.html';
}

async function initLayout() {
  let account;
  try {
    const data = await api.get('/auth/me');
    account = data.account;
  } catch (_) {
    window.location.href = '/login.html';
    return null;
  }

  const root = document.getElementById('app-shell');
  if (!root) return account;

  root.insertAdjacentHTML(
    'afterbegin',
    `
    <aside class="sidebar" id="desktop-sidebar">${sidebarInnerHtml(account)}</aside>
    <div class="mobile-topbar">
      <div class="brand"><div class="logo-box">W</div><span style="font-weight:600">Wirebase</span></div>
      <button id="mobile-menu-btn">${ICONS.menu}</button>
    </div>
    <div class="mobile-drawer-backdrop" id="mobile-drawer-backdrop">
      <aside class="mobile-drawer">
        <button class="close-btn" id="mobile-close-btn">${ICONS.x}</button>
        ${sidebarInnerHtml(account)}
      </aside>
    </div>`
  );

  document.querySelectorAll('#logout-btn').forEach((btn) => btn.addEventListener('click', logout));

  const backdrop = document.getElementById('mobile-drawer-backdrop');
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => (backdrop.style.display = 'block'));
  document.getElementById('mobile-close-btn')?.addEventListener('click', () => (backdrop.style.display = 'none'));
  backdrop?.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.style.display = 'none';
  });

  return account;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text);
  if (btn) {
    const original = btn.innerHTML;
    btn.innerHTML = '✓';
    setTimeout(() => (btn.innerHTML = original), 1200);
  }
}
