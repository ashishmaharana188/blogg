import { getPgClient } from "./postgres.ts";
const client = await getPgClient();

export async function initializePostgresSchema() {
  await client.query(`
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,

    display_name VARCHAR(100),

    avatar_url TEXT,

    bio TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
    `);
}
