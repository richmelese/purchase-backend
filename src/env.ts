import * as fs from 'node:fs';

// Load purchase-backend/.env before anything reads process.env (real environment variables win).
if (fs.existsSync('.env')) process.loadEnvFile('.env');
