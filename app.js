/* ==========================================================================
   VistaERP2 API Helper — engine
   Renders UI from api-config.json and drives all API calls.
   ========================================================================== */
'use strict';

const State = {
  config: null,
  baseUrl: '',
  session: '',
  lang: 'th',
  cc: '',
  appId: 'vistaerp2.020201.web',   // _aa — global app identifier for REST (v2) calls
  resources: { tables: [], processes: [], reports: [] },
  current: null,      // active endpoint
  method: 'GET',      // chosen HTTP method (overrides endpoint default)
  showCurl: false,    // show the curl command in the request preview
  fieldEls: {},       // key -> input element for the active endpoint
};

const HTTP_METHODS = ['GET', 'POST', 'PUT'];

/* ---------- tiny DOM helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return n;
};

/* ---------- bootstrap ---------- */
async function boot() {
  const res = await fetch('api-config.json');
  State.config = await res.json();

  // Derive base URL: strip the /help marker off the current location.
  const marker = State.config.meta.helpMarker || '/help';
  const href = window.location.href;
  const idx = href.indexOf(marker);
  State.baseUrl = idx > -1 ? href.substring(0, idx) : window.location.origin;

  document.title = State.config.meta.title;
  $('#brandTitle').textContent = State.config.meta.title;
  $('#brandSub').textContent = State.config.meta.subtitle;
  $('#copyright').textContent = '© ' + State.config.meta.copyright;

  const baseInput = $('#baseUrl');
  baseInput.value = State.baseUrl;
  baseInput.addEventListener('input', e => { State.baseUrl = e.target.value.trim(); refreshUrlPreview(); });

  const aaInput = $('#appId');
  if (aaInput) {
    aaInput.value = State.appId;
    aaInput.addEventListener('input', e => { State.appId = e.target.value.trim(); refreshUrlPreview(); });
  }
  const lgInput = $('#lang');
  if (lgInput) {
    lgInput.value = State.lang;
    lgInput.addEventListener('change', e => { State.lang = e.target.value; refreshUrlPreview(); });
  }

  buildNav();
  // open first endpoint
  const first = State.config.groups[0].endpoints[0];
  selectEndpoint(State.config.groups[0].id, first.id);
}

/* ---------- navigation ---------- */
function buildNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  for (const g of State.config.groups) {
    nav.append(el('div', { class: 'nav-group-label' }, g.label));
    for (const ep of g.endpoints) {
      nav.append(el('div', {
        class: 'nav-item', 'data-gid': g.id, 'data-eid': ep.id,
        onclick: () => selectEndpoint(g.id, ep.id),
      }, el('span', { class: 'dot' }), ep.label));
    }
  }
}

function selectEndpoint(gid, eid) {
  const group = State.config.groups.find(g => g.id === gid);
  const ep = group.endpoints.find(e => e.id === eid);
  State.current = ep;
  State.fieldEls = {};
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.gid === gid && n.dataset.eid === eid));
  renderEndpoint(group, ep);
}

/* ---------- endpoint rendering ---------- */
function renderEndpoint(group, ep) {
  const content = $('#content');
  content.innerHTML = '';
  State.method = ep.method;   // reset override to the endpoint default

  const head = el('div', { class: 'card-head' },
    el('div', { class: 'crumb' }, group.label + ' / ' + ep.id),
    el('h2', {}, el('span', { class: 'method-pill method-' + ep.method }, ep.method), ep.label),
    ep.description ? el('p', {}, ep.description) : null,
  );

  const grid = el('div', { class: 'form-grid' });
  for (const f of ep.fields) grid.append(renderField(f));

  const body = el('div', { class: 'card-body' }, grid);

  // primary action
  const runLabel = ep.flow === 'filters' ? 'Load parameters'
    : ep.flow === 'record' ? 'Load record' : 'Send request';

  // HTTP method override (GET / POST / PUT)
  const methodSel = el('select', { class: 'method-select',
    title: 'HTTP method', onchange: e => { State.method = e.target.value; refreshUrlPreview(); } });
  for (const m of HTTP_METHODS)
    methodSel.append(el('option', { value: m, selected: m === ep.method ? '' : null }, m));

  const actions = el('div', { class: 'actions' },
    el('div', { class: 'form-field' }, el('label', {}, 'method'), methodSel),
    el('button', { class: 'btn btn-primary', onclick: () => runEndpoint(ep) }, runLabel));
  body.append(actions);

  // URL preview
  body.append(el('div', { class: 'url-preview', id: 'urlPreview' }));

  // result container
  body.append(el('div', { class: 'result', id: 'result' }));

  content.append(el('div', { class: 'card' }, head, body));
  refreshUrlPreview();
}

function renderField(f) {
  const wrap = el('div', { class: 'form-field' });
  const label = el('label', {}, f.label, f.required ? el('span', { class: 'req' }, '*') : null);
  wrap.append(label);

  let input;
  const onChange = () => refreshUrlPreview();

  switch (f.type) {
    case 'select': {
      input = el('select', { onchange: onChange });
      for (const o of f.options) {
        const opt = typeof o === 'object' ? o : { value: o, label: o };
        input.append(el('option', { value: opt.value, selected: opt.value === f.default ? '' : null }, opt.label));
      }
      break;
    }
    case 'resource': {
      input = el('select', { class: 'resource-select', 'data-resource': f.resource, onchange: onChange });
      fillResourceSelect(input, f.resource);
      break;
    }
    case 'textarea': {
      input = el('textarea', { rows: f.rows || 6, oninput: onChange }, f.default || '');
      break;
    }
    case 'json': {
      input = el('textarea', { class: 'json-field', rows: f.rows || 5, spellcheck: 'false', oninput: onChange }, f.default || '{}');
      break;
    }
    case 'session': {
      input = el('input', { type: 'text', readonly: '', class: 'readonly', placeholder: '(login first)', style: 'width:220px' });
      input.value = State.session;
      break;
    }
    case 'password':
      input = el('input', { type: 'password', oninput: onChange, style: widthStyle(f) });
      if (f.default) input.value = f.default;
      break;
    default: // text, raw, raw-field, raw-value
      input = el('input', { type: 'text', placeholder: f.placeholder || '', oninput: onChange, style: widthStyle(f) });
      if (f.default != null) input.value = f.default;
  }
  if (f.bind && State[f.bind] != null && !input.value) input.value = State[f.bind];

  State.fieldEls[f.key] = input;
  wrap.append(input);
  return wrap;
}

const widthStyle = f => f.width ? `width:${f.width}px` : 'width:150px';

function fillResourceSelect(sel, resourceName) {
  const list = State.resources[resourceName] || [];
  sel.innerHTML = '';
  sel.append(el('option', { value: '' }, list.length ? '— select —' : '(login to load)'));
  for (const name of list) sel.append(el('option', { value: name }, name));
}

/* ---------- URL / params assembly ---------- */
function fieldValue(key) {
  const inp = State.fieldEls[key];
  return inp ? inp.value : '';
}

function assemble(ep) {
  const method = State.method || ep.method;   // chosen HTTP method
  const inBody = method !== 'GET';            // GET → query string, POST/PUT → body
  // path with {placeholders} + {path} inline segments
  let path = ep.path;
  const query = [];   // [name, value] pairs for query string / display
  const body = {};    // for POST / PUT

  for (const f of ep.fields) {
    const val = fieldValue(f.key);
    if (f.in === 'path') {
      const seg = f.prefix && val ? f.prefix + val : val;
      path = path.replace('{' + f.key + '}', seg);
      continue;
    }
    if (f.type === 'session') continue;
    if (f.type === 'raw') { if (val) query.push([val, undefined]); continue; } // "field=value" already
    if (f.type === 'raw-field' || f.type === 'raw-value') continue; // handled by flow=record
    if (f.keyParam || f.valueFor) continue; // handled below (config key/value pair)
    if (f.type === 'json') { // a params object: spread its keys into query/body
      let obj = null;
      try { obj = JSON.parse(val || '{}'); } catch (_) {}
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (inBody) body[k] = v;
          else query.push([k, encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)]);
        }
      }
      continue;
    }

    const param = f.param || f.key;
    if (val === '' || val == null) continue;
    const encoded = f.encode ? encodeURIComponent(val) : val;
    if (inBody && f.type === 'textarea') body[param] = val;
    else if (inBody) body[param] = encoded;
    else query.push([param, encoded]);
  }

  // config key/value pair (Admin/config)
  const keyField = ep.fields.find(f => f.keyParam);
  const valField = ep.fields.find(f => f.valueFor);
  if (keyField && valField) {
    const k = fieldValue(keyField.key), v = fieldValue(valField.key);
    if (inBody) body[k] = v; else query.push([k, v]);
  }

  // fixed params
  if (ep.fixed) for (const [k, v] of Object.entries(ep.fixed)) query.push([k, v]);

  // REST (v2) auto-injected params: _aa (app id), _lg (language), _t (table)
  if (ep.v2) {
    const inject = { _aa: State.appId, _lg: State.lang };
    if (ep.tableParam) inject._t = fieldValue(ep.tableParam);
    for (const [k, v] of Object.entries(inject)) {
      if (v === '' || v == null) continue;
      if (inBody) { if (!(k in body)) body[k] = v; }
      else query.push([k, encodeURIComponent(v)]);
    }
  }

  // session travels in the Authorization: Bearer header (not query/body)
  const headers = {};
  if ((ep.needsSession || ep.fields.some(f => f.type === 'session')) && State.session) {
    headers.Authorization = 'Bearer ' + State.session;
  }

  let url = (State.baseUrl || '') + path;
  const qs = query.map(([k, v]) => v === undefined ? k : `${k}=${v}`).join('&');
  if (!inBody && qs) url += (url.includes('?') ? '&' : '?') + qs;

  // v2 POST/PUT bodies are JSON; legacy endpoints use form-urlencoding
  const json = !!(ep.v2 && inBody);
  return { url, method, body, query, headers, json };
}

// Bearer header for fetch calls that require a session.
function authHeaders() { return State.session ? { Authorization: 'Bearer ' + State.session } : {}; }
// Session query param — only for real navigations (downloads / new-tab links) that can't send headers.
function appendSession(url) {
  return State.session ? url + (url.includes('?') ? '&' : '?') + 's=' + encodeURIComponent(State.session) : url;
}

function refreshUrlPreview() {
  const box = $('#urlPreview');
  if (!box || !State.current) return;
  const call = assemble(State.current);
  const { url, method, body, headers } = call;
  box.innerHTML = '';
  box.append(el('div', { class: 'u-row' },
    el('span', { class: 'u-method' }, method),
    el('a', { href: url, target: '_blank', rel: 'noopener' }, url),
    el('button', { class: 'copy toggle' + (State.showCurl ? ' active' : ''),
      onclick: () => { State.showCurl = !State.showCurl; refreshUrlPreview(); } }, 'cURL'),
    el('button', { class: 'copy', onclick: () => navigator.clipboard.writeText(url) }, 'copy'),
  ));
  // Session (and any other) headers.
  if (headers && Object.keys(headers).length) {
    const hstr = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
    box.append(el('div', { class: 'u-body' },
      el('div', { class: 'u-body-head' },
        el('span', { class: 'u-body-label' }, 'headers'),
        el('button', { class: 'copy', onclick: () => navigator.clipboard.writeText(hstr) }, 'copy')),
      el('pre', { class: 'json' }, hstr)));
  }
  // For POST / PUT the params travel in the request body — show it.
  if (method !== 'GET') {
    const json = JSON.stringify(body, null, 2);
    box.append(el('div', { class: 'u-body' },
      el('div', { class: 'u-body-head' },
        el('span', { class: 'u-body-label' }, 'body'),
        el('button', { class: 'copy', onclick: () => navigator.clipboard.writeText(json) }, 'copy')),
      el('pre', { class: 'json', html: highlight(body) })));
  }
  // cURL command equivalent.
  if (State.showCurl) {
    const cmd = curlCommand(call);
    box.append(el('div', { class: 'u-body' },
      el('div', { class: 'u-body-head' },
        el('span', { class: 'u-body-label' }, 'curl'),
        el('button', { class: 'copy', onclick: () => navigator.clipboard.writeText(cmd) }, 'copy')),
      el('pre', { class: 'json curl' }, cmd)));
  }
}

// Build a runnable curl command from an assembled call.
function curlCommand({ url, method, body, headers, json }) {
  const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const parts = [`curl -X ${method} ${q(url)}`];
  for (const [k, v] of Object.entries(headers || {})) parts.push(`-H ${q(k + ': ' + v)}`);
  if (method !== 'GET' && body && Object.keys(body).length) {
    if (json) {
      parts.push(`-H 'Content-Type: application/json'`);
      parts.push(`--data ${q(JSON.stringify(body))}`);
    } else {
      parts.push(`-H 'Content-Type: application/x-www-form-urlencoded'`);
      const data = Object.entries(body)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');
      parts.push(`--data ${q(data)}`);
    }
  }
  return parts.join(' \\\n  ');
}

/* ---------- request execution ---------- */
async function sendRequest({ url, method, body, headers, json: jsonBody }) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (method !== 'GET' && body) {
    if (jsonBody) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');
    }
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { res, text, json };
}

function runEndpoint(ep) {
  // required-field guard
  for (const f of ep.fields) {
    if (f.required && !fieldValue(f.key)) { showBanner('“' + f.label + '” is required.', 'err'); return; }
  }
  if (ep.needsSession && !State.session) { showBanner('No session yet — call Auth/login2 first.', 'err'); }

  if (ep.flow === 'filters') return flowFilters(ep);
  if (ep.flow === 'filtersV2') return flowFiltersV2(ep);
  if (ep.flow === 'record') return flowRecord(ep);
  if (ep.flow === 'recordV2') return flowRecordV2(ep);
  if (ep.flow === 'download') return flowDownload(ep, assemble(ep), ep.download && ep.download.filename);
  return flowRequest(ep);
}

/* Fetch a binary response with the Bearer header and save it as a file. */
async function flowDownload(ep, call, fallbackName) {
  const result = $('#result');
  result.innerHTML = loadingHtml();
  try {
    const res = await fetch(call.url, {
      method: call.method,
      headers: { ...(call.headers || {}), ...(call.json && call.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
      body: call.method !== 'GET' && call.body ? (call.json ? JSON.stringify(call.body) : formEncode(call.body)) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) { // an error came back as JSON, not a file
      const j = await res.json();
      return renderResult(ep, { res, json: j });
    }
    const blob = await res.blob();
    const name = filenameFromResponse(res) || fallbackName || 'download';
    const href = URL.createObjectURL(blob);
    const a = el('a', { href, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
    result.innerHTML = '';
    result.append(resultHead({ res }),
      el('div', { class: 'banner info' }, `Downloaded “${name}” (${(blob.size / 1024).toFixed(1)} KB, ${blob.type || ct || 'binary'}).`));
  } catch (err) {
    result.innerHTML = '';
    result.append(el('div', { class: 'banner err' }, 'Download failed: ' + err.message));
  }
}

const formEncode = body => Object.entries(body)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');

function filenameFromResponse(res) {
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ---------- flow: plain request ---------- */
async function flowRequest(ep) {
  const call = assemble(ep);

  // download shortcuts (export / get / etc.) — real navigation, session goes in the query
  if (ep.downloadWhen) {
    const [[k, vals]] = Object.entries(ep.downloadWhen);
    if (vals.includes(fieldValue(k))) {
      const dl = appendSession(call.url);
      openTab(dl); return renderResult(ep, { downloaded: dl });
    }
  }

  const result = $('#result');
  result.innerHTML = loadingHtml();
  try {
    const r = await sendRequest(call);
    if (ep.onSuccess === 'authenticated') handleAuth(r.json);
    renderResult(ep, r);
  } catch (err) {
    result.innerHTML = '';
    result.append(el('div', { class: 'banner err' }, 'Network error: ' + err.message));
  }
}

/* ---------- flow: filters → execute (Process / Report) ---------- */
async function flowFilters(ep) {
  const call = assemble(ep);
  const result = $('#result');
  result.innerHTML = loadingHtml();
  const r = await sendRequest(call);
  if (!r.json || r.json.issuccess === 0) return renderResult(ep, r);

  const cols = (r.json.data && r.json.data.columns) || [];
  result.innerHTML = '';
  result.append(resultHead(r));

  const form = el('div', { class: 'filter-form' });
  const inputs = {};
  for (const c of cols) {
    const row = el('div', { class: 'form-field' });
    row.append(el('label', {}, c.field, c.isnull ? null : el('span', { class: 'req' }, '*'),
      el('span', { class: 'meta' }, '  ' + (c.label || ''))));
    const inA = el('input', { type: 'text', class: c.readonly ? 'readonly' : '', style: 'width:150px',
      value: c.default != null ? c.default : '', readonly: c.readonly ? '' : null });
    row.append(inA);
    let inB = null;
    if (c.isrange) {
      row.append(el('span', {}, ' ~ '));
      inB = el('input', { type: 'text', style: 'width:150px', value: c.default2 != null ? c.default2 : '' });
      row.append(inB);
    }
    inputs[c.field] = { a: inA, b: inB, range: c.isrange };
    form.append(row);
  }
  const box = el('div', { class: 'filter-row' });
  cols.forEach(c => {}); // layout handled by CSS
  form.querySelectorAll('.form-field').forEach(ff => box.append(ff));

  const ex = ep.execute;
  const fmtSel = ex.format ? el('select', ...[{}].concat(ex.format.map(x => el('option', {}, x)))) : null;

  const runExec = () => {
    let pm = '';
    for (const c of cols) {
      const io = inputs[c.field];
      const v = encodeURIComponent(io.a.value);
      pm += io.range ? `&${c.field}=${v}::${io.b.value}` : `&${c.field}=${v}`;
    }
    let url = State.baseUrl + ex.path + '?_t=' + encodeURIComponent(fieldValue('_t')) + pm;
    if (ex.lang) url += '&_lg=' + State.lang;
    if (fmtSel) url += '&_ct=' + fmtSel.value;
    url += '&s=' + State.session;
    $('#execUrl').innerHTML = '';
    $('#execUrl').append(el('span', { class: 'u-method' }, 'GET'),
      el('a', { href: url, target: '_blank', rel: 'noopener' }, url),
      el('button', { class: 'copy', onclick: () => navigator.clipboard.writeText(url) }, 'copy'));
    if (ex.mode === 'download') openTab(url);
  };

  const execBtn = el('button', { class: 'btn btn-success', onclick: runExec },
    ex.mode === 'download' ? 'Execute & download' : 'Build execute URL');

  result.append(box, el('div', { class: 'actions' }, execBtn, fmtSel || null),
    el('div', { class: 'url-preview', id: 'execUrl', style: 'display:block' }));
}

/* ---------- flow: record CRUD (Data/info) ---------- */
async function flowRecord(ep) {
  const op = fieldValue('op');
  const table = fieldValue('_t');
  const pk = fieldValue('pk'), pkv = fieldValue('pkv');
  const result = $('#result');
  result.innerHTML = loadingHtml();

  // 1. fetch columns (session via Bearer header)
  const colsUrl = `${State.baseUrl}/api/Data/columns?_t=${encodeURIComponent(table)}`;
  const colsR = await sendRequest({ url: colsUrl, method: 'GET', headers: authHeaders() });
  if (!colsR.json || colsR.json.issuccess === 0) return renderResult(ep, colsR);
  const cols = colsR.json.data.columns;

  // 2. fetch record (info/new/copy)
  let infoUrl = `${State.baseUrl}/api/Data/${op}?_t=${encodeURIComponent(table)}`;
  if (pk) infoUrl += `&${pk}=${encodeURIComponent(pkv)}`;
  const infoR = await sendRequest({ url: infoUrl, method: 'GET', headers: authHeaders() });
  if (!infoR.json || infoR.json.issuccess === 0) return renderResult(ep, infoR);
  const info = infoR.json.data.info || {};

  result.innerHTML = '';
  result.append(resultHead(infoR), el('div', { class: 'url-preview' },
    el('div', { class: 'u-row' }, el('span', { class: 'u-method' }, 'GET'),
      el('a', { href: appendSession(infoUrl), target: '_blank', rel: 'noopener' }, infoUrl))));

  const inputs = {};
  const wrap = el('div', { class: 'table-wrap' });
  const tbl = el('table', { class: 'data' });
  tbl.append(el('thead', {}, el('tr', {},
    ...['field', 'label', 'type', 'value', 'callout'].map(h => el('th', {}, h)))));
  const tb = el('tbody');
  cols.forEach((c, i) => {
    if (c.display !== 'Y') return;
    const readonly = (op === 'info' && !c.update) || (op !== 'info' && !c.insert);
    const inp = el('input', { type: 'text', style: 'width:200px', class: readonly ? 'readonly' : '',
      readonly: readonly ? '' : null, value: info[c.field] != null ? info[c.field] : '' });
    inputs[c.field] = inp;
    const calloutBtn = c.callout
      ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => runCallout(cols, inputs, table, c) }, c.callout)
      : null;
    tb.append(el('tr', {},
      el('td', {}, el('span', { class: 'tag' }, c.field)),
      el('td', {}, c.label || ''),
      el('td', {}, c.type || ''),
      el('td', {}, inp),
      el('td', {}, calloutBtn)));
  });
  tbl.append(tb); wrap.append(tbl); result.append(wrap);

  // CRUD actions
  const acts = el('div', { class: 'actions' });
  const mkUrl = (verb, changedOnly) => {
    let q = '';
    for (const c of cols) {
      if (c.display !== 'Y') continue;
      const v = inputs[c.field].value;
      if (changedOnly && String(v) === String(info[c.field] ?? '')) continue;
      q += `&${c.field}=${encodeURIComponent(v)}`;
    }
    if (verb === 'update' || verb === 'delete') q += `&${pk}=${encodeURIComponent(pkv)}`;
    return `${State.baseUrl}/api/Data/${verb}?_t=${encodeURIComponent(table)}${q}`;
  };
  const doCrud = async (verb, changedOnly) => {
    const url = verb === 'delete'
      ? `${State.baseUrl}/api/Data/delete?_t=${encodeURIComponent(table)}&${pk}=${encodeURIComponent(pkv)}`
      : mkUrl(verb, changedOnly);
    if (!confirm(verb.toUpperCase() + '?\n\n' + url)) return;
    const r = await sendRequest({ url, method: 'GET', headers: authHeaders() });
    renderJsonBlock(result, r, url);
  };
  if (op === 'new' || op === 'copy') {
    acts.append(el('button', { class: 'btn btn-success', onclick: () => doCrud('insert', false) }, 'Insert'));
  } else {
    acts.append(
      el('button', { class: 'btn btn-success', onclick: () => doCrud('update', true) }, 'Update'),
      el('button', { class: 'btn btn-danger', onclick: () => doCrud('delete', false) }, 'Delete'));
  }
  result.append(acts);
}

/* ---------- flow: REST model → execute (Process / Report v2) ---------- */
async function flowFiltersV2(ep) {
  const call = assemble(ep);                 // GET .../model/<name>
  const result = $('#result');
  result.innerHTML = loadingHtml();
  const r = await sendRequest(call);
  if (!isOk(r.json)) return renderResult(ep, r);

  const filters = (r.json.data && r.json.data.filters) || [];
  const title = r.json.data && r.json.data.title;
  result.innerHTML = '';
  result.append(resultHead(r));
  if (title) result.append(el('h3', { style: 'margin:6px 0 12px;font-size:16px' }, title));

  const inputs = {};
  const box = el('div', { class: 'filter-row' });
  for (const c of filters) {
    if (c.display === 'N') continue;
    const ff = el('div', { class: 'form-field' });
    ff.append(el('label', {}, c.field, c.isnull ? null : el('span', { class: 'req' }, '*'),
      el('span', { class: 'meta' }, '  ' + (c.label || '') + (c['link-table'] ? '  [' + c['link-table'] + ']' : ''))));
    const inA = el('input', { type: 'text', class: c.readonly ? 'readonly' : '', style: 'width:180px',
      value: c.default != null ? c.default : '', readonly: c.readonly ? '' : null });
    ff.append(inA);
    let inB = null;
    if (c.isrange) { ff.append(el('span', {}, ' ~ ')); inB = el('input', { type: 'text', style: 'width:180px', value: c.default2 != null ? c.default2 : '' }); ff.append(inB); }
    inputs[c.field] = { a: inA, b: inB, range: c.isrange };
    box.append(ff);
  }

  const ex = ep.execute;
  const pathField = ep.fields.find(f => f.in === 'path');
  const target = fieldValue(pathField.key);
  const buildExec = () => {
    const body = { _aa: State.appId, _lg: State.lang };
    for (const c of filters) {
      const io = inputs[c.field]; if (!io) continue;
      body[c.field] = io.range ? `${io.a.value}::${io.b.value}` : io.a.value;
    }
    const url = State.baseUrl + ex.path.replace('{' + pathField.key + '}', encodeURIComponent(target));
    return { url, method: 'POST', body, headers: authHeaders(), json: true };
  };

  const execResult = el('div', { class: 'result' });
  const runExec = async () => {
    const exCall = buildExec();
    if (ex.mode === 'download') return flowDownload(ep, exCall, ex.filename);
    execResult.innerHTML = loadingHtml();
    const er = await sendRequest(exCall);
    execResult.innerHTML = '';
    const out = el('div');
    execResult.append(execUrlBlock('POST', exCall.url), out);
    renderResult(ep, er, out);
  };
  const execBtn = el('button', { class: 'btn btn-success', onclick: runExec },
    ex.mode === 'download' ? 'Execute & download' : 'Execute');
  result.append(box, el('div', { class: 'actions' }, execBtn), execResult);
}

/* ---------- flow: REST record (new / info) + CRUD (v2) ---------- */
async function flowRecordV2(ep) {
  const call = assemble(ep);                 // GET .../new|info/<table>?id=
  const op = fieldValue('op');
  const table = fieldValue('table');
  const result = $('#result');
  result.innerHTML = loadingHtml();
  const r = await sendRequest(call);
  if (!isOk(r.json)) return renderResult(ep, r);

  const cols = (r.json.data && r.json.data.columns) || [];
  const info = (r.json.data && r.json.data.info) || {};
  const pkFields = modelPks(r.json.data || {}, cols);   // supports single pk & compound pks

  result.innerHTML = '';
  result.append(resultHead(r), execUrlBlock(call.method, call.url));

  const inputs = {};
  const tbl = el('table', { class: 'data' });
  tbl.append(el('thead', {}, el('tr', {}, ...['field', 'label', 'type', 'value'].map(h => el('th', {}, h)))));
  const tb = el('tbody');
  for (const c of cols) {
    if (c.display !== 'Y') continue;
    const readonly = (op === 'info' && c.update === false) || (op === 'new' && c.insert === false);
    const inp = el('input', { type: 'text', style: 'width:240px', class: readonly ? 'readonly' : '',
      readonly: readonly ? '' : null, value: info[c.field] != null ? info[c.field] : '' });
    inputs[c.field] = inp;
    tb.append(el('tr', {},
      el('td', {}, el('span', { class: 'tag' }, c.field), pkFields.includes(c.field) ? el('span', { class: 'tag', style: 'margin-left:4px;color:var(--accent)' }, 'pk') : null),
      el('td', {}, c.label || ''), el('td', {}, c.type || ''), el('td', {}, inp)));
  }
  tbl.append(tb);
  result.append(el('div', { class: 'table-wrap' }, tbl));

  const crudResult = el('div', { class: 'result' });
  const pkVal = f => (inputs[f] ? inputs[f].value : (info[f] != null ? info[f] : ''));
  const doCrud = async verb => {
    const body = { _aa: State.appId, _lg: State.lang };
    if (verb === 'delete') {
      // documented delete takes {id}; compound keys send each pk field instead
      if (pkFields.length > 1) pkFields.forEach(f => { body[f] = pkVal(f); });
      else body.id = pkFields.length ? pkVal(pkFields[0]) : fieldValue('id');
    } else {
      for (const c of cols) {
        if (c.display !== 'Y') continue;
        const v = inputs[c.field].value;
        if (verb === 'update' && !pkFields.includes(c.field) && String(v) === String(info[c.field] ?? '')) continue;
        body[c.field] = v;
      }
      if (verb === 'update') pkFields.forEach(f => { body[f] = pkVal(f); });
    }
    const url = `${State.baseUrl}/api/Data/${verb}/${encodeURIComponent(table)}`;
    if (!confirm(verb.toUpperCase() + ' ' + table + '?\n\n' + JSON.stringify(body, null, 2))) return;
    crudResult.innerHTML = loadingHtml();
    const cr = await sendRequest({ url, method: 'POST', body, headers: authHeaders(), json: true });
    crudResult.innerHTML = '';
    const out = el('div');
    crudResult.append(execUrlBlock('POST', url), out);
    renderResult(ep, cr, out);
  };

  const acts = el('div', { class: 'actions' });
  if (op === 'new') acts.append(el('button', { class: 'btn btn-success', onclick: () => doCrud('insert') }, 'Insert'));
  else acts.append(
    el('button', { class: 'btn btn-success', onclick: () => doCrud('update') }, 'Update'),
    el('button', { class: 'btn btn-danger', onclick: () => doCrud('delete') }, 'Delete'));
  result.append(acts, crudResult);
}

// Small URL line used inside sub-results.
function execUrlBlock(method, url) {
  return el('div', { class: 'url-preview' }, el('div', { class: 'u-row' },
    el('span', { class: 'u-method' }, method),
    el('a', { href: url, target: '_blank', rel: 'noopener' }, url),
    el('button', { class: 'copy', onclick: () => navigator.clipboard.writeText(url) }, 'copy')));
}

async function runCallout(cols, inputs, table, field) {
  const body = { _t: table, _type: 'change', _fld: field.field };
  for (const c of cols) {
    if (c.display !== 'Y') continue;
    const v = inputs[c.field].value;
    body[c.field] = c.field === field.field ? '' : encodeURIComponent(v);
    if (c.field === field.field) body._val = encodeURIComponent(v);
  }
  const r = await sendRequest({ url: State.baseUrl + '/api/Data/callout', method: 'POST', body, headers: authHeaders() });
  if (!r.json || r.json.issuccess === 0) { showBanner('Callout error: ' + (r.json && r.json.message), 'err'); return; }
  const info = r.json.data.info || {};
  for (const [k, v] of Object.entries(info)) if (inputs[k]) inputs[k].value = v;
}

/* ---------- auth handling ---------- */
function handleAuth(json) {
  if (!json || json.issuccess === 0 || !json.data) return;
  if (json.data.s) {
    State.session = json.data.s;
    updateSessionChip();
    loadResources();
  }
}

async function loadResources() {
  const specs = [
    ['tables', 'tables', 'tables.json'],
    ['processes', 'process', 'processes.json'],
    ['reports', 'report', 'reports.json'],
  ];
  for (const [slot, type, file] of specs) {
    try {
      const url = `${State.baseUrl}/api/Auth/resources?type=${type}&file=${file}&_cc=${State.cc}`;
      const r = await sendRequest({ url, method: 'GET', headers: authHeaders() });
      if (r.json) State.resources[slot] = Object.keys(r.json).sort();
    } catch (_) {}
  }
  // refresh any resource dropdowns currently on screen
  document.querySelectorAll('.resource-select').forEach(sel =>
    fillResourceSelect(sel, sel.dataset.resource));
}

function updateSessionChip() {
  const chip = $('#sessionChip');
  chip.classList.toggle('live', !!State.session);
  $('#sessionVal').textContent = State.session ? State.session : 'no session';
  document.querySelectorAll('.form-field input.readonly[placeholder="(login first)"]').forEach(i => { i.value = State.session; });
}

/* ---------- result rendering ---------- */
// Every JSON response follows { issuccess, message, data }. issuccess 0 → business/exception error.
const isOk = json => json && json.issuccess !== 0;

function renderResult(ep, r, root) {
  const result = root || $('#result');
  result.innerHTML = '';
  if (r.downloaded) {
    result.append(el('div', { class: 'banner info' }, 'Opened download in a new tab.'),
      el('div', { class: 'url-preview' }, el('a', { href: r.downloaded, target: '_blank' }, r.downloaded)));
    return;
  }
  result.append(resultHead(r));

  // Uniform error handling: surface the message, then the raw payload.
  if (r.json && !isOk(r.json)) {
    result.append(el('div', { class: 'banner err' }, r.json.message || 'Request failed (issuccess = 0)'));
    renderJson(result, r.json);
    return;
  }
  if (!r.json) { renderJson(result, r.text); return; }

  const mode = (ep.result && ep.result.mode) || 'json';
  switch (mode) {
    case 'keyedTable': return renderKeyedTable(result, r.json, ep.result);
    case 'columns':    return renderColumns(result, r.json);
    case 'records':    return renderRecords(result, r);
    case 'model':      return renderModel(result, r);
    case 'resourceLinks': return renderResourceLinks(result, r.json, ep);
    default:           return renderJson(result, r.json);
  }
}

function resultHead(r) {
  const ok = r.json ? isOk(r.json) : (r.res ? r.res.ok : true);
  const status = r.res ? r.res.status : '';
  const msg = r.json && r.json.message;
  return el('div', { class: 'result-head' },
    el('h3', {}, 'Response'),
    el('span', { class: 'status-badge ' + (ok ? 'status-ok' : 'status-err') },
      (ok ? 'success' : 'error') + (status ? ' · ' + status : '')),
    msg ? el('span', { class: 'hint' }, msg) : null);
}

// Primary key field(s): "pk" (single) or "pks" (compound), falling back to a type:"pk" column.
function modelPks(data, cols) {
  if (Array.isArray(data.pks)) return data.pks;
  if (typeof data.pks === 'string' && data.pks) return [data.pks];
  if (data.pk) return [data.pk];
  if (Array.isArray(cols)) return cols.filter(c => c.type === 'pk').map(c => c.field);
  return [];
}

/* ---------- result mode: Data/model ---------- */
function renderModel(root, r) {
  const d = r.json && r.json.data;
  if (!d) return renderJson(root, r.json);
  const pkList = modelPks(d);
  const meta = [
    ['title', d.title], ['tablename', d.tablename],
    [pkList.length > 1 ? 'pks' : 'pk', pkList.join(', ')],
    ['paging', String(d.paging ?? '')], ['pagesize', String(d.pagesize ?? '')],
    ['firstload', String(d.firstload ?? '')], ['autonew', String(d.autonew ?? '')],
    ['permission', d.permission ? Object.entries(d.permission).filter(([, v]) => v).map(([k]) => k).join(', ') : ''],
  ].filter(([, v]) => v !== '' && v != null);

  const metaTbl = el('table', { class: 'data' }, el('tbody', {},
    ...meta.map(([k, v]) => el('tr', {}, el('td', { style: 'width:140px' }, el('span', { class: 'tag' }, k)), el('td', {}, v)))));
  root.append(el('div', { class: 'table-wrap', style: 'margin-bottom:16px' }, metaTbl));

  if (Array.isArray(d.reports) && d.reports.length) {
    root.append(el('div', { class: 'hint', style: 'margin:12px 0 6px' }, 'reports'));
    const rt = el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', {}, '_t'), el('th', {}, 'label'))),
      el('tbody', {}, ...d.reports.map(x => el('tr', {}, el('td', {}, el('span', { class: 'tag' }, x._t)), el('td', {}, x.label || '')))));
    root.append(el('div', { class: 'table-wrap', style: 'margin-bottom:16px' }, rt));
  }

  const filters = d.filters || [];
  if (filters.length) {
    root.append(el('div', { class: 'hint', style: 'margin:12px 0 6px' }, 'filters'));
    root.append(renderColumnTable(filters));
  }
  // Everything else (layout-info, apis, ...) as raw JSON in a details block.
  const rest = { ...d }; delete rest.filters; delete rest.reports;
  root.append(el('details', { style: 'margin-top:14px' },
    el('summary', { class: 'hint', style: 'cursor:pointer' }, 'full data (layout-info, apis, permission, …)'),
    el('pre', { class: 'json', html: highlight(r.json) })));
}

// Shared column/filter table (field, label, type, flags, link-table).
function renderColumnTable(arr) {
  const heads = ['field', 'label', 'type', 'display', 'isnull', 'readonly', 'isrange', 'default', 'link-table'];
  const tbl = el('table', { class: 'data' });
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map(h => el('th', {}, h)))));
  const tb = el('tbody');
  for (const o of arr) tb.append(el('tr', {},
    el('td', {}, el('span', { class: 'tag' }, o.field), o.type === 'pk' ? el('span', { class: 'tag', style: 'margin-left:4px;color:var(--accent)' }, 'pk') : null),
    el('td', {}, o.label || ''),
    el('td', {}, o.type || o['data-type'] || ''),
    el('td', {}, String(o.display ?? '')),
    el('td', {}, String(o.isnull ?? '')),
    el('td', {}, String(o.readonly ?? '')),
    el('td', {}, String(o.isrange ?? '')),
    el('td', {}, o.default != null ? String(o.default) : ''),
    el('td', {}, o['link-table'] || '')));
  tbl.append(tb);
  return el('div', { class: 'table-wrap' }, tbl);
}

function renderJson(root, data) {
  root.append(el('pre', { class: 'json', html: highlight(data) }));
}
function renderJsonBlock(root, r, url) {
  root.append(el('div', { class: 'url-preview' }, el('span', { class: 'u-method' }, 'GET'),
    el('a', { href: url, target: '_blank' }, url)));
  renderJson(root, r.json ?? r.text);
}

function renderKeyedTable(root, data, opt) {
  if (!data) return renderJson(root, data);
  const rows = Object.keys(data).sort().map(k => [k, data[k]])
    .filter(([, v]) => !opt.onlyDisplay || v.display === 'Y');
  const tbl = el('table', { class: 'data' });
  tbl.append(el('thead', {}, el('tr', {}, el('th', {}, 'key'), el('th', {}, opt.labelKey || 'label'))));
  const tb = el('tbody');
  for (const [k, v] of rows) tb.append(el('tr', {},
    el('td', {}, el('span', { class: 'tag' }, k)), el('td', {}, (v && v[opt.labelKey]) || '')));
  tbl.append(tb);
  root.append(el('div', { class: 'hint', style: 'margin-bottom:8px' }, rows.length + ' items'),
    el('div', { class: 'table-wrap' }, tbl));
}

function renderColumns(root, data) {
  if (!data || !data.data) return renderJson(root, data);
  const d = data.data;
  const arr = d.columns || d.filters || [];
  const isModel = !!d.filters && !d.columns;
  const tbl = el('table', { class: 'data' });
  const heads = ['field', 'label', 'type', 'isnull', 'insert', 'update', 'group', 'note', 'link-table'];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map(h => el('th', {}, h)))));
  const tb = el('tbody');
  for (const o of arr) {
    if (o.display !== 'Y') continue;
    tb.append(el('tr', {},
      el('td', {}, el('span', { class: 'tag' }, o.field)),
      el('td', {}, o.label || ''),
      el('td', {}, o.type || ''),
      el('td', {}, String(o.isnull ?? '')),
      el('td', {}, String(o.insert ?? '')),
      el('td', {}, String(o.update ?? '')),
      el('td', {}, o.groupname || ''),
      el('td', {}, o.note || ''),
      el('td', {}, o['link-table'] || '')));
  }
  tbl.append(tb);
  if (isModel) {
    const meta = el('table', { class: 'data', style: 'margin-bottom:14px' });
    meta.append(el('tbody', {}, ...['paging', 'pagesize', 'firstload'].map(k =>
      el('tr', {}, el('td', {}, el('span', { class: 'tag' }, k)), el('td', {}, String(d[k] ?? ''))))));
    root.append(el('div', { class: 'table-wrap', style: 'margin-bottom:14px' }, meta));
  }
  root.append(el('div', { class: 'table-wrap' }, tbl));
}

function renderRecords(root, r) {
  const d = r.json && r.json.data;
  if (!d || !d.list) return renderJson(root, r.json ?? r.text);
  buildTabs(root, r, () => {
    const cols = d.columns || [];
    const tbl = el('table', { class: 'data' });
    tbl.append(el('thead', {}, el('tr', {}, ...cols.map(c =>
      el('th', {}, el('span', { class: 'fld' }, c.field), c.label || '')))));
    const tb = el('tbody');
    for (const row of d.list) tb.append(el('tr', {}, ...cols.map(c => el('td', {}, fmtCell(row[c.field])))));
    tbl.append(tb);
    return el('div', {},
      el('div', { class: 'hint', style: 'margin-bottom:8px' }, d.list.length + ' rows'),
      el('div', { class: 'table-wrap' }, tbl));
  });
}

function renderResourceLinks(root, data, ep) {
  const d = data && data.data;
  const list = d && d.list;
  if (!list) return renderJson(root, data);
  const base = State.baseUrl + ep.result.linkBase;
  const path = fieldValue('path') || '';
  const tbl = el('table', { class: 'data' });
  const tb = el('tbody');
  for (const item of list) {
    const name = typeof item === 'object' ? item.name : item;
    const href = `${base}${path ? path + '/' : '/'}${name}?s=${State.session}`;
    tb.append(el('tr', {}, el('td', {}, el('a', { href, target: '_blank', rel: 'noopener' }, name))));
  }
  tbl.append(tb);
  root.append(el('div', { class: 'table-wrap' }, tbl));
}

/* tabs: rendered view + raw source */
function buildTabs(root, r, renderView) {
  const tabs = el('div', { class: 'tabs' });
  const tView = el('div', { class: 'tab active' }, 'View');
  const tRaw = el('div', { class: 'tab' }, 'Raw JSON');
  tabs.append(tView, tRaw);
  const pView = el('div', { class: 'tab-panel active' }, renderView());
  const pRaw = el('div', { class: 'tab-panel' }, el('pre', { class: 'json', html: highlight(r.json ?? r.text) }));
  const swap = active => {
    tView.classList.toggle('active', active === 'v'); tRaw.classList.toggle('active', active === 'r');
    pView.classList.toggle('active', active === 'v'); pRaw.classList.toggle('active', active === 'r');
  };
  tView.onclick = () => swap('v'); tRaw.onclick = () => swap('r');
  root.append(tabs, pView, pRaw);
}

/* ---------- misc UI ---------- */
function fmtCell(v) {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function loadingHtml() { return '<div class="empty">Loading…</div>'; }
function openTab(url) { const a = el('a', { href: url, target: '_blank', rel: 'noopener' }); document.body.append(a); a.click(); a.remove(); }
function showBanner(msg, kind) {
  const result = $('#result');
  if (result) { result.innerHTML = ''; result.append(el('div', { class: 'banner ' + (kind || 'info') }, msg)); }
}

/* JSON syntax highlighter */
function highlight(data) {
  let json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    m => {
      let cls = 'n';
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'k' : 's';
      else if (/true|false/.test(m)) cls = 'b';
      else if (/null/.test(m)) cls = 'nl';
      return `<span class="${cls}">${m}</span>`;
    });
}

/* bind topbar lang/cc if present later; kick off */
boot().catch(err => {
  document.body.innerHTML = '<pre style="padding:24px;color:#f85149">Failed to load config: ' + err.message + '</pre>';
});
