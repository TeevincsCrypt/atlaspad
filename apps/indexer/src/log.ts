type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
