const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const core = require('./core.js');
const test = require('node:test');

test('family controls enforce locks, restore inputs and discard stale optimisation', async () => {
class Element {
  constructor() { this.children=[]; this.listeners={}; this.value='modern'; this.dataset={}; this.style={}; this.classList={toggle(){},add(){},remove(){}}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
  addEventListener(name, fn) { this.listeners[name]=fn; }
  setAttribute(name,value) { this[name]=value; }
  focus() { this.focused=true; }
  close() { this.listeners.close?.(); }
  createTHead() { return new Element(); }
  createTBody() { return new Element(); }
  insertRow() { const e=new Element(); this.append(e); return e; }
  insertCell() { const e=new Element(); this.append(e); return e; }
}
const elements=new Map();
const modeButtons=['1','0','9','family','10'].map((mode) => Object.assign(new Element(), {dataset:{mode}}));
const familyTabs=['2','4','8'].map((mode) => Object.assign(new Element(),
  {dataset:{familyMode:mode},id:`family-tab-${mode}`}));
const document={ querySelector(s) { if(!elements.has(s)) elements.set(s,new Element()); return elements.get(s); },
  querySelectorAll(s){return s==='.mode-button'?modeButtons:s==='.family-tab'?familyTabs:[];},
  createElement(){return new Element();}, createTextNode(text){return {textContent:text};} };
const row = (label, value, source='reference') => ({label,values:Array(25).fill(value),category:'modern',source});
const refs=[['modern','Low',...Array(25).fill(0)],['modern','High',...Array(25).fill(1)]];
let lastWorker;
class Worker { constructor(url){this.url=url; lastWorker=this;} postMessage(data){this.data=data;} terminate(){this.terminated=true;} }
const window={G25Core:core,G25_REFERENCES:refs};
const pcaRow = (label, value, category = 'modern') => [category, label, ...Array(25).fill(value)];
window.G25_TURKISH_MODERN_PCAS = [
  { id: 'first', references: [pcaRow('Group_A:Fitted', 2), pcaRow('Group_A:Unused', 3), pcaRow('Group_B:Other', 4)], referenceAnchors: [] },
  { id: 'second', references: [pcaRow('Other_Group:Alias', 3), pcaRow('Group_B:Other', 4)], referenceAnchors: [] },
];
window.G25_TURKISH_MEDIEVAL_REFERENCES = {
  early: [pcaRow('Rum:Early', 5, 'medieval')],
  late: [pcaRow('Rum:Late', 6, 'medieval'), pcaRow('Türk:Late', 7, 'medieval')],
};
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
source=source.replace('  render();\n})();','  window.testApi = {state, familyLocks, familyReverts, render, optimiseFamily, setTarget, changeBlacklist, changeWhitelist, allowedReferences, allowedPcaReferences, renderMedievalFit};\n  render();\n})();');
vm.runInNewContext(source,context);
const api=window.testApi;
const button=()=>document.querySelector('#family-optimise');
familyTabs[1].listeners.click();
assert.equal(api.state.mode,4);
api.state.slots[4][0]=row('Saved grandparent',.2);
modeButtons[0].listeners.click();
assert.equal(document.querySelector('#family-tabs').hidden,true);
modeButtons[3].listeners.click();
assert.equal(api.state.mode,4);
assert.equal(document.querySelector('#family-tabs').hidden,false);
assert.equal(familyTabs[1]['aria-selected'],'true');
assert.equal(document.querySelector('#family-inputs')['aria-labelledby'],familyTabs[1].id);
modeButtons[4].listeners.click();
assert.equal(api.state.mode,10);
assert.equal(document.querySelector('#period-tabs').hidden,false);
assert.equal(document.querySelector('#family-tabs').hidden,true);
assert.equal(document.querySelector('#modern-analysis-tab')['aria-selected'],'true');
modeButtons[0].listeners.click();
assert.equal(document.querySelector('#period-tabs').hidden,true);
assert.equal(document.querySelector('#inputs-title').textContent,'Analyse');
modeButtons[3].listeners.click();
familyTabs[0].listeners.click();
assert.equal(api.state.slots[4][0].label,'Saved grandparent');
let preventedTabKey=false;
document.querySelector('#family-tabs').listeners.keydown({key:'End',preventDefault(){preventedTabKey=true;}});
assert.equal(api.state.mode,8);
assert.ok(preventedTabKey && familyTabs[2].focused);
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
api.state.offspring=row('Child',.5);
api.state.slots[4]=[row('Locked grandparent',.2),null,null,null];
api.familyLocks[4]=[true,false,false,false];
api.render();
assert.equal(button().disabled,false);
api.optimiseFamily();
const partialJob=lastWorker;
const partialData=partialJob.data;
assert.equal(partialData.ancestors.filter(Boolean).length,1);
partialJob.onmessage({data:{result:core.optimiseFamily(partialData.offspring,
  partialData.ancestors,partialData.locks,partialData.references,partialData.male)}});
assert.equal(api.state.slots[4][0].label,'Locked grandparent');
assert.ok(api.state.slots[4].every(Boolean));
assert.equal(button().textContent,'Revert');
api.optimiseFamily();
assert.equal(api.state.slots[4].filter(Boolean).length,1);
assert.equal(api.state.slots[4][0].label,'Locked grandparent');
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
assert.equal(document.querySelector('#period-tabs').hidden, true);
assert.equal(document.querySelector('#matches-panel').hidden, false);
assert.equal(document.querySelector('#medieval-breakdown-panel').hidden, true);
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

// The group control excludes unfitted members and aliases across PCAs as one restorable rule.
const list = document.querySelector('#medieval-breakdown-list');
list.replaceChildren();
api.renderMedievalFit({ distance: 0, values: Array(25).fill(2), groups: [{ ethnicity: 'Group_A', weight: 1,
  samples: [{ label: 'Group_A:Fitted', sample: 'Fitted', weight: 1 }] }] }, true);
const groupSummary = list.children[0].children[0];
const groupButton = groupSummary.children[2];
assert.equal(groupSummary.children[1].textContent, '100.0%');
assert.equal(groupButton['aria-label'], 'Blacklist entire Group A group');
let prevented = false;
let stopped = false;
groupButton.listeners.click({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
assert.ok(prevented && stopped);
assert.equal(document.querySelector('#blacklist-count').textContent, '1');
assert.equal(JSON.parse(storage.get('g25-temporary-blacklist'))[0].group, true);
assert.equal(api.allowedPcaReferences(window.G25_TURKISH_MODERN_PCAS[0]).map((row) => row[1]).join(','), 'Group_B:Other');
assert.equal(api.allowedPcaReferences(window.G25_TURKISH_MODERN_PCAS[1]).map((row) => row[1]).join(','), 'Group_B:Other');
assert.equal(api.allowedReferences([pcaRow('Group_A:New', 8)]).length, 0);
assert.equal(api.allowedReferences([pcaRow('Main_Dataset_Alias', 3)]).length, 0);
const groupRule = document.querySelector('#blacklist-list').children[0];
assert.equal(groupRule.children[0].children[1].textContent, 'modern · entire group');
groupRule.children[2].listeners.click();
assert.equal(api.allowedPcaReferences(window.G25_TURKISH_MODERN_PCAS[0]).length, 3);
assert.equal(api.allowedPcaReferences(window.G25_TURKISH_MODERN_PCAS[1]).length, 2);

// Medieval rules cover both periods and remain scoped to their reference category.
api.changeBlacklist({ category: 'medieval', label: 'Rum', group: true }, true);
assert.equal(api.allowedReferences(window.G25_TURKISH_MEDIEVAL_REFERENCES.early).length, 0);
assert.equal(api.allowedReferences(window.G25_TURKISH_MEDIEVAL_REFERENCES.late).map((row) => row[1]).join(','), 'Türk:Late');
assert.equal(api.allowedReferences([pcaRow('Rum:Modern', 5)]).length, 1);
document.querySelector('#blacklist-clear').listeners.click();
assert.equal(api.allowedReferences(window.G25_TURKISH_MEDIEVAL_REFERENCES.early).length, 1);
assert.equal(api.allowedReferences(window.G25_TURKISH_MEDIEVAL_REFERENCES.late).length, 2);

// Bulk actions apply the full search, including rows beyond the visible first 20.
const bulkRows = Array.from({length: 25}, (_, index) => pcaRow(`Bulk_Phrase_${index}`, index));
const ancientBulkRows = Array.from({length: 3}, (_, index) => pcaRow(`Bulk_Phrase_Ancient_${index}`, index, 'ancient'));
refs.push(...bulkRows, ...ancientBulkRows, bulkRows[0]);
const search = document.querySelector('#blacklist-search');
const bulk = document.querySelector('#population-add-matches');
const modernBulk = document.querySelector('#population-add-modern-matches');
const ancientBulk = document.querySelector('#population-add-ancient-matches');
search.value = 'Bulk Phrase';
search.listeners.input();
assert.equal(document.querySelector('#blacklist-search-results').children.length, 20);
assert.equal(bulk.textContent, 'Blacklist all 28 matches');
assert.equal(modernBulk.textContent, 'Blacklist all 25 modern matches');
assert.equal(ancientBulk.textContent, 'Blacklist all 3 ancient matches');
modernBulk.listeners.click();
assert.equal(document.querySelector('#blacklist-count').textContent, '25');
assert.equal(modernBulk.hidden, true);
assert.equal(ancientBulk.hidden, false);
assert.equal(bulk.textContent, 'Blacklist all 3 matches');
assert.equal(JSON.parse(storage.get('g25-temporary-blacklist')).length, 25);
assert.equal(api.allowedReferences(bulkRows).length, 0);
assert.equal(api.allowedReferences(ancientBulkRows).length, 3);
ancientBulk.listeners.click();
assert.equal(document.querySelector('#blacklist-count').textContent, '28');
assert.equal(bulk.hidden, true);

document.querySelector('#population-mode-only').listeners.click();
assert.equal(bulk.textContent, 'Only use all 28 matches');
assert.equal(modernBulk.textContent, 'Only use all 25 modern matches');
assert.equal(ancientBulk.textContent, 'Only use all 3 ancient matches');
modernBulk.listeners.click();
assert.equal(document.querySelector('#blacklist-count').textContent, '3');
assert.equal(document.querySelector('#whitelist-count').textContent, '25');
assert.equal(api.allowedReferences(ancientBulkRows).length, 0);
ancientBulk.listeners.click();
assert.equal(document.querySelector('#blacklist-count').textContent, '0');
assert.equal(document.querySelector('#whitelist-count').textContent, '28');
assert.equal(api.allowedReferences(refs).length, 29);
assert.equal(bulk.hidden, true);
document.querySelector('#population-mode-exclude').listeners.click();
assert.equal(bulk.textContent, 'Blacklist all 28 matches');
bulk.listeners.click();
assert.equal(document.querySelector('#blacklist-count').textContent, '28');
assert.equal(document.querySelector('#whitelist-count').textContent, '0');
search.value = '';
search.listeners.input();
assert.equal(bulk.hidden, true);
assert.equal(modernBulk.hidden, true);
assert.equal(ancientBulk.hidden, true);
document.querySelector('#blacklist-clear').listeners.click();
refs.push(pcaRow('Separator_Test', 31), pcaRow('Separator-Test', 32));
search.value = 'Separator_Test';
search.listeners.input();
assert.equal(bulk.textContent, 'Blacklist all 1 match');
assert.equal(document.querySelector('#blacklist-search-results').children[0].children[0].textContent, 'Separator_Test · modern');
search.value = 'Separator-Test';
search.listeners.input();
assert.equal(bulk.textContent, 'Blacklist all 1 match');
assert.equal(document.querySelector('#blacklist-search-results').children[0].children[0].textContent, 'Separator-Test · modern');
search.value = 'Separator Test';
search.listeners.input();
assert.equal(bulk.textContent, 'Blacklist all 2 matches');
search.value = '_';
search.listeners.input();
assert.equal(bulk.hidden, false);
search.value = '-';
search.listeners.input();
assert.equal(bulk.textContent, 'Blacklist all 1 match');
});
