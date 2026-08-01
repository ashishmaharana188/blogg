import { getPgClient } from "../../db/postgres.ts";
import type { AuthUser } from "../../types/authenticationTypes.ts";

export const findUserByEmail = async (
  email: string,
): Promise<(AuthUser & { passwordHash: string }) | null> => {
  const client = await getPgClient();

  try {
    const result = await client.query(
      `
      SELECT
          id,
          username,
          email,
          password_hash AS "passwordHash",
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email],
    );

    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
};

export const findUserByUsername = async (
  username: string,
): Promise<(AuthUser & { passwordHash: string }) | null> => {
  const client = await getPgClient();

  try {
    const result = await client.query(
      `
      SELECT
          id,
          username,
          email,
          password_hash AS "passwordHash",
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      FROM users
      WHERE username = $1
      LIMIT 1
      `,
      [username],
    );

    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
};

export const findUserById = async (id: string): Promise<AuthUser | null> => {
  const client = await getPgClient();

  try {
    const result = await client.query(
      `
      SELECT
          id,
          username,
          email,
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
};

export const createUser = async (params: {
  username: string;
  email: string;
  passwordHash: string;
}): Promise<AuthUser> => {
  const client = await getPgClient();

  try {
    const { username, email, passwordHash } = params;

    const result = await client.query(
      `
      INSERT INTO users (
          username,
          email,
          password_hash,
          created_at,
          updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING
          id,
          username,
          email,
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [username, email, passwordHash],
    );

    return result.rows[0];
  } finally {
    client.release();
  }
};
