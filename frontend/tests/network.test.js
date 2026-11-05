import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetwork, toAddress, positiveInteger, splitNetworks, validatePayload, csvText } from '../assets/network.js';

test('IPv4 conserva correctamente /0, /31, /32 y direcciones superiores a 2^31', () => {
  assert.equal(parseNetwork('0.0.0.0/0').size, 4294967296);
  assert.equal(parseNetwork('255.255.255.255/32').address, 4294967295);
  assert.equal(parseNetwork('192.168.1.0/31').size, 2);
  assert.equal(toAddress(4294967295), '255.255.255.255');
  assert.equal(toAddress(0), '0.0.0.0');
});

test('rechaza hosts activos, octetos inválidos, IPv6 y máscaras en lugar de prefijos', () => {
  for (const value of ['192.168.1.1/24', '10.0.0.300/24', '2001:db8::/64', '10.0.0.0/255.255.255.0', '010.0.0.0/8', '0.0.0.0/33', '']) {
    assert.throws(() => parseNetwork(value), value);
  }
});

test('cantidades enteras y límites del contrato', () => {
  assert.equal(positiveInteger('4096', 4096, 'Subredes'), 4096);
  for (const value of ['', '0', '-1', '1.5', '1e3', '4097', true, NaN]) {
    assert.throws(() => positiveInteger(value, 4096, 'Subredes'));
  }
});

test('redes CIDR por línea, coma o punto y coma; límites y mensaje por posición', () => {
  assert.deepEqual(splitNetworks('10.0.0.0/24,10.0.1.0/24;\n10.0.2.0/24'), ['10.0.0.0/24', '10.0.1.0/24', '10.0.2.0/24']);
  assert.throws(() => splitNetworks('10.0.0.0/24\n10.0.1.300/24'), /Red 2:/);
  assert.throws(() => splitNetworks(''), /al menos/);
  assert.throws(() => splitNetworks(Array(4097).fill('10.0.0.0/24').join('\n')), /máximo/);
});

test('VLSM exige nombres únicos, nombres válidos y hosts', () => {
  const base = { base_network: '172.16.0.0/22' };
  for (const departments of [[], [{ name: '', hosts_needed: 2 }], [{ name: 'a'.repeat(81), hosts_needed: 2 }], [{ name: 'A', hosts_needed: 2 }, { name: 'a', hosts_needed: 2 }], [{ name: 'A', hosts_needed: 0 }]]) {
    assert.throws(() => validatePayload('vlsm', { ...base, departments }));
  }
  assert.doesNotThrow(() => validatePayload('vlsm', { ...base, departments: [{ name: 'Ingeniería', hosts_needed: 500 }] }));
});

test('CSV conserva tildes, escapa comillas, saltos y fórmulas de hoja de cálculo', () => {
  const output = csvText(['Nombre', 'Hosts'], [['Ingeniería, "A"', 120], ['=1+1', 3], [' A\nB', 4]]);
  assert.ok(output.startsWith('\uFEFF'));
  assert.ok(output.includes('"Ingeniería, ""A"""'));
  assert.ok(output.includes('"\'=1+1"'));
  assert.ok(output.includes('" A\nB"'));
});
