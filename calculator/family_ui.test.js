const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const core = require('./core.js');
const test = require('node:test');

test('family controls enforce locks, restore inputs and discard stale optimisation', async () => {
class Element {
  constructor() { this.children=[]; this.listeners={}; this.value='modern'; this.dataset={}; this.classList={toggle(){},add(){},remove(){}}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
  addEventListener(name, fn) { this.listeners[name]=fn; }
  setAttribute(name,value) { this[name]=value; }
  close() { this.listeners.close?.(); }
  createTHead() { return new Element(); }
  createTBody() { return new Element(); }
  insertRow() { const e=new Element(); this.append(e); return e; }
  insertCell() { const e=new Element(); this.append(e); return e; }
}
const elements=new Map();
const document={ querySelector(s) { if(!elements.has(s)) elements.set(s,new Element()); return elements.get(s); }, querySelectorAll(){return [];}, createElement(){return new Element();}, createTextNode(text){return {textContent:text};} };
const row = (label, value, source='reference') => ({label,values:Array(25).fill(value),category:'modern',source});
const refs=[['modern','Low',...Array(25).fill(0)],['modern','High',...Array(25).fill(1)]];
let lastWorker;
class Worker { constructor(url){this.url=url; lastWorker=this;} postMessage(data){this.data=data;} terminate(){this.terminated=true;} }
const window={G25Core:core,G25_REFERENCES:refs};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, 'core.js'), 'utf8'), { window });
let workerBlob;
const revoked = [];
const workerURLs = { createObjectURL(blob) { workerBlob = blob; return 'blob:null/family-test'; },
  revokeObjectURL(url) { revoked.push(url); } };
const storage = new Map();
const sessionStorage = { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, 'mixture.js'), 'utf8'), { window });
const context={window,document,Worker,URL:workerURLs,Blob,console,sessionStorage};
let source=fs.readFileSync(require('node:path').join(__dirname, 'app.js'),'utf8');
source=source.replace('  render();\n})();','  window.testApi = {state, familyLocks, familyReverts, render, optimiseFamily, setTarget, changeBlacklist, changeWhitelist, allowedReferences};\n  render();\n})();');
vm.runInNewContext(source,context);
const api=window.testApi;
const button=()=>document.querySelector('#family-optimise');
for(const mode of [2,4,8]) {
  api.state.mode=mode;
  api.state.offspring=row('Child',.5);
  api.state.slots[mode]=Array.from({length:mode},(_,i)=>row('Original'+i,.2));
  api.render();
  assert.equal(button().disabled,mode>2);
  for(let i=0;i<({2:0,4:1,8:4}[mode]);i++) api.familyLocks[mode][i]=true;
  api.render();
  assert.equal(button().disabled,false);
  const old=api.state.slots[mode];
  api.optimiseFamily();
  assert.equal(button().disabled,true);
  assert.equal(lastWorker.url, 'blob:null/family-test');
  const workerSource = await workerBlob.text();
  assert.ok(!workerSource.includes('importScripts'));
  let workerResult;
  const self = { postMessage(data) { workerResult = data; } };
  vm.runInNewContext(workerSource, { self });
  self.onmessage({ data: lastWorker.data });
  assert.ok(workerResult.result);
  const d=lastWorker.data;
  lastWorker.onmessage({data:{result:core.optimiseFamily(d.offspring,d.ancestors,d.locks,d.references,d.male)}});
  assert.equal(button().textContent,'Revert');
  api.optimiseFamily();
  assert.equal(button().textContent,'Optimise');
  assert.equal(JSON.stringify(api.state.slots[mode]),JSON.stringify(old));
  api.optimiseFamily();
  const data=lastWorker.data;
  lastWorker.onmessage({data:{result:core.optimiseFamily(data.offspring,data.ancestors,data.locks,data.references,data.male)}});
  api.state.slots[mode][mode-1]=row('Changed',.7);
  api.render();
  assert.equal(button().textContent,'Optimise');
  api.optimiseFamily();
  const pending=lastWorker;
  api.state.slots[mode][mode-1]=row('New input',.8);
  api.render();
  assert.equal(pending.terminated,true);
  assert.equal(button().textContent,'Optimise');
}
api.state.mode=4;
api.familyLocks[4].fill(false);
api.state.slots[4][0]=row('Paste1',.2,undefined); delete api.state.slots[4][0].source;
api.state.slots[4][1]=row('Paste2',.3,undefined); delete api.state.slots[4][1].source;
api.render();
assert.equal(button().disabled,false);
assert.ok(revoked.length > 0);
for (const key of ['suggestions', 'closest', 'metrics']) {
  const toggle = document.querySelector('#' + key + '-accordion-toggle');
  const body = document.querySelector('#' + key + '-accordion-body');
  assert.equal(toggle.hidden, false);
  toggle.listeners.click();
  assert.equal(body.hidden, true);
  assert.equal(toggle['aria-expanded'], 'false');
  for (const mode of [0, 1]) {
    api.state.mode = mode;
    api.render();
    assert.equal(toggle.hidden, true);
    assert.equal(body.hidden, false);
  }
  api.state.mode = 4;
  api.render();
  assert.equal(body.hidden, true);
  toggle.listeners.click();
  assert.equal(body.hidden, false);
}
// Blacklisting changes the search pool, leaves current/locked inputs intact,
// persists for this tab, and cancels old searches before rerunning Analyse.
api.state.mode = 2;
api.state.offspring = row('Child', .5);
api.state.slots[2] = [row('Low', 0), row('High', 1)];
api.familyLocks[2] = [true, false];
api.render();
api.changeBlacklist({ label: 'High', category: 'modern' }, true);
assert.equal(api.state.slots[2][1].label, 'High');
assert.equal(api.familyLocks[2][0], true);
assert.equal(document.querySelector('#blacklist-count').textContent, '1');
assert.ok(storage.get('g25-temporary-blacklist').includes('High'));
api.optimiseFamily();
assert.equal(lastWorker.data.references.length, 1);
assert.equal(lastWorker.data.references[0][1], 'Low');
const familySearch = lastWorker;
api.state.mode = 1;
api.state.single = row('Sample', .4);
api.render();
assert.equal(familySearch.terminated, true);
assert.equal(lastWorker.data.modernReferences.length, 1);
assert.equal(lastWorker.data.references[0][1], 'Low');
const oldSearch = lastWorker;
api.changeBlacklist({ label: 'High', category: 'modern' }, false);
assert.equal(oldSearch.terminated, true);
assert.equal(lastWorker.data.modernReferences.length, 2);
api.changeBlacklist({ label: 'Low', category: 'modern' }, true);
api.changeBlacklist({ label: 'High', category: 'modern' }, true);
assert.equal(document.querySelector('#blacklist-count').textContent, '2');
document.querySelector('#blacklist-clear').listeners.click();
assert.equal(lastWorker.data.modernReferences.length, 2);
assert.equal(document.querySelector('#blacklist-count').textContent, '0');
assert.equal(storage.get('g25-temporary-blacklist'), '[]');
api.changeWhitelist({label: 'Low', category: 'modern'}, true);
assert.equal(lastWorker.data.references.length, 1);
assert.equal(lastWorker.data.references[0][1], 'Low');
assert.equal(document.querySelector('#whitelist-count').textContent, '1');
assert.ok(storage.get('g25-temporary-whitelist').includes('Low'));
api.changeWhitelist({label: 'High', category: 'modern'}, true);
assert.equal(lastWorker.data.references.length, 2);
api.changeBlacklist({label: 'Low', category: 'modern'}, true);
assert.equal(document.querySelector('#whitelist-count').textContent, '1');
assert.equal(lastWorker.data.references[0][1], 'High');
api.changeWhitelist({label: 'Low', category: 'modern'}, true);
assert.equal(document.querySelector('#blacklist-count').textContent, '0');
assert.equal(lastWorker.data.references.length, 2);
api.changeWhitelist({label: 'High', category: 'modern'}, false);
assert.equal(lastWorker.data.references.length, 1);
api.changeWhitelist({label: 'Low', category: 'modern'}, false);
assert.equal(lastWorker.data.references.length, 2);
api.changeWhitelist({label: 'Not in current set', category: 'ancient'}, true);
assert.equal(api.allowedReferences(refs).length, 0);
document.querySelector('#blacklist-clear').listeners.click();
assert.equal(lastWorker.data.references.length, 2);
assert.equal(storage.get('g25-temporary-whitelist'), '[]');
api.state.mode = 4;
api.state.offspring = null;
api.render();
assert.ok(!document.querySelector('#family-optimise-status').textContent.includes('Fill the child'));
});
