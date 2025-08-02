#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up DeFi Arbitrage Bot...\n');

// Check Node.js version
const nodeVersion = process.version;
const requiredVersion = 'v18.0.0';
if (nodeVersion < requiredVersion) {
    console.error(`❌ Node.js ${requiredVersion} or higher is required. Current version: ${nodeVersion}`);
    process.exit(1);
}
console.log(`✅ Node.js version check passed: ${nodeVersion}`);

// Check if .env file exists
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
    console.log('📝 Creating .env file from template...');
    const envTemplate = `# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=arbitrage_bot
DB_USER=postgres
DB_PASSWORD=your_password_here

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Blockchain Configuration
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
POLYGON_RPC_URL=https://polygon-mainnet.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE
ARBITRAGE_CONTRACT_ADDRESS=YOUR_CONTRACT_ADDRESS_HERE

# Application Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Security
JWT_SECRET=your_jwt_secret_here
API_KEYS=api_key_1,api_key_2

# Notification URLs (optional)
SLACK_WEBHOOK_URL=
DISCORD_WEBHOOK_URL=
`;
    
    fs.writeFileSync(envPath, envTemplate);
    console.log('✅ .env file created. Please update it with your configuration.');
} else {
    console.log('✅ .env file already exists');
}

// Create logs directory
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log('✅ Logs directory created');
}

// Install dependencies
try {
    console.log('📦 Installing dependencies...');
    execSync('npm install', { stdio: 'inherit' });
    console.log('✅ Dependencies installed successfully');
} catch (error) {
    console.error('❌ Failed to install dependencies:', error.message);
    process.exit(1);
}

// Create initial database (if using Docker)
try {
    console.log('🐳 Starting database with Docker Compose...');
    execSync('docker-compose up -d postgres redis', { stdio: 'inherit' });
    console.log('✅ Database services started');
    
    // Wait a bit for database to be ready
    console.log('⏳ Waiting for database to be ready...');
    setTimeout(() => {
        try {
            execSync('npm run migrate', { stdio: 'inherit' });
            console.log('✅ Database migrations completed');
            
            console.log('🌱 Seeding database with sample data...');
            execSync('npm run seed', { stdio: 'inherit' });
            console.log('✅ Database seeded successfully');
        } catch (error) {
            console.warn('⚠️  Database setup failed. You may need to run migrations manually.');
        }
    }, 5000);
    
} catch (error) {
    console.warn('⚠️  Docker Compose not available or failed. Please set up database manually.');
}

console.log(`
🎉 Setup completed successfully!

Next steps:
1. Update your .env file with the correct configuration
2. Deploy your smart contract and update ARBITRAGE_CONTRACT_ADDRESS
3. Start the development server: npm run dev
4. View API documentation at: http://localhost:3000/api

For production deployment:
- Build and push Docker image: npm run docker:build
- Deploy using Kubernetes or Docker Compose
- Set up monitoring and alerts

Happy trading! 🚀
`); 