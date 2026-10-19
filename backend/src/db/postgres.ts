import { Pool } from "pg";
import type { PoolClient } from "pg";
import logger from "../logs/logger.ts";
import "dotenv/config";

let pgPool: Pool | null = null;

const createPgPool = (): Pool => {
  const connectionString = process.env.DATABASE_URL?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  // Neon supplies a PostgreSQL connection URL. Prefer it when configured so
  // its hostname, port, credentials, database, and TLS query parameters are
  // handled by node-postgres in one place.
  if (connectionString) {
    const pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on("connect", () => {
      logger.info({
        event: "POSTGRES_CONNECTED",
        message: "New PostgreSQL connection established.",
      });
    });

    pool.on("error", (error: any) => {
      logger.error({
        event: "POSTGRES_ERROR",
        message: error.message,
      });
    });

    return pool;
  }

  // Keep the existing split DB_* settings for local development and existing
  // deployments. In production, don't silently fall back to local defaults.
  if (
    isProduction &&
    (!process.env.DB_USER ||
      !process.env.DB_HOST ||
      !process.env.DB_NAME ||
      !process.env.DB_PASSWORD)
  ) {
    throw new Error(
      "Configure DATABASE_URL (recommended for Neon) or set DB_USER, DB_HOST, DB_NAME, and DB_PASSWORD in the production environment.",
    );
  }

  const pool = new Pool({
    user: process.env.DB_USER ?? "postgres",
    host: process.env.DB_HOST ?? "localhost",
    database: process.env.DB_NAME ?? "blogg",
    password: process.env.DB_PASSWORD ?? "123456",
    port: Number(process.env.DB_PORT ?? 5432),
    // Direct PostgreSQL providers generally require TLS. Local development
    // remains unchanged; DATABASE_URL is preferred for Neon.
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on("connect", () => {
    logger.info({
      event: "POSTGRES_CONNECTED",
      message: "New PostgreSQL connection established.",
    });
  });

  pool.on("error", (error: any) => {
    logger.error({
      event: "POSTGRES_ERROR",
      message: error.message,
    });
  });

  return pool;
};

export const getPgPool = async (): Promise<Pool> => {
  if (!pgPool) {
    pgPool = createPgPool();
  }

  return pgPool;
};

export const getPgClient = async (): Promise<PoolClient> => {
  const pool = await getPgPool();

  return pool.connect();
};

export const warmupPgPool = async (): Promise<void> => {
  const client = await getPgClient();

  try {
    await client.query("SELECT 1");

    logger.info({
      event: "POSTGRES_WARMUP",
      message: "PostgreSQL warm-up successful.",
    });
  } finally {
    client.release();
  }
};

export const disconnectPgPool = async (): Promise<void> => {
  if (!pgPool) return;

  await pgPool.end();

  pgPool = null;

  logger.info({
    event: "POSTGRES_DISCONNECTED",
    message: "PostgreSQL pool closed.",
  });
};
