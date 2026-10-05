/**
 * Smoke test: loads the REAL index.html into jsdom (with script execution
 * enabled), points it at the fake in-memory API server, and drives the
 * actual case-management functions (the same ones wired to onclick
 * handlers in the UI) through: create case -> import CDR+towers -> load
 * case data back -> add a note -> delete case. Fails loudly on any thrown
 * error or unexpected response shape.
 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

async function main() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.CDR_API_BASE = 'http://localhost:4123/api';
      // Leaflet/Chart.js/jsPDF load from a CDN this sandbox can't reach;
      // stub just enough surface so unrelated app init code (which
      // references them defensively / lazily) doesn't throw.
      window.L = new Proxy(() => window.L, { get: () => window.L, apply: () => window.L });
      window.Chart = class { constructor(){} destroy(){} update(){} };
      window.jspdf = { jsPDF: class { text(){} save(){} } };
      // jsdom doesn't implement fetch itself — use Node's.
      window.fetch = (...args) => fetch(...args);
    },
  });
  const { window } = dom;

  window.onerror = (msg) => console.error('  [window error]', msg);

  // Let the page's own startup script (loadCasesFromStorage(), event
  // listeners, etc.) run.
  await new Promise((r) => setTimeout(r, 500));

  const w = window;
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERTION FAILED: ' + msg); console.log('  ok:', msg); };
  // Top-level `let`/`const` in a classic <script> (cases, records, towers,
  // activeCaseId) are global *lexical* bindings, not properties of
  // `window` — unlike `function` declarations, which do become window
  // properties. window.eval() runs as indirect eval (global scope), which
  // shares that same lexical environment, so it can read/write them.
  const get = (expr) => w.eval(expr);
  const set = (name, value) => { w.__inject__ = value; w.eval(`${name} = window.__inject__;`); };

  console.log('--- 1. case list starts empty ---');
  assert(Array.isArray(get('cases')), 'cases is an array after load');
  assert(get('cases').length === 0, 'no cases yet');

  console.log('--- 2. create a case (mirrors saveCaseForm) ---');
  w.document.getElementById('caseNo').value = 'CASE-001';
  w.document.getElementById('caseTitle').value = 'Test Investigation';
  w.document.getElementById('caseOfficer').value = 'Insp. Test';
  w.document.getElementById('caseDescription').value = 'Smoke test case';
  await w.saveCaseForm();
  assert(get('cases').length === 1, 'case created locally');
  const caseId = get('cases')[0].id;
  assert(!('savedData' in get('cases')[0]), 'no savedData field on the local case object');
  assert(get('cases')[0].recordCount === 0, 'recordCount starts at 0');

  console.log('--- 3. activate case + load synthetic CDR/tower data, then save (mirrors saveDataToActiveCase) ---');
  w.setActiveCaseId(caseId);
  const syntheticRecords = Array.from({ length: 2500 }, (_, i) => ({
    TARGET_NO: '9' + String(i).padStart(9, '0'),
    B_PARTY_NO: '8' + String(i).padStart(9, '0'),
    DATE_TIME: '2026-07-20 10:00:00',
    DURATION: 60,
    FIRST_CGI: '404-10-2101-1',
    IMEI: '35' + String(i).padStart(13, '0'),
  }));
  set('records', syntheticRecords);
  set('towers', [{ CELL_ID: '404-10-2101-1', LATITUDE: 26.85, LONGITUDE: 80.95, TOWER_NAME: 'T1' }]);
  await w.saveDataToActiveCase();
  assert(w.getActiveCase().recordCount === 2500, `recordCount reflects import (${w.getActiveCase().recordCount})`);
  assert(w.getActiveCase().towerCount === 1, 'towerCount reflects import');

  console.log('--- 4. reset in-memory working set, then reload via loadDataFromCase (exercises cursor pagination across >1 page) ---');
  set('records', []); set('towers', []);
  await w.loadDataFromCase(caseId);
  assert(get('records').length === 2500, `all 2500 records fetched back via pagination (got ${get('records').length})`);
  assert(get('towers').length === 1, 'tower fetched back');
  assert(get('records')[0].TARGET_NO === '9' + '0'.repeat(9), 'first record content round-trips correctly');
  assert(get('records')[2499].TARGET_NO === '9' + String(2499).padStart(9, '0'), 'last record content round-trips correctly');

  console.log('--- 5. add a note (mirrors the case-log UI) ---');
  await w.addCaseNote('Smoke-test note', true);
  assert(w.getActiveCase().notes.some((n) => n.text === 'Smoke-test note'), 'note round-trips into local case object');

  console.log('--- 6. render case list HTML (checks the recordCount/towerCount-based markup) ---');
  w.renderCaseList();
  const cardHtml = w.document.getElementById('caseList').innerHTML;
  assert(cardHtml.includes('2500 records, 1 towers'), 'case card shows correct saved-data summary');
  assert(cardHtml.includes('Load Data'), '"Load Data" button shown now that recordCount > 0');

  console.log('--- 7. delete the case (cascade covered server-side; here just confirms the client flow) ---');
  w.confirm = () => true; // jsdom's window.confirm is a no-op returning undefined by default
  await w.deleteCase(caseId);
  assert(get('cases').length === 0, 'case removed from local list after delete');

  console.log('\nALL SMOKE TESTS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nSMOKE TEST FAILED:', err);
  process.exit(1);
});
