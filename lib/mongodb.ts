import { MongoClient, ServerApiVersion } from "mongodb";

const rawUri = process.env.MONGO_DB_CONNECTION_STRING ?? "";
const uri = rawUri
  .trim()
  .replace(/^['"]|['"]$/g, "")
  .replace(/\\n/g, "")
  .trim();

if (!uri) {
  throw new Error("Missing MONGO_DB_CONNECTION_STRING in environment.");
}

type GlobalWithMongo = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

const globalForMongo = globalThis as GlobalWithMongo;

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
};

if (!globalForMongo._mongoClientPromise) {
  const client = new MongoClient(uri, options);
  globalForMongo._mongoClientPromise = client.connect();
}

export default globalForMongo._mongoClientPromise;
