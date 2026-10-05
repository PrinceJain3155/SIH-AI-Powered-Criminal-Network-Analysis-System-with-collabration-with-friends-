const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const mongoose = require('mongoose');
const CdrRecord = require('../models/CdrRecord');
const Case = require('../models/Case');
const asyncHandler = require('../utils/asyncHandler');
const { logTimeline } = require('../utils/timelineLogger');
const { batchInsert, BATCH_SIZE } = require('./cases');

const router = express.Router();
router.use(requireAuth);

// POST /api/cases/:id/import-cdr
// Body: { records: [...], mode: 'replace' | 'append' }
//
// Designed to be called repeatedly by the client with chunks of ~1000
// records (see CDR_IMPORT_CHUNK_SIZE in index.html) so that:
//   - a multi-million-row import never has to fit in one HTTP request body
//   - the frontend can show real import progress
//   - the server never has to buffer the entire import in memory at once
// `mode: 'replace'` (only needs to be sent on the FIRST chunk of an
// import) clears any existing CDR data for the case first — this matches
// the old frontend behavior where importing a new CSV into a case replaced
// its previously saved records rather than appending to them. Every
// subsequent chunk in the same import should use mode: 'append' (or omit
// it, since 'append' is the default) so it doesn't wipe the chunks that
// were just inserted.
router.post(
  '/cases/:id/import-cdr',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const { records, mode } = req.body;

    const caseDoc = await Case.exists({ id });
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!Array.isArray(records)) return res.status(400).json({ error: '"records" must be an array' });

    if (mode === 'replace') {
      await CdrRecord.deleteMany({ caseId: id });
    }

    const inserted = records.length ? await batchInsert(CdrRecord, records.map((r) => ({ ...r, caseId: id })), BATCH_SIZE) : 0;

    if (inserted) {
      await logTimeline(id, 'cdr_imported', `${inserted} CDR record(s) imported.`, { count: inserted }, req.user);
    }

    res.json({ ok: true, inserted });
  })
);

// GET /api/cases/:id/cdr — cursor-based pagination.
// Query params: cursor (last-seen _id), limit (default 1000, max 5000)
// Returns { records, nextCursor, hasMore }. Sorting by _id (insertion
// order) keeps pagination O(limit) per page via an indexed range scan,
// unlike skip/limit which gets slower the deeper you page.
router.get(
  '/cases/:id/cdr',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const cursor = req.query.cursor;

    const query = { caseId: id };
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor)) return res.status(400).json({ error: 'Invalid cursor' });
      query._id = { $gt: cursor };
    }

    // Projection excludes Mongoose's __v; keep _id since it's the cursor.
    const records = await CdrRecord.find(query, { __v: 0 })
      .sort({ _id: 1 })
      .limit(limit + 1) // fetch one extra to know if there's a next page, without a separate count query
      .lean();

    const hasMore = records.length > limit;
    if (hasMore) records.pop();

    res.json({
      records,
      nextCursor: hasMore ? String(records[records.length - 1]._id) : null,
      hasMore,
    });
  })
);

// GET /api/cases/:id/cdr/count — cheap total, used by the frontend's
// import-progress / case-list display instead of pulling all records.
router.get(
  '/cases/:id/cdr/count',
  asyncHandler(async (req, res) => {
    if (!(await assertCaseAccess(req, res, req.params.id))) return;
    const count = await CdrRecord.countDocuments({ caseId: req.params.id });
    res.json({ count });
  })
);

// DELETE /api/cdr/:recordId — delete a single record.
router.delete(
  '/cdr/:recordId',
  asyncHandler(async (req, res) => {
    const { recordId } = req.params;
    if (!mongoose.isValidObjectId(recordId)) return res.status(400).json({ error: 'Invalid record id' });

    const existing = await CdrRecord.findById(recordId).lean();
    if (!existing) return res.status(404).json({ error: 'Record not found' });
    if (!(await assertCaseAccess(req, res, existing.caseId))) return;
    const doc = await CdrRecord.findByIdAndDelete(recordId).lean();
    if (!doc) return res.status(404).json({ error: 'Record not found' });

    await logTimeline(doc.caseId, 'cdr_deleted', `1 CDR record deleted.`, undefined, req.user);
    res.json({ ok: true });
  })
);

// DELETE /api/cases/:id/cdr — bulk-clear all CDR records for a case.
router.delete(
  '/cases/:id/cdr',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const result = await CdrRecord.deleteMany({ caseId: id });
    if (result.deletedCount) await logTimeline(id, 'cdr_deleted', `${result.deletedCount} CDR record(s) cleared.`, undefined, req.user);
    res.json({ ok: true, deletedCount: result.deletedCount });
  })
);

module.exports = router;
