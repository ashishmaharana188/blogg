import "dotenv/config";
import bcrypt from "bcrypt";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { disconnectPgPool, getPgClient } from "../src/db/postgres.ts";

function ask(label: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return rl.question(label).finally(() => rl.close());
}

function askSecret(label: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(
      new Error("Run this command in an interactive terminal so the password can be entered safely."),
    );
  }

  return new Promise((resolve, reject) => {
    let value = "";
    let done = false;

    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Password reset cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = [...value].slice(0, -1).join("");
            stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          stdout.write("*");
        }
      }
    };

    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    throw new Error(
      "ADMIN_EMAIL must be set in backend/.env or the server environment. This script only creates/resets that configured admin account.",
    );
  }

  let password = "";
  const first = await askSecret("New admin password: ");
  const second = await askSecret("Confirm new password: ");
  if (first.length < 12) {
    throw new Error("Use a password of at least 12 characters.");
  }
  if (first !== second) {
    throw new Error("Passwords do not match. Nothing was changed.");
  }
  password = first;
  const passwordHash = await bcrypt.hash(password, 12);
  password = "";

  const client = await getPgClient();
  try {
    // Match the application schema so this remains usable as a recovery path
    // even if the app has not initialized its users table yet.
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
      )
    `);

    const existing = await client.query<{ id: string; username: string }>(
      "SELECT id, username FROM users WHERE email = $1 LIMIT 1",
      [adminEmail],
    );

    if (existing.rows[0]) {
      await client.query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [passwordHash, existing.rows[0].id],
      );
      stdout.write(`Admin password reset successfully for ${adminEmail}.\n`);
      stdout.write(`Existing username retained: ${existing.rows[0].username}\n`);
      return;
    }

    const username = (await ask("Admin username for the new account: ")).trim();
    if (!username || username.length > 50) {
      throw new Error("Username must contain 1 to 50 characters.");
    }

    const usernameTaken = await client.query(
      "SELECT 1 FROM users WHERE username = $1 LIMIT 1",
      [username],
    );
    if (usernameTaken.rowCount) {
      throw new Error("That username is already taken. Run the script again with another username.");
    }

    await client.query(
      `INSERT INTO users (username, email, password_hash, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, $1, NOW(), NOW())`,
      [username, adminEmail, passwordHash],
    );
    stdout.write(`Admin account created for ${adminEmail}.\n`);
    stdout.write(`Username: ${username}\n`);
  } finally {
    client.release();
    await disconnectPgPool();
  }
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  try {
    await disconnectPgPool();
  } catch {
    // Preserve the original error; pool cleanup is best-effort.
  }
  process.exitCode = 1;
});
