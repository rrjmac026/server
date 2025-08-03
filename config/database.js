require('dotenv').config();
const { MongoClient } = require('mongodb');

if (!process.env.MONGODB_URI) {
    throw new Error('Please define MONGODB_URI in your environment');
}

let client;
let db;

class DatabaseConfig {
    static async connectToDatabase() {
        if (db) return db;

        if (!client) {
            client = new MongoClient(process.env.MONGODB_URI);
            await client.connect();
            console.log('✅ Connected to MongoDB');
        }
        
        db = client.db(process.env.MONGODB_DB_NAME || 'plantmonitoringdb');
        return db;
    }

    static async getCollection(collectionName) {
        const database = await this.connectToDatabase();
        return database.collection(collectionName);
    }

    static async closeConnection() {
        if (client) {
            await client.close();
            client = null;
            db = null;
            console.log('✅ Database connection closed');
        }
    }
}

module.exports = DatabaseConfig;