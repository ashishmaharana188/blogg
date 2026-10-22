import fs from "node:fs";
import path from "node:path";

const filePath = path.resolve(
  process.cwd(),
  "frontend/src/pages/Account/HealthAdminPanel.tsx",
);
if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this script from the repository root.`);
  process.exit(1);
}

const source = fs.readFileSync(filePath, "utf8");
if (source.includes("const runningHeartRateSessions: ExerciseSession[]")) {
  console.log("HealthAdminPanel.tsx already includes running-session heart rates; no change needed.");
  process.exit(0);
}

const startMarker = "  const heartMetricSessions = allExerciseSessions";
const endMarker = "  const hasHeartData = Boolean(";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  console.error("Could not find the expected heart-rate session block. No file was changed.");
  process.exit(1);
}

const replacement = `  // Running sessions are stored separately from other exercises by the backend.
  // Merge them here so the heart-rate panel reports every activity with HR data.
  const runningHeartRateSessions: ExerciseSession[] = (summary?.recentRuns || []).map((run) => ({
    sessionId: run.sessionId,
    exerciseType: 1002,
    activityName: "Running",
    startedAt: run.startedAt,
    durationSeconds: run.durationSeconds,
    calories: run.calories,
    avgHeartRate: run.avgHeartRate,
    minHeartRate: run.minHeartRate,
    maxHeartRate: run.maxHeartRate,
    values: {
      heartRate: {
        average: run.avgHeartRate,
        minimum: run.minHeartRate,
        maximum: run.maxHeartRate,
      },
    },
  }));
  const heartMetricSessions = [...allExerciseSessions, ...runningHeartRateSessions]
    .filter((session) => {
      const heart = getSessionHeartRate(session);
      return heart.average != null || heart.minimum != null || heart.maximum != null;
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 5);

`;
const updated = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(filePath, updated, "utf8");
console.log("Updated HealthAdminPanel.tsx to include running-session heart rates. No other panel code was changed.");
