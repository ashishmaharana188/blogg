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
const MAX_MISSED_OCCURRENCES = 240;
const LEGACY_MANDATE_ID = "legacy-wallet-emi";

type WalletSettingsDocument = {
  key: string;
  walletBalancePaise?: number;
  currentCycleId?: string | null;
  currentCycleStartAt?: Date | string | null;
  autoEmiEnabled?: boolean;
  emiAmountPaise?: number;
  emiDayOfMonth?: number;
  emiDescription?: string;
  nextEmiAt?: Date | string | null;
  updatedAt?: Date;
};

type WalletCycleDocument = {
  cycleId: string;
  startedAt: Date;
  scheduledEndAt: Date | null;
  closedAt: Date | null;
  fundingPaise: number;
  netPnlPaise: number;
  savingsTransferPaise: number | null;
  entryCount: number;
  status: "open" | "closed";
};

type EmiMandateDocument = {
  mandateId: string;
  enabled: boolean;
  amountPaise: number;
  dayOfMonth: number;
  description: string;
  nextEmiAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type EmiHistoryRow = {
  eventKey: string;
  autoEmiMandateId: string;
  occurrenceMonth: string;
  description: string;
  amountPaise: number;
  createdAt: Date | string;
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
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 1
    && value <= 31;
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
      getDB().collection("adminWalletEmiMandates").createIndex(
        { mandateId: 1 },
        { unique: true, name: "admin_wallet_emi_mandate_unique" },
      ),
      getDB().collection("adminWalletEmiMandates").createIndex(
        { enabled: 1, nextEmiAt: 1, deletedAt: 1 },
        { name: "admin_wallet_emi_due_schedule" },
      ),
      getDB().collection("adminWalletTransactions").createIndex(
        { autoEmiMandateId: 1, createdAt: -1 },
        { name: "admin_wallet_emi_history" },
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
  return new Date(
    Date.UTC(year, month, safeDay, EMI_HOUR_IST, 0, 0) - IST_OFFSET_MS,
  );
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

async function loadWalletSettings(
  session: ClientSession,
): Promise<WalletSettingsDocument> {
  const collection = getDB().collection<WalletSettingsDocument>("adminWalletSettings");
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
 * Existing installations used one settings document for one EMI.
 * Copy that configuration into a durable mandate once, preserving its next due date.
 */
async function migrateLegacyMandate(
  settings: WalletSettingsDocument,
  session: ClientSession,
): Promise<void> {
  const amountPaise = Number(settings.emiAmountPaise || 0);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return;

  const mandates = getDB().collection<EmiMandateDocument>("adminWalletEmiMandates");
  const existing = await mandates.findOne(
    { mandateId: LEGACY_MANDATE_ID },
    { session },
  );
  if (existing) return;

  const dayOfMonth = validDay(settings.emiDayOfMonth)
    ? settings.emiDayOfMonth
    : 5;
  const enabled = Boolean(settings.autoEmiEnabled);
  const now = new Date();
  await mandates.insertOne({
    mandateId: LEGACY_MANDATE_ID,
    enabled,
    amountPaise,
    dayOfMonth,
    description: cleanDescription(settings.emiDescription) || "Monthly EMI",
    nextEmiAt: enabled
      ? (asDate(settings.nextEmiAt) || nextMonthlyEmiDateAfter(now, dayOfMonth))
      : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }, { session });
}

/**
 * Applies missed occurrences as immutable wallet expenses.
 * Idempotency is scoped to mandate + India-local calendar month.
 * This is an internal ledger simulation, not a bank/NACH instruction.
 */
export async function processDueAdminWalletEmi(now = new Date()): Promise<void> {
  await ensureIndexes();
  const session = getDB().client.startSession();

  try {
    await session.withTransaction(async () => {
      const settingsCollection = getDB().collection<WalletSettingsDocument>(
        "adminWalletSettings",
      );
      const settings = await loadWalletSettings(session);
      await migrateLegacyMandate(settings, session);

      const mandates = getDB().collection<EmiMandateDocument>(
        "adminWalletEmiMandates",
      );
      const activeMandates = await mandates.find(
        { deletedAt: null, enabled: true },
        { session },
      ).toArray();

      const transactions = getDB().collection("adminWalletTransactions");
      const cycles = getDB().collection<WalletCycleDocument>("adminWalletCycles");

      let walletBalancePaise = Number(settings.walletBalancePaise || 0);
      let currentCycleId = settings.currentCycleId || null;
      let currentCycleStartAt = asDate(settings.currentCycleStartAt);
      let walletChanged = false;

      for (const mandate of activeMandates) {
        if (!validAmount(mandate.amountPaise) || !validDay(mandate.dayOfMonth)) {
          continue;
        }

        const description = cleanDescription(mandate.description) || "Monthly EMI";
        let nextEmiAt = asDate(mandate.nextEmiAt);

        // A mandate created without a next date begins with the next future occurrence.
        if (!nextEmiAt) {
          nextEmiAt = nextMonthlyEmiDateAfter(now, mandate.dayOfMonth);
          await mandates.updateOne(
            { mandateId: mandate.mandateId, deletedAt: null },
            { $set: { nextEmiAt, updatedAt: now } },
            { session },
          );
          continue;
        }

        let processed = 0;
        while (nextEmiAt.getTime() <= now.getTime()) {
          processed += 1;
          if (processed > MAX_MISSED_OCCURRENCES) {
            throw new Error(
              `Too many missed EMI dates for mandate ${mandate.mandateId}. Review the schedule.`,
            );
          }

          const dueAt = new Date(nextEmiAt);
          const occurrenceMonth = monthKeyInIndia(dueAt);
          const eventKey = `auto-emi:${mandate.mandateId}:${occurrenceMonth}`;
          const alreadyRecorded = await transactions.findOne(
            { eventKey },
            { session },
          );

          if (!alreadyRecorded) {
            let openCycle = currentCycleId
              ? await cycles.findOne(
                  { cycleId: currentCycleId, status: "open" },
                  { session },
                )
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

            const signedAmountPaise = -mandate.amountPaise;
            await transactions.insertOne({
              eventKey,
              type: "expense",
              description: `Auto EMI · ${description}`,
              amountPaise: signedAmountPaise,
              walletDeltaPaise: signedAmountPaise,
              savingsDeltaPaise: 0,
              cycleId: currentCycleId,
              createdAt: dueAt,
              autoEmiMandateId: mandate.mandateId,
              occurrenceMonth,
            }, { session });

            walletBalancePaise += signedAmountPaise;
            await cycles.updateOne(
              { cycleId: currentCycleId, status: "open" },
              { $inc: { netPnlPaise: signedAmountPaise, entryCount: 1 } },
              { session },
            );
            walletChanged = true;
          }

          nextEmiAt = followingMonthlyEmiDate(dueAt, mandate.dayOfMonth);
        }

        if (processed > 0) {
          await mandates.updateOne(
            { mandateId: mandate.mandateId, deletedAt: null },
            { $set: { nextEmiAt, updatedAt: now } },
            { session },
          );
        }
      }

      if (walletChanged) {
        await settingsCollection.updateOne(
          { key: SETTINGS_KEY },
          {
            $set: {
              walletBalancePaise,
              currentCycleId,
              currentCycleStartAt,
              updatedAt: now,
            },
          },
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

async function buildEmiPayload() {
  await processDueAdminWalletEmi();

  const [mandates, historyRows] = await Promise.all([
    getDB().collection<EmiMandateDocument>("adminWalletEmiMandates")
      .find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .toArray(),
    getDB().collection<EmiHistoryRow>("adminWalletTransactions")
      .find({ autoEmiMandateId: { $exists: true } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray(),
  ]);

  return {
    mandates: mandates.map((mandate) => ({
      mandateId: mandate.mandateId,
      enabled: Boolean(mandate.enabled),
      amountPaise: Number(mandate.amountPaise || 0),
      dayOfMonth: mandate.dayOfMonth,
      description: mandate.description,
      nextEmiAt: asDate(mandate.nextEmiAt)?.toISOString() || null,
      createdAt: asDate(mandate.createdAt)?.toISOString() || null,
      updatedAt: asDate(mandate.updatedAt)?.toISOString() || null,
    })),
    history: historyRows.map((row) => ({
      eventKey: row.eventKey,
      mandateId: row.autoEmiMandateId,
      occurrenceMonth: row.occurrenceMonth,
      description: row.description,
      amountPaise: Math.abs(Number(row.amountPaise || 0)),
      createdAt: asDate(row.createdAt)?.toISOString() || null,
    })),
  };
}

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
    res.json(await buildEmiPayload());
  } catch (error) {
    next(error);
  }
});

router.post("/admin/wallet/emi", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const amountPaise = req.body?.amountPaise;
    const dayOfMonth = req.body?.dayOfMonth;
    const description = cleanDescription(req.body?.description);
    const enabled = req.body?.enabled === undefined ? true : req.body.enabled;

    if (typeof enabled !== "boolean") {
      res.status(400).json({ message: "enabled must be a boolean." });
      return;
    }
    if (!validAmount(amountPaise)) {
      res.status(400).json({ message: "Enter a positive EMI amount in paise." });
      return;
    }
    if (!validDay(dayOfMonth)) {
      res.status(400).json({ message: "Choose a debit day from 1 to 31." });
      return;
    }
    if (!description) {
      res.status(400).json({ message: "Enter a description for this EMI mandate." });
      return;
    }

    await ensureIndexes();
    await processDueAdminWalletEmi();
    const now = new Date();
    await getDB().collection<EmiMandateDocument>("adminWalletEmiMandates").insertOne({
      mandateId: randomUUID(),
      enabled,
      amountPaise,
      dayOfMonth,
      description,
      nextEmiAt: enabled ? nextMonthlyEmiDateAfter(now, dayOfMonth) : null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildEmiPayload());
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/wallet/emi/:mandateId", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    await ensureIndexes();
    await processDueAdminWalletEmi();

    const mandateId = String(req.params.mandateId || "");
    const mandates = getDB().collection<EmiMandateDocument>("adminWalletEmiMandates");
    const existing = await mandates.findOne({ mandateId, deletedAt: null });
    if (!existing) {
      res.status(404).json({ message: "EMI mandate not found." });
      return;
    }

    const body = req.body || {};
    const amountPaise = body.amountPaise === undefined
      ? existing.amountPaise
      : body.amountPaise;
    const dayOfMonth = body.dayOfMonth === undefined
      ? existing.dayOfMonth
      : body.dayOfMonth;
    const description = body.description === undefined
      ? existing.description
      : cleanDescription(body.description);
    const enabled = body.enabled === undefined
      ? existing.enabled
      : body.enabled;

    if (!validAmount(amountPaise)) {
      res.status(400).json({ message: "Enter a positive EMI amount in paise." });
      return;
    }
    if (!validDay(dayOfMonth)) {
      res.status(400).json({ message: "Choose a debit day from 1 to 31." });
      return;
    }
    if (typeof description !== "string" || !description.trim()) {
      res.status(400).json({ message: "Enter a description for this EMI mandate." });
      return;
    }
    if (typeof enabled !== "boolean") {
      res.status(400).json({ message: "enabled must be a boolean." });
      return;
    }

    const scheduleChanged = amountPaise !== existing.amountPaise
      || dayOfMonth !== existing.dayOfMonth
      || description !== existing.description
      || enabled !== existing.enabled;
    const now = new Date();
    const nextEmiAt = !enabled
      ? null
      : (!existing.enabled || scheduleChanged)
        ? nextMonthlyEmiDateAfter(now, dayOfMonth)
        : asDate(existing.nextEmiAt);

    await mandates.updateOne(
      { mandateId, deletedAt: null },
      {
        $set: {
          amountPaise,
          dayOfMonth,
          description: description.trim(),
          enabled,
          nextEmiAt,
          updatedAt: now,
        },
      },
    );

    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildEmiPayload());
  } catch (error) {
    next(error);
  }
});

router.delete("/admin/wallet/emi/:mandateId", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    await ensureIndexes();
    await processDueAdminWalletEmi();

    const mandateId = String(req.params.mandateId || "");
    const now = new Date();
    const result = await getDB().collection<EmiMandateDocument>(
      "adminWalletEmiMandates",
    ).updateOne(
      { mandateId, deletedAt: null },
      {
        $set: {
          enabled: false,
          nextEmiAt: null,
          deletedAt: now,
          updatedAt: now,
        },
      },
    );

    if (result.matchedCount !== 1) {
      res.status(404).json({ message: "EMI mandate not found." });
      return;
    }

    // Soft-delete the mandate. Past wallet debits remain in the ledger/history.
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildEmiPayload());
  } catch (error) {
    next(error);
  }
});

export function startAdminWalletEmiScheduler(): void {
  if (scheduler) return;

  const run = () => {
    void processDueAdminWalletEmi().catch((error) => {
      console.error("[adminWalletAutoEmi] Scheduled mandate processing failed:", error);
    });
  };

  run();
  scheduler = setInterval(run, SCHEDULER_INTERVAL_MS);
  scheduler.unref?.();
}

export default router;
