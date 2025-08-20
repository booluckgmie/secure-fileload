const express = require('express');
const serverless = require('serverless-http');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs').promises;

const app = express();

// Environment variables (set in Netlify dashboard)
const JWT_SECRET = process.env.JWT_SECRET || '0f6ade702b5cd881ac1b8e557ed51771';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const BASE_URL = process.env.BASE_URL || 'https://nexaflow.netlify.app';

// In-memory storage for demo (use database in production)
let users = new Map();
let files = new Map();
let tokens = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../dist')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Email configuration
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// File storage configuration
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 1000000 * 1024 * 1024 // 1GB limit
  },
  fileFilter: (req, file, cb) => {
    // Add file type restrictions if needed
    cb(null, true);
  }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Routes

// Request access token
app.post('/api/request-access', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Generate access token
    const accessToken = uuidv4();
    const hashedToken = await bcrypt.hash(accessToken, 10);
    
    // Store token with expiry (1 hour)
    const tokenData = {
      email,
      hashedToken,
      expires: Date.now() + 3600000 // 1 hour
    };
    
    tokens.set(accessToken, tokenData);
    
    // Send email
    const mailOptions = {
      from: EMAIL_USER,
      to: email,
      subject: 'Secure File Storage - Access Token',
      html: `
        <h2>Access Token for Secure File Storage</h2>
        <p>Click the link below to access the file storage platform:</p>
        <p><a href="${BASE_URL}?token=${accessToken}">Access File Storage</a></p>
        <p>This token expires in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    
    res.json({ message: 'Access token sent to your email' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send access token' });
  }
});

// Verify token and get JWT
app.post('/api/verify-token', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  const tokenData = tokens.get(token);
  
  if (!tokenData) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (Date.now() > tokenData.expires) {
    tokens.delete(token);
    return res.status(401).json({ error: 'Token expired' });
  }

  try {
    // Create user if doesn't exist
    if (!users.has(tokenData.email)) {
      users.set(tokenData.email, {
        id: uuidv4(),
        email: tokenData.email,
        createdAt: new Date().toISOString()
      });
    }

    const user = users.get(tokenData.email);
    
    // Generate JWT
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Remove used token
    tokens.delete(token);

    res.json({ 
      token: jwtToken, 
      user: { id: user.id, email: user.email } 
    });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// Upload file
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileId = uuidv4();
  const fileData = {
    id: fileId,
    originalName: req.file.originalname,
    filename: `${fileId}_${req.file.originalname}`,
    size: req.file.size,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
    uploadedBy: req.user.id,
    uploadedAt: new Date().toISOString()
  };

  files.set(fileId, fileData);

  res.json({
    id: fileId,
    filename: fileData.filename,
    originalName: fileData.originalName,
    size: fileData.size,
    mimeType: fileData.mimeType,
    uploadedAt: fileData.uploadedAt
  });
});

// Get file list (directory)
app.get('/api/files', authenticateToken, (req, res) => {
  const userFiles = [];
  
  for (const [id, file] of files) {
    if (file.uploadedBy === req.user.id) {
      userFiles.push({
        id: file.id,
        filename: file.filename,
        originalName: file.originalName,
        size: file.size,
        mimeType: file.mimeType,
        uploadedAt: file.uploadedAt
      });
    }
  }

  res.json(userFiles);
});

// Download file
app.get('/api/files/:id/download', authenticateToken, (req, res) => {
  const fileId = req.params.id;
  const file = files.get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (file.uploadedBy !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.set({
    'Content-Type': file.mimeType,
    'Content-Disposition': `attachment; filename="${file.originalName}"`,
    'Content-Length': file.size
  });

  res.send(file.buffer);
});

// Delete file
app.delete('/api/files/:id', authenticateToken, (req, res) => {
  const fileId = req.params.id;
  const file = files.get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (file.uploadedBy !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  files.delete(fileId);
  res.json({ message: 'File deleted successfully' });
});

// Get user info
app.get('/api/user', authenticateToken, (req, res) => {
  const user = users.get(req.user.email);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({ id: user.id, email: user.email });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports.handler = serverless(app);