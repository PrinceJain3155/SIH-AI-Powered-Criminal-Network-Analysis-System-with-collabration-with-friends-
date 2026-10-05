const Timeline = require('../models/Timeline');
const logger = require('./logger');

/**
 * Fire-and-log a timeline entry. Deliberately does not throw on failure —
 * a broken timeline write should never fail the primary operation.
 *
 * actor is the authenticated user object (username/_id). It is stored in
 * meta.actor so every audit entry records who performed the action.
 */
async function logTimeline(caseId, type, message, meta, actor) {
  try {
    const safeMeta = { ...(meta || {}) };
    if (actor) {
      safeMeta.actor = {
        id: String(actor._id || actor.id || ''),
        username: actor.username,
      };
    }
    await Timeline.create({ caseId: caseId || null, type, message, meta: safeMeta });
  } catch (err) {
    logger.error(`Failed to write timeline entry (case ${caseId || 'system'}, type ${type}):`, err.message);
  }
}

module.exports = { logTimeline };
