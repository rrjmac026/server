const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getCollection } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

// User registration
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, username, role = 'user' } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, password, and username are required' 
      });
    }

    const usersCollection = await getCollection('users');
    
    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        error: 'User already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await usersCollection.insertOne({
      email,
      username,
      password: hashedPassword,
      role: role === 'admin' ? 'admin' : 'user',
      createdAt: new Date(),
      isActive: true,
      lastLogin: null,
    });

    // Create JWT token
    const token = jwt.sign(
      { 
        id: result.insertedId, 
        email, 
        role: role === 'admin' ? 'admin' : 'user',
        username 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: result.insertedId,
        email,
        username,
        role: role === 'admin' ? 'admin' : 'user',
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Registration failed' 
    });
  }
});

// User login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password are required' 
      });
    }

    const usersCollection = await getCollection('users');
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    // Update last login
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    // Create JWT token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role,
        username: user.username 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Login failed' 
    });
  }
});

// Google authentication
router.post('/auth/google', async (req, res) => {
  try {
    const { email, displayName, photoUrl, idToken, accessToken } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }

    const usersCollection = await getCollection('users');
    
    let user = await usersCollection.findOne({ email });

    if (!user) {
      // Create new user from Google login (always starts as 'user' role)
      const result = await usersCollection.insertOne({
        email,
        username: displayName || email.split('@')[0],
        password: null,
        role: 'user', // Default role for new users
        photoUrl,
        createdAt: new Date(),
        isActive: true,
        lastLogin: new Date(),
        googleAuth: true,
      });

      user = {
        _id: result.insertedId,
        email,
        username: displayName || email.split('@')[0],
        role: 'user',
      };
    } else {
      // Update last login
      await usersCollection.updateOne(
        { _id: user._id },
        { $set: { lastLogin: new Date() } }
      );
    }

    // Create JWT token with role
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role,
        username: user.username 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Google authentication failed' 
    });
  }
});

// Verify token
router.post('/auth/verify', authenticateToken, async (req, res) => {
  try {
    const usersCollection = await getCollection('users');
    const user = await usersCollection.findOne({ _id: req.user.id });

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Token verification failed' 
    });
  }
});

// Get all users (admin only)
router.get('/auth/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Admin access required' 
      });
    }

    const usersCollection = await getCollection('users');
    const users = await usersCollection.find({}, { 
      projection: { password: 0 } 
    }).toArray();

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch users' 
    });
  }
});

// Update user role (admin only)
router.patch('/auth/users/:userId/role', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Admin access required' 
      });
    }

    const { userId } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid role' 
      });
    }

    const usersCollection = await getCollection('users');
    const result = await usersCollection.updateOne(
      { _id: userId },
      { $set: { role } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    res.json({
      success: true,
      message: 'User role updated successfully',
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update user role' 
    });
  }
});

// Delete user (admin only)
router.delete('/auth/users/:userId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Admin access required' 
      });
    }

    const { userId } = req.params;
    const usersCollection = await getCollection('users');
    
    const result = await usersCollection.deleteOne({ _id: userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete user' 
    });
  }
});

module.exports = router;
