const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const mongoose = require('mongoose');
const Evidence = require('../models/Evidence');
const Case = require('../models/Case');
const asyncHandler = require('../utils/asyncHandler');
const { logTimeline } = require('../utils/timelineLogger');

const router = express.Router();
router.use(requireAuth);

// POST /api/cases/:id/evidence — record evidence metadata (file itself is
// expected to already be stored on disk/object storage by the caller;
// this stores the pointer + forensic metadata, not the binary).
router.post(
  '/cases/:id/evidence',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const { fileName, filePath, fileType, hash, uploadedBy, description } = req.body;

    const caseDoc = await Case.exists({ id });
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!fileName || !filePath) return res.status(400).json({ error: 'fileName and filePath are required' });

    const evidence = await Evidence.create({ caseId: id, fileName, filePath, fileType, hash, uploadedBy, description });
    await logTimeline(id, 'evidence_added', `Evidence "${fileName}" added.`, undefined, req.user);

    res.status(201).json(evidence);
  })
);

// GET /api/cases/:id/evidence
router.get(
  '/cases/:id/evidence',
  asyncHandler(async (req, res) => {
    if (!(await assertCaseAccess(req, res, req.params.id))) return;
    const evidence = await Evidence.find({ caseId: req.params.id }).sort({ uploadDate: -1 }).lean();
    res.json(evidence);
  })
);

// DELETE /api/evidence/:id
router.delete(
  '/evidence/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid evidence id' });

    const existing = await Evidence.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Evidence not found' });
    if (!(await assertCaseAccess(req, res, existing.caseId))) return;
    const doc = await Evidence.findByIdAndDelete(id).lean();
    if (!doc) return res.status(404).json({ error: 'Evidence not found' });

    await logTimeline(doc.caseId, 'evidence_deleted', `Evidence "${doc.fileName}" deleted.`, undefined, req.user);
    res.json({ ok: true });
  })
);

module.exports = router;
