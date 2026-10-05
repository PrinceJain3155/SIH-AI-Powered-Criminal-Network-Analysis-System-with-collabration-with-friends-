/**
 * CDR Intelligence — backend (normalized, production architecture)
 *
 * A browser can't open a raw MongoDB connection, so this Express server is
 * the bridge: it holds the real (pooled) MongoDB connection via Mongoose,
 * and the HTML app talks to it over plain HTTP.
 *
 * ARCHITECTURE CHANGE FROM THE ORIGINAL VERSION:
 * Cases used to store an embedded `savedData: { records, towers }` blob
 * directly on the Case document. That doesn't scale — MongoDB has a 16MB
 * document limit, every case load/save moved the entire blob over the
 * wire, and there was no way to index or query individual records. This
 * version splits storage into one collection per concern (cases,
 * cdr_records, tower_records, evidence, notes, tasks, timeline,
 * graph_cache, ai_analysis), each properly indexed, with bulk/paginated
 * APIs designed to handle millions of CDR records. See routes/*.js and
 * models/*.js for the details, and scripts/migrate.js for how existing
 * embedded-format data is moved over.
 *
 * Run:
 *   npm install
 *   npm start
 *
 * Config (env vars, see .env.example):
 *   PORT              - port this server listens on (default 4000)
 *   MONGODB_URI       - your MongoDB connection string (default mongodb://localhost:27017)
 *   DB_NAME           - database name to use (default "cdrIntelligence")
 *   MONGO_MAX_POOL_SIZE / MONGO_MIN_POOL_SIZE - connection pool sizing
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { connect, DB_NAME, MONGODB_URI } = require('./db');
const logger = require('./utils/logger');

const casesRouter = require('./routes/cases');
const cdrRouter = require('./routes/cdr');
const towersRouter = require('./routes/towers');
const evidenceRouter = require('./routes/evidence');
const notesRouter = require('./routes/notes');
const tasksRouter = require('./routes/tasks');
const timelineRouter = require('./routes/timeline');
const graphRouter = require('./routes/graph');
const analysisRouter = require('./routes/analysis');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 4000;

async function start() {
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be configured.');
  }
  await connect();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  // Individual CDR imports are now sent in ~1000-record batches (see
  // routes/cdr.js and the frontend's chunked importer), so the body limit
  // can be far smaller than the old "whole case in one request" design
  // needed. 25mb comfortably covers a 1000-row batch with room to spare.
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, db: DB_NAME });
  });

  // Authentication / administration
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);

  // Cases (metadata CRUD) — GET/POST/PUT/DELETE /api/cases[...]
  app.use('/api/cases', casesRouter);

  // Everything below is mounted at /api directly because several of these
  // resources are addressed two ways: nested under a case
  // (/api/cases/:id/cdr) for listing/importing, and by their own id
  // (/api/cdr/:recordId) for single-record operations.
  app.use('/api', cdrRouter);
  app.use('/api', towersRouter);
  app.use('/api', evidenceRouter);
  app.use('/api', notesRouter);
  app.use('/api', tasksRouter);
  app.use('/api', timelineRouter);
  app.use('/api', graphRouter);
  app.use('/api', analysisRouter);

  // 404 for unmatched /api/* routes.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
  });

  // Centralized error handler — every route uses asyncHandler() to forward
  // errors here instead of leaking stack traces to the client or crashing
  // the process on an unhandled rejection.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    logger.error(`${req.method} ${req.originalUrl} failed:`, err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate key', detail: err.keyValue });
    }
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  });

  app.listen(PORT, () => {
    logger.info(`Connected to MongoDB (${MONGODB_URI}) → database "${DB_NAME}"`);
    logger.info(`CDR Intelligence backend listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start: could not connect to MongoDB.', err.message);
  logger.error(`Checked MONGODB_URI="${MONGODB_URI}" — make sure your MongoDB is running and reachable at this address.`);
  process.exit(1);
});
