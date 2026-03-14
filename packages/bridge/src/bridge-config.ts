const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://copilotchat.vercel.app"
] as const;

export function resolveAllowedOrigins(rawValue = process.env.ALLOWED_ORIGIN) {
  if (!rawValue?.trim()) {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
