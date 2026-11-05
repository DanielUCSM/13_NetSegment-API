import { parseNetwork, toAddress, positiveInteger, splitNetworks, validatePayload, csvText } from './network.js';

const $ = id => document.getElementById(id);
const format = value => Number(value).toLocaleString('es-PE');
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const modes = {
  flsm: {
    name: 'Subnetting FLSM', number: '01', tag: 'FIXED LENGTH', title: 'Cada subred, en su lugar.',
    description: 'Divide una red IPv4 en bloques iguales y obtén todo tu direccionamiento.',
    subtitle: 'Una máscara. Subredes de igual capacidad.', action: 'Calcular subredes',
    learn: 'Una red, bloques del mismo tamaño.',
    explanation: 'FLSM toma bits de la parte de host para crear subredes iguales. Se reservan las direcciones de red y broadcast; cada subred debe admitir al menos dos hosts.',
    endpoint: '/api/v1/subnetting/flsm', example: { network: '192.168.10.0/24', subnets_needed: 4 },
  },
  vlsm: {
    name: 'Subnetting VLSM', number: '02', tag: 'VARIABLE LENGTH', title: 'El espacio justo para cada red.',
    description: 'Asigna bloques IPv4 según la demanda real de hosts de cada segmento.',
    subtitle: 'Diferentes necesidades. Una distribución eficiente.', action: 'Distribuir direcciones',
    learn: 'Más capacidad donde más se necesita.',
    explanation: 'VLSM asigna primero las redes más grandes. Cada bloque utiliza el prefijo mínimo que admite los hosts solicitados, sin solapamientos y con red y broadcast reservados.',
    endpoint: '/api/v1/subnetting/vlsm', example: { base_network: '172.16.0.0/22', departments: [
      { name: 'Ingeniería', hosts_needed: 500 }, { name: 'Ventas', hosts_needed: 120 },
      { name: 'Servidores', hosts_needed: 50 }, { name: 'Enlace WAN', hosts_needed: 2 },
    ] },
  },
  cidr: {
    name: 'Agregación CIDR', number: '03', tag: 'EXACT AGGREGATION', title: 'Menos rutas. La misma cobertura.',
    description: 'Resume redes contiguas en una superred exacta, sin incluir direcciones adicionales.',
    subtitle: 'Simplifica las rutas. Conserva cada dirección.', action: 'Agregar redes',
    learn: 'Una ruta que representa exactamente tus redes.',
    explanation: 'La agregación CIDR combina bloques contiguos y alineados. El resultado se acepta cuando una sola superred cubre las redes de entrada sin huecos ni solapamientos.',
    endpoint: '/api/v1/supernetting/aggregate', example: { networks: ['192.168.0.0/24', '192.168.1.0/24', '192.168.2.0/24', '192.168.3.0/24'] },
  },
};

let mode = 'flsm';
let calculation = null;
let activeRequest = null;
let generation = 0;
let page = 0;
let rows = [];
let columns = [];
let rowSequence = 0;
let toastTimer;
let history = readHistory();
const pageSize = 25;
const historyKey = 'netsegment.history.v1';

function readHistory() {
  try {
    const text = localStorage.getItem('netsegment.history.v1') || '[]';
    if (text.length > 2000000) return [];
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.filter(entry => {
      try {
        if (!modes[entry.mode] || typeof entry.date !== 'string' || !Number.isFinite(Date.parse(entry.date))) return false;
        validatePayload(entry.mode, entry.payload);
        return true;
      } catch { return false; }
    }).slice(0, 10) : [];
  } catch { return []; }
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function clearError() {
  $('form-error').hidden = true;
  document.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
}

function showError(message, field) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', 'form-error');
    field.focus();
  }
}

function syncControls(busy = false) {
  $('calculator-form').querySelectorAll('input, textarea, button').forEach(control => {
    control.disabled = busy || Boolean(control.closest('.mode-fields[hidden]'));
  });
  $('example-button').disabled = busy;
  $('calculate-label').textContent = busy ? 'Calculando…' : modes[mode].action;
  $('calculate-icon').textContent = busy ? '◌' : '→';
  const entries = $('departments').querySelectorAll('.department-row');
  entries.forEach(row => { row.querySelector('button').disabled = busy || entries.length <= 1; });
  $('add-department').disabled = busy || entries.length >= 1024;
  $('results-card').setAttribute('aria-busy', String(busy));
}

function invalidate() {
  generation += 1;
  activeRequest?.abort();
  activeRequest = null;
  calculation = null;
  $('results-content').hidden = true;
  $('empty-state').hidden = false;
  $('loading-state').hidden = true;
  $('result-state').textContent = 'Sin calcular';
  $('result-state').removeAttribute('data-state');
  clearError();
  syncControls();
}

function switchMode(next, focus = false) {
  if (!modes[next]) next = 'flsm';
  invalidate();
  mode = next;
  const config = modes[mode];
  document.querySelectorAll('[data-mode]').forEach(link => {
    if (link.dataset.mode === mode) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  for (const name of Object.keys(modes)) $(`${name}-fields`).hidden = name !== mode;
  $('page-title').textContent = config.title;
  $('page-description').textContent = config.description;
  $('breadcrumb-mode').textContent = config.name;
  $('tool-title').textContent = config.name;
  $('tool-number').textContent = config.number;
  $('tool-description').textContent = config.subtitle;
  $('algorithm-tag').textContent = config.tag;
  $('learning-title').textContent = config.learn;
  $('learning-text').textContent = config.explanation;
  $('learning-abbr').textContent = mode.toUpperCase();
  document.title = `${config.name} · NetSegment`;
  syncControls();
  if (focus) $(`${mode === 'cidr' ? 'cidr-networks' : `${mode}-network`}`).focus();
}

function addDepartment(name = '', hosts = '') {
  if ($('departments').children.length >= 1024) return;
  rowSequence += 1;
  const row = document.createElement('div');
  row.className = 'department-row';
  row.innerHTML = `<input type="text" maxlength="80" autocomplete="off" required aria-label="Nombre del segmento ${rowSequence}" placeholder="Ej. Ventas"><input type="number" min="1" max="4294967294" step="1" required aria-label="Hosts del segmento ${rowSequence}" placeholder="120"><button type="button" class="remove-row" aria-label="Eliminar segmento ${rowSequence}" title="Eliminar segmento">×</button>`;
  row.children[0].value = name;
  row.children[1].value = hosts;
  row.querySelector('button').addEventListener('click', () => {
    const fallback = row.previousElementSibling || row.nextElementSibling;
    row.remove();
    updateSegmentCount();
    invalidate();
    fallback?.querySelector('input').focus();
  });
  $('departments').append(row);
  updateSegmentCount();
}

function updateSegmentCount() {
  const count = $('departments').children.length;
  $('segments-count').textContent = `${count} ${count === 1 ? 'segmento' : 'segmentos'}`;
  syncControls();
}

function fillPayload(payload) {
  if (mode === 'flsm') {
    $('flsm-network').value = payload.network;
    $('flsm-count').value = payload.subnets_needed;
  } else if (mode === 'vlsm') {
    $('vlsm-network').value = payload.base_network;
    $('departments').replaceChildren();
    payload.departments.forEach(item => addDepartment(item.name, item.hosts_needed));
  } else $('cidr-networks').value = payload.networks.join('\n');
  invalidate();
}

function payloadFromForm() {
  const fieldValue = (id, parser) => {
    const input = $(id);
    try { return parser(input.value); } catch (error) { error.field = input; throw error; }
  };
  if (mode === 'flsm') return {
    network: fieldValue('flsm-network', value => parseNetwork(value).text),
    subnets_needed: fieldValue('flsm-count', value => positiveInteger(value, 4096, 'Subredes')),
  };
  if (mode === 'cidr') return { networks: fieldValue('cidr-networks', splitNetworks) };
  const departments = [...$('departments').children].map((row, index) => {
    const [nameField, hostsField] = row.querySelectorAll('input');
    const name = nameField.value.trim();
    if (!name || name.length > 80) {
      const error = new Error(`Segmento ${index + 1}: escribe un nombre de entre 1 y 80 caracteres.`);
      error.field = nameField;
      throw error;
    }
    try { return { name, hosts_needed: positiveInteger(hostsField.value, 4294967294, `Hosts de ${name}`) }; }
    catch (error) { error.field = hostsField; throw error; }
  });
  return { base_network: fieldValue('vlsm-network', value => parseNetwork(value).text), departments };
}

function apiMessage(body, status) {
  if (typeof body?.message === 'string') return body.message;
  if (Array.isArray(body?.detail)) {
    const first = body.detail[0];
    const location = (first.loc || []).filter(part => part !== 'body').map(part => typeof part === 'number' ? part + 1 : part).join(' → ');
    const reasons = {
      int_type: 'Introduce un número entero.', greater_than_equal: 'La cantidad debe ser al menos 1.',
      extra_forbidden: 'El campo no forma parte de esta operación.', string_too_long: 'El nombre excede los 80 caracteres.',
    };
    return `${location ? `${location}: ` : ''}${reasons[first.type] || first.msg || 'Comprueba los datos de entrada.'}`;
  }
  if (status >= 500) return 'El servicio no pudo completar el cálculo. Inténtalo nuevamente.';
  return `No se pudo completar la solicitud (HTTP ${status}).`;
}

async function calculate(event) {
  event.preventDefault();
  let payload;
  try { payload = validatePayload(mode, payloadFromForm()); }
  catch (error) { showError(error.message, error.field); return; }
  invalidate();
  const currentGeneration = generation;
  const currentMode = mode;
  const controller = new AbortController();
  activeRequest = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  $('empty-state').hidden = true;
  $('loading-state').hidden = false;
  $('result-state').textContent = 'Procesando';
  syncControls(true);
  try {
    const response = await fetch(modes[currentMode].endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (currentGeneration !== generation) return;
    if (!response.ok) throw new Error(apiMessage(body, response.status));
    if (body?.status !== 'success' || !body.data) throw new Error('El servicio devolvió una respuesta inesperada. Vuelve a intentarlo.');
    calculation = { mode: currentMode, payload, response: body, date: new Date().toISOString() };
    renderResult();
    saveHistory(calculation);
    setConnection('online', 'Servicio disponible');
    toast('Cálculo completado. Tu plan de direccionamiento está listo.');
    if (window.matchMedia('(max-width: 980px)').matches) $('results-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (currentGeneration !== generation) return;
    if (error.name === 'AbortError' && !timedOut) return;
    const message = timedOut ? 'El cálculo excedió el tiempo de espera. Comprueba el servicio e inténtalo de nuevo.'
      : error instanceof TypeError ? 'No se pudo conectar con el servicio. Comprueba que el backend siga ejecutándose e inténtalo nuevamente.' : error.message;
    showError(message);
    $('empty-state').hidden = false;
    $('result-state').textContent = 'Revisar datos';
    if (error instanceof TypeError || timedOut) setConnection('offline', 'Sin conexión');
  } finally {
    clearTimeout(timeout);
    if (currentGeneration === generation) {
      activeRequest = null;
      $('loading-state').hidden = true;
      syncControls();
    }
  }
}

function metric(label, value, mono = false) {
  return `<div class="metric"><span>${escape(label)}</span><strong${mono ? ' class="mono"' : ''}>${escape(value)}</strong></div>`;
}

function renderResult() {
  const { data } = calculation.response;
  const summary = $('result-summary');
  let blocks;
  let note = '';
  let total;
  let base;
  columns = ['Segmento', 'Red / prefijo', 'Hosts utilizables', 'Primer host', 'Último host', 'Broadcast', 'Máscara', 'Wildcard'];
  if (mode === 'flsm') {
    summary.innerHTML = metric('Subredes generadas', format(data.allocated_subnets_count)) + metric('Nuevo prefijo', `/${data.cidr_prefix}`) + metric('Hosts por subred', format(data.usable_hosts_per_subnet)) + metric('Máscara de subred', data.subnet_mask, true);
    if (data.allocated_subnets_count !== data.requested_subnets_count) note = `Solicitaste ${format(data.requested_subnets_count)} subredes. Se generan ${format(data.allocated_subnets_count)} para completar la partición de la red en una potencia de dos.`;
    rows = data.subnets.map(row => [`Subred ${row.subnet_id}`, row.network_address + row.cidr, data.usable_hosts_per_subnet, row.first_usable_ip, row.last_usable_ip, row.broadcast_address, row.netmask, row.wildcard_mask]);
    base = data.base_network;
    total = parseNetwork(base).size;
    blocks = data.subnets.map(row => ({ label: `Subred ${row.subnet_id}`, network: row.network_address + row.cidr, size: data.total_hosts_per_subnet }));
    $('table-title').textContent = 'Subredes calculadas';
  } else if (mode === 'vlsm') {
    summary.innerHTML = metric('Direcciones asignadas', format(data.total_space_allocated)) + metric('Direcciones sin asignar', format(data.total_space_remaining)) + metric('Hosts solicitados', format(data.total_requested_hosts)) + metric('Bloque utilizado', `${(data.total_space_allocated / data.total_space_available * 100).toFixed(1)} %`);
    note = `${format(data.total_space_available)} direcciones en el bloque base. Quedan ${format(data.total_space_remaining)} sin asignar y ${format(data.total_host_capacity_unused)} hosts libres dentro de los segmentos creados. Son espacios diferentes.`;
    columns = ['Segmento', 'Red / prefijo', 'Hosts utilizables', 'Primer host', 'Último host', 'Broadcast', 'Máscara', 'Wildcard', 'Hosts solicitados'];
    rows = data.allocations.map(row => [row.department, row.network_address + row.cidr, row.allocated_hosts, row.first_usable_ip, row.last_usable_ip, row.broadcast_address, row.netmask, row.wildcard_mask, row.requested_hosts]);
    base = data.base_network;
    total = data.total_space_available;
    blocks = data.allocations.map(row => ({ label: row.department, network: row.network_address + row.cidr, size: parseNetwork(row.network_address + row.cidr).size }));
    if (data.total_space_remaining) blocks.push({ label: 'Sin asignar', network: '', size: data.total_space_remaining, free: true });
    $('table-title').textContent = 'Asignación por segmento';
  } else {
    base = data.summary_route;
    total = parseNetwork(base).size;
    summary.innerHTML = metric('Ruta agregada', data.summary_route, true) + metric('Redes de entrada', format(data.input_networks_count)) + metric('Reducción de rutas', data.routing_table_reduction) + metric('Direcciones cubiertas', format(total));
    note = `Máscara: ${data.summary_netmask} · Wildcard: ${data.summary_wildcard}. Cobertura exacta desde ${data.range_covered.start_address} hasta ${data.range_covered.end_address}.`;
    const inputs = calculation.payload.networks.map(parseNetwork).sort((a, b) => a.address - b.address);
    columns = ['Red de entrada', 'Máscara', 'Dirección inicial', 'Dirección final', 'Direcciones'];
    rows = inputs.map(network => [network.text, toAddress(4294967296 - network.size), toAddress(network.address), toAddress(network.last), network.size]);
    blocks = inputs.map(network => ({ label: network.text, network: '', size: network.size }));
    $('table-title').textContent = 'Redes de origen';
  }
  $('result-note').hidden = !note;
  $('result-note').textContent = note;
  $('visualization-title').textContent = mode === 'cidr' ? 'Cobertura de la superred' : 'Distribución del bloque';
  $('visualization-meta').textContent = base;
  drawMap(blocks, total);
  $('result-state').textContent = 'Calculado';
  $('result-state').dataset.state = 'success';
  $('empty-state').hidden = true;
  $('results-content').hidden = false;
  $('result-search').value = '';
  $('json-output').textContent = JSON.stringify({ request: calculation.payload, response: calculation.response }, null, 2);
  page = 0;
  renderTable();
}

function drawMap(blocks, total) {
  $('network-map').replaceChildren();
  $('map-legend').replaceChildren();
  const maxBlocks = 32;
  const shown = blocks.length > maxBlocks ? [...blocks.slice(0, maxBlocks - 1), { label: `${blocks.length - maxBlocks + 1} bloques más`, size: blocks.slice(maxBlocks - 1).reduce((sum, block) => sum + block.size, 0) }] : blocks;
  for (const [index, block] of shown.entries()) {
    const color = block.free ? 'tone-free' : `tone-${index % 4}`;
    const width = block.size / total * 100;
    const bar = document.createElement('div');
    bar.className = `network-block ${color}`;
    bar.style.flexBasis = `${width}%`;
    bar.title = `${block.label}${block.network ? ` · ${block.network}` : ''} · ${format(block.size)} direcciones (${width.toFixed(2)} %)`;
    if (width > 12) bar.textContent = block.network ? block.network.slice(block.network.indexOf('/')) : `${width.toFixed(1)} %`;
    $('network-map').append(bar);
    if (index < 6 || block.free) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-dot ${color}"></span><span>${escape(block.label)} · ${format(block.size)}</span>`;
      $('map-legend').append(item);
    }
  }
  if (blocks.length > 6) {
    const more = document.createElement('span');
    more.textContent = `${format(blocks.length)} bloques en total. Consulta el detalle en la tabla.`;
    $('map-legend').append(more);
  }
}

function renderTable(printAll = false) {
  const query = $('result-search').value.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => row.some(value => String(value).toLocaleLowerCase().includes(query)));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  page = Math.min(page, pageCount - 1);
  const visible = printAll ? rows : filtered.slice(page * pageSize, (page + 1) * pageSize);
  const head = $('result-table').querySelector('thead');
  const body = $('result-table').querySelector('tbody');
  if (mode === 'cidr') {
    head.innerHTML = '<tr><th scope="col">Red de entrada</th><th scope="col">Máscara</th><th scope="col">Primera dirección</th><th scope="col">Última dirección</th><th scope="col">Direcciones</th></tr>';
    body.innerHTML = visible.map(row => `<tr>${row.map(value => `<td class="mono">${escape(value)}</td>`).join('')}</tr>`).join('');
  } else {
    head.innerHTML = '<tr><th scope="col">Segmento</th><th scope="col">Red / prefijo</th><th scope="col">Hosts</th><th scope="col">Rango utilizable</th><th scope="col">Broadcast</th><th scope="col">Máscaras</th></tr>';
    body.innerHTML = visible.map(row => `<tr><td>${escape(row[0])}</td><td class="mono">${escape(row[1])}</td><td class="mono">${escape(format(row[2]))}${mode === 'vlsm' ? `<small>${escape(format(row[8]))} solicitados</small>` : '<small>utilizables</small>'}</td><td class="mono">${escape(row[3])}<small>a ${escape(row[4])}</small></td><td class="mono">${escape(row[5])}</td><td class="mono">${escape(row[6])}<small>WC ${escape(row[7])}</small></td></tr>`).join('');
  }
  if (!visible.length) body.innerHTML = `<tr><td colspan="6" class="no-results">No hay resultados para esta búsqueda.</td></tr>`;
  $('table-count').textContent = format(rows.length);
  $('page-info').textContent = filtered.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} de ${format(filtered.length)}` : '0 resultados';
  $('previous-page').disabled = page === 0;
  $('next-page').disabled = page >= pageCount - 1;
}

function saveHistory(entry) {
  const saved = { mode: entry.mode, payload: entry.payload, date: entry.date };
  const key = JSON.stringify(saved.payload);
  history = [saved, ...history.filter(item => item.mode !== entry.mode || JSON.stringify(item.payload) !== key)].slice(0, 10);
  try { localStorage.setItem(historyKey, JSON.stringify(history)); }
  catch { toast('Cálculo listo. El navegador no permite guardar el historial local.'); }
  renderHistory();
}

function renderHistory() {
  $('history-list').replaceChildren();
  $('clear-history').disabled = !history.length;
  if (!history.length) {
    const p = document.createElement('p'); p.className = 'history-empty'; p.textContent = 'Tus cálculos aparecerán aquí.';
    $('history-list').append(p); return;
  }
  for (const entry of history) {
    const title = entry.payload.network || entry.payload.base_network || `${entry.payload.networks.length} redes para agregar`;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'history-item';
    const date = new Date(entry.date).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    button.innerHTML = `<span class="history-icon" aria-hidden="true">↶</span><span><strong>${escape(title)}</strong><small>${escape(entry.mode.toUpperCase())} · ${escape(date)}</small></span>`;
    button.title = `Cargar ${entry.mode.toUpperCase()}: ${title}`;
    button.addEventListener('click', () => {
      switchMode(entry.mode);
      window.history.replaceState(null, '', `#${entry.mode}`);
      fillPayload(entry.payload);
      $('calculator-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Datos recuperados. Pulsa calcular para generar el resultado.');
    });
    $('history-list').append(button);
  }
}

function download(content, type, extension) {
  if (!calculation) return;
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `netsegment-${calculation.mode}-${calculation.date.slice(0, 10)}.${extension}`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setConnection(state, label) {
  $('connection').dataset.state = state;
  $('connection-label').textContent = label;
}

let healthPending = false;
async function checkHealth() {
  if (healthPending) return;
  healthPending = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/health', { signal: controller.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.status !== 'ok') throw new Error('Servicio no disponible');
    setConnection('online', 'Servicio disponible');
    $('connection').title = `Servicio disponible · versión ${data.version}. Pulsa para comprobar.`;
  } catch { setConnection('offline', 'Sin conexión · reintentar'); }
  finally { clearTimeout(timeout); healthPending = false; }
}

$('calculator-form').addEventListener('submit', calculate);
$('calculator-form').addEventListener('input', invalidate);
$('add-department').addEventListener('click', () => {
  addDepartment(); invalidate(); $('departments').lastElementChild?.querySelector('input').focus();
});
$('example-button').addEventListener('click', () => {
  fillPayload(modes[mode].example); toast('Ejemplo cargado. Pulsa calcular para ver el resultado.');
});
$('reset-button').addEventListener('click', () => {
  if (mode === 'flsm') { $('flsm-network').value = ''; $('flsm-count').value = ''; }
  else if (mode === 'vlsm') { $('vlsm-network').value = ''; $('departments').replaceChildren(); addDepartment(); }
  else $('cidr-networks').value = '';
  invalidate();
  $(mode === 'cidr' ? 'cidr-networks' : `${mode}-network`).focus();
});
$('result-search').addEventListener('input', () => { page = 0; renderTable(); });
$('previous-page').addEventListener('click', () => { page -= 1; renderTable(); });
$('next-page').addEventListener('click', () => { page += 1; renderTable(); });
$('export-csv').addEventListener('click', () => download(csvText(columns, rows), 'text/csv;charset=utf-8', 'csv'));
$('export-json').addEventListener('click', () => download(JSON.stringify(calculation, null, 2), 'application/json;charset=utf-8', 'json'));
$('copy-json').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('json-output').textContent); toast('JSON copiado al portapapeles.'); }
  catch { toast('No se pudo acceder al portapapeles. Puedes descargar el archivo JSON.'); }
});
$('print-result').addEventListener('click', () => window.print());
window.addEventListener('beforeprint', () => { if (calculation) renderTable(true); });
window.addEventListener('afterprint', () => { if (calculation) renderTable(); });
$('clear-history').addEventListener('click', () => {
  history = [];
  try { localStorage.removeItem(historyKey); } catch { /* La sesión puede continuar sin almacenamiento. */ }
  renderHistory(); toast('Historial local borrado.');
});
$('guide-button').addEventListener('click', () => $('guide-dialog').showModal());
$('mobile-guide').addEventListener('click', () => $('guide-dialog').showModal());
$('mobile-history').addEventListener('click', () => {
  const open = document.querySelector('.sidebar').classList.toggle('history-open');
  $('mobile-history').setAttribute('aria-expanded', String(open));
});
$('close-guide').addEventListener('click', () => $('guide-dialog').close());
$('guide-dialog').addEventListener('click', event => { if (event.target === $('guide-dialog')) $('guide-dialog').close(); });
$('connection').addEventListener('click', checkHealth);
window.addEventListener('hashchange', () => switchMode(location.hash.slice(1)));
window.addEventListener('online', checkHealth);
window.addEventListener('offline', () => setConnection('offline', 'Sin conexión'));
setInterval(() => { if (!document.hidden) checkHealth(); }, 30000);
addDepartment();
renderHistory();
switchMode(location.hash.slice(1));
checkHealth();
