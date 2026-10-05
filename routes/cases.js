const express = require('express');
const { requireAuth, assertCaseAccess, caseAccessFilter } = require('../middleware/auth');
const Case = require('../models/Case');
const CdrRecord = require('../models/CdrRecord');
const TowerRecord = require('../models/TowerRecord');
const Evidence = require('../models/Evidence');
const Note = require('../models/Note');
const Task = require('../models/Task');
const Timeline = require('../models/Timeline');
const GraphCache = require('../models/GraphCache');
const AiAnalysis = require('../models/AiAnalysis');
const asyncHandler = require('../utils/asyncHandler');
const { logTimeline } = require('../utils/timelineLogger');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

const BATCH_SIZE = 1000;

/** Insert an array in fixed-size batches via insertMany (unordered, so one
 *  bad row in a batch doesn't abort the whole batch). Used both here (for
 *  the legacy embedded-savedData migration path) and in routes/cdr.js /
 *  routes/towers.js for regular imports. */
async function batchInsert(Model, docs, batchSize = BATCH_SIZE) {
  let inserted = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const result = await Model.insertMany(batch, { ordered: false });
    inserted += result.length;
  }
  return inserted;
}

/** Shape a Case doc + its related counts/notes into what the existing
 *  frontend expects from GET /api/cases — same field names it has always
 *  read (id, caseNo, title, officer, status, description, openedDate,
 *  notes), plus recordCount/towerCount replacing the old embedded
 *  savedData.records.length / savedData.towers.length. */
function serializeCase(caseDoc, notes, recordCount, towerCount) {
  return {
    id: caseDoc.id,
    caseNo: caseDoc.caseNo,
    title: caseDoc.title,
    description: caseDoc.description,
    officer: caseDoc.officer,
    status: caseDoc.status,
    priority: caseDoc.priority,
    openedDate: caseDoc.openedDate,
    createdAt: caseDoc.createdAt,
    updatedAt: caseDoc.updatedAt,
    notes: (notes || []).map((n) => ({ ts: n.ts, text: n.text })),
    recordCount,
    towerCount,
  };
}

// GET /api/cases — list all cases (metadata + note log + cheap counts only;
// never the full CDR/tower arrays, which is what made the old design not
// scale — every page load pulled every byte of every case's data).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const cases = await Case.find(caseAccessFilter(req)).sort({ createdAt: -1 }).lean();
    if (!cases.length) return res.json([]);

    const ids = cases.map((c) => c.id);

    // One aggregation per related collection instead of N+1 queries per case.
    const [noteRows, cdrCounts, towerCounts] = await Promise.all([
      Note.find({ caseId: { $in: ids } }).sort({ ts: 1 }).lean(),
      CdrRecord.aggregate([{ $match: { caseId: { $in: ids } } }, { $group: { _id: '$caseId', n: { $sum: 1 } } }]),
      TowerRecord.aggregate([{ $match: { caseId: { $in: ids } } }, { $group: { _id: '$caseId', n: { $sum: 1 } } }]),
    ]);

    const notesByCase = {};
    for (const n of noteRows) (notesByCase[n.caseId] = notesByCase[n.caseId] || []).push(n);
    const cdrCountByCase = Object.fromEntries(cdrCounts.map((r) => [r._id, r.n]));
    const towerCountByCase = Object.fromEntries(towerCounts.map((r) => [r._id, r.n]));

    res.json(
      cases.map((c) =>
        serializeCase(c, notesByCase[c.id], cdrCountByCase[c.id] || 0, towerCountByCase[c.id] || 0)
      )
    );
  })
);

// GET /api/cases/:id — single case, same shape as one entry of the list above.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const caseDoc = await Case.findOne({ id: req.params.id }).lean();
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (req.user.role !== 'admin' && caseDoc.officer !== req.user.username) return res.status(403).json({ error: 'Forbidden' });

    const [notes, recordCount, towerCount] = await Promise.all([
      Note.find({ caseId: caseDoc.id }).sort({ ts: 1 }).lean(),
      CdrRecord.countDocuments({ caseId: caseDoc.id }),
      TowerRecord.countDocuments({ caseId: caseDoc.id }),
    ]);

    res.json(serializeCase(caseDoc, notes, recordCount, towerCount));
  })
);

// POST /api/cases — create a case (server generates the id if the client
// didn't supply one). New-style creation endpoint alongside the PUT-based
// upsert below, which the current frontend actually uses.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const id = req.body.id || `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const { caseNo, title, description, officer, status, priority, openedDate } = req.body;
    if (!caseNo || !title) return res.status(400).json({ error: 'caseNo and title are required' });
    if (req.user.role !== 'admin' && officer !== req.user.username) return res.status(403).json({ error: 'Investigators may only create cases assigned to themselves' });

    const caseDoc = await Case.create({
      id,
      caseNo,
      title,
      description,
      officer,
      status,
      priority,
      openedDate: openedDate || new Date(),
    });
    await logTimeline(id, 'case_created', `Case "${caseNo}" created.`, undefined, req.user);

    res.status(201).json(serializeCase(caseDoc, [], 0, 0));
  })
);

// PUT /api/cases/:id — upsert by app-generated id. This is what the
// existing frontend's saveCaseForm()/persistCase() calls.
//
// Backward-compatibility note: the *very first* load of an upgraded
// frontend against an empty database still runs its one-time
// localStorage -> backend migration (loadCasesFromStorage in index.html),
// which sends legacy case objects that may still carry an embedded
// `notes` array and/or `savedData: { records, towers }`. Handling that
// here means the legacy migration path keeps working with zero frontend
// changes, even though new saves never send those fields.
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { caseNo, title, description, officer, status, priority, openedDate, notes, savedData } = req.body;
    if (!caseNo || !title) return res.status(400).json({ error: 'caseNo and title are required' });

    const existing = await Case.findOne({ id }).lean();
    if (existing && req.user.role !== 'admin' && existing.officer !== req.user.username) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role !== 'admin' && officer !== req.user.username) return res.status(403).json({ error: 'Investigators may only manage cases assigned to themselves' });
    const update = { id, caseNo, title, description, officer, status, priority };
    if (openedDate) update.openedDate = openedDate;

    const caseDoc = await Case.findOneAndUpdate(
      { id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    await logTimeline(id, existing ? 'case_updated' : 'case_created', `Case "${caseNo}" ${existing ? 'updated' : 'created'}.`, undefined, req.user);

    // Legacy embedded notes -> Note collection (only meaningful on the
    // one-time migration path; harmless no-op otherwise).
    if (Array.isArray(notes) && notes.length) {
      await Note.insertMany(
        notes.map((n) => ({ caseId: id, text: n.text, ts: n.ts ? new Date(n.ts) : new Date() })),
        { ordered: false }
      );
    }

    // Legacy embedded savedData -> normalized collections.
    if (savedData && (Array.isArray(savedData.records) || Array.isArray(savedData.towers))) {
      const records = Array.isArray(savedData.records) ? savedData.records : [];
      const towers = Array.isArray(savedData.towers) ? savedData.towers : [];
      if (records.length) {
        await CdrRecord.deleteMany({ caseId: id }); // legacy payload is a full snapshot, not a delta
        await batchInsert(CdrRecord, records.map((r) => ({ ...r, caseId: id })));
        await logTimeline(id, 'cdr_imported', `${records.length} CDR record(s) migrated from legacy embedded storage.`, undefined, req.user);
      }
      if (towers.length) {
        await TowerRecord.deleteMany({ caseId: id });
        await batchInsert(TowerRecord, towers.map((t) => ({ ...t, caseId: id })));
        await logTimeline(id, 'tower_imported', `${towers.length} tower record(s) migrated from legacy embedded storage.`, undefined, req.user);
      }
      logger.info(`Migrated legacy embedded savedData for case ${id}: ${records.length} records, ${towers.length} towers.`);
    }

    const [noteDocs, recordCount, towerCount] = await Promise.all([
      Note.find({ caseId: id }).sort({ ts: 1 }).lean(),
      CdrRecord.countDocuments({ caseId: id }),
      TowerRecord.countDocuments({ caseId: id }),
    ]);

    res.json(serializeCase(caseDoc, noteDocs, recordCount, towerCount));
  })
);

// DELETE /api/cases/:id — delete the case AND cascade-delete everything
// linked to it. Without this, deleting a case would silently orphan
// millions of CDR rows in the normalized collections.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const caseDoc = await Case.findOne({ id }).lean();
    if (!caseDoc) return res.json({ ok: true }); // already gone — DELETE is idempotent
    if (req.user.role !== 'admin' && caseDoc.officer !== req.user.username) return res.status(403).json({ error: 'Forbidden' });

    await Promise.all([
      Case.deleteOne({ id }),
      CdrRecord.deleteMany({ caseId: id }),
      TowerRecord.deleteMany({ caseId: id }),
      Evidence.deleteMany({ caseId: id }),
      Note.deleteMany({ caseId: id }),
      Task.deleteMany({ caseId: id }),
      Timeline.deleteMany({ caseId: id }),
      GraphCache.deleteMany({ caseId: id }),
      AiAnalysis.deleteMany({ caseId: id }),
    ]);

    await logTimeline(null, 'case_deleted', `Case "${caseDoc.caseNo}" deleted.`, { action: 'case_delete', targetCaseId: id, caseNo: caseDoc.caseNo }, req.user);
    res.json({ ok: true });
  })
);

module.exports = router;
module.exports.batchInsert = batchInsert;
module.exports.BATCH_SIZE = BATCH_SIZE;
