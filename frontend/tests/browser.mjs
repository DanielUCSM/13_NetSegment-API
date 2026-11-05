import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.PYTHON || join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const port = process.env.E2E_PORT || '18080';
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const output = await mkdtemp(join(tmpdir(), 'netsegment-browser-'));
let server;
let serverLog = '';
let browser;
let count = 0;
const pageErrors = [];

async function check(name, action) { await action(); count += 1; console.log(`PASS ${name}`); }

try {
  if (!process.env.BASE_URL) {
    server = spawn(python, ['-m', 'app'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: port, LOG_LEVEL: 'warning' }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.on('error', error => { serverLog += error.message; });
    server.stderr.on('data', chunk => { serverLog += chunk; });
  }
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* Esperar al servidor de pruebas. */ }
    if (server?.exitCode !== null && server?.exitCode !== undefined) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`No inició el backend de pruebas. ${serverLog}`);
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? {
    executablePath: process.env.BROWSER_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--use-gl=angle', '--use-angle=swiftshader'],
  } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  const external = [];
  page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
  const calculate = async () => { await page.click('#calculate-button'); await page.waitForSelector('#result-state[data-state=success]'); };
  const tool = async name => { await page.click(`[data-mode="${name}"]`); await page.waitForSelector(`#${name}-fields:not([hidden])`); };
  await page.goto(base);
  await check('interfaz, recursos locales y disponibilidad del backend', async () => {
    await page.waitForSelector('#connection[data-state=online]');
    assert.match(await page.title(), /FLSM/);
    assert.equal(external.length, 0);
  });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'inicio.png'), fullPage: true });
  await check('FLSM real: cuatro /26 y 62 hosts', async () => {
    await page.click('#example-button'); await calculate();
    assert.equal(await page.locator('#result-table tbody tr').count(), 4);
    assert.match(await page.locator('#result-summary').innerText(), /62/);
    assert.match(await page.locator('#result-table').innerText(), /192\.168\.10\.255/);
  });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'flsm.png'), fullPage: true });
  await check('búsqueda y descarga JSON con todas las subredes', async () => {
    await page.fill('#result-search', '192.168.10.64');
    assert.equal(await page.locator('#result-table tbody tr').count(), 1);
    const downloaded = page.waitForEvent('download'); await page.click('#export-json');
    const file = await downloaded; await file.saveAs(join(output, 'plan.json'));
    const json = JSON.parse(await readFile(join(output, 'plan.json'), 'utf8'));
    assert.equal(json.response.data.subnets.length, 4);
    assert.equal(json.payload.subnets_needed, 4);
  });
  await check('FLSM redondea tres subredes a cuatro y lo explica', async () => {
    await page.fill('#flsm-count', '3'); await calculate();
    assert.match(await page.locator('#result-note').innerText(), /generan 4/);
  });
  await check('paginación y exportación CSV completa', async () => {
    await page.fill('#flsm-count', '64'); await calculate();
    assert.equal(await page.locator('#result-table tbody tr').count(), 25);
    await page.click('#next-page'); assert.match(await page.locator('#page-info').innerText(), /26–50/);
    const downloaded = page.waitForEvent('download'); await page.click('#export-csv');
    const file = await downloaded; await file.saveAs(join(output, 'plan.csv'));
    assert.equal((await readFile(join(output, 'plan.csv'), 'utf8')).split('\r\n').length, 65);
  });
  await check('impresión incluye todas las filas y restaura la paginación', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#result-table tbody tr').count(), 64);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('#result-table tbody tr').count(), 25);
  });
  await check('IPv4 inválida y campos vacíos muestran un error corregible', async () => {
    await page.fill('#flsm-network', '192.168.1.300/24'); await page.click('#calculate-button');
    assert.match(await page.locator('#form-error').innerText(), /octeto/);
    await page.click('#reset-button'); await page.click('#calculate-button');
    assert.match(await page.locator('#form-error').innerText(), /CIDR/);
    assert.equal(await page.locator('#results-content').isVisible(), false);
  });
  await check('VLSM real: 708 direcciones asignadas y 316 libres', async () => {
    await tool('vlsm'); await page.click('#example-button'); await calculate();
    assert.match(await page.locator('#result-summary').innerText(), /708/);
    assert.match(await page.locator('#result-summary').innerText(), /316/);
    assert.match(await page.locator('#result-table').innerText(), /172\.16\.2\.192\/30/);
  });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'vlsm.png'), fullPage: true });
  await check('VLSM permite añadir y eliminar segmentos', async () => {
    await page.click('#add-department'); assert.equal(await page.locator('.department-row').count(), 5);
    await page.locator('.department-row').last().locator('button').click();
    assert.equal(await page.locator('.department-row').count(), 4);
  });
  await check('VLSM rechaza nombres repetidos y conserva el formulario', async () => {
    await page.locator('.department-row input[type=text]').nth(1).fill('Ingeniería');
    await page.click('#calculate-button'); assert.match(await page.locator('#form-error').innerText(), /repetido/);
  });
  await check('error HTTP 400 por capacidad insuficiente y recuperación', async () => {
    await page.click('#example-button'); await page.fill('#vlsm-network', '172.16.0.0/24');
    await page.click('#calculate-button'); await page.waitForSelector('#form-error:not([hidden])');
    assert.match(await page.locator('#form-error').innerText(), /capacidad/);
    assert.equal(await page.locator('#results-content').isVisible(), false);
    await page.fill('#vlsm-network', '172.16.0.0/22'); await calculate();
  });
  await check('los nombres se muestran como texto y no como HTML', async () => {
    await page.locator('.department-row input[type=text]').first().fill('<img src=x onerror="window.injected=1">');
    await calculate(); assert.equal(await page.locator('#result-table img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.match(await page.locator('#result-table').innerText(), /<img/);
  });
  await check('CIDR real: cuatro /24 forman /22 y reducen rutas en 75 %', async () => {
    await tool('cidr'); await page.click('#example-button'); await calculate();
    assert.match(await page.locator('#result-summary').innerText(), /192\.168\.0\.0\/22/);
    assert.match(await page.locator('#result-summary').innerText(), /75\.0%/);
  });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'cidr.png'), fullPage: true });
  await check('CIDR rechaza solapamientos y bloques desalineados', async () => {
    await page.fill('#cidr-networks', '10.0.0.0/24\n10.0.0.0/25'); await page.click('#calculate-button');
    await page.waitForSelector('#form-error:not([hidden])'); assert.match(await page.locator('#form-error').innerText(), /solapan/);
    await page.fill('#cidr-networks', '10.0.1.0/24\n10.0.2.0/24'); await page.click('#calculate-button');
    await page.waitForFunction(() => document.getElementById('form-error').textContent.includes('alineada'));
  });
  await check('CIDR admite un /32 y máscara 255.255.255.255', async () => {
    await page.fill('#cidr-networks', '255.255.255.255/32'); await calculate();
    assert.match(await page.locator('#result-table').innerText(), /255\.255\.255\.255/);
  });
  await check('historial persiste y recupera los parámetros de entrada', async () => {
    await page.reload(); await page.waitForSelector('.history-item');
    await page.locator('.history-item').first().click();
    assert.equal(await page.locator('#cidr-networks').inputValue(), '255.255.255.255/32');
    await calculate();
  });
  await check('un fallo de conexión muestra un error y permite reintentar', async () => {
    await page.route('**/api/v1/supernetting/aggregate', route => route.abort('failed'));
    await page.click('#calculate-button'); await page.waitForSelector('#form-error:not([hidden])');
    assert.match(await page.locator('#form-error').innerText(), /conectar/);
    assert.equal(await page.locator('#cidr-networks').inputValue(), '255.255.255.255/32');
    await page.unroute('**/api/v1/supernetting/aggregate'); await calculate();
  });
  await check('cambiar de herramienta cancela un cálculo pendiente', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/supernetting/aggregate', async route => { await gate; await route.continue().catch(() => {}); });
    await page.click('#calculate-button'); await page.waitForSelector('#loading-state:not([hidden])');
    await tool('flsm'); release(); await page.unroute('**/api/v1/supernetting/aggregate');
    await page.waitForTimeout(100); assert.equal(await page.locator('#results-content').isVisible(), false);
    assert.match(await page.title(), /FLSM/);
  });
  await check('vista móvil, guía, historial y cálculo sin desbordamiento', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#mobile-guide'); assert.equal(await page.locator('#guide-dialog').isVisible(), true);
    await page.keyboard.press('Escape'); await page.click('#mobile-history');
    assert.equal(await page.locator('#history-list').isVisible(), true);
    await page.click('#mobile-history'); await page.click('#example-button'); await calculate();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'movil.png'), fullPage: true });
  await check('un historial corrupto no impide usar la aplicación', async () => {
    await page.evaluate(() => localStorage.setItem('netsegment.history.v1', 'incorrecto'));
    await page.reload(); await page.waitForSelector('#connection[data-state=online]');
    await page.click('#example-button'); await calculate();
  });
  await check('la aplicación funciona si el navegador bloquea guardar el historial', async () => {
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage bloqueado'); }; });
    await calculate(); assert.equal(await page.locator('#results-content').isVisible(), true);
  });
  assert.deepEqual(pageErrors, []);
  assert.equal(external.length, 0);
  console.log(`${count} comprobaciones de navegador correctas. Sin errores JavaScript ni dependencias de red externas.`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(output, { recursive: true, force: true });
}
