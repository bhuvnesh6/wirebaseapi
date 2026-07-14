let subadmins = [];
const credentialsById = {}; // { [id]: { email, password } } - shown once per page session

function credentialsCardHtml(id, email, password) {
  return `
    <div class="credentials-card" data-cred-for="${id}">
      <button class="dismiss" data-dismiss-cred="${id}">✕</button>
      <div style="display:flex;gap:10px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div style="flex:1;">
          <h4 style="font-size:13px;">Save these credentials now</h4>
          <p class="hint-text" style="margin-top:4px;">This password is shown once and can't be retrieved again.</p>
          <div class="grid grid-2" style="margin-top:10px;gap:8px;">
            <div>
              <p class="label" style="margin-bottom:4px;">Email</p>
              <div class="cred-field"><code>${escapeHtml(email)}</code><button data-copy="${escapeHtml(email)}">⧉</button></div>
            </div>
            <div>
              <p class="label" style="margin-bottom:4px;">Password</p>
              <div class="cred-field"><code>${escapeHtml(password)}</code><button data-copy="${escapeHtml(password)}">⧉</button></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function subadminCardHtml(s) {
  const cred = credentialsById[s.id];
  return `
    <div class="card card-pad" style="display:flex;flex-direction:column;gap:12px;" data-subadmin-id="${s.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h3 style="font-size:16px;">${escapeHtml(s.name)}</h3>
          <p class="hint-text" style="margin-top:2px;">${escapeHtml(s.email)}</p>
        </div>
        <span class="badge ${s.active ? 'badge-signal' : 'badge-danger'}">${s.active ? 'Active' : 'Disabled'}</span>
      </div>
      ${cred ? credentialsCardHtml(s.id, cred.email, cred.password) : ''}
      <div style="display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid var(--canvas-border);padding-top:12px;">
        <button class="btn btn-ghost btn-sm" data-toggle="${s.id}" data-active="${s.active}">${s.active ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-ghost btn-sm" data-reset="${s.id}">Reset password</button>
        <button class="btn btn-ghost btn-sm danger" data-delete="${s.id}">Delete</button>
      </div>
    </div>`;
}

function render() {
  const area = document.getElementById('subadmins-area');
  if (subadmins.length === 0) {
    area.innerHTML = `
      <div class="card empty-state">
        <div class="empty-icon-circle" style="background:var(--wire-50);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <h3 style="font-size:18px;">No sub-admins yet</h3>
        <p class="hint-text" style="max-width:360px;">Create a sub-admin account and share their login with your team.</p>
        <button class="btn btn-accent" id="empty-create-btn">Create sub-admin</button>
      </div>`;
    document.getElementById('empty-create-btn').addEventListener('click', openCreateModal);
    return;
  }

  area.innerHTML = `<div class="grid grid-3">${subadmins.map(subadminCardHtml).join('')}</div>`;
  attachRowHandlers();
}

function attachRowHandlers() {
  document.querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => toggleActive(btn.dataset.toggle, btn.dataset.active === 'true'))
  );
  document.querySelectorAll('[data-reset]').forEach((btn) => btn.addEventListener('click', () => resetPassword(btn.dataset.reset)));
  document.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', () => removeSubAdmin(btn.dataset.delete)));
  document.querySelectorAll('[data-dismiss-cred]').forEach((btn) =>
    btn.addEventListener('click', () => {
      delete credentialsById[btn.dataset.dismissCred];
      render();
    })
  );
  document.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy, btn)));
}

async function load() {
  const data = await api.get('/subadmins');
  subadmins = data.subadmins;
  render();
}

async function toggleActive(id, currentActive) {
  const data = await api.patch(`/subadmins/${id}/toggle`, { active: !currentActive });
  subadmins = subadmins.map((s) => (s.id === data.subadmin.id ? data.subadmin : s));
  render();
}

async function resetPassword(id) {
  if (!confirm('This invalidates the current password. Continue?')) return;
  const data = await api.post(`/subadmins/${id}/reset-password`);
  credentialsById[id] = data.credentials;
  render();
}

async function removeSubAdmin(id) {
  if (!confirm('This permanently deletes the sub-admin, their instances, and their API keys. Continue?')) return;
  await api.delete(`/subadmins/${id}`);
  subadmins = subadmins.filter((s) => s.id !== id);
  render();
}

function openCreateModal() {
  document.getElementById('create-modal').style.display = 'flex';
}
function closeCreateModal() {
  document.getElementById('create-modal').style.display = 'none';
  document.getElementById('create-form').reset();
  document.getElementById('create-error').style.display = 'none';
}

document.getElementById('new-subadmin-btn').addEventListener('click', openCreateModal);
document.getElementById('close-create-modal').addEventListener('click', closeCreateModal);
document.getElementById('cancel-create').addEventListener('click', closeCreateModal);

document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-create');
  const errorEl = document.getElementById('create-error');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const data = await api.post('/subadmins', {
      name: document.getElementById('sub-name').value,
      email: document.getElementById('sub-email').value,
    });
    subadmins = [data.subadmin, ...subadmins];
    credentialsById[data.subadmin.id] = data.credentials;
    closeCreateModal();
    render();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create sub-admin';
  }
});

(async function init() {
  const account = await initLayout();
  if (!account) return;
  if (account.role !== 'admin') {
    window.location.href = '/';
    return;
  }
  await load();
})();
