const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Timeline = require('../models/Timeline');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logTimeline } = require('../utils/timelineLogger');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/users', asyncHandler(async (_req, res) => {
  const users = await User.find({}).sort({ createdAt: -1 }).select('-passwordHash').lean();
  res.json(users);
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid user id' });
  const allowedRoles = ['admin', 'investigator'];
  const allowedStatuses = ['active', 'disabled'];
  const updates = {};
  if (req.body.role !== undefined) {
    if (!allowedRoles.includes(req.body.role)) return res.status(400).json({ error: 'Invalid role' });
    updates.role = req.body.role;
  }
  if (req.body.status !== undefined) {
    if (!allowedStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
    updates.status = req.body.status;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No supported changes supplied' });

  if (String(req.user._id) === String(id) && (updates.status === 'disabled' || updates.role === 'investigator')) {
    return res.status(400).json({ error: 'You cannot disable or demote your own admin account' });
  }

  const before = await User.findById(id).lean();
  if (!before) return res.status(404).json({ error: 'User not found' });
  const user = await User.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true }).select('-passwordHash').lean();

  if (updates.role && updates.role !== before.role) {
    await logTimeline(null, 'admin_user_action', `Admin changed role for user "${before.username}" from ${before.role} to ${updates.role}.`, {
      action: 'role_change', targetUserId: String(before._id), targetUsername: before.username, from: before.role, to: updates.role,
    }, req.user);
  }
  if (updates.status && updates.status !== before.status) {
    await logTimeline(null, 'admin_user_action', `Admin changed status for user "${before.username}" to ${updates.status}.`, {
      action: updates.status === 'disabled' ? 'disable' : 'enable', targetUserId: String(before._id), targetUsername: before.username, from: before.status, to: updates.status,
    }, req.user);
  }

  res.json(user);
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid user id' });
  if (String(req.user._id) === String(id)) return res.status(400).json({ error: 'You cannot delete your own admin account' });

  const user = await User.findById(id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  await User.deleteOne({ _id: id });
  await logTimeline(null, 'admin_user_action', `Admin deleted user "${user.username}".`, {
    action: 'delete', targetUserId: String(user._id), targetUsername: user.username, role: user.role, status: user.status,
  }, req.user);
  res.json({ ok: true });
}));

const AUDIT_TYPES = [
  'case_created',
  'case_updated',
  'case_deleted',
  'cdr_imported',
  'cdr_deleted',
  'tower_imported',
  'evidence_added',
  'evidence_deleted',
  'note_added',
  'task_added',
  'task_updated',
  'ai_analysis_generated',
  'admin_user_action',
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAuditDate(value, endOfDay = false) {
  if (!value || typeof value !== 'string') return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

// GET /api/admin/audit-log — read-only global audit trail with filtering + pagination.
router.get('/audit-log', asyncHandler(async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  if (page > 10000) return res.status(400).json({ error: 'Page is too large' });

  const filter = {};
  if (req.query.actor) {
    const actor = String(req.query.actor).trim();
    if (actor.length > 100) return res.status(400).json({ error: 'actor filter is too long' });
    filter['meta.actor.username'] = actor;
  }
  if (req.query.type) {
    const type = String(req.query.type).trim();
    if (!AUDIT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid audit action type' });
    filter.type = type;
  }
  if (req.query.caseId) {
    const caseId = String(req.query.caseId).trim();
    if (caseId.length > 120) return res.status(400).json({ error: 'caseId filter is too long' });
    filter.caseId = caseId;
  }

  const from = parseAuditDate(req.query.from);
  if (req.query.from && !from) return res.status(400).json({ error: 'Invalid from date' });
  const to = parseAuditDate(req.query.to, true);
  if (req.query.to && !to) return res.status(400).json({ error: 'Invalid to date' });
  if (from || to) filter.ts = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const query = String(req.query.q || '').trim();
  if (query) {
    if (query.length > 100) return res.status(400).json({ error: 'Search query is too long' });
    const rx = new RegExp(escapeRegex(query), 'i');
    filter.$or = [
      { message: rx },
      { type: rx },
      { caseId: rx },
      { 'meta.actor.username': rx },
      { 'meta.actor.id': rx },
    ];
  }

  const [entries, total] = await Promise.all([
    Timeline.find(filter)
      .sort({ ts: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Timeline.countDocuments(filter),
  ]);

  res.json({
    entries: entries.map((entry) => ({
      _id: entry._id,
      caseId: entry.caseId || null,
      type: entry.type,
      message: entry.message,
      meta: entry.meta || null,
      ts: entry.ts,
      actor: entry.meta?.actor || null,
    })),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  });
}));
module.exports = router;
