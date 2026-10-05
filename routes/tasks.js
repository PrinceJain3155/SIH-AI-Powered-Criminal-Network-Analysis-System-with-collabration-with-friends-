const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const Case = require('../models/Case');
const asyncHandler = require('../utils/asyncHandler');
const { logTimeline } = require('../utils/timelineLogger');

const router = express.Router();
router.use(requireAuth);

// POST /api/cases/:id/tasks
router.post(
  '/cases/:id/tasks',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const { task, officer, dueDate, status, priority } = req.body;

    const caseDoc = await Case.exists({ id });
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    if (!task) return res.status(400).json({ error: 'task is required' });

    const taskDoc = await Task.create({ caseId: id, task, officer, dueDate, status, priority });
    await logTimeline(id, 'task_added', `Task "${task}" added.`, undefined, req.user);

    res.status(201).json(taskDoc);
  })
);

// GET /api/cases/:id/tasks
router.get(
  '/cases/:id/tasks',
  asyncHandler(async (req, res) => {
    if (!(await assertCaseAccess(req, res, req.params.id))) return;
    const tasks = await Task.find({ caseId: req.params.id }).sort({ dueDate: 1 }).lean();
    res.json(tasks);
  })
);

// PUT /api/tasks/:id
router.put(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid task id' });
    const existingTask = await Task.findById(id).lean();
    if (!existingTask) return res.status(404).json({ error: 'Task not found' });
    if (!(await assertCaseAccess(req, res, existingTask.caseId))) return;

    const { task, officer, dueDate, status, priority } = req.body;
    const taskDoc = await Task.findByIdAndUpdate(
      id,
      { $set: { task, officer, dueDate, status, priority } },
      { new: true, runValidators: true }
    );
    if (!taskDoc) return res.status(404).json({ error: 'Task not found' });

    await logTimeline(taskDoc.caseId, 'task_updated', `Task "${taskDoc.task}" updated.`, undefined, req.user);
    res.json(taskDoc);
  })
);

module.exports = router;
