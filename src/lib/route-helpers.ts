import { NextResponse } from "next/server";
import { UnauthorizedError } from "./session";

/**
 * Error whose message is safe to show the user (e.g. "please reconnect Gmail").
 * Anything that isn't a ClientError/UnauthorizedError is treated as internal and
 * surfaced only as a generic message — we never leak raw DB/provider error text.
 */
export class ClientError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

/** Map thrown errors to consistent JSON HTTP responses for route handlers. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error("API error:", err);
  if (err instanceof ClientError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Internal errors: log the detail server-side, return a generic message.
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
