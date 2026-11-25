import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { isModelsRefreshable, refreshConnectionModels } from "@/lib/providerModelsRefresh";

/**
 * POST /api/providers/refresh-models - refresh every active connection that has a
 * live catalog. Sequential on purpose (upstreams rate-limit hard); a per-connection
 * error is collected instead of failing the whole request. Connections without a
 * live fetcher are skipped, and one already refreshing elsewhere reports 409 there.
 */
export async function POST() {
  try {
    const connections = await getProviderConnections({ isActive: true });
    const results = [];
    const skipped = [];
    const errors = [];

    for (const connection of connections) {
      if (!isModelsRefreshable(connection.provider)) {
        skipped.push({ connectionId: connection.id, provider: connection.provider, reason: "No live models fetcher" });
        continue;
      }
      const result = await refreshConnectionModels(connection.id);
      results.push(result);
      if (!result.ok) {
        errors.push({ connectionId: connection.id, provider: connection.provider, error: result.error, status: result.status });
      }
    }

    return NextResponse.json({
      ok: true,
      refreshed: results.filter((r) => r.ok).length,
      results,
      skipped,
      errors,
    });
  } catch (error) {
    console.log("Error refreshing provider models:", error);
    return NextResponse.json({ ok: false, error: "Failed to refresh models" }, { status: 500 });
  }
}
