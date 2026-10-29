const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../app.js');

class MemoryStorage {
  constructor(entries = []) { this.data = new Map(entries); this.failOnKey = null; }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (key === this.failOnKey) { this.failOnKey = null; throw new Error('quota'); }
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
}

const day1 = '2026-10-28';
const day2 = '2026-10-29';

function legacyRecord(date = day1) {
  const record = {
    fecha: date, turno: 'Nocturno', inicio: '20:30', fin: '23:30', supervisor: 'Supervisora',
    etq1: 'Ana', acom1: 'Beto', ind1: 'Caro', meta1: '1671',
    etq2: 'Dani', acom2: 'Eli', ind2: 'Fabi', meta2: '1671',
    reflujo_pescador: 'Gus', incidents: [['21:00', 'Isla A', 'Falta contenedor', 'Pendiente']]
  };
  for (const letter of ['a', 'b', 'c', 'd', 'f', 'g']) {
    record[`${letter}_pescador`] = `Pescador ${letter}`;
    record[`${letter}_contenedor`] = `Contenedor ${letter}`;
    record[`${letter}_num_contenedores`] = '8';
    record[`${letter}_meta`] = '341';
    record[`${letter}_cierre`] = false;
  }
  return record;
}

test('precarga la distribución actual y los puestos iniciales', () => {
  const record = Core.createDefaultRecord(day1);
  assert.deepEqual(record.labelers.map(item => item.name), ['Etiquetadoras 1 y 2', 'Etiquetadora 2']);
  assert.deepEqual(record.islands.map(item => item.name), ['Isla A', 'Isla B', 'Isla C', 'Isla D', 'Isla F', 'Isla G']);
  assert.deepEqual(record.labelers[0].people.map(person => person.role), ['Etiquetador', 'Acomodador', 'Inductor']);
  assert.deepEqual(record.islands[0].people.map(person => person.role), ['Pescador', 'Contenedorizador']);
  assert.equal(record.reflow.name, 'Reflujo');
  assert.equal(record.belt.label, 'BANDA TRANSPORTE · FLUJO CONTINUO');
});

test('permite agregar, quitar y reorganizar estaciones, etiquetadoras y puestos sin un límite fijo', () => {
  const record = Core.createDefaultRecord(day1);
  for (let index = 0; index < 18; index += 1) Core.addIsland(record, `Zona ${index + 1}`);
  for (let index = 0; index < 8; index += 1) Core.addLabeler(record, `Etiquetadora ${index + 3}`);
  for (let index = 0; index < 9; index += 1) Core.addPerson(record.labelers[0], `Inductor ${index + 1}`);
  assert.equal(record.islands.length, 24);
  assert.equal(record.labelers.length, 10);
  assert.equal(record.labelers[0].people.length, 12);
  const movedId = record.islands.at(-1).id;
  assert.equal(Core.moveItem(record.islands, movedId, -1), true);
  assert.equal(record.islands.at(-2).id, movedId);
  assert.equal(Core.removeItem(record.islands, movedId).name, 'Zona 18');
  const personId = record.labelers[0].people.at(-1).id;
  assert.equal(Core.removePerson(record.labelers[0], personId).role, 'Inductor 9');
  assert.equal(record.labelers[0].people.length, 11);
});

test('detecta nombres repetidos entre estaciones y puestos', () => {
  const record = Core.createDefaultRecord(day1);
  record.labelers[0].people[0].name = '  Ana Pérez ';
  record.islands[2].people[1].name = 'ana pérez';
  record.reflow.people[0].name = 'Marta';
  const duplicates = Core.findDuplicateAssignments(record);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].name, 'ana pérez');
  assert.equal(duplicates[0].assignments.length, 2);
});

test('un día nuevo no escribe valores vacíos sin que haya ocurrido un cambio', () => {
  const storage = new MemoryStorage();
  const loaded = Core.loadRecord(storage, day1);
  assert.equal(loaded.isNew, true);
  assert.equal(storage.length, 0);
  assert.equal(loaded.record.meta.supervisor, '');
});

test('guarda y recupera registros independientes al cambiar la fecha', () => {
  const storage = new MemoryStorage();
  const first = Core.createDefaultRecord(day1);
  first.meta.supervisor = 'Turno A';
  Core.saveRecord(storage, day1, first);
  const second = Core.loadRecord(storage, day2);
  second.record.meta.supervisor = 'Turno B';
  Core.saveRecord(storage, day2, second.record);
  assert.equal(Core.loadRecord(storage, day1).record.meta.supervisor, 'Turno A');
  assert.equal(Core.loadRecord(storage, day2).record.meta.supervisor, 'Turno B');
  assert.deepEqual(Core.storedDates(storage), [day2, day1]);
});

test('migración conserva los campos de respaldos anteriores', () => {
  const record = Core.migrateLegacyRecord(day1, legacyRecord());
  assert.equal(record.meta.supervisor, 'Supervisora');
  assert.equal(record.labelers[0].people[2].name, 'Caro');
  assert.equal(record.islands.find(item => item.name === 'Isla F').people[0].name, 'Pescador f');
  assert.equal(record.islands.find(item => item.name === 'Isla G').containerCount, '8');
  assert.deepEqual(record.incidents[0], { id: record.incidents[0].id, time: '21:00', location: 'Isla A', description: 'Falta contenedor', status: 'Pendiente' });
  const storage = new MemoryStorage([[Core.legacyKey(day1), JSON.stringify(legacyRecord())]]);
  const loaded = Core.loadRecord(storage, day1);
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.record.meta.supervisor, 'Supervisora');
  Core.saveRecord(storage, day1, loaded.record);
  assert.notEqual(storage.getItem(Core.currentKey(day1)), null);
  assert.notEqual(storage.getItem(Core.legacyKey(day1)), null);
});

test('rechaza respaldos inválidos antes de tocar almacenamiento', () => {
  const storage = new MemoryStorage([[Core.currentKey(day1), 'valor existente']]);
  const before = [...storage.data.entries()];
  assert.throws(() => Core.parseBackup('{"2026-02-31":{}}'), Core.DataValidationError);
  const legacy = legacyRecord(day1);
  legacy.incidents = [['solo', 'tres', 'campos']];
  assert.throws(() => Core.parseBackup(JSON.stringify({ [day1]: legacy })), /cuatro campos/);
  const invalid = Core.createDefaultRecord(day2);
  invalid.islands[0].containerCount = '-4';
  let invalidRecord;
  try { Core.parseBackup(JSON.stringify({ format: 'layout-pre-cargas', version: 2, records: { [day2]: invalid } })); }
  catch (error) { invalidRecord = error; }
  assert.ok(invalidRecord instanceof Core.DataValidationError);
  assert.ok(invalidRecord.details.some(detail => /número entero/.test(detail)));
  assert.deepEqual([...storage.data.entries()], before);
});

test('acepta la forma antigua del respaldo y conserva registros', () => {
  const parsed = Core.parseBackup(JSON.stringify({ [day1]: legacyRecord() }));
  assert.equal(parsed[day1].meta.supervisor, 'Supervisora');
  assert.equal(parsed[day1].islands.length, 6);
});

test('advierte conflictos y cancelar no sobrescribe el día existente', () => {
  const storage = new MemoryStorage();
  const original = Core.createDefaultRecord(day1);
  original.meta.supervisor = 'Registro original';
  Core.saveRecord(storage, day1, original);
  const incoming = Core.createDefaultRecord(day1);
  incoming.meta.supervisor = 'Respaldo nuevo';
  let receivedConflicts;
  const result = Core.importRecords(storage, { [day1]: incoming }, conflicts => { receivedConflicts = conflicts; return false; });
  assert.deepEqual(receivedConflicts, [day1]);
  assert.equal(result.cancelled, true);
  assert.equal(Core.loadRecord(storage, day1).record.meta.supervisor, 'Registro original');
});

test('sobrescritura solo ocurre después de confirmarse', () => {
  const storage = new MemoryStorage();
  const incoming = Core.createDefaultRecord(day1);
  incoming.meta.supervisor = 'Respaldo confirmado';
  assert.equal(Core.importRecords(storage, { [day1]: incoming }, () => true).imported, true);
  assert.equal(Core.loadRecord(storage, day1).record.meta.supervisor, 'Respaldo confirmado');
});

test('revierte una importación si el almacenamiento falla a mitad de escritura', () => {
  const storage = new MemoryStorage();
  const before = Core.createDefaultRecord(day1);
  before.meta.supervisor = 'Antes';
  Core.saveRecord(storage, day1, before);
  const day2Record = Core.createDefaultRecord(day2);
  storage.failOnKey = Core.currentKey(day2);
  assert.throws(() => Core.importRecords(storage, { [day1]: Core.createDefaultRecord(day1), [day2]: day2Record }, () => true), /restauraron/);
  assert.equal(Core.loadRecord(storage, day1).record.meta.supervisor, 'Antes');
  assert.equal(storage.getItem(Core.currentKey(day2)), null);
});

test('lectura dañada bloquea el guardado y conserva el valor original', () => {
  const damaged = '{bad-json';
  const storage = new MemoryStorage([[Core.currentKey(day1), damaged]]);
  assert.throws(() => Core.loadRecord(storage, day1), /está dañado/);
  assert.equal(storage.getItem(Core.currentKey(day1)), damaged);
});

test('exportación nueva se valida y puede volver a importarse', () => {
  const record = Core.createDefaultRecord(day1);
  record.islands[0].people[0].name = 'Operador';
  const encoded = Core.serializeBackup({ [day1]: record }, '2026-10-28T12:00:00.000Z');
  const parsed = Core.parseBackup(encoded);
  assert.equal(parsed[day1].islands[0].people[0].name, 'Operador');
  assert.throws(() => Core.serializeBackup({ [day1]: { ...record, date: day2 } }), Core.DataValidationError);
});

test('diseño incluye puntos de quiebre móvil, impresión horizontal y controles de edición fuera de impresión', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(css, /@media\s*\(max-width:\s*560px\)/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@page\s*\{[^}]*size:\s*A4\s+landscape/s);
  assert.match(css, /\.toolbar,\.editor-only,\.toast,dialog\{display:none!important\}/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="upperFlow"/);
  assert.match(html, /id="lowerFlow"/);
  assert.match(html, /ANTES DE LA BANDA/);
  assert.match(html, /DESPUÉS DE LA BANDA/);
  assert.match(html, /localStorage|no se sincronizan/i);
});

