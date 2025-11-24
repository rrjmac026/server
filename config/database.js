const { MongoClient } = require('mongodb');

if (!process.env.MONGODB_URI) {
    throw new Error('Please define MONGODB_URI in your environment');
}

let client;
let db;

async function connectToDatabase() {
    if (db) return db;

    if (!client) {
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
    }
    
    db = client.db(process.env.MONGODB_DB_NAME || 'plantmonitoringdb');
    console.log('✅ Connected to MongoDB');
    return db;
}

const getCollection = async (collection) => {
    const database = await connectToDatabase();
    return database.collection(collection);
};

module.exports = { connectToDatabase, getCollection };
