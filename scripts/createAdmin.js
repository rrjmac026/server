require('dotenv').config();
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');

async function createAdmins() {
  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'plantmonitoringdb';

  if (!mongoUri) {
    console.error('❌ MONGODB_URI not defined in .env file');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    console.log('🔗 Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Multiple admin accounts
    const adminAccounts = [
      { email: 'admin@admin.com', username: 'admin', password: 'password' },
      { email: '1901102366@student.buksu.edu.ph', username: 'Rey Rameses Jude III S. Macalutas', password: 'password' }
    ];

    for (const admin of adminAccounts) {
      // Check if admin already exists
      const existingAdmin = await usersCollection.findOne({ email: admin.email });
      if (existingAdmin) {
        console.log(`⚠️ Admin already exists: ${admin.email}`);
        continue;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(admin.password, 10);

      // Insert admin user
      const result = await usersCollection.insertOne({
        email: admin.email,
        username: admin.username,
        password: hashedPassword,
        role: 'admin',
        createdAt: moment().tz('Asia/Manila').toDate(),
        isActive: true,
        lastLogin: null,
        photoUrl: null,
        googleAuth: false
      });

      console.log(`✅ Admin created: ${admin.email} (ID: ${result.insertedId})`);
    }

    console.log('\n📋 Admin Accounts Summary:');
    adminAccounts.forEach(a => {
      console.log('Email:', a.email, '| Username:', a.username, '| Password:', a.password);
    });
    console.log('⚠️ Please change passwords after first login!');

  } catch (error) {
    console.error('❌ Error creating admin users:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✅ Connection closed');
  }
}

createAdmins();
