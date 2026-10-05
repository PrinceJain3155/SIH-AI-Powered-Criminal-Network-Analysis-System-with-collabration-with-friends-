require('dotenv').config();
const bcrypt = require('bcrypt');
const { connect } = require('../db');
const User = require('../models/User');

const MIN_PASSWORD_LENGTH = 8;

async function main() {
  const username = process.env.FIRST_ADMIN_USERNAME;
  const password = process.env.FIRST_ADMIN_PASSWORD;
  const email = process.env.FIRST_ADMIN_EMAIL || `${username || 'admin'}@localhost`;

  if (!username || !password) {
    throw new Error('Set FIRST_ADMIN_USERNAME and FIRST_ADMIN_PASSWORD before running this script.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('FIRST_ADMIN_PASSWORD must be at least 8 characters.');
  }

  await connect();
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    console.log(`User already exists: ${existing.username}`);
    process.exitCode = 0;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ username, email, passwordHash, role: 'admin', status: 'active' });
  console.log(`Created first admin user: ${user.username}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
