/**
 * db.js — single shared Mongoose connection.
 *
 * Every model/route imports the same connection instead of opening its own,
 * so we get one pooled connection to MongoDB for the whole process.
 */
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'cdrIntelligence';

async function connect() {
  mongoose.set('strictQuery', true);

  await mongoose.connect(MONGODB_URI, {
    dbName: DB_NAME,
    // Connection pooling — reused across every request instead of opening
    // a new socket per query. maxPoolSize scales with concurrent requests;
    // minPoolSize keeps a few warm so the first requests after idle time
    // aren't stuck paying connection-setup latency.
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 50,
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected — mongoose will attempt to reconnect automatically.');
  });

  return mongoose.connection;
}

module.exports = { connect, mongoose, DB_NAME, MONGODB_URI };
