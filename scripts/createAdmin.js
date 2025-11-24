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

    // Test connection
    await client.db('admin').command({ ping: 1 });
    console.log('✅ MongoDB ping successful');

    const db = client.db(dbName);
    
    // Ensure collection exists with indexes
    const usersCollection = db.collection('users');
    
    // Create unique index on email
    try {
      await usersCollection.createIndex({ email: 1 }, { unique: true });
      console.log('✅ Email unique index created');
    } catch (err) {
      console.log('ℹ️ Email index already exists');
    }

    // Multiple admin accounts
    const adminAccounts = [
      { 
        email: 'admin@admin.com', 
        username: 'admin', 
        password: 'password' 
      },
      { 
        email: '1901102366@student.buksu.edu.ph', 
        username: 'Rey Rameses Jude III S. Macalutas', 
        password: 'password' 
      }
    ];

    let createdCount = 0;
    let skippedCount = 0;

    for (const admin of adminAccounts) {
      // Check if admin already exists
      const existingAdmin = await usersCollection.findOne({ email: admin.email });
      if (existingAdmin) {
        console.log(`⚠️  Admin already exists: ${admin.email}`);
        skippedCount++;
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
        updatedAt: moment().tz('Asia/Manila').toDate(),
        isActive: true,
        lastLogin: null,
        photoUrl: null,
        googleAuth: false
      });

      console.log(`✅ Admin created: ${admin.email} (ID: ${result.insertedId})`);
      createdCount++;
    }

    console.log('\n📋 Admin Accounts Summary:');
    console.log('================================');
    adminAccounts.forEach(a => {
      console.log(`📧 Email:    ${a.email}`);
      console.log(`👤 Username: ${a.username}`);
      console.log(`🔑 Password: ${a.password}`);
      console.log('--------------------------------');
    });
    console.log(`\n✅ Created: ${createdCount} | ⏭️  Skipped: ${skippedCount}`);
    console.log('⚠️  Please change passwords after first login!');

    // Verify insertion
    const allUsers = await usersCollection.countDocuments();
    console.log(`\n📊 Total users in database: ${allUsers}`);

  } catch (error) {
    console.error('❌ Error creating admin users:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✅ Connection closed');
  }
}

createAdmins();
