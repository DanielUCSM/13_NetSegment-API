export function parseNetwork(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text);
  if (!match) throw new Error('Usa una red IPv4 en formato CIDR, por ejemplo 192.168.10.0/24.');
  const octets = match.slice(1, 5);
  if (octets.some(part => Number(part) > 255 || String(Number(part)) !== part)) {
    throw new Error('Cada octeto debe estar entre 0 y 255, sin ceros a la izquierda.');
  }
  const prefix = Number(match[5]);
  if (prefix > 32) throw new Error('El prefijo CIDR debe estar entre 0 y 32.');
  const address = octets.reduce((total, part) => total * 256 + Number(part), 0);
  const size = 2 ** (32 - prefix);
  if (address % size !== 0) throw new Error('Introduce la dirección de red, sin bits de host activos. Ejemplo: 192.168.10.0/24.');
  return { text, prefix, address, size, last: address + size - 1 };
}

export function toAddress(number) {
  return [24, 16, 8, 0].map(shift => Math.floor(number / 2 ** shift) % 256).join('.');
}

export function positiveInteger(value, max, label) {
  const text = String(value ?? '').trim();
  const number = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(number) || number > max) {
    throw new Error(`${label}: introduce un número entero entre 1 y ${max.toLocaleString('es-PE')}.`);
  }
  return number;
}

export function splitNetworks(text) {
  const lines = text.trim().split(/[\r\n,;]+/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Introduce al menos una red para agregar.');
  if (lines.length > 4096) throw new Error('Puedes agregar como máximo 4 096 redes.');
  lines.forEach((line, index) => {
    try { parseNetwork(line); } catch (error) { throw new Error(`Red ${index + 1}: ${error.message}`); }
  });
  return lines;
}

export function validatePayload(mode, payload) {
  if (mode === 'flsm') {
    parseNetwork(payload.network);
    positiveInteger(payload.subnets_needed, 4096, 'Subredes');
  } else if (mode === 'vlsm') {
    parseNetwork(payload.base_network);
    if (!Array.isArray(payload.departments) || !payload.departments.length || payload.departments.length > 1024) {
      throw new Error('Introduce entre 1 y 1 024 segmentos.');
    }
    const names = new Set();
    payload.departments.forEach((department, index) => {
      const name = String(department.name ?? '').trim();
      if (!name || name.length > 80) throw new Error(`Segmento ${index + 1}: el nombre debe tener entre 1 y 80 caracteres.`);
      if (names.has(name.toLocaleLowerCase())) throw new Error(`El nombre «${name}» está repetido. Usa nombres únicos.`);
      names.add(name.toLocaleLowerCase());
      positiveInteger(department.hosts_needed, 4294967294, `Hosts de ${name}`);
    });
  } else if (mode === 'cidr') {
    if (!Array.isArray(payload.networks)) throw new Error('Introduce las redes a agregar.');
    splitNetworks(payload.networks.join('\n'));
  } else throw new Error('Herramienta desconocida.');
  return payload;
}

export function csvText(columns, rows) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}
