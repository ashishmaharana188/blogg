import { Pool } from "pg";
import type { PoolClient } from "pg";
import logger from "../logs/logger.ts";
import "dotenv/config";

let pgPool: Pool | null = null;

const createPgPool = (): Pool => {
  const connectionString = process.env.DATABASE_URL?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  // Cloud deployments such as Neon provide a PostgreSQL connection URL.
  // Keep the provider's TLS settings from that URL intact.
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

  // The split DB_* configuration is used for the local PostgreSQL instance.
  // Cloud deployments should use DATABASE_URL (for example, Neon's URL).
  // Explicit ssl:false prevents NODE_ENV=production or PGSSLMODE inherited
  // from the shell from forcing TLS against a local server that has no SSL.
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
    ssl: false,
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
