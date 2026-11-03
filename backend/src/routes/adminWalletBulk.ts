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

type HistoryRange = "month" | "week" | "year";

type WalletSettings = {
  key: string;
  autoFundingEnabled?: boolean;
  fundingAmountPaise?: number;
  intervalDays?: 30 | 31;
  nextFundingAt?: Date | null;
  currentCycleId?: string | null;
  currentCycleStartAt?: Date | null;
  walletBalancePaise?: number;
  savingsBalancePaise?: number;
  updatedAt?: Date;
};

type WalletCycle = {
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

type WalletTransaction = {
  eventKey: string;
  type: string;
  savingsDeltaPaise?: number;
  cycleId: string | null;
  createdAt: Date;
  [key: string]: unknown;
};

async function withWalletTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = getDB().client.startSession();
  let result!: T;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function indiaDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
  };
}

function historyStart(range: HistoryRange, now = new Date()): Date {
  const { year, month, day } = indiaDateParts(now);
  let startYear = year;
  let startMonth = month - 1;
  let startDay = 1;

  if (range === "year") {
    startMonth = 0;
  } else if (range === "week") {
    const todayUtc = new Date(Date.UTC(year, month - 1, day));
    const daysSinceMonday = (todayUtc.getUTCDay() + 6) % 7;
    todayUtc.setUTCDate(todayUtc.getUTCDate() - daysSinceMonday);
    startYear = todayUtc.getUTCFullYear();
    startMonth = todayUtc.getUTCMonth();
    startDay = todayUtc.getUTCDate();
  }

  return new Date(Date.UTC(startYear, startMonth, startDay) - IST_OFFSET_MS);
}

router.get("/admin/wallet/transactions", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const rawRange = String(req.query.range || "month");
    if (rawRange !== "month" && rawRange !== "week" && rawRange !== "year") {
      res.status(400).json({ message: "Choose month, week, or year for transaction history." });
      return;
    }

    const transactions = await getDB()
      .collection<WalletTransaction>("adminWalletTransactions")
      .find(
        { createdAt: { $gte: historyStart(rawRange) } },
        { projection: { _id: 0 } },
      )
      .sort({ createdAt: -1 })
      .toArray();

    res.setHeader("Cache-Control", "private, no-store");
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

/**
 * Full ledger reset. All transactions and all cycle documents are deleted.
 * Balances are reset, and a new empty open cycle is created only as the active
 * container for future entries and the existing funding schedule.
 */
router.delete("/admin/wallet/transactions", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    const result = await withWalletTransaction(async (session) => {
      const settingsCollection = getDB().collection<WalletSettings>("adminWalletSettings");
      await settingsCollection.updateOne(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            autoFundingEnabled: false,
            fundingAmountPaise: 0,
            intervalDays: 30,
            nextFundingAt: null,
          },
        },
        { upsert: true, session },
      );
      const settings = await settingsCollection.findOne({ key: SETTINGS_KEY }, { session });
      if (!settings) throw new Error("Could not load wallet settings for the reset.");

      const transactionDeletion = await getDB()
        .collection("adminWalletTransactions")
        .deleteMany({}, { session });
      const cycleDeletion = await getDB()
        .collection("adminWalletCycles")
        .deleteMany({}, { session });

      const now = new Date();
      const nextFundingAt = settings.autoFundingEnabled
        ? (settings.nextFundingAt && settings.nextFundingAt.getTime() > now.getTime()
          ? settings.nextFundingAt
          : new Date(now.getTime() + (settings.intervalDays || 30) * 24 * 60 * 60 * 1000))
        : null;
      const cycleId = randomUUID();
      const cycle: WalletCycle = {
        cycleId,
        startedAt: now,
        scheduledEndAt: nextFundingAt,
        closedAt: null,
        fundingPaise: 0,
        netPnlPaise: 0,
        savingsTransferPaise: null,
        entryCount: 0,
        status: "open",
      };
      await getDB().collection<WalletCycle>("adminWalletCycles").insertOne(cycle, { session });

      await settingsCollection.updateOne(
        { key: SETTINGS_KEY },
        {
          $set: {
            walletBalancePaise: 0,
            savingsBalancePaise: 0,
            currentCycleId: cycleId,
            currentCycleStartAt: now,
            nextFundingAt,
            updatedAt: now,
          },
        },
        { session },
      );

      return {
        deletedTransactions: transactionDeletion.deletedCount,
        deletedCycles: cycleDeletion.deletedCount,
      };
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete every completed cycle and all transaction rows linked to those cycles.
 * Savings is reduced by the deleted settlement amounts; the active cycle and
 * unrelated Savings adjustments remain untouched.
 */
router.delete("/admin/wallet/cycles/completed", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    const result = await withWalletTransaction(async (session) => {
      const cycles = getDB().collection<WalletCycle>("adminWalletCycles");
      const closedCycles = await cycles.find(
        { status: "closed" },
        { projection: { cycleId: 1 }, session },
      ).toArray();
      const cycleIds = closedCycles.map((cycle) => cycle.cycleId);
      if (!cycleIds.length) {
        return { deletedCycles: 0, deletedTransactions: 0, savingsAdjustmentPaise: 0 };
      }

      const transactions = getDB().collection<WalletTransaction>("adminWalletTransactions");
      const linkedTransactions = await transactions.find(
        { cycleId: { $in: cycleIds } },
        { projection: { _id: 0, type: 1, savingsDeltaPaise: 1 }, session },
      ).toArray();
      const removedSettlementPaise = linkedTransactions
        .filter((transaction) => transaction.type === "settlement")
        .reduce((total, transaction) => total + Number(transaction.savingsDeltaPaise || 0), 0);

      const transactionDeletion = await transactions.deleteMany(
        { cycleId: { $in: cycleIds } },
        { session },
      );
      const cycleDeletion = await cycles.deleteMany(
        { cycleId: { $in: cycleIds }, status: "closed" },
        { session },
      );

      const settingsCollection = getDB().collection<WalletSettings>("adminWalletSettings");
      const settings = await settingsCollection.findOne({ key: SETTINGS_KEY }, { session });
      if (settings) {
        await settingsCollection.updateOne(
          { key: SETTINGS_KEY },
          {
            $set: {
              savingsBalancePaise: Number(settings.savingsBalancePaise || 0) - removedSettlementPaise,
              updatedAt: new Date(),
            },
          },
          { session },
        );
      }

      return {
        deletedCycles: cycleDeletion.deletedCount,
        deletedTransactions: transactionDeletion.deletedCount,
        savingsAdjustmentPaise: -removedSettlementPaise,
      };
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

export default router;
