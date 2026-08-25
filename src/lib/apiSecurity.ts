import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";

export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": getSiteUrl(),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function jsonWithCors<T>(body: T, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return NextResponse.json(body, { ...init, headers });
}

export function handleOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
