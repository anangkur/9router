import { NextResponse } from "next/server";
import { refreshConnectionModels } from "@/lib/providerModelsRefresh";

/**
 * POST /api/providers/[id]/models/refresh - force a live re-fetch for one connection.
 * Returns { ok, connectionId, provider, fetched, freeCount, added[], removed[] }.
 */
export async function POST(request, { params }) {
  const { id } = await params;
  const { status, ...payload } = await refreshConnectionModels(id);
  return NextResponse.json(payload, { status: status || 200 });
}
