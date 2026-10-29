const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor(id = '') {
    this.id = id; this.value = ''; this.innerHTML = ''; this.textContent = ''; this.dataset = {};
    this.type = 'text'; this.checked = false; this.disabled = false; this.listeners = {};
    this.children = []; this.files = []; this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatch(type, event = {}) { for (const callback of this.listeners[type] || []) callback({ type, target: this, ...event }); }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  click() { this.dispatch('click'); }
}

function createAppHarness() {
  const ids = ['fecha', 'historyDates', 'saveState', 'upperFlow', 'lowerFlow', 'incidentRows', 'statusWarnings', 'toast', 'importFile', 'sheet', 'previousDay', 'nextDay', 'newDay', 'exportData', 'importButton', 'printButton'];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  const storage = new Map();
  const localStorage = {
    get length() { return storage.size; },
    key(index) { return [...storage.keys()][index] ?? null; },
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const document = {
    activeElement: null,
    querySelector(selector) { return elements[selector.replace(/^#/, '')] || null; },
    querySelectorAll() { return []; },
    createElement() { return new FakeElement(); }
  };
  const window = { confirm: () => true, print() {} };
  const context = vm.createContext({ document, window, localStorage, Date, Map, Set, Intl, JSON, Math, String, Number, Boolean, Array, Object, Error, TypeError, RegExp, Blob, URL, console, setTimeout, clearTimeout });
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'app.js' });
  function clickAction(action, data = {}) {
    const button = { dataset: { action, ...data }, disabled: false };
    elements.sheet.dispatch('click', { target: { closest: selector => selector === '[data-action]' ? button : null } });
  }
  function boundInput(pathName, value, type = 'text') {
    const input = new FakeElement(); input.dataset.bind = pathName; input.type = type; input.value = value; input.checked = value;
    elements.sheet.dispatch('input', { target: { closest: selector => selector === '[data-bind]' ? input : null } });
  }
  return { elements, localStorage, clickAction, boundInput };
}

test('la interfaz inicia con la distribución actual y agrega estructuras editables', () => {
  const app = createAppHarness();
  assert.equal((app.elements.upperFlow.innerHTML.match(/class="station-card labeler-card"/g) || []).length, 1);
  assert.equal((app.elements.lowerFlow.innerHTML.match(/class="station-card labeler-card"/g) || []).length, 1);
  assert.equal((app.elements.upperFlow.innerHTML.match(/class="station-card island-card"/g) || []).length, 3);
  assert.equal((app.elements.lowerFlow.innerHTML.match(/class="station-card island-card"/g) || []).length, 3);
  assert.match(app.elements.upperFlow.innerHTML, /Inductor/);
  assert.match(app.elements.lowerFlow.innerHTML, /Reflujo/);
  assert.ok(app.elements.upperFlow.innerHTML.indexOf('Etiquetadoras 1 y 2') < app.elements.upperFlow.innerHTML.indexOf('Isla A'));
  assert.ok(app.elements.lowerFlow.innerHTML.indexOf('Etiquetadora 2') < app.elements.lowerFlow.innerHTML.indexOf('Isla B'));
  assert.equal(app.localStorage.length, 0, 'no se persiste el día vacío al abrir');
  app.clickAction('add-labeler');
  app.clickAction('add-island');
  assert.equal((app.elements.upperFlow.innerHTML.match(/class="station-card labeler-card"/g) || []).length + (app.elements.lowerFlow.innerHTML.match(/class="station-card labeler-card"/g) || []).length, 3);
  assert.equal((app.elements.upperFlow.innerHTML.match(/class="station-card island-card"/g) || []).length + (app.elements.lowerFlow.innerHTML.match(/class="station-card island-card"/g) || []).length, 7);
  assert.equal(app.localStorage.length, 1, 'el primer cambio guarda el día');
});

test('la interfaz permite aumentar puestos, advertir duplicados y reordenar estaciones', () => {
  const app = createAppHarness();
  const firstLabelerId = app.elements.upperFlow.innerHTML.match(/data-item-id="([^"]+)"/)[1];
  app.clickAction('add-person', { collection: 'labelers', itemId: firstLabelerId });
  assert.match(app.elements.upperFlow.innerHTML, /Nuevo puesto/);
  const labelerMarkup = app.elements.upperFlow.innerHTML.split('</article>')[0];
  const newPersonId = labelerMarkup.match(/data-action="move-person"[^>]*data-person-id="([^"]+)" data-direction="-1"[^>]*>↑/g).at(-1).match(/data-person-id="([^"]+)"/)[1];
  app.clickAction('move-person', { collection: 'labelers', itemId: firstLabelerId, personId: newPersonId, direction: '-1' });
  assert.match(app.elements.upperFlow.innerHTML, /data-bind="labelers\.0\.people\.2\.role" value="Nuevo puesto"/);
  app.clickAction('remove-person', { collection: 'labelers', itemId: firstLabelerId, personId: newPersonId });
  assert.doesNotMatch(app.elements.upperFlow.innerHTML, /value="Nuevo puesto"/);
  app.boundInput('labelers.0.people.0.name', 'Ana');
  app.boundInput('islands.0.people.0.name', ' ana ');
  assert.match(app.elements.statusWarnings.children[0].textContent, /Nombre repetido/);
  const firstIslandId = app.elements.upperFlow.innerHTML.match(/data-collection="islands" data-item-id="([^"]+)"/)[1];
  app.clickAction('move-item', { collection: 'islands', itemId: firstIslandId, direction: '1' });
  const stationNames = [...app.elements.upperFlow.innerHTML.matchAll(/class="station-title"[^>]*value="([^"]+)"/g)].map(match => match[1]);
  assert.equal(stationNames[0], 'Etiquetadoras 1 y 2');
  assert.equal(stationNames[1], 'Isla C');
  assert.equal(stationNames[2], 'Isla A');
});

test('la interfaz guarda datos y los recupera al cambiar de fecha', () => {
  const app = createAppHarness();
  const dateField = app.elements.fecha;
  const originalDay = dateField.value;
  app.boundInput('meta.supervisor', 'Turno uno');
  dateField.value = '2026-10-29';
  dateField.dispatch('change');
  assert.match(app.elements.saveState.textContent, /Día nuevo/);
  app.boundInput('meta.supervisor', 'Turno dos');
  dateField.value = originalDay;
  dateField.dispatch('change');
  assert.match(app.elements.saveState.textContent, /Registro del/);
  assert.match(app.elements.upperFlow.innerHTML, /value="Etiquetadoras 1 y 2"/);
  assert.equal(app.localStorage.getItem(`layoutPreCargas:v2:${originalDay}`) !== null, true);
});

