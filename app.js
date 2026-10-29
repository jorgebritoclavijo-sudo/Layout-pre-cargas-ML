(() => {
  'use strict';

  const VERSION = 2;
  const LEGACY_PREFIX = 'layoutPreCargas:';
  const CURRENT_PREFIX = 'layoutPreCargas:v2:';
  const COLORS = ['blue', 'green', 'purple', 'teal', 'orange'];
  const DEFAULT_ISLANDS = ['A', 'B', 'C', 'D', 'F', 'G'];
  let idCounter = 0;

  class DataValidationError extends Error {
    constructor(message, details = []) {
      super(message);
      this.name = 'DataValidationError';
      this.details = details;
    }
  }

  class StorageReadError extends Error {
    constructor(message, cause) {
      super(message, { cause });
      this.name = 'StorageReadError';
    }
  }

  function makeId(prefix = 'item') {
    idCounter += 1;
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${prefix}-${uuid || `${Date.now().toString(36)}-${idCounter.toString(36)}`}`;
  }

  function localDateString(now = new Date()) {
    const date = new Date(now);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function isDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function createPerson(role = '', name = '') {
    return { id: makeId('person'), role, name };
  }

  function createLabeler(name, side = 'upper', roles = ['Etiquetador', 'Acomodador', 'Inductor']) {
    return {
      id: makeId('labeler'),
      name,
      side,
      target: '1671',
      unit: 'paquetes/h',
      people: roles.map(role => createPerson(role, ''))
    };
  }

  function createIsland(name, color = 'blue', side = 'upper') {
    return {
      id: makeId('island'),
      name,
      color,
      side,
      target: '341',
      containerCount: '',
      closeComplete: false,
      people: [createPerson('Pescador', ''), createPerson('Contenedorizador', '')]
    };
  }

  function createDefaultRecord(date = localDateString()) {
    return {
      version: VERSION,
      date,
      meta: { turno: 'Nocturno', inicio: '20:30', fin: '23:30', supervisor: '' },
      belt: { label: 'BANDA TRANSPORTE · FLUJO CONTINUO' },
      labelers: [createLabeler('Etiquetadoras 1 y 2', 'upper'), createLabeler('Etiquetadora 2', 'lower')],
      islands: DEFAULT_ISLANDS.map((letter, index) => createIsland(`Isla ${letter}`, COLORS[index % COLORS.length], index % 2 === 0 ? 'upper' : 'lower')),
      reflow: { name: 'Reflujo', people: [createPerson('Pescador', '')] },
      incidents: [createIncident(), createIncident(), createIncident()]
    };
  }

  function createIncident() {
    return { id: makeId('incident'), time: '', location: '', description: '', status: '' };
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function requireText(value, label, errors, { empty = true } = {}) {
    if (typeof value !== 'string') errors.push(`${label}: se esperaba texto.`);
    else if (!empty && value.trim() === '') errors.push(`${label}: no puede estar vacío.`);
  }

  function validateNumberText(value, label, errors, { integer = false } = {}) {
    if (value === '') return;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
      errors.push(`${label}: usa un número ${integer ? 'entero ' : ''}igual o mayor que cero.`);
    }
  }

  function validatePeople(people, label, errors, ids) {
    if (!Array.isArray(people)) {
      errors.push(`${label}: la lista de personas debe ser una lista.`);
      return;
    }
    people.forEach((person, index) => {
      const itemLabel = `${label}, persona ${index + 1}`;
      if (!isObject(person)) {
        errors.push(`${itemLabel}: registro inválido.`);
        return;
      }
      requireText(person.id, `${itemLabel}, identificador`, errors, { empty: false });
      requireText(person.role, `${itemLabel}, puesto`, errors);
      requireText(person.name, `${itemLabel}, nombre`, errors);
      if (typeof person.id === 'string') {
        if (ids.has(person.id)) errors.push(`${itemLabel}: identificador repetido.`);
        ids.add(person.id);
      }
    });
  }

  function validateRecord(record, expectedDate) {
    const errors = [];
    if (!isObject(record)) throw new DataValidationError('El registro no es un objeto válido.');
    if (record.version !== VERSION) errors.push(`Versión de registro no compatible: ${record.version ?? 'sin versión'}.`);
    if (!isDateKey(record.date) || (expectedDate && record.date !== expectedDate)) errors.push('La fecha del registro no coincide o no es válida.');
    if (!isObject(record.meta)) errors.push('Faltan los datos del turno.');
    else ['turno', 'inicio', 'fin', 'supervisor'].forEach(key => requireText(record.meta[key], `Datos del turno: ${key}`, errors));
    if (!isObject(record.belt)) errors.push('Falta la configuración de la banda.');
    else requireText(record.belt.label, 'Nombre de la banda', errors, { empty: false });

    const ids = new Set();
    for (const groupName of ['labelers', 'islands']) {
      const group = record[groupName];
      if (!Array.isArray(group)) {
        errors.push(`${groupName}: se esperaba una lista.`);
        continue;
      }
      group.forEach((item, index) => {
        const label = `${groupName === 'labelers' ? 'Etiquetadora' : 'Estación'} ${index + 1}`;
        if (!isObject(item)) {
          errors.push(`${label}: registro inválido.`);
          return;
        }
        requireText(item.id, `${label}, identificador`, errors, { empty: false });
        requireText(item.name, `${label}, nombre`, errors, { empty: false });
        if (item.side !== 'upper' && item.side !== 'lower') errors.push(`${label}: lado del flujo no reconocido.`);
        if (ids.has(item.id)) errors.push(`${label}: identificador repetido.`);
        ids.add(item.id);
        if (groupName === 'labelers') {
          requireText(item.target, `${label}, meta`, errors);
          validateNumberText(item.target, `${label}, meta`, errors);
          requireText(item.unit, `${label}, unidad`, errors, { empty: false });
        } else {
          if (typeof item.color !== 'string' || !COLORS.includes(item.color)) errors.push(`${label}: color no reconocido.`);
          requireText(item.target, `${label}, objetivo`, errors);
          validateNumberText(item.target, `${label}, objetivo`, errors);
          requireText(item.containerCount, `${label}, número de contenedores`, errors);
          validateNumberText(item.containerCount, `${label}, número de contenedores`, errors, { integer: true });
          if (typeof item.closeComplete !== 'boolean') errors.push(`${label}: el cierre debe ser verdadero o falso.`);
        }
        validatePeople(item.people, label, errors, ids);
      });
    }
    if (!isObject(record.reflow)) errors.push('Falta la zona de reflujo.');
    else {
      requireText(record.reflow.name, 'Nombre de reflujo', errors, { empty: false });
      validatePeople(record.reflow.people, 'Reflujo', errors, ids);
    }
    if (!Array.isArray(record.incidents)) errors.push('Las incidencias deben ser una lista.');
    else record.incidents.forEach((incident, index) => {
      const label = `Incidencia ${index + 1}`;
      if (!isObject(incident)) {
        errors.push(`${label}: registro inválido.`);
        return;
      }
      requireText(incident.id, `${label}, identificador`, errors, { empty: false });
      ['time', 'location', 'description', 'status'].forEach(key => requireText(incident[key], `${label}, ${key}`, errors));
      if (ids.has(incident.id)) errors.push(`${label}: identificador repetido.`);
      ids.add(incident.id);
    });
    if (errors.length) throw new DataValidationError(`El registro del ${expectedDate || record.date || 'día'} tiene errores.`, errors);
    return record;
  }

  function legacyString(record, key, fallback = '') {
    const value = record[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    throw new DataValidationError(`El campo anterior "${key}" no contiene texto válido.`);
  }

  function legacyBoolean(record, key, fallback = false) {
    const value = record[key];
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 0 || value === 1) return Boolean(value);
    if (value === 'true' || value === 'false') return value === 'true';
    throw new DataValidationError(`El campo anterior "${key}" no contiene un cierre válido.`);
  }

  function migrateLegacyRecord(date, legacy) {
    if (!isDateKey(date) || !isObject(legacy)) throw new DataValidationError(`El registro anterior del ${date} no es válido.`);
    const record = createDefaultRecord(date);
    record.meta.turno = legacyString(legacy, 'turno', record.meta.turno);
    record.meta.inicio = legacyString(legacy, 'inicio', record.meta.inicio);
    record.meta.fin = legacyString(legacy, 'fin', record.meta.fin);
    record.meta.supervisor = legacyString(legacy, 'supervisor');
    record.labelers[0].target = legacyString(legacy, 'meta1', '1671');
    record.labelers[0].people.forEach((person, index) => { person.name = legacyString(legacy, ['etq1', 'acom1', 'ind1'][index]); });
    record.labelers[1].target = legacyString(legacy, 'meta2', '1671');
    record.labelers[1].people.forEach((person, index) => { person.name = legacyString(legacy, ['etq2', 'acom2', 'ind2'][index]); });
    record.islands.forEach(island => {
      const letter = island.name.slice(-1).toLowerCase();
      island.target = legacyString(legacy, `${letter}_meta`, '341');
      island.containerCount = legacyString(legacy, `${letter}_num_contenedores`);
      island.closeComplete = legacyBoolean(legacy, `${letter}_cierre`);
      island.people[0].name = legacyString(legacy, `${letter}_pescador`);
      island.people[1].name = legacyString(legacy, `${letter}_contenedor`);
    });
    record.reflow.people[0].name = legacyString(legacy, 'reflujo_pescador');
    if (legacy.incidents !== undefined) {
      if (!Array.isArray(legacy.incidents)) throw new DataValidationError('Las incidencias del respaldo anterior deben ser una lista.');
      record.incidents = legacy.incidents.map((row, index) => {
        if (!Array.isArray(row) || row.length !== 4 || row.some(value => typeof value !== 'string')) {
          throw new DataValidationError(`La incidencia anterior ${index + 1} debe tener cuatro campos de texto.`);
        }
        return { id: makeId('incident'), time: row[0], location: row[1], description: row[2], status: row[3] };
      });
    }
    return validateRecord(record, date);
  }

  function parseBackup(text) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new DataValidationError('El respaldo no contiene JSON válido.'); }
    if (!isObject(parsed)) throw new DataValidationError('El archivo de respaldo debe contener un objeto.');
    let records;
    if (parsed.format === 'layout-pre-cargas' && parsed.version === VERSION && isObject(parsed.records)) {
      records = Object.entries(parsed.records).map(([date, record]) => [date, validateRecord(record, date)]);
    } else if (!Object.prototype.hasOwnProperty.call(parsed, 'format')) {
      records = Object.entries(parsed).map(([date, record]) => [date, migrateLegacyRecord(date, record)]);
    } else {
      throw new DataValidationError('La versión o estructura del respaldo no es compatible.');
    }
    if (!records.length) throw new DataValidationError('El respaldo no contiene registros para importar.');
    return Object.fromEntries(records);
  }

  function serializeBackup(records, exportedAt = new Date().toISOString()) {
    const checked = {};
    for (const [date, record] of Object.entries(records)) checked[date] = validateRecord(record, date);
    return JSON.stringify({ format: 'layout-pre-cargas', version: VERSION, exportedAt, records: checked }, null, 2);
  }

  function currentKey(date) { return `${CURRENT_PREFIX}${date}`; }
  function legacyKey(date) { return `${LEGACY_PREFIX}${date}`; }

  function loadRecord(storage, date) {
    if (!isDateKey(date)) throw new DataValidationError('La fecha seleccionada no es válida.');
    let currentRaw;
    let oldRaw;
    try {
      currentRaw = storage.getItem(currentKey(date));
      if (currentRaw === null) oldRaw = storage.getItem(legacyKey(date));
    } catch (error) {
      throw new StorageReadError('No se pudo leer el almacenamiento local. No se guardaron datos vacíos.', error);
    }
    if (currentRaw !== null) {
      let record;
      try { record = JSON.parse(currentRaw); }
      catch { throw new DataValidationError(`El registro guardado del ${date} está dañado. Se dejó intacto.`); }
      return { record: validateRecord(record, date), migrated: false, isNew: false };
    }
    if (oldRaw !== null) {
      let legacy;
      try { legacy = JSON.parse(oldRaw); }
      catch { throw new DataValidationError(`El registro anterior del ${date} está dañado. Se dejó intacto.`); }
      return { record: migrateLegacyRecord(date, legacy), migrated: true, isNew: false };
    }
    return { record: createDefaultRecord(date), migrated: false, isNew: true };
  }

  function saveRecord(storage, date, record) {
    const checked = validateRecord(record, date);
    try { storage.setItem(currentKey(date), JSON.stringify(checked)); }
    catch (error) { throw new Error('No se pudo guardar. El registro sigue en pantalla; revisa el espacio disponible.', { cause: error }); }
    return checked;
  }

  function storedDates(storage) {
    const dates = new Set();
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      let date = null;
      if (key.startsWith(CURRENT_PREFIX)) date = key.slice(CURRENT_PREFIX.length);
      else if (key.startsWith(LEGACY_PREFIX) && !key.startsWith(`${LEGACY_PREFIX}v2:`)) date = key.slice(LEGACY_PREFIX.length);
      if (isDateKey(date)) dates.add(date);
    }
    return [...dates].sort().reverse();
  }

  function importRecords(storage, records, confirmOverwrite = () => true) {
    const checked = {};
    for (const [date, record] of Object.entries(records)) checked[date] = validateRecord(record, date);
    const conflicts = Object.keys(checked).filter(date => storage.getItem(currentKey(date)) !== null || storage.getItem(legacyKey(date)) !== null);
    if (conflicts.length && !confirmOverwrite(conflicts)) return { imported: false, cancelled: true, conflicts };
    const previous = new Map();
    try {
      for (const [date, record] of Object.entries(checked)) {
        const key = currentKey(date);
        previous.set(key, storage.getItem(key));
        storage.setItem(key, JSON.stringify(record));
      }
    } catch (error) {
      let rollbackFailed = false;
      for (const [key, oldValue] of previous) {
        try { oldValue === null ? storage.removeItem(key) : storage.setItem(key, oldValue); }
        catch { rollbackFailed = true; }
      }
      throw new Error(rollbackFailed ? 'Falló la importación y no se pudo completar la reversión. No cierres el navegador; exporta lo que aún esté disponible.' : 'Falló la importación. Se restauraron los valores que había antes.', { cause: error });
    }
    return { imported: true, cancelled: false, conflicts: [] };
  }

  function addLabeler(record, name = `Etiquetadora ${record.labelers.length + 1}`) {
    const upper = record.labelers.filter(labeler => labeler.side === 'upper').length;
    const lower = record.labelers.length - upper;
    const item = createLabeler(name, upper <= lower ? 'upper' : 'lower');
    record.labelers.push(item);
    return item;
  }

  function addIsland(record, name = `Isla ${record.islands.length + 1}`) {
    const upper = record.islands.filter(island => island.side === 'upper').length;
    const lower = record.islands.length - upper;
    const item = createIsland(name, COLORS[record.islands.length % COLORS.length], upper <= lower ? 'upper' : 'lower');
    record.islands.push(item);
    return item;
  }

  function addPerson(group, role = 'Nuevo puesto') {
    const item = createPerson(role, '');
    group.people.push(item);
    return item;
  }

  function findDuplicateAssignments(record) {
    const names = new Map();
    const groups = [...record.labelers.map(item => ({ label: item.name, people: item.people })), ...record.islands.map(item => ({ label: item.name, people: item.people })), { label: record.reflow.name, people: record.reflow.people }];
    groups.forEach(group => group.people.forEach(person => {
      const name = person.name.trim().toLocaleLowerCase('es');
      if (!name) return;
      const entries = names.get(name) || [];
      entries.push(`${group.label} · ${person.role || 'Sin puesto'}`);
      names.set(name, entries);
    }));
    return [...names.entries()].filter(([, entries]) => entries.length > 1).map(([name, entries]) => ({ name, assignments: entries }));
  }

  function moveItem(list, id, direction) {
    const index = list.findIndex(item => item.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= list.length) return false;
    [list[index], list[next]] = [list[next], list[index]];
    return true;
  }

  function moveItemWithinSide(list, id, direction) {
    const item = list.find(entry => entry.id === id);
    if (!item) return false;
    const positions = list.map((entry, index) => entry.side === item.side ? index : -1).filter(index => index >= 0);
    const groupPosition = positions.indexOf(list.indexOf(item));
    const nextPosition = groupPosition + direction;
    if (groupPosition < 0 || nextPosition < 0 || nextPosition >= positions.length) return false;
    const currentIndex = positions[groupPosition];
    const nextIndex = positions[nextPosition];
    [list[currentIndex], list[nextIndex]] = [list[nextIndex], list[currentIndex]];
    return true;
  }

  function removeItem(list, id) {
    const index = list.findIndex(item => item.id === id);
    if (index < 0) return null;
    return list.splice(index, 1)[0];
  }

  function removePerson(group, id) {
    return removeItem(group.people, id);
  }

  const Core = {
    VERSION, LEGACY_PREFIX, CURRENT_PREFIX, COLORS, DEFAULT_ISLANDS,
    DataValidationError, StorageReadError, createDefaultRecord, createIncident, createPerson, createLabeler, createIsland,
    isDateKey, localDateString, validateRecord, migrateLegacyRecord, parseBackup, serializeBackup, currentKey, legacyKey,
    loadRecord, saveRecord, storedDates, importRecords, addLabeler, addIsland, addPerson, findDuplicateAssignments, moveItem, moveItemWithinSide, removeItem, removePerson
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') startApp(Core);

  function startApp(core) {
    const $ = selector => document.querySelector(selector);
    const nodes = {
      date: $('#fecha'), history: $('#historyDates'), status: $('#saveState'), upperFlow: $('#upperFlow'), lowerFlow: $('#lowerFlow'), incidents: $('#incidentRows'), warnings: $('#statusWarnings'), toast: $('#toast'), importFile: $('#importFile')
    };
    let currentDate = localDateString();
    let currentRecord = null;
    let readOnly = false;
    let toastTimer;
    nodes.date.value = currentDate;

    function escapeHTML(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function getPath(path) { return path.split('.').reduce((value, key) => value?.[key], currentRecord); }
    function setPath(path, value) {
      const parts = path.split('.');
      const last = parts.pop();
      const target = parts.reduce((object, key) => object[key], currentRecord);
      target[last] = value;
    }

    function announce(message, error = false) {
      nodes.status.textContent = message;
      nodes.status.classList.toggle('status-error', error);
    }

    function toast(message) {
      nodes.toast.textContent = message;
      nodes.toast.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { nodes.toast.textContent = ''; nodes.toast.classList.remove('visible'); }, 3600);
    }

    function showWarnings() {
      nodes.warnings.replaceChildren();
      if (readOnly) {
        const error = document.createElement('div');
        error.className = 'data-warning data-error';
        error.textContent = 'No pude recuperar este día. Dejé el almacenamiento intacto y bloqueé la edición para evitar sobrescribirlo. Cambia la fecha o importa un respaldo válido.';
        nodes.warnings.append(error);
        return;
      }
      if (!currentRecord) return;
      const duplicates = core.findDuplicateAssignments(currentRecord);
      if (!duplicates.length) return;
      const warning = document.createElement('div');
      warning.className = 'duplicate-warning';
      warning.textContent = duplicates.map(item => `Nombre repetido “${item.name}”: ${item.assignments.join(', ')}`).join(' · ');
      nodes.warnings.append(warning);
    }

    function renderPeople(people, path, collection, itemId) {
      return `<div class="people-list">${people.map((person, index) => `<div class="person-row">
        <input class="person-role" type="text" data-bind="${path}.${index}.role" value="${escapeHTML(person.role)}" placeholder="Puesto" aria-label="Puesto">
        <input class="person-name" type="text" data-bind="${path}.${index}.name" value="${escapeHTML(person.name)}" placeholder="Nombre de la persona" aria-label="Nombre de la persona">
        <span class="person-actions editor-only">
          <button class="icon-button" type="button" data-action="move-person" data-collection="${collection}" data-item-id="${escapeHTML(itemId)}" data-person-id="${escapeHTML(person.id)}" data-direction="-1" aria-label="Mover ${escapeHTML(person.role || 'persona')} arriba" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-button" type="button" data-action="move-person" data-collection="${collection}" data-item-id="${escapeHTML(itemId)}" data-person-id="${escapeHTML(person.id)}" data-direction="1" aria-label="Mover ${escapeHTML(person.role || 'persona')} abajo" ${index === people.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-button" type="button" data-action="remove-person" data-collection="${collection}" data-item-id="${escapeHTML(itemId)}" data-person-id="${escapeHTML(person.id)}" aria-label="Quitar persona o puesto">×</button>
        </span>
      </div>`).join('')}</div><button class="person-add editor-only" type="button" data-action="add-person" data-collection="${collection}" data-item-id="${escapeHTML(itemId)}">＋ Agregar persona / puesto</button>`;
    }

    function cardActions(collection, item) {
      const group = currentRecord[collection];
      const peers = group.filter(entry => entry.side === item.side);
      const position = peers.findIndex(entry => entry.id === item.id);
      return `<span class="card-actions editor-only">
        <button class="icon-button" type="button" data-action="move-item" data-collection="${collection}" data-item-id="${escapeHTML(item.id)}" data-direction="-1" aria-label="Mover ${escapeHTML(item.name)} antes" ${position === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button" type="button" data-action="move-item" data-collection="${collection}" data-item-id="${escapeHTML(item.id)}" data-direction="1" aria-label="Mover ${escapeHTML(item.name)} después" ${position === peers.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-button" type="button" data-action="remove-item" data-collection="${collection}" data-item-id="${escapeHTML(item.id)}" aria-label="Quitar ${escapeHTML(item.name)}">×</button>
      </span>`;
    }

    function renderLabeler(item, index) {
      const path = `labelers.${index}`;
      return `<article class="station-card labeler-card">
        <div class="card-head yellow"><span class="symbol" aria-hidden="true">▣</span><input class="station-title" type="text" data-bind="${path}.name" value="${escapeHTML(item.name)}" aria-label="Nombre de la etiquetadora">${cardActions('labelers', item)}</div>
        <div class="card-body"><p class="person-count">${item.people.length} puestos configurados</p>${renderPeople(item.people, `${path}.people`, 'labelers', item.id)}
          <label class="data-row goal-row"><span>Meta de etiquetado</span><input type="number" min="0" step="any" data-bind="${path}.target" value="${escapeHTML(item.target)}" aria-label="Meta de etiquetado"><span class="unit-label">p/h</span></label>
          <label class="side-control"><span>Lado de la banda</span><select data-bind="${path}.side"><option value="upper" ${item.side === 'upper' ? 'selected' : ''}>Antes de la banda</option><option value="lower" ${item.side === 'lower' ? 'selected' : ''}>Después de la banda</option></select></label>
        </div>
      </article>`;
    }

    function renderIsland(item, index) {
      const path = `islands.${index}`;
      return `<article class="station-card island-card">
        <div class="card-head ${escapeHTML(item.color)}"><span class="symbol" aria-hidden="true">⬡</span><input class="station-title" type="text" data-bind="${path}.name" value="${escapeHTML(item.name)}" aria-label="Nombre de la isla o estación">${cardActions('islands', item)}</div>
        <div class="card-body"><p class="person-count">${item.people.length} puestos configurados</p>${renderPeople(item.people, `${path}.people`, 'islands', item.id)}
          <label class="data-row"><span># Contenedores</span><input type="number" min="0" step="1" data-bind="${path}.containerCount" value="${escapeHTML(item.containerCount)}" aria-label="Número de contenedores"></label>
          <label class="data-row goal-row"><span>Objetivo</span><input type="number" min="0" step="any" data-bind="${path}.target" value="${escapeHTML(item.target)}" aria-label="Objetivo de la estación"><span class="unit-label">p/h</span></label>
          <label class="checkline"><input type="checkbox" data-bind="${path}.closeComplete" ${item.closeComplete ? 'checked' : ''}> Cerrar contenedores al 100%</label>
          <label class="side-control"><span>Lado de la banda</span><select data-bind="${path}.side"><option value="upper" ${item.side === 'upper' ? 'selected' : ''}>Antes de la banda</option><option value="lower" ${item.side === 'lower' ? 'selected' : ''}>Después de la banda</option></select></label>
        </div>
      </article>`;
    }

    function renderReflow() {
      const item = currentRecord.reflow;
      return `<article class="station-card reflow-card"><div class="card-head gray"><span class="symbol" aria-hidden="true">⇄</span><input class="station-title" type="text" data-bind="reflow.name" value="${escapeHTML(item.name)}" aria-label="Nombre de la zona de reflujo"></div><div class="card-body">${renderPeople(item.people, 'reflow.people', 'reflow', item.id)}<div class="reflow-art" aria-hidden="true">📦　📦　📦　↩</div></div></article>`;
    }

    function renderIncidents() {
      nodes.incidents.innerHTML = currentRecord.incidents.map((incident, index) => `<tr class="incident-row">
        <td><input type="time" data-bind="incidents.${index}.time" value="${escapeHTML(incident.time)}" aria-label="Hora de la incidencia"></td>
        <td><input type="text" data-bind="incidents.${index}.location" value="${escapeHTML(incident.location)}" placeholder="Ej. Isla A" aria-label="Isla o estación"></td>
        <td><input type="text" data-bind="incidents.${index}.description" value="${escapeHTML(incident.description)}" placeholder="Descripción" aria-label="Descripción"></td>
        <td><input type="text" data-bind="incidents.${index}.status" value="${escapeHTML(incident.status)}" placeholder="Pendiente" aria-label="Estatus"></td>
        <td class="editor-only"><button class="icon-button remove-incident" type="button" data-action="remove-incident" data-index="${index}" aria-label="Eliminar incidencia">×</button></td>
      </tr>`).join('');
    }

    function updateBoundInputs() {
      document.querySelectorAll('[data-bind]').forEach(input => {
        const value = getPath(input.dataset.bind);
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else if (document.activeElement !== input) input.value = value ?? '';
      });
    }

    function render() {
      const disabled = readOnly || !currentRecord;
      document.querySelectorAll('[data-bind]').forEach(input => { input.disabled = disabled; });
      document.querySelectorAll('[data-action]').forEach(button => { button.disabled = disabled; });
      if (!currentRecord) {
        nodes.upperFlow.innerHTML = '<div class="data-warning data-error">El contenido de este día no está disponible para editar.</div>';
        nodes.lowerFlow.replaceChildren();
        nodes.incidents.replaceChildren();
        showWarnings();
        return;
      }
      nodes.upperFlow.innerHTML = [
        ...currentRecord.labelers.map((item, index) => ({ item, index })).filter(entry => entry.item.side === 'upper').map(entry => renderLabeler(entry.item, entry.index)),
        ...currentRecord.islands.map((item, index) => ({ item, index })).filter(entry => entry.item.side === 'upper').map(entry => renderIsland(entry.item, entry.index))
      ].join('');
      nodes.lowerFlow.innerHTML = [
        ...currentRecord.labelers.map((item, index) => ({ item, index })).filter(entry => entry.item.side === 'lower').map(entry => renderLabeler(entry.item, entry.index)),
        ...currentRecord.islands.map((item, index) => ({ item, index })).filter(entry => entry.item.side === 'lower').map(entry => renderIsland(entry.item, entry.index)),
        renderReflow()
      ].join('');
      renderIncidents();
      updateBoundInputs();
      showWarnings();
    }

    function refreshHistory() {
      const dates = core.storedDates(localStorage);
      nodes.history.innerHTML = '<option value="">Días guardados…</option>' + dates.map(day => `<option value="${day}">${new Date(`${day}T12:00:00`).toLocaleDateString('es-MX')}</option>`).join('');
      nodes.history.value = dates.includes(currentDate) ? currentDate : '';
    }

    function loadDay(date) {
      if (!core.isDateKey(date)) {
        announce('Selecciona una fecha válida.', true);
        return;
      }
      currentDate = date;
      nodes.date.value = date;
      readOnly = false;
      try {
        const loaded = core.loadRecord(localStorage, date);
        currentRecord = loaded.record;
        if (loaded.migrated) {
          core.saveRecord(localStorage, date, currentRecord);
          announce('Registro anterior recuperado y convertido. El original se conservó.');
        } else if (loaded.isNew) announce('Día nuevo · se guardará al primer cambio.');
        else announce(`Registro del ${new Date(`${date}T12:00:00`).toLocaleDateString('es-MX')} recuperado.`);
      } catch (error) {
        currentRecord = null;
        readOnly = true;
        announce(error.message || 'No se pudo leer el registro.', true);
      }
      refreshHistory();
      render();
    }

    function saveCurrent() {
      if (readOnly || !currentRecord) return false;
      try {
        core.saveRecord(localStorage, currentDate, currentRecord);
        announce(`Guardado local · ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`);
        refreshHistory();
        return true;
      } catch (error) {
        announce(error.message || 'No se pudo guardar.', true);
        return false;
      }
    }

    function handleBoundInput(event) {
      const input = event.target.closest('[data-bind]');
      if (!input || !currentRecord || readOnly) return;
      const oldValue = getPath(input.dataset.bind);
      const value = input.type === 'checkbox' ? input.checked : input.value;
      try {
        setPath(input.dataset.bind, value);
        core.validateRecord(currentRecord, currentDate);
        saveCurrent();
        showWarnings();
      } catch (error) {
        setPath(input.dataset.bind, oldValue);
        if (input.type === 'checkbox') input.checked = Boolean(oldValue);
        else input.value = oldValue ?? '';
        announce(error.details?.join(' ') || error.message, true);
      }
    }

    function findGroup(collection, itemId) {
      if (collection === 'reflow') return currentRecord.reflow;
      return currentRecord[collection]?.find(item => item.id === itemId);
    }

    function handleAction(event) {
      const button = event.target.closest('[data-action]');
      if (!button || !currentRecord || readOnly) return;
      const { action, collection, itemId } = button.dataset;
      if (action === 'add-labeler') core.addLabeler(currentRecord);
      else if (action === 'add-island') core.addIsland(currentRecord);
      else if (action === 'add-incident') currentRecord.incidents.push(core.createIncident());
      else if (action === 'add-person') {
        const group = findGroup(collection, itemId);
        if (group) core.addPerson(group);
      } else if (action === 'remove-person') {
        const group = findGroup(collection, itemId);
        const person = group?.people.find(item => item.id === button.dataset.personId);
        if (group && person && window.confirm(`¿Quitar a ${person.name || person.role || 'esta persona'}?`)) core.removePerson(group, person.id);
      } else if (action === 'move-person') {
        const group = findGroup(collection, itemId);
        if (group) core.moveItem(group.people, button.dataset.personId, Number(button.dataset.direction));
      } else if (action === 'remove-item') {
        const group = currentRecord[collection];
        const item = group?.find(entry => entry.id === itemId);
        if (item && window.confirm(`¿Quitar “${item.name}” de este día?`)) core.removeItem(group, itemId);
      } else if (action === 'move-item') {
        const group = currentRecord[collection];
        if (group) core.moveItemWithinSide(group, itemId, Number(button.dataset.direction));
      } else if (action === 'remove-incident') {
        const index = Number(button.dataset.index);
        currentRecord.incidents.splice(index, 1);
      }
      render();
      saveCurrent();
    }

    async function importFile(file) {
      try {
        const records = core.parseBackup(await file.text());
        const result = core.importRecords(localStorage, records, dates => window.confirm(`El respaldo contiene ${dates.length} día(s) que ya existen (${dates.join(', ')}). Si continúas, se reemplazarán esos registros. ¿Continuar?`));
        if (result.cancelled) { toast('Importación cancelada; no se modificaron datos.'); return; }
        toast(`Respaldo importado: ${Object.keys(records).length} día(s).`);
        if (records[currentDate]) loadDay(currentDate);
        else refreshHistory();
      } catch (error) {
        const detail = error.details?.length ? ` ${error.details.join(' ')}` : '';
        toast(`${error.message}${detail}`);
      } finally { nodes.importFile.value = ''; }
    }

    function exportBackup() {
      try {
        if (currentRecord && !readOnly) core.saveRecord(localStorage, currentDate, currentRecord);
        const records = {};
        for (const date of core.storedDates(localStorage)) records[date] = core.loadRecord(localStorage, date).record;
        const blob = new Blob([core.serializeBackup(records)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'respaldo-layout-pre-cargas.json';
        link.click();
        URL.revokeObjectURL(link.href);
        toast(`Respaldo exportado: ${Object.keys(records).length} día(s).`);
      } catch (error) { toast(`No se pudo exportar: ${error.message}`); }
    }

    $('#sheet').addEventListener('input', handleBoundInput);
    $('#sheet').addEventListener('change', handleBoundInput);
    $('#sheet').addEventListener('click', handleAction);
    nodes.date.addEventListener('change', () => loadDay(nodes.date.value));
    nodes.history.addEventListener('change', () => { if (nodes.history.value) loadDay(nodes.history.value); });
    $('#previousDay').addEventListener('click', () => { const date = new Date(`${currentDate}T12:00:00`); date.setDate(date.getDate() - 1); loadDay(core.localDateString(date)); });
    $('#nextDay').addEventListener('click', () => { const date = new Date(`${currentDate}T12:00:00`); date.setDate(date.getDate() + 1); loadDay(core.localDateString(date)); });
    $('#newDay').addEventListener('click', () => loadDay(localDateString()));
    $('#exportData').addEventListener('click', exportBackup);
    $('#importButton').addEventListener('click', () => nodes.importFile.click());
    nodes.importFile.addEventListener('change', () => { const file = nodes.importFile.files?.[0]; if (file) importFile(file); });
    $('#printButton').addEventListener('click', () => window.print());

    loadDay(currentDate);
  }
})();

