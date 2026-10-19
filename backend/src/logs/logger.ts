import winston from "winston";

type LogRecord = Record<string, unknown>;
type LogLevel = "info" | "warn" | "error";

const sink = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

function write(level: LogLevel, record: LogRecord): void {
  const event = typeof record.event === "string" ? record.event : level.toUpperCase();
  sink.log({ ...record, level, message: event });
}

const logger = {
  info: (record: LogRecord) => write("info", record),
  warn: (record: LogRecord) => write("warn", record),
  error: (record: LogRecord) => write("error", record),
};

export default logger;
