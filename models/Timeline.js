/**
 * Timeline — audit log of actions taken on a case (NOT the call-activity
 * timeline chart already on the frontend's "Timeline" page, which is
 * derived client-side from CDR records and is unaffected by this).
 * Entries are created automatically by the route handlers below via
 * utils/timelineLogger.js whenever a case-level action happens.
 */
const { mongoose } = require('../db');

const TimelineSchema = new mongoose.Schema(
  {
    caseId: { type: String, default: null, index: true },
    type: {
      type: String,
      required: true,
      enum: [
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
      ],
      index: true,
    },
    message: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ts: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

TimelineSchema.index({ caseId: 1, ts: -1 });
TimelineSchema.index({ 'meta.actor.username': 1, ts: -1 });
TimelineSchema.index({ type: 1, ts: -1 });

module.exports = mongoose.models.Timeline || mongoose.model('Timeline', TimelineSchema);
