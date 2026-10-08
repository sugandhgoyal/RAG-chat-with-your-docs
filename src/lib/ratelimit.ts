import { createHash } from "node:crypto";
import { getSupabaseClient } from "./vectorstore";

// Tunable without code changes: set in .env.local / Vercel env vars
const PER_VISITOR_LIMIT = Number(process.env.DEMO_DAILY_LIMIT_PER_VISITOR ?? 20);
const GLOBAL_LIMIT = Number(process.env.DEMO_DAILY_LIMIT_GLOBAL ?? 300);

export type LimitResult = { ok: true } | { ok: false; status: number; message: string };

// We never store IP addresses: only a salted hash, used as a stable anonymous visitor ID.
function visitorKey(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const salt = process.env.IP_HASH_SALT ?? "docs-chat";
  return "v:" + createHash("sha256").update(salt + ip).digest("hex").slice(0, 32);
}

async function withinLimit(key: string, limit: number): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("increment_usage", {
    p_key: key,
    p_limit: limit,
  });
  if (error) throw error;
  return data === true;
}

export async function checkDemoLimits(req: Request): Promise<LimitResult> {
  try {
    // Visitor first: someone who is over their own limit shouldn't use up the shared budget
    if (!(await withinLimit(visitorKey(req), PER_VISITOR_LIMIT))) {
      return {
        ok: false,
        status: 429,
        message: `Daily limit reached (${PER_VISITOR_LIMIT} questions per visitor). Please come back tomorrow.`,
      };
    }
    if (!(await withinLimit("global", GLOBAL_LIMIT))) {
      return {
        ok: false,
        status: 429,
        message: "This demo has reached its daily capacity. Please try again tomorrow.",
      };
    }
    return { ok: true };
  } catch (err) {
    // Fail closed: if we can't count usage, don't risk an unmetered public endpoint
    console.error("rate limiter error:", err);
    return { ok: false, status: 503, message: "The demo is temporarily unavailable." };
  }
}
