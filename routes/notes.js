const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const Note = require('../models/Note');
const Case = require('../models/Case');
const asyncHandler = require('../utils/asyncHandler');
const { logTimeline } = require('../utils/timelineLogger');

const router = express.Router();
router.use(requireAuth);

// POST /api/cases/:id/notes — add a case log entry. Replaces the old flow
// where a note was pushed into case.notes client-side and the whole case
// document was re-saved.
router.post(
  '/cases/:id/notes',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const { text } = req.body;

    const caseDoc = await Case.exists({ id });
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

    const note = await Note.create({ caseId: id, text: text.trim() });
    await logTimeline(id, 'note_added', `Note added: "${text.trim().slice(0, 80)}${text.length > 80 ? '…' : ''}"`, undefined, req.user);

    res.status(201).json(note);
  })
);

// GET /api/cases/:id/notes
router.get(
  '/cases/:id/notes',
  asyncHandler(async (req, res) => {
    if (!(await assertCaseAccess(req, res, req.params.id))) return;
    const notes = await Note.find({ caseId: req.params.id }).sort({ ts: 1 }).lean();
    res.json(notes);
  })
);

module.exports = router;
