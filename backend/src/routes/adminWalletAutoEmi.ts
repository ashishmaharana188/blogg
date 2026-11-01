import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const SETTINGS_KEY = "admin-wallet-v1";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const EMI_HOUR_IST = 9;
const MAX_EMI_AMOUNT_PAISE = 100_000_000_000;
const MAX_DESCRIPTION_LENGTH = 120;
const SCHEDULER_INTERVAL_MS = 60_000;

type EmiSettingsDocument = {
  key: string;
  autoEmiEnabled?: boolean;
  emiAmountPaise?: number;
  emiDayOfMonth?: number;
  emiDescription?: string;
  nextEmiAt?: Date | string | null;
  walletBalancePaise?: number;
  currentCycleId?: string | null;
  currentCycleStartAt?: Date | string | null;
};

type EmiApiSettings = {
  enabled: boolean;
  amountPaise: number;
  dayOfMonth: number;
  description: string;
  nextEmiAt: string | null;
};

let indexesReady: Promise<void> | null = null;
let scheduler: ReturnType<typeof setInterval> | null = null;

function cleanDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);
}

function validAmount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_EMI_AMOUNT_PAISE;
}

function validDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = Promise.all([
      getDB().collection("adminWalletTransactions").createIndex(
        { eventKey: 1 },
        { unique: true, name: "admin_wallet_event_unique" },
      ),
      getDB().collection("adminWalletCycles").createIndex(
        { cycleId: 1 },
        { unique: true, name: "admin_wallet_cycle_unique" },
      ),
    ]).then(() => undefined).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function istDateAtNine(year: number, month: number, day: number): Date {
  const safeDay = Math.min(day, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, safeDay, EMI_HOUR_IST, 0, 0) - IST_OFFSET_MS);
}

function nextMonthlyEmiDateAfter(reference: Date, requestedDay: number): Date {
  const istReference = new Date(reference.getTime() + IST_OFFSET_MS);
  let year = istReference.getUTCFullYear();
  let month = istReference.getUTCMonth();
  let candidate = istDateAtNine(year, month, requestedDay);
  if (candidate.getTime() <= reference.getTime()) {
    month += 1;
    if (month > 11) {
      year += 1;
      month = 0;
    }
    candidate = istDateAtNine(year, month, requestedDay);
  }
  return candidate;
}

function followingMonthlyEmiDate(dueAt: Date, requestedDay: number): Date {
  const istDue = new Date(dueAt.getTime() + IST_OFFSET_MS);
  let year = istDue.getUTCFullYear();
  let month = istDue.getUTCMonth() + 1;
  if (month > 11) {
    year += 1;
    month = 0;
  }
  return istDateAtNine(year, month, requestedDay);
}

function monthKeyInIndia(date: Date): string {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, "0")}`;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function responseSettings(document: EmiSettingsDocument | null): EmiApiSettings {
  return {
    enabled: Boolean(document?.autoEmiEnabled),
    amountPaise: Number(document?.emiAmountPaise || 0),
    dayOfMonth: validDay(document?.emiDayOfMonth) ? document.emiDayOfMonth : 5,
    description: cleanDescription(document?.emiDescription) || "Monthly EMI",
    nextEmiAt: asDate(document?.nextEmiAt)?.toISOString() || null,
  };
}

async function loadWalletSettings(session: ClientSession): Promise<EmiSettingsDocument> {
  const collection = getDB().collection<EmiSettingsDocument>("adminWalletSettings");
  await collection.updateOne(
    { key: SETTINGS_KEY },
    {
      $setOnInsert: {
        key: SETTINGS_KEY,
        walletBalancePaise: 0,
        currentCycleId: null,
        currentCycleStartAt: null,
      },
    },
    { upsert: true, session },
  );
  const settings = await collection.findOne({ key: SETTINGS_KEY }, { session });
  if (!settings) throw new Error("Could not initialise the wallet settings.");
  return settings;
}

/**
 * Applies missed recurring EMI debits as immutable expense entries.
 * The task is idempotent per India-local calendar month.
 */
export async function processDueAdminWalletEmi(now = new Date()): Promise<void> {
  await ensureIndexes();
  const session = getDB().client.startSession();
  try {
    await session.withTransaction(async () => {
      const settingsCollection = getDB().collection<EmiSettingsDocument>("adminWalletSettings");
      const settings = await loadWalletSettings(session);
      if (!settings.autoEmiEnabled) return;

      const amountPaise = Number(settings.emiAmountPaise || 0);
      const dayOfMonth = validDay(settings.emiDayOfMonth) ? settings.emiDayOfMonth : 5;
      const description = cleanDescription(settings.emiDescription) || "Monthly EMI";
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return;

      let nextEmiAt = asDate(settings.nextEmiAt);
      if (!nextEmiAt) nextEmiAt = nextMonthlyEmiDateAfter(now, dayOfMonth);

      let walletBalancePaise = Number(settings.walletBalancePaise || 0);
      let currentCycleId = settings.currentCycleId || null;
      let currentCycleStartAt = asDate(settings.currentCycleStartAt);
      let processed = 0;

      while (nextEmiAt.getTime() <= now.getTime()) {
        processed += 1;
        if (processed > 240) {
          throw new Error("Too many missed EMI dates. Review the wallet schedule before continuing.");
        }

        const dueAt = new Date(nextEmiAt);
        const eventKey = `auto-emi:${monthKeyInIndia(dueAt)}`;
        const transactions = getDB().collection("adminWalletTransactions");
        const alreadyRecorded = await transactions.findOne({ eventKey }, { session });

        if (!alreadyRecorded) {
          const cycles = getDB().collection("adminWalletCycles");
          let openCycle = currentCycleId
            ? await cycles.findOne({ cycleId: currentCycleId, status: "open" }, { session })
            : null;

          if (!openCycle) {
            currentCycleId = randomUUID();
            currentCycleStartAt = dueAt;
            openCycle = {
              cycleId: currentCycleId,
              startedAt: dueAt,
              scheduledEndAt: null,
              closedAt: null,
              fundingPaise: 0,
              netPnlPaise: 0,
              savingsTransferPaise: null,
              entryCount: 0,
              status: "open",
            };
            await cycles.insertOne(openCycle, { session });
          }

          const signedAmountPaise = -amountPaise;
          await transactions.insertOne({
            eventKey,
            type: "expense",
            description: `Auto EMI · ${description}`,
            amountPaise: signedAmountPaise,
            walletDeltaPaise: signedAmountPaise,
            savingsDeltaPaise: 0,
            cycleId: currentCycleId,
            createdAt: dueAt,
          }, { session });

          walletBalancePaise += signedAmountPaise;
          await cycles.updateOne(
            { cycleId: currentCycleId, status: "open" },
            { $inc: { netPnlPaise: signedAmountPaise, entryCount: 1 } },
            { session },
          );
        }

        nextEmiAt = followingMonthlyEmiDate(dueAt, dayOfMonth);
      }

      await settingsCollection.updateOne(
        { key: SETTINGS_KEY },
        {
          $set: {
            walletBalancePaise,
            currentCycleId,
            currentCycleStartAt,
            nextEmiAt,
            updatedAt: new Date(),
          },
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}

async function getEmiSettings(): Promise<EmiApiSettings> {
  await processDueAdminWalletEmi();
  const document = await getDB().collection<EmiSettingsDocument>("adminWalletSettings")
    .findOne({ key: SETTINGS_KEY });
  return responseSettings(document);
}

// Protected middleware before the main wallet GET route. This makes Feed's
// existing wallet widget catch up overdue EMI entries when the API is awake.
router.get("/admin/wallet", ...ADMIN_GUARD, async (_req, _res, next) => {
  try {
    await processDueAdminWalletEmi();
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/admin/wallet/emi", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await getEmiSettings());
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/wallet/emi", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const enabled = req.body?.enabled;
    const amountPaise = req.body?.amountPaise;
    const dayOfMonth = req.body?.dayOfMonth;
    const description = cleanDescription(req.body?.description);

    if (typeof enabled !== "boolean") {
      res.status(400).json({ message: "enabled must be a boolean." });
      return;
    }
    if (!validAmount(amountPaise)) {
      res.status(400).json({ message: "Enter a positive EMI amount in paise." });
      return;
    }
    if (!validDay(dayOfMonth)) {
      res.status(400).json({ message: "Choose a day from 1 to 31." });
      return;
    }
    if (!description) {
      res.status(400).json({ message: "Enter a description for the EMI debit." });
      return;
    }

    // Apply any due occurrence before changing the schedule.
    await processDueAdminWalletEmi();
    const now = new Date();
    const nextEmiAt = enabled ? nextMonthlyEmiDateAfter(now, dayOfMonth) : null;

    await getDB().collection<EmiSettingsDocument>("adminWalletSettings").updateOne(
      { key: SETTINGS_KEY },
      {
        $set: {
          key: SETTINGS_KEY,
          autoEmiEnabled: enabled,
          emiAmountPaise: amountPaise,
          emiDayOfMonth: dayOfMonth,
          emiDescription: description,
          nextEmiAt,
          updatedAt: now,
        },
        $setOnInsert: {
          walletBalancePaise: 0,
          currentCycleId: null,
          currentCycleStartAt: null,
        },
      },
      { upsert: true },
    );

    res.setHeader("Cache-Control", "private, no-store");
    res.json(await getEmiSettings());
  } catch (error) {
    next(error);
  }
});

export function startAdminWalletEmiScheduler(): void {
  if (scheduler) return;

  const run = () => {
    void processDueAdminWalletEmi().catch((error) => {
      console.error("[adminWalletAutoEmi] Scheduled wallet EMI processing failed:", error);
    });
  };

  run();
  scheduler = setInterval(run, SCHEDULER_INTERVAL_MS);
  scheduler.unref?.();
}

export default router;
