const { mongoose } = require('../db');

const TaskSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },
    task: { type: String, required: true },
    officer: { type: String, default: '', index: true },
    dueDate: { type: Date },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'done', 'blocked'],
      default: 'pending',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
  },
  { timestamps: true }
);

TaskSchema.index({ caseId: 1, status: 1 });

module.exports = mongoose.models.Task || mongoose.model('Task', TaskSchema);
