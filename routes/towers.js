const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const mongoose = require('mongoose');
const TowerRecord = require('../models/TowerRecord');
const Case = require('../models/Case');
const asyncHandler = require('../utils/asyncHandler');
const { logTimeline } = require('../utils/timelineLogger');
const { batchInsert, BATCH_SIZE } = require('./cases');

const router = express.Router();
router.use(requireAuth);

// POST /api/cases/:id/import-towers — same chunked-import contract as
// import-cdr (see routes/cdr.js for details).
router.post(
  '/cases/:id/import-towers',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const { towers, mode } = req.body;

    const caseDoc = await Case.exists({ id });
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!Array.isArray(towers)) return res.status(400).json({ error: '"towers" must be an array' });

    if (mode === 'replace') {
      await TowerRecord.deleteMany({ caseId: id });
    }

    const inserted = towers.length ? await batchInsert(TowerRecord, towers.map((t) => ({ ...t, caseId: id })), BATCH_SIZE) : 0;

    if (inserted) {
      await logTimeline(id, 'tower_imported', `${inserted} tower record(s) imported.`, { count: inserted }, req.user);
    }

    res.json({ ok: true, inserted });
  })
);

// GET /api/cases/:id/towers — tower lists per case are typically much
// smaller than CDR data (hundreds-thousands, not millions), so this
// returns everything by default; pass ?limit=N&cursor=... to page it the
// same way /cdr does if a case ever has an unusually large tower master.
router.get(
  '/cases/:id/towers',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const limit = Math.min(Number(req.query.limit) || 20000, 50000);
    const cursor = req.query.cursor;

    const query = { caseId: id };
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor)) return res.status(400).json({ error: 'Invalid cursor' });
      query._id = { $gt: cursor };
    }

    const towers = await TowerRecord.find(query, { __v: 0 }).sort({ _id: 1 }).limit(limit + 1).lean();
    const hasMore = towers.length > limit;
    if (hasMore) towers.pop();

    res.json({ towers, nextCursor: hasMore ? String(towers[towers.length - 1]._id) : null, hasMore });
  })
);

// DELETE /api/towers/:towerId
router.delete(
  '/towers/:towerId',
  asyncHandler(async (req, res) => {
    const { towerId } = req.params;
    if (!mongoose.isValidObjectId(towerId)) return res.status(400).json({ error: 'Invalid tower id' });

    const existing = await TowerRecord.findById(towerId).lean();
    if (!existing) return res.status(404).json({ error: 'Tower record not found' });
    if (!(await assertCaseAccess(req, res, existing.caseId))) return;
    const doc = await TowerRecord.findByIdAndDelete(towerId).lean();
    if (!doc) return res.status(404).json({ error: 'Tower record not found' });

    res.json({ ok: true });
  })
);

// DELETE /api/cases/:id/towers — bulk-clear.
router.delete(
  '/cases/:id/towers',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const result = await TowerRecord.deleteMany({ caseId: id });
    res.json({ ok: true, deletedCount: result.deletedCount });
  })
);

module.exports = router;
