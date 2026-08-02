import { Pool } from "pg";
import type { PoolClient } from "pg";
import logger from "../logs/logger.ts";
import "dotenv/config";

let pgPool: Pool | null = null;

const createPgPool = (): Pool => {
  const pool = new Pool({
    user: process.env.DB_USER ?? "postgres",
    host: process.env.DB_HOST ?? "localhost",
    database: process.env.DB_NAME ?? "blogg",
    password: process.env.DB_PASSWORD ?? "123456",
    port: Number(process.env.DB_PORT ?? 5432),

    max: 20,
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
