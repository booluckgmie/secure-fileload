# Secure File Storage Platform

A secure file storage platform with email token authentication built with Node.js and designed for deployment on Netlify.

## Features

- 🔐 **Email Token Authentication**: Users receive secure access tokens via email
- 📁 **File Upload & Management**: Upload, view, and delete files securely
- 🗂️ **Directory Browsing**: View all uploaded files in a clean interface
- 🛡️ **Security Features**: JWT authentication, file encryption, rate limiting
- 📱 **Responsive Design**: Works on desktop and mobile devices
- ⚡ **Netlify Deployment**: Ready for serverless deployment

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd secure-file-storage
npm install
```

### 2. Environment Setup

Copy the environment variables template:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-gmail-app-password
ADMIN_EMAIL=admin@yourdomain.com
BASE_URL=http://localhost:8888
```

### 3. Gmail App Password Setup

1. Enable 2-Factor Authentication on your Gmail account
2. Go to Google Account settings → Security → App passwords
3. Generate an app password for "Mail"
4. Use this password as `EMAIL_PASS` in your `.env` file

### 4. Local Development

```bash
npm run dev
```

Visit `http://localhost:8888` to test the application.

## Deployment to Netlify

### Option 1: Deploy from GitHub

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Connect to Netlify**:
   - Go to [Netlify](https://netlify.com)
   - Click "New site from Git"
   - Connect your GitHub repository
   - Build settings should be auto-detected from `netlify.toml`

3. **Set Environment Variables** in Netlify Dashboard:
   - Go to Site settings → Environment variables
   - Add all variables from your `.env` file
   - **Important**: Update `BASE_URL` to your Netlify URL (e.g., `https://your-app-name.netlify.app`)

### Option 2: Direct Deploy

```bash
npm install -g netlify-cli
npm run build
netlify deploy --prod --dir=dist
```

## Project Structure

```
secure-file-storage/
├── netlify/
│   └── functions/
│       └── server.js          # Main server logic
├── public/
│   └── index.html            # Frontend application
├── package.json              # Dependencies and scripts
├── netlify.toml             # Netlify configuration
├── .env.example             # Environment variables template
├── .gitignore               # Git ignore rules
└── README.md                # This file
```

## Security Features

- **Email Token Authentication**: Temporary tokens sent via email
- **JWT Tokens**: Secure session management
- **Rate Limiting**: Prevents abuse
- **File Type Validation**: Configurable file type restrictions
- **Size Limits**: 10MB maximum file size (configurable)
- **Access Control**: Users can only access their own files

## API Endpoints

- `POST /api/request-access` - Request email token
- `POST /api/verify-token` - Verify email token and get JWT
- `POST /api/upload` - Upload file (requires auth)
- `GET /api/files` - Get user's files (requires auth)
- `GET /api/files/:id/download` - Download file (requires auth)
- `DELETE /api/files/:id` - Delete file (requires auth)
- `GET /api/user` - Get user info (requires auth)

## Usage Flow

1. **Request Access**: User enters email and clicks "Send Access Token"
2. **Email Verification**: User receives email with access link
3. **Authentication**: Clicking the link logs them into the platform
4. **File Management**: User can upload, view, download, and delete files

## Configuration Options

### File Upload Limits

Edit `netlify/functions/server.js`:

```javascript
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // Change size limit here
  }
});
```

### File Type Restrictions

Add file type validation in the `fileFilter` function:

```javascript
fileFilter: (req, file, cb) => {
  const allowedTypes = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                         // .xls
  'text/csv',                                                         // .csv
  'application/x-sqlite3',                                            // .sqlite
  'application/octet-stream'                                          // generic .db
];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
}
```

### Token Expiry

Change token expiration time:

```javascript
// Email token expiry (default: 1 hour)
expires: Date.now() + 3600000 // 1 hour in milliseconds

// JWT token expiry (default: 24 hours)
{ expiresIn: '24h' }
```

## Production Considerations

1. **Database**: Current implementation uses in-memory storage. For production, implement persistent storage (MongoDB, PostgreSQL, etc.)

2. **File Storage**: Consider using cloud storage (AWS S3, Google Cloud Storage) instead of memory storage

3. **Email Service**: Consider using transactional email services like SendGrid, Mailgun, or AWS SES

4. **Monitoring**: Add logging and monitoring for production use

5. **Backup**: Implement regular backups of user data and files

## Troubleshooting

### Common Issues

1. **Email not sending**: Check Gmail app password and account settings
2. **Build errors**: Ensure all environment variables are set in Netlify
3. **File upload fails**: Check file size limits and available memory
4. **Token expired**: Tokens expire after 1 hour, request a new one

### Development Tips

- Use `netlify dev` for local development with serverless functions
- Check Netlify function logs for debugging
- Test with different file types and sizes
- Verify email delivery in different email clients

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Check the troubleshooting section above
- Review Netlify function logs
- Ensure all environment variables are properly set