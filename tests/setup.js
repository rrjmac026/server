const { MongoMemoryServer } = require('mongodb-memory-server');
const { getCollection } = require('../config/database');

let mongoServer;

// Start in-memory MongoDB for testing
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.MONGODB_DB_NAME = 'test_plant_db';
});

// Stop MongoDB after tests
afterAll(async () => {
  if (mongoServer) {
    await mongoServer.stop();
  }
});

// Clear database between tests
beforeEach(async () => {
  const collections = ['sensor_data', 'audit_logs', 'schedules'];
  for (const collName of collections) {
    const collection = await getCollection(collName);
    await collection.deleteMany({});
  }
});

module.exports = { getCollection };
