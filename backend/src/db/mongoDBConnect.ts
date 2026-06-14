import "dotenv/config";
import { MongoClient, Db } from "mongodb";

export const config = {
  mongoUri: process.env.MONGO_URI!,
  databaseName: process.env.MONGODB_DB_NAME!,
};

let db: Db;

export async function mongoConnectDB() {
  const client = new MongoClient(config.mongoUri);

  await client.connect();

  db = client.db(config.databaseName);

  console.log("MongoDB Connected");
}

export function getDB() {
  if (!db) {
    throw new Error("Database not connected");
  }

  return db;
}
