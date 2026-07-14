let keys = [];

function keysTableHtml() {
  if (keys.length === 0) {
    return `
      <div class="card empty-state">
        <div class="empty-icon-circle" style="background:var(--signal-50);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#189a54" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        </div>
        <h3 style="font-size:18px;">No API keys yet</h3>
        <p class="hint-text" style="max-width:360px;">Create a key to send messages programmatically from n8n, a script, or any HTTP client.</p>
        <button class="btn btn-accent" id="empty-create-btn">Create your first key</button>
      </div>`;
  }

  return `
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Label</th><th>Key</th><th>Last used</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${keys
            .map(
              (k) => `
            <tr>
              <td style="font-weight:500;">${escapeHtml(k.label)}</td>
              <td class="mono hint-text">${escapeHtml(k.prefix)}</td>
              <td class="hint-text" style="font-size:12px;">${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</td>
              <td><span class="badge ${k.revoked ? 'badge-danger' : 'badge-signal'}">${k.revoked ? 'Revoked' : 'Active'}</span></td>
              <td style="text-align:right;">
                ${!k.revoked ? `<button class="btn btn-ghost btn-sm" data-revoke="${k.id}" title="Revoke">Revoke</button>` : ''}
                <button class="btn btn-ghost btn-sm danger" data-delete="${k.id}" title="Delete">Delete</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function render() {
  document.getElementById('keys-area').innerHTML = keysTableHtml();
  document.getElementById('empty-create-btn')?.addEventListener('click', openCreateModal);
  document.querySelectorAll('[data-revoke]').forEach((btn) => btn.addEventListener('click', () => revoke(btn.dataset.revoke)));
  document.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', () => remove(btn.dataset.delete)));
}

async function load() {
  const data = await api.get('/api-keys');
  keys = data.apiKeys;
  render();
}

async function revoke(id) {
  if (!confirm('Revoke this key? Any integration using it will stop working immediately.')) return;
  await api.post(`/api-keys/${id}/revoke`);
  await load();
}

async function remove(id) {
  if (!confirm('Delete this key permanently?')) return;
  await api.delete(`/api-keys/${id}`);
  keys = keys.filter((k) => k.id !== id);
  render();
}

function openCreateModal() {
  document.getElementById('create-form').style.display = 'block';
  document.getElementById('created-key-view').style.display = 'none';
  document.getElementById('modal-title').textContent = 'New API key';
  document.getElementById('create-modal').style.display = 'flex';
}
function closeCreateModal() {
  document.getElementById('create-modal').style.display = 'none';
  document.getElementById('create-form').reset();
  document.getElementById('create-error').style.display = 'none';
}

document.getElementById('new-key-btn').addEventListener('click', openCreateModal);
document.getElementById('close-create-modal').addEventListener('click', closeCreateModal);
document.getElementById('cancel-create').addEventListener('click', closeCreateModal);
document.getElementById('done-btn').addEventListener('click', () => {
  closeCreateModal();
  load();
});

document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-create');
  const errorEl = document.getElementById('create-error');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const data = await api.post('/api-keys', { label: document.getElementById('key-label').value });
    document.getElementById('create-form').style.display = 'none';
    document.getElementById('created-key-view').style.display = 'block';
    document.getElementById('created-key-text').textContent = data.key;
    document.getElementById('modal-title').textContent = 'Key created';
    document.getElementById('copy-created-key').onclick = (ev) => copyToClipboard(data.key, ev.currentTarget);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create key';
  }
});

(async function init() {
  const account = await initLayout();
  if (!account) return;
  await load();
})();
