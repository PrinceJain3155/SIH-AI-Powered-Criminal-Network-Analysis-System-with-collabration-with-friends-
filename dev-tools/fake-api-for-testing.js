/**
 * Minimal in-memory fake of the real API (routes/*.js), used ONLY for
 * local smoke-testing the frontend against the new API contract when a
 * real MongoDB instance isn't available (as in this sandbox). Mirrors
 * response shapes exactly; no persistence, no indexes, no validation
 * beyond what the frontend flow actually exercises.
 */
const http = require('http');

const cases = new Map(); // id -> case metadata
const notes = new Map(); // id -> [{ts,text}]
const cdr = new Map();   // id -> [records]
const towers = new Map();// id -> [towers]

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(s);
}
function serializeCase(c) {
  return {
    ...c,
    notes: notes.get(c.id) || [],
    recordCount: (cdr.get(c.id) || []).length,
    towerCount: (towers.get(c.id) || []).length,
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  let bodyRaw = '';
  req.on('data', (c) => (bodyRaw += c));
  req.on('end', () => {
    let body = {};
    try { body = bodyRaw ? JSON.parse(bodyRaw) : {}; } catch (e) { /* ignore */ }

    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;

    console.log(`  [fake-api] ${m} ${p}${url.search}`);

    if (p === '/api/health') return json(res, 200, { ok: true, db: 'fake' });

    if (p === '/api/cases' && m === 'GET') {
      return json(res, 200, [...cases.values()].map(serializeCase));
    }
    if (p === '/api/cases' && m === 'POST') {
      const id = body.id || 'c_' + Math.random().toString(36).slice(2);
      cases.set(id, { id, ...body });
      return json(res, 201, serializeCase(cases.get(id)));
    }
    let mm;
    if ((mm = p.match(/^\/api\/cases\/([^/]+)$/)) && m === 'PUT') {
      const id = decodeURIComponent(mm[1]);
      const { notes: bodyNotes, savedData, ...meta } = body;
      const existing = cases.get(id) || {};
      cases.set(id, { ...existing, ...meta, id });
      if (Array.isArray(bodyNotes) && bodyNotes.length) {
        notes.set(id, [...(notes.get(id) || []), ...bodyNotes]);
      }
      if (savedData) {
        if (Array.isArray(savedData.records)) cdr.set(id, savedData.records);
        if (Array.isArray(savedData.towers)) towers.set(id, savedData.towers);
      }
      return json(res, 200, serializeCase(cases.get(id)));
    }
    if ((mm = p.match(/^\/api\/cases\/([^/]+)$/)) && m === 'DELETE') {
      const id = decodeURIComponent(mm[1]);
      cases.delete(id); notes.delete(id); cdr.delete(id); towers.delete(id);
      return json(res, 200, { ok: true });
    }
    if ((mm = p.match(/^\/api\/cases\/([^/]+)\/import-cdr$/)) && m === 'POST') {
      const id = decodeURIComponent(mm[1]);
      if (body.mode === 'replace') cdr.set(id, []);
      const arr = cdr.get(id) || [];
      arr.push(...(body.records || []));
      cdr.set(id, arr);
      return json(res, 200, { ok: true, inserted: (body.records || []).length });
    }
    if ((mm = p.match(/^\/api\/cases\/([^/]+)\/import-towers$/)) && m === 'POST') {
      const id = decodeURIComponent(mm[1]);
      if (body.mode === 'replace') towers.set(id, []);
      const arr = towers.get(id) || [];
      arr.push(...(body.towers || []));
      towers.set(id, arr);
      return json(res, 200, { ok: true, inserted: (body.towers || []).length });
    }
    if ((mm = p.match(/^\/api\/cases\/([^/]+)\/cdr$/)) && m === 'GET') {
      const id = decodeURIComponent(mm[1]);
      const all = cdr.get(id) || [];
      const limit = Number(url.searchParams.get('limit')) || 2000;
      const cursor = Number(url.searchParams.get('cursor')) || 0;
      const page = all.slice(cursor, cursor + limit);
      const nextCursor = cursor + limit;
      return json(res, 200, { records: page, nextCursor: nextCursor < all.length ? String(nextCursor) : null, hasMore: nextCursor < all.length });
    }
    if ((mm = p.match(/^\/api\/cases\/([^/]+)\/towers$/)) && m === 'GET') {
      const id = decodeURIComponent(mm[1]);
      return json(res, 200, { towers: towers.get(id) || [], nextCursor: null, hasMore: false });
    }
    if ((mm = p.match(/^\/api\/cases\/([^/]+)\/notes$/)) && m === 'POST') {
      const id = decodeURIComponent(mm[1]);
      const note = { ts: new Date().toISOString(), text: body.text };
      notes.set(id, [...(notes.get(id) || []), note]);
      return json(res, 201, note);
    }
    if ((mm = p.match(/^\/api\/cases\/([^/]+)\/notes$/)) && m === 'GET') {
      const id = decodeURIComponent(mm[1]);
      return json(res, 200, notes.get(id) || []);
    }

    json(res, 404, { error: `no fake route for ${m} ${p}` });
  });
});

const PORT = 4123;
server.listen(PORT, () => console.log(`[fake-api] listening on http://localhost:${PORT}`));
