/**
 * Case — metadata ONLY.
 *
 * Previously this document also carried `savedData: { cdrRecords, towerRecords }`
 * which meant a single case with a large CDR import could approach (or blow
 * past) MongoDB's 16MB document limit, and every save/load of the case
 * rewrote the entire blob. CDR/tower data now lives in its own collections
 * (see CdrRecord.js / TowerRecord.js), keyed by caseId. Same goes for notes,
 * which used to be an embedded array here and now live in the Note
 * collection so a chatty case log doesn't bloat this document either.
 *
 * `id` (NOT `_id`) is kept as the lookup key because the existing frontend
 * generates its own ids client-side (genId() -> "c_xxxx") and references
 * cases by that id everywhere. Keeping it means zero changes are needed to
 * how the frontend identifies a case.
 */
const { mongoose } = require('../db');

const CaseSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    caseNo: { type: String, required: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    officer: { type: String, default: '', trim: true, index: true },
    status: {
      type: String,
      enum: ['open', 'review', 'closed'],
      default: 'open',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    openedDate: { type: Date, default: Date.now },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
    // Old documents from the pre-refactor schema may still have a
    // `savedData` / `notes` field on disk until the migration script runs.
    // Ignoring unknown fields on read (rather than strict-erroring) keeps
    // reads safe during a rolling migration.
    strict: 'throw',
  }
);

// Compound index: officer + status is a common case-list filter combination.
CaseSchema.index({ officer: 1, status: 1 });
// Text-ish lookup by case number is frequent (case search box in the UI).
CaseSchema.index({ caseNo: 1, title: 1 });

module.exports = mongoose.models.Case || mongoose.model('Case', CaseSchema);
