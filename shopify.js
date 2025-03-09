import { LATEST_API_VERSION } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { MemorySessionStorage } from "@shopify/shopify-app-session-storage-memory";
// import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";  // Import SQLite session storage
import { restResources } from "@shopify/shopify-api/rest/admin/2024-07";
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";


// const MONGO_URI = "mongodb+srv://shekharpareek:nRJxxajEi8zuZhBL@cluster0.yo9hd.mongodb.net/myDatabase?retryWrites=true&w=majority";
const MONGO_URI = 'mongodb+srv://vishalmaheshwar:Newday@123@jeebly-app.z0e08.mongodb.net/?retryWrites=true&w=majority&appName=Jeebly-app'
const DB_NAME = "jeebly-app";
dotenv.config();  // Load environment variables..


// /// Manually create __dirname for ES module
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// // Use the writable /tmp directory for SQLite storage
// const dbDirectory = '/tmp';

// // Ensure the directory exists (although /tmp typically exists on most systems)
// if (!fs.existsSync(dbDirectory)) {
//   fs.mkdirSync(dbDirectory);  // Should succeed as /tmp is writable
// }

// Define the full path to the SQLite database file in /tmp
// const dbPath = path.join(dbDirectory, 'sessions.db');
// const sessionDb = new SQLiteSessionStorage(dbPath);  // Use SQLite session storage in /tmp

const shopify = shopifyApp({
  
  api: {
    apiVersion: LATEST_API_VERSION,
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: process.env.SHOPIFY_SCOPES,
    hostName: process.env.SHOPIFY_HOST,
    restResources,
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  
  sessionStorage: new MongoDBSessionStorage(MONGO_URI, DB_NAME)
//  sessionStorage: new MemorySessionStorage() //this isthe last memory storage
});

async function createWebhook(shop, accessToken) {
  const client = new shopify.Clients.Rest(shop, accessToken);

  try {
    const response = await client.post({
      path: 'webhooks',
      data: {
        webhook: {
          topic: 'orders/create',
          address: 'https://yourapp.com/webhooks/orders/create',
          format: 'json'
        }
      },
      type: shopify.Clients.Rest.DataType.JSON,
    });
    console.log('Webhook created:', response.body);
  } catch (error) {
    console.error('Failed to create webhook:', error);
  }
}

export default shopify;