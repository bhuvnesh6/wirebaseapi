const STATUS_META = {
  connected: { label: 'Connected', dot: '#189a54', text: '#189a54', pulse: true },
  qr_pending: { label: 'Awaiting scan', dot: '#d97706', text: '#d97706', pulse: true },
  connecting: { label: 'Connecting', dot: '#d97706', text: '#d97706', pulse: true },
  disconnected: { label: 'Disconnected', dot: '#6b7280', text: '#6b7280', pulse: false },
  logged_out: { label: 'Logged out', dot: '#dc2626', text: '#dc2626', pulse: false },
  created: { label: 'Not started', dot: '#6b7280', text: '#6b7280', pulse: false },
};

let instancesCache = [];

function renderStatCards(instances) {
  const connected = instances.filter((i) => i.status === 'connected').length;
  const webhooks = instances.filter((i) => i.webhookUrl).length;

  document.getElementById('stat-cards').innerHTML = `
    ${statCard('Total instances', instances.length, '#f7f8fa', '#3a3f47', gridIcon())}
    ${statCard('Connected now', connected, '#effbf3', '#189a54', wifiIcon())}
    ${statCard('Webhooks configured', webhooks, '#eef0fe', '#4f46e5', webhookIcon())}
  `;
}

function statCard(label, value, bg, color, icon) {
  return `
    <div class="card stat-card">
      <div class="stat-icon" style="background:${bg};color:${color};">${icon}</div>
      <div><p class="stat-value">${value}</p><p class="stat-label">${label}</p></div>
    </div>`;
}

function gridIcon() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
}
function wifiIcon() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
}
function webhookIcon() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 1 1 2 17.13"/><path d="M15 6.35a4 4 0 1 1 3.83 5.6"/><path d="m6.06 12.94 4.5-8.9"/></svg>';
}

function renderInstances(instances, isAdmin) {
  const area = document.getElementById('instances-area');
  if (instances.length === 0) {
    area.innerHTML = `
      <div class="card empty-state">
        <div class="empty-icon-circle" style="background:var(--signal-50);">${wifiIcon().replace('currentColor', 'var(--signal-500)')}</div>
        <h3 style="font-size:18px;">No instances yet</h3>
        <p class="hint-text" style="max-width:360px;">Create your first instance, scan the QR code with WhatsApp, and start routing messages to your webhook.</p>
        <button class="btn btn-accent" id="empty-create-btn">Create your first instance</button>
      </div>`;
    document.getElementById('empty-create-btn').addEventListener('click', openCreateModal);
    return;
  }

  area.innerHTML = `<div class="grid grid-3">${instances.map(instanceCardHtml).join('')}</div>`;
  area.querySelectorAll('[data-instance-id]').forEach((card) => {
    card.addEventListener('click', () => {
      window.location.href = `/instance.html?id=${card.dataset.instanceId}`;
    });
  });
}

function instanceCardHtml(inst) {
  const meta = STATUS_META[inst.status] || STATUS_META.created;
  return `
    <div class="card instance-card" data-instance-id="${inst._id}">
      <div class="instance-title-row">
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <h3 style="font-size:16px;">${escapeHtml(inst.name)}</h3>
            ${inst.ownerLabel ? `<span class="owner-badge">${escapeHtml(inst.ownerLabel)}</span>` : ''}
          </div>
          <p class="mono hint-text" style="margin-top:4px;">${inst.phoneNumber ? '+' + inst.phoneNumber : 'No number linked yet'}</p>
        </div>
      </div>
      <div class="status-row">
        <span class="status-dot ${meta.pulse ? 'pulse' : ''}" style="background:${meta.dot};"></span>
        <span style="font-size:14px;font-weight:500;color:${meta.text};">${meta.label}</span>
      </div>
      <div class="instance-footer">
        <span>${webhookIcon()} ${inst.webhookUrl ? 'Webhook set' : 'No webhook'}</span>
        <span>${inst.useProxy ? 'Proxy on' : 'Direct'}</span>
      </div>
    </div>`;
}

async function loadInstances() {
  const { instances } = await api.get('/instances');
  instancesCache = instances;
  renderStatCards(instances);
  renderInstances(instances);
}

function openCreateModal() {
  document.getElementById('create-modal').style.display = 'flex';
}
function closeCreateModal() {
  document.getElementById('create-modal').style.display = 'none';
  document.getElementById('create-form').reset();
  document.getElementById('create-error').style.display = 'none';
}

document.getElementById('new-instance-btn').addEventListener('click', openCreateModal);
document.getElementById('close-create-modal').addEventListener('click', closeCreateModal);
document.getElementById('cancel-create').addEventListener('click', closeCreateModal);

document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-create');
  const errorEl = document.getElementById('create-error');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    await api.post('/instances', {
      name: document.getElementById('instance-name').value,
      useProxy: document.getElementById('instance-proxy').checked,
    });
    closeCreateModal();
    await loadInstances();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create instance';
  }
});

(async function init() {
  const account = await initLayout();
  if (!account) return;
  await loadInstances();
})();
