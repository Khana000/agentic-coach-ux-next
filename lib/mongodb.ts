import { MongoClient, ServerApiVersion } from "mongodb";

type GlobalWithMongo = typeof globalThis & {
  _mongoClient?: MongoClient;
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

const resolveMongoUri = () =>
  (process.env.MONGO_DB_CONNECTION_STRING ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\n/g, "")
    .trim();

const createClientPromise = () => {
  const uri = resolveMongoUri();
  if (!uri) {
    throw new Error("Missing MONGO_DB_CONNECTION_STRING in environment.");
  }
  const client = new MongoClient(uri, options);
  return client.connect().then((connectedClient) => {
    globalForMongo._mongoClient = connectedClient;
    return connectedClient;
  });
};

const getMongoClient = async () => {
  if (globalForMongo._mongoClient) {
    return globalForMongo._mongoClient;
  }

  if (!globalForMongo._mongoClientPromise) {
    globalForMongo._mongoClientPromise = createClientPromise().catch((error) => {
      globalForMongo._mongoClientPromise = undefined;
      throw error;
    });
  }

  return globalForMongo._mongoClientPromise;
};

export default getMongoClient;
