import { MongoClient } from "mongodb";

const uri = process.env.MONGO_DB_CONNECTION_STRING;

if (!uri) {
  throw new Error("Missing MONGO_DB_CONNECTION_STRING in environment.");
}

type GlobalWithMongo = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

const globalForMongo = globalThis as GlobalWithMongo;

if (!globalForMongo._mongoClientPromise) {
  const client = new MongoClient(uri);
  globalForMongo._mongoClientPromise = client.connect();
}

export default globalForMongo._mongoClientPromise;
