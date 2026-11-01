import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const SETTINGS_KEY = "admin-wallet-v1";
const MAX_AMOUNT_PAISE = 100_000_000_000; // ₹100 crore
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_RECENT_TRANSACTIONS = 100;
const MAX_RECENT_CYCLES = 24;

type WalletSettings = {
  key: string;
  autoFundingEnabled: boolean;
  fundingAmountPaise: number;
  intervalDays: 30 | 31;
  nextFundingAt: Date | null;
  currentCycleId: string | null;
  currentCycleStartAt: Date | null;
  walletBalancePaise: number;
  savingsBalancePaise: number;
  updatedAt: Date;
};

type WalletTransaction = {
  eventKey: string;
  type: "funding" | "expense" | "income" | "settlement" | "savings-adjustment";
  description: string;
  amountPaise: number;
  walletDeltaPaise: number;
  savingsDeltaPaise: number;
  cycleId: string | null;
  createdAt: Date;
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

let indexPromise: Promise<void> | null = null;

function ensureIndexes(): Promise<void> {
  if (!indexPromise) {
    indexPromise = Promise.all([
      getDB().collection("adminWalletTransactions").createIndex(
        { eventKey: 1 },
        { unique: true, name: "admin_wallet_event_unique" },
      ),
      getDB().collection("adminWalletTransactions").createIndex(
        { createdAt: -1 },
        { name: "admin_wallet_created_at" },
      ),
      getDB().collection("adminWalletCycles").createIndex(
        { cycleId: 1 },
        { unique: true, name: "admin_wallet_cycle_unique" },
      ),
      getDB().collection("adminWalletCycles").createIndex(
        { status: 1, closedAt: -1 },
        { name: "admin_wallet_cycle_history" },
      ),
    ]).then(() => undefined).catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

function defaultSettings(): WalletSettings {
  return {
    key: SETTINGS_KEY,
    autoFundingEnabled: false,
    fundingAmountPaise: 0,
    intervalDays: 30,
    nextFundingAt: null,
    currentCycleId: null,
    currentCycleStartAt: null,
    walletBalancePaise: 0,
    savingsBalancePaise: 0,
    updatedAt: new Date(),
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

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
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_AMOUNT_PAISE;
}

async function withWalletTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  // MongoDB transactions keep the balance, cycle and immutable ledger in sync.
  // Production MongoDB must support sessions/transactions (Atlas replica set).
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

async function loadSettings(session: ClientSession): Promise<WalletSettings> {
  const collection = getDB().collection<WalletSettings>("adminWalletSettings");
  await collection.updateOne(
    { key: SETTINGS_KEY },
    { $setOnInsert: defaultSettings() },
    { upsert: true, session },
  );
  const settings = await collection.findOne({ key: SETTINGS_KEY }, { session });
  if (!settings) throw new Error("Could not initialise the administrator wallet.");
  return settings;
}

async function saveSettings(
  settings: WalletSettings,
  session: ClientSession,
): Promise<void> {
  settings.updatedAt = new Date();
  await getDB().collection<WalletSettings>("adminWalletSettings").updateOne(
    { key: SETTINGS_KEY },
    {
      $set: {
        autoFundingEnabled: settings.autoFundingEnabled,
        fundingAmountPaise: settings.fundingAmountPaise,
        intervalDays: settings.intervalDays,
        nextFundingAt: settings.nextFundingAt,
        currentCycleId: settings.currentCycleId,
        currentCycleStartAt: settings.currentCycleStartAt,
        walletBalancePaise: settings.walletBalancePaise,
        savingsBalancePaise: settings.savingsBalancePaise,
        updatedAt: settings.updatedAt,
      },
    },
    { session },
  );
}

async function insertTransaction(
  session: ClientSession,
  transaction: WalletTransaction,
): Promise<void> {
  await getDB().collection<WalletTransaction>("adminWalletTransactions").insertOne(
    transaction,
    { session },
  );
}

async function openCycle(
  settings: WalletSettings,
  session: ClientSession,
  startedAt: Date,
  fundingAmountPaise: number,
): Promise<void> {
  const cycleId = randomUUID();
  const scheduledEndAt = settings.autoFundingEnabled
    ? addDays(startedAt, settings.intervalDays)
    : null;

  const cycle: WalletCycle = {
    cycleId,
    startedAt,
    scheduledEndAt,
    closedAt: null,
    fundingPaise: fundingAmountPaise,
    netPnlPaise: fundingAmountPaise,
    savingsTransferPaise: null,
    entryCount: 0,
    status: "open",
  };

  await getDB().collection<WalletCycle>("adminWalletCycles").insertOne(cycle, { session });

  if (fundingAmountPaise !== 0) {
    await insertTransaction(session, {
      eventKey: `funding:${cycleId}`,
      type: "funding",
      description: "Automatic wallet funding",
      amountPaise: fundingAmountPaise,
      walletDeltaPaise: fundingAmountPaise,
      savingsDeltaPaise: 0,
      cycleId,
      createdAt: startedAt,
    });
  }

  settings.currentCycleId = cycleId;
  settings.currentCycleStartAt = startedAt;
  settings.walletBalancePaise += fundingAmountPaise;
  settings.nextFundingAt = settings.autoFundingEnabled
    ? addDays(startedAt, settings.intervalDays)
    : null;
}

async function closeCycleAndTransfer(
  settings: WalletSettings,
  session: ClientSession,
  closedAt: Date,
): Promise<void> {
  const cycleId = settings.currentCycleId;
  const transferPaise = settings.walletBalancePaise;

  if (cycleId) {
    await getDB().collection<WalletCycle>("adminWalletCycles").updateOne(
      { cycleId, status: "open" },
      {
        $set: {
          closedAt,
          netPnlPaise: transferPaise,
          savingsTransferPaise: transferPaise,
          status: "closed",
        },
      },
      { session },
    );
  }

  // One immutable transfer record carries both sides of the internal transfer.
  // A negative cycle result reduces Savings instead of being silently discarded.
  await insertTransaction(session, {
    eventKey: `settlement:${cycleId || randomUUID()}`,
    type: "settlement",
    description: "Cycle net P&L transferred to Savings",
    amountPaise: transferPaise,
    walletDeltaPaise: -transferPaise,
    savingsDeltaPaise: transferPaise,
    cycleId,
    createdAt: closedAt,
  });

  settings.savingsBalancePaise += transferPaise;
  settings.walletBalancePaise = 0;
  settings.currentCycleId = null;
  settings.currentCycleStartAt = null;
}

async function processDueCycles(
  settings: WalletSettings,
  session: ClientSession,
  now: Date,
): Promise<boolean> {
  if (!settings.autoFundingEnabled || !settings.nextFundingAt) return false;

  let changed = false;
  let processed = 0;

  while (
    settings.nextFundingAt &&
    settings.nextFundingAt.getTime() <= now.getTime()
  ) {
    processed += 1;
    if (processed > 240) {
      throw new Error("Wallet schedule has too many missed cycles to process safely.");
    }

    const cycleBoundary = new Date(settings.nextFundingAt);
    await closeCycleAndTransfer(settings, session, cycleBoundary);
    await openCycle(
      settings,
      session,
      cycleBoundary,
      settings.fundingAmountPaise,
    );
    changed = true;
  }

  return changed;
}


async function recalculateCycleAfterTransactionChange(
  settings: WalletSettings,
  session: ClientSession,
  cycleId: string,
): Promise<void> {
  const cycles = getDB().collection<WalletCycle>("adminWalletCycles");
  const cycle = await cycles.findOne({ cycleId }, { session });
  if (!cycle) {
    throw Object.assign(new Error("The transaction's wallet cycle could not be found."), { statusCode: 409 });
  }

  const transactions = getDB().collection<WalletTransaction>("adminWalletTransactions");
  const sourceEntries = await transactions.find(
    { cycleId, type: { $ne: "settlement" } },
    { session },
  ).toArray();

  const cycleBalancePaise = sourceEntries.reduce(
    (total, entry) => total + Number(entry.walletDeltaPaise || 0),
    0,
  );
  const fundingPaise = sourceEntries
    .filter((entry) => entry.type === "funding")
    .reduce((total, entry) => total + Number(entry.walletDeltaPaise || 0), 0);
  const entryCount = sourceEntries.filter(
    (entry) => entry.type === "expense" || entry.type === "income",
  ).length;

  if (cycle.status === "closed") {
    const settlement = await transactions.findOne(
      { cycleId, type: "settlement" },
      { session },
    );
    if (!settlement) {
      throw Object.assign(
        new Error("This completed cycle has no linked Savings transfer. Its entries cannot be changed safely."),
        { statusCode: 409 },
      );
    }

    const previousSavingsTransfer = Number(settlement.savingsDeltaPaise || 0);
    const savingsAdjustment = cycleBalancePaise - previousSavingsTransfer;

    // Keep the cycle's paired transfer in step with edited/deleted source entries.
    // The Savings balance changes by the exact difference, not by the whole cycle again.
    await transactions.updateOne(
      { eventKey: settlement.eventKey },
      {
        $set: {
          amountPaise: cycleBalancePaise,
          walletDeltaPaise: -cycleBalancePaise,
          savingsDeltaPaise: cycleBalancePaise,
        },
      },
      { session },
    );

    settings.savingsBalancePaise += savingsAdjustment;
    await cycles.updateOne(
      { cycleId, status: "closed" },
      {
        $set: {
          fundingPaise,
          entryCount,
          netPnlPaise: cycleBalancePaise,
          savingsTransferPaise: cycleBalancePaise,
        },
      },
      { session },
    );
    return;
  }

  if (settings.currentCycleId !== cycleId) {
    throw Object.assign(
      new Error("This is not the active wallet cycle. Refresh the wallet and try again."),
      { statusCode: 409 },
    );
  }

  settings.walletBalancePaise = cycleBalancePaise;
  await cycles.updateOne(
    { cycleId, status: "open" },
    {
      $set: {
        fundingPaise,
        entryCount,
        netPnlPaise: cycleBalancePaise,
      },
    },
    { session },
  );
}

function validateTransactionReplacement(
  transaction: WalletTransaction,
  amountPaise: unknown,
): amountPaise is number {
  if (!validAmount(amountPaise) || amountPaise === 0) return false;
  if (transaction.type === "expense") return amountPaise < 0;
  if (transaction.type === "income" || transaction.type === "funding") return amountPaise > 0;
  return false;
}

async function updateWalletTransaction(
  eventKey: string,
  amountPaise: number,
): Promise<void> {
  await ensureIndexes();
  await withWalletTransaction(async (session) => {
    const settings = await loadSettings(session);
    await processDueCycles(settings, session, new Date());

    const transactions = getDB().collection<WalletTransaction>("adminWalletTransactions");
    const existing = await transactions.findOne({ eventKey }, { session });
    if (!existing) {
      throw Object.assign(new Error("Wallet transaction not found."), { statusCode: 404 });
    }
    if (existing.type === "settlement") {
      throw Object.assign(
        new Error("Savings settlement rows are linked to the whole cycle. Edit or remove a source transaction instead; the transfer will recalculate automatically."),
        { statusCode: 400 },
      );
    }
    if (!existing.cycleId) {
      throw Object.assign(new Error("This transaction is not linked to a wallet cycle."), { statusCode: 409 });
    }
    if (!validateTransactionReplacement(existing, amountPaise)) {
      throw Object.assign(
        new Error(existing.type === "expense"
          ? "Expense amounts must remain negative."
          : "Income and funding amounts must remain positive."),
        { statusCode: 400 },
      );
    }

    await transactions.updateOne(
      { eventKey, type: existing.type },
      {
        $set: {
          amountPaise,
          walletDeltaPaise: amountPaise,
        },
      },
      { session },
    );
    await recalculateCycleAfterTransactionChange(settings, session, existing.cycleId);
    await saveSettings(settings, session);
  });
}

async function removeWalletTransaction(eventKey: string): Promise<void> {
  await ensureIndexes();
  await withWalletTransaction(async (session) => {
    const settings = await loadSettings(session);
    await processDueCycles(settings, session, new Date());

    const transactions = getDB().collection<WalletTransaction>("adminWalletTransactions");
    const existing = await transactions.findOne({ eventKey }, { session });
    if (!existing) {
      throw Object.assign(new Error("Wallet transaction not found."), { statusCode: 404 });
    }
    if (existing.type === "settlement") {
      throw Object.assign(
        new Error("Savings settlement rows cannot be removed separately. Remove or edit a source transaction instead; the transfer will recalculate automatically."),
        { statusCode: 400 },
      );
    }
    if (!existing.cycleId) {
      throw Object.assign(new Error("This transaction is not linked to a wallet cycle."), { statusCode: 409 });
    }

    const deletion = await transactions.deleteOne({ eventKey, type: existing.type }, { session });
    if (deletion.deletedCount !== 1) {
      throw Object.assign(new Error("The transaction changed before it could be removed. Refresh and try again."), { statusCode: 409 });
    }

    await recalculateCycleAfterTransactionChange(settings, session, existing.cycleId);
    await saveSettings(settings, session);
  });
}

async function buildWalletResponse() {
  await ensureIndexes();
  const settings = await withWalletTransaction(async (session) => {
    const current = await loadSettings(session);
    const changed = await processDueCycles(current, session, new Date());
    if (changed) await saveSettings(current, session);
    return current;
  });

  const [recentTransactions, recentCycles] = await Promise.all([
    getDB().collection<WalletTransaction>("adminWalletTransactions")
      .find({})
      .sort({ createdAt: -1 })
      .limit(MAX_RECENT_TRANSACTIONS)
      .toArray(),
    getDB().collection<WalletCycle>("adminWalletCycles")
      .find({ status: "closed" })
      .sort({ closedAt: -1 })
      .limit(MAX_RECENT_CYCLES)
      .toArray(),
  ]);

  return {
    autoFundingEnabled: settings.autoFundingEnabled,
    fundingAmountPaise: settings.fundingAmountPaise,
    intervalDays: settings.intervalDays,
    nextFundingAt: settings.nextFundingAt,
    currentCycleId: settings.currentCycleId,
    currentCycleStartAt: settings.currentCycleStartAt,
    walletBalancePaise: settings.walletBalancePaise,
    netPnlPaise: settings.walletBalancePaise,
    savingsBalancePaise: settings.savingsBalancePaise,
    updatedAt: settings.updatedAt,
    recentTransactions,
    recentCycles,
  };
}

// Public Feed line numeral endpoint. It returns Savings divided by ₹10,000,
// rounded to two decimals. Each 0.01 step therefore represents ₹100. This is the
// explicitly requested public scaled figure; exact balances and the ledger remain
// available only through the guarded administrator endpoint.
router.get("/showcase/wallet-graph", async (_req, res, next) => {
  try {
    const settings = await getDB().collection("adminWalletSettings").findOne(
      { key: SETTINGS_KEY },
      { projection: { _id: 0, savingsBalancePaise: 1 } },
    );
    const savingsBalancePaise = Number(settings?.savingsBalancePaise || 0);
    const unitsOfTenThousand = Number.isFinite(savingsBalancePaise)
      ? Math.round((savingsBalancePaise / 1_000_000) * 100) / 100
      : 0;

    res.setHeader("Cache-Control", "no-store");
    res.json({ value: unitsOfTenThousand });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/wallet", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildWalletResponse());
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/wallet/settings", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const body = req.body || {};
    const autoFundingEnabled = body.autoFundingEnabled;
    const fundingAmountPaise = body.fundingAmountPaise;
    const intervalDays = body.intervalDays;

    if (typeof autoFundingEnabled !== "boolean") {
      res.status(400).json({ message: "autoFundingEnabled must be a boolean." });
      return;
    }
    if (!validAmount(fundingAmountPaise) || fundingAmountPaise < 0) {
      res.status(400).json({ message: "Enter a valid non-negative funding amount in paise." });
      return;
    }
    if (intervalDays !== 30 && intervalDays !== 31) {
      res.status(400).json({ message: "The funding interval must be 30 or 31 days." });
      return;
    }
    if (autoFundingEnabled && fundingAmountPaise <= 0) {
      res.status(400).json({ message: "Set a funding amount greater than zero before enabling automatic funding." });
      return;
    }

    await ensureIndexes();
    await withWalletTransaction(async (session) => {
      const settings = await loadSettings(session);
      await processDueCycles(settings, session, new Date());

      const wasEnabled = settings.autoFundingEnabled;
      const oldInterval = settings.intervalDays;
      settings.fundingAmountPaise = fundingAmountPaise;
      settings.intervalDays = intervalDays;
      settings.autoFundingEnabled = autoFundingEnabled;

      if (!autoFundingEnabled) {
        settings.nextFundingAt = null;
        if (settings.currentCycleId) {
          await getDB().collection<WalletCycle>("adminWalletCycles").updateOne(
            { cycleId: settings.currentCycleId, status: "open" },
            { $set: { scheduledEndAt: null } },
            { session },
          );
        }
      } else if (!wasEnabled || !settings.currentCycleId) {
        // First activation funds immediately. Re-enabling with an open cycle
        // preserves its balance and starts a fresh schedule from the enable date.
        if (!settings.currentCycleId) {
          await openCycle(settings, session, new Date(), fundingAmountPaise);
        } else {
          settings.nextFundingAt = addDays(new Date(), intervalDays);
          await getDB().collection<WalletCycle>("adminWalletCycles").updateOne(
            { cycleId: settings.currentCycleId, status: "open" },
            { $set: { scheduledEndAt: settings.nextFundingAt } },
            { session },
          );
        }
      } else if (oldInterval !== intervalDays) {
        settings.nextFundingAt = addDays(new Date(), intervalDays);
        await getDB().collection<WalletCycle>("adminWalletCycles").updateOne(
          { cycleId: settings.currentCycleId, status: "open" },
          { $set: { scheduledEndAt: settings.nextFundingAt } },
          { session },
        );
      }

      await saveSettings(settings, session);
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildWalletResponse());
  } catch (error) {
    next(error);
  }
});

router.post("/admin/wallet/entries", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const amountPaise = req.body?.amountPaise;
    const description = cleanDescription(req.body?.description);

    if (!validAmount(amountPaise) || amountPaise === 0) {
      res.status(400).json({ message: "Enter a non-zero amount in paise. Use a negative amount for an expense." });
      return;
    }
    if (!description) {
      res.status(400).json({ message: "Enter a description for this transaction." });
      return;
    }

    await ensureIndexes();
    await withWalletTransaction(async (session) => {
      const settings = await loadSettings(session);
      await processDueCycles(settings, session, new Date());

      if (!settings.currentCycleId) {
        // Manual entries are allowed while automatic funding is paused.
        const cycleId = randomUUID();
        const startedAt = new Date();
        const cycle: WalletCycle = {
          cycleId,
          startedAt,
          scheduledEndAt: null,
          closedAt: null,
          fundingPaise: 0,
          netPnlPaise: 0,
          savingsTransferPaise: null,
          entryCount: 0,
          status: "open",
        };
        await getDB().collection<WalletCycle>("adminWalletCycles").insertOne(cycle, { session });
        settings.currentCycleId = cycleId;
        settings.currentCycleStartAt = startedAt;
      }

      const cycleId = settings.currentCycleId;
      const now = new Date();
      const transaction: WalletTransaction = {
        eventKey: `entry:${randomUUID()}`,
        type: amountPaise < 0 ? "expense" : "income",
        description,
        amountPaise,
        walletDeltaPaise: amountPaise,
        savingsDeltaPaise: 0,
        cycleId,
        createdAt: now,
      };
      await insertTransaction(session, transaction);
      settings.walletBalancePaise += amountPaise;
      await getDB().collection<WalletCycle>("adminWalletCycles").updateOne(
        { cycleId, status: "open" },
        { $inc: { netPnlPaise: amountPaise, entryCount: 1 } },
        { session },
      );
      await saveSettings(settings, session);
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildWalletResponse());
  } catch (error) {
    next(error);
  }
});


router.patch("/admin/wallet/transactions/:eventKey", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const eventKey = String(req.params.eventKey || "");
    const amountPaise = req.body?.amountPaise;
    if (!eventKey) {
      res.status(400).json({ message: "A transaction identifier is required." });
      return;
    }
    if (!validAmount(amountPaise) || amountPaise === 0) {
      res.status(400).json({ message: "Enter a non-zero transaction amount in paise." });
      return;
    }

    await updateWalletTransaction(eventKey, amountPaise);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildWalletResponse());
  } catch (error) {
    next(error);
  }
});

router.delete("/admin/wallet/transactions/:eventKey", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const eventKey = String(req.params.eventKey || "");
    if (!eventKey) {
      res.status(400).json({ message: "A transaction identifier is required." });
      return;
    }

    await removeWalletTransaction(eventKey);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildWalletResponse());
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/wallet/savings", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const savingsBalancePaise = req.body?.savingsBalancePaise;
    const description = cleanDescription(req.body?.description) || "Manual Savings balance adjustment";
    if (!validAmount(savingsBalancePaise)) {
      res.status(400).json({ message: "Enter a valid Savings balance in paise." });
      return;
    }

    await ensureIndexes();
    await withWalletTransaction(async (session) => {
      const settings = await loadSettings(session);
      await processDueCycles(settings, session, new Date());
      const adjustmentPaise = savingsBalancePaise - settings.savingsBalancePaise;
      settings.savingsBalancePaise = savingsBalancePaise;
      await insertTransaction(session, {
        eventKey: `savings-adjustment:${randomUUID()}`,
        type: "savings-adjustment",
        description,
        amountPaise: adjustmentPaise,
        walletDeltaPaise: 0,
        savingsDeltaPaise: adjustmentPaise,
        cycleId: null,
        createdAt: new Date(),
      });
      await saveSettings(settings, session);
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildWalletResponse());
  } catch (error) {
    next(error);
  }
});

router.post("/admin/wallet/settle", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    await ensureIndexes();
    await withWalletTransaction(async (session) => {
      const settings = await loadSettings(session);
      await processDueCycles(settings, session, new Date());
      if (!settings.currentCycleId) {
        throw Object.assign(new Error("There is no open wallet cycle to settle."), { statusCode: 409 });
      }

      const now = new Date();
      await closeCycleAndTransfer(settings, session, now);
      // An early manual settlement resets the next automatic funding date.
      settings.nextFundingAt = settings.autoFundingEnabled
        ? addDays(now, settings.intervalDays)
        : null;
      await saveSettings(settings, session);
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.json(await buildWalletResponse());
  } catch (error) {
    next(error);
  }
});

export default router;
