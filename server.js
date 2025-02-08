const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Plant Data Routes
app.get('/api/plants', async (req, res) => {
  try {
    const plantsSnapshot = await db.collection('plants').get();
    const plants = [];
    plantsSnapshot.forEach(doc => {
      plants.push({ id: doc.id, ...doc.data() });
    });
    res.json(plants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sensor Data Routes
app.post('/api/sensor-data', async (req, res) => {
  try {
    const { moisture, temperature, plantId } = req.body;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    
    await db.collection('sensor_data').add({
      moisture,
      temperature,
      plantId,
      timestamp
    });

    // Check if notification needs to be sent
    if (moisture < 30) {
      await createNotification(plantId, 'Low moisture level detected!');
    }

    res.json({ message: 'Sensor data recorded successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Notification Routes
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', req.params.userId)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    
    const notifications = [];
    notificationsSnapshot.forEach(doc => {
      notifications.push({ id: doc.id, ...doc.data() });
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function createNotification(plantId, message) {
  try {
    const plant = await db.collection('plants').doc(plantId).get();
    const userId = plant.data().userId;
    
    await db.collection('notifications').add({
      userId,
      plantId,
      message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
