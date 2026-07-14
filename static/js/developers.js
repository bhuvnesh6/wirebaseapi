const LANGS = [
  { id: 'curl', label: 'cURL' },
  { id: 'js', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'n8n', label: 'n8n' },
  { id: 'php', label: 'PHP' },
];
const MSG_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'document', label: 'Document / file' },
];
const FIELDS = [
  ['instanceName', 'The instance to send from, by name — must be Connected. (instanceId also accepted.)'],
  ['to', 'Recipient number, digits only with country code (no +).'],
  ['type', '"text" | "image" | "video" | "audio" | "document" (default: text)'],
  ['message', 'Text body — required when type is text.'],
  ['url', 'Public URL of the media file — required for media types.'],
  ['caption', 'Optional caption for image/video/document.'],
  ['filename', 'Optional file name shown to the recipient (document only).'],
];

let instances = [];
let instanceName = 'YOUR_INSTANCE_NAME';
let lang = 'curl';
let msgType = 'text';

function buildBody() {
  const base = { instanceName, to: '919876543210' };
  if (msgType === 'text') return { ...base, type: 'text', message: 'Hello from Wirebase!' };
  if (msgType === 'image') return { ...base, type: 'image', url: 'https://example.com/photo.jpg', caption: 'Check this out' };
  if (msgType === 'video') return { ...base, type: 'video', url: 'https://example.com/clip.mp4', caption: 'Quick demo' };
  return { ...base, type: 'document', url: 'https://example.com/invoice.pdf', filename: 'invoice.pdf', caption: 'Your invoice is attached' };
}

function pyDict(obj) {
  return `{\n${Object.entries(obj).map(([k, v]) => `    "${k}": ${JSON.stringify(v)}`).join(',\n')},\n}`;
}
function phpArray(obj) {
  return `[\n${Object.entries(obj).map(([k, v]) => `    "${k}" => ${JSON.stringify(v)}`).join(',\n')},\n]`;
}

function buildCode(endpoint, body) {
  const json = JSON.stringify(body, null, 2);
  if (lang === 'curl') {
    return `curl -X POST "${endpoint}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-API-Key: YOUR_API_KEY" \\\n  -d '${JSON.stringify(body)}'`;
  }
  if (lang === 'js') {
    return `const response = await fetch("${endpoint}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "X-API-Key": "YOUR_API_KEY",\n  },\n  body: JSON.stringify(${json}),\n});\n\nconst data = await response.json();\nconsole.log(data);`;
  }
  if (lang === 'python') {
    return `import requests\n\nresponse = requests.post(\n    "${endpoint}",\n    headers={"X-API-Key": "YOUR_API_KEY"},\n    json=${pyDict(body)},\n)\n\nprint(response.json())`;
  }
  if (lang === 'php') {
    return `<?php\n$ch = curl_init("${endpoint}");\ncurl_setopt($ch, CURLOPT_POST, true);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n    "Content-Type: application/json",\n    "X-API-Key: YOUR_API_KEY",\n]);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(${phpArray(body)}));\n\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`;
  }
  return '';
}

function codeBlockHtml(code, language) {
  const escaped = escapeHtml(code);
  return `
    <div class="code-block">
      <div class="code-block-header">
        <span>${language}</span>
        <button data-copy-code="1">⧉ Copy</button>
      </div>
      <pre>${escaped}</pre>
    </div>`;
}

function n8nGuideHtml(endpoint, body) {
  return `
    <div class="card card-pad">
      <h3 style="font-size:16px;">Using the HTTP Request node in n8n</h3>
      <ol style="margin-top:12px;font-size:14px;color:var(--ink-soft);padding-left:20px;line-height:1.8;">
        <li><strong>1. Add an HTTP Request node</strong> and set Method to <code class="mono">POST</code>.</li>
        <li><strong>2. Set the URL</strong> to: <code class="mono" style="display:block;margin-top:4px;background:var(--canvas-panel);border-radius:8px;padding:8px 12px;font-size:12px;word-break:break-all;">${endpoint}</code></li>
        <li><strong>3. Under Headers</strong>, add <code class="mono">Content-Type: application/json</code> and <code class="mono">X-API-Key: your API key</code>.</li>
        <li><strong>4. Set Body</strong> to JSON and paste:${codeBlockHtml(JSON.stringify(body, null, 2), 'json')}</li>
        <li><strong>5. Map fields dynamically</strong> from earlier nodes, e.g. <code class="mono">{{$json.phone}}</code> for <code class="mono">to</code>.</li>
      </ol>
    </div>`;
}

function render() {
  const endpoint = `${window.location.origin}/api/public/send`;
  document.getElementById('endpoint-display').textContent = `POST ${endpoint}`;

  document.getElementById('type-chips').innerHTML = MSG_TYPES.map(
    (t) => `<button class="chip-btn ${msgType === t.id ? 'active' : ''}" data-type="${t.id}">${t.label}</button>`
  ).join('');
  document.getElementById('lang-chips').innerHTML = LANGS.map(
    (l) => `<button class="chip-btn ${lang === l.id ? 'active' : ''}" data-lang="${l.id}">${l.label}</button>`
  ).join('');

  document.getElementById('field-reference').innerHTML = FIELDS.map(
    ([name, desc]) => `<div style="display:flex;gap:8px;margin-bottom:8px;"><code class="mono" style="flex-shrink:0;background:var(--canvas-panel);padding:2px 6px;border-radius:4px;">${name}</code><span class="hint-text">${desc}</span></div>`
  ).join('');

  const body = buildBody();
  const codeArea = document.getElementById('code-area');
  codeArea.innerHTML = lang === 'n8n' ? n8nGuideHtml(endpoint, body) : codeBlockHtml(buildCode(endpoint, body), lang);

  document.querySelectorAll('[data-type]').forEach((btn) => btn.addEventListener('click', () => { msgType = btn.dataset.type; render(); }));
  document.querySelectorAll('[data-lang]').forEach((btn) => btn.addEventListener('click', () => { lang = btn.dataset.lang; render(); }));
  codeArea.querySelectorAll('[data-copy-code]').forEach((btn) =>
    btn.addEventListener('click', () => copyToClipboard(lang === 'n8n' ? JSON.stringify(body, null, 2) : buildCode(endpoint, body), btn))
  );
}

async function loadInstances() {
  const data = await api.get('/instances');
  instances = data.instances;
  const select = document.getElementById('instance-select');
  if (instances.length === 0) {
    select.innerHTML = `<option value="YOUR_INSTANCE_NAME">YOUR_INSTANCE_NAME</option>`;
  } else {
    select.innerHTML = instances.map((i) => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.name)}</option>`).join('');
    instanceName = instances[0].name;
  }
  select.addEventListener('change', (e) => {
    instanceName = e.target.value;
    render();
  });
}

(async function init() {
  const account = await initLayout();
  if (!account) return;
  await loadInstances();
  render();
})();
