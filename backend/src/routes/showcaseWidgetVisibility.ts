import { Router } from "express";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const SETTING_KEY = "showcase-widget-visibility";

const DEFAULT_WIDGETS = {
  music: false,
  health: false,
  reading: false,
} as const;

type WidgetKey = keyof typeof DEFAULT_WIDGETS;
type WidgetVisibility = Record<WidgetKey, boolean>;

function isWidgetKey(value: unknown): value is WidgetKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEFAULT_WIDGETS, value);
}

async function readWidgetVisibility(): Promise<WidgetVisibility> {
  const setting = await getDB().collection("adminIntegrationSettings").findOne({ key: SETTING_KEY });
  const saved = setting?.widgets && typeof setting.widgets === "object"
    ? setting.widgets as Record<string, unknown>
    : {};

  // Opt-in by default: until an administrator enables a widget, public pages hide it.
  return {
    music: saved.music === true,
    health: saved.health === true,
    reading: saved.reading === true,
  };
}

router.get("/showcase/widget-visibility", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json({ widgets: await readWidgetVisibility() });
  } catch (error) {
    return next(error);
  }
});

router.patch("/admin/showcase/widget-visibility", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const widget = req.body?.widget as unknown;
    const enabled = req.body?.enabled as unknown;

    if (!isWidgetKey(widget) || typeof enabled !== "boolean") {
      return res.status(400).json({
        message: "widget must be music, health, or reading, and enabled must be a boolean.",
      });
    }

    const widgets = await readWidgetVisibility();
    const updated: WidgetVisibility = { ...widgets, [widget]: enabled };
    await getDB().collection("adminIntegrationSettings").updateOne(
      { key: SETTING_KEY },
      { $set: { key: SETTING_KEY, widgets: updated, updatedAt: new Date() } },
      { upsert: true },
    );

    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, widgets: updated });
  } catch (error) {
    return next(error);
  }
});

export default router;
