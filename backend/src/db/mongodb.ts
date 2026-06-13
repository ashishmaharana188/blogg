import "dotenv/config";
import { MongoClient, Db } from "mongodb";

export const config = {
  mongoUri: process.env.MONGO_URI!,
  databaseName: process.env.DATABASE_NAME!,
};

let db: Db;

export async function connectDB() {
  const client = new MongoClient(config.mongoUri);

  await client.connect();

  db = client.db(config.databaseName);

  console.log("MongoDB Connected");
}

export { db };
