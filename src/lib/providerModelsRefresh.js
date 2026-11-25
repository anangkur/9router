// Explicit per-connection "refresh available models".
//
// Reuses the single live-fetch code path (lib/providerModelsFetch.js) instead of
// duplicating HTTP clients, then reports what the live catalog has that the
// connection's stored custom rows do not. Persists nothing but a timestamp.
import { getProviderConnectionById, getCustomModels, updateProviderConnection } from "@/models";
import { fetchConnectionModels } from "@/lib/providerModelsFetch";

export { isModelsRefreshable } from "@/lib/providerModelsFetch";

// Max one in-flight refresh per connection: concurrent dashboard clicks would
// otherwise stampede the upstream. Module scope is per server process, which is
// the right granularity here (no cross-process lock, no restart needed).
const inFlight = new Set();

const isFreeModel = (model) => model?.isFree === true || /-free$/i.test(String(model?.id || ""));

/** Pure diff of live ids vs stored custom-row ids. */
export function diffModelIds(liveModels, storedModels) {
  const liveIds = (liveModels || []).map((m) => m?.id).filter(Boolean);
  const liveSet = new Set(liveIds);
  const storedIds = (storedModels || []).map((m) => m?.id).filter(Boolean);
  const storedSet = new Set(storedIds);
  return {
    added: liveIds.filter((id) => !storedSet.has(id)),
    removed: storedIds.filter((id) => !liveSet.has(id)),
  };
}

function defaultDeps() {
  return {
    fetchModels: async (id) => {
      const { getProviderConnectionById: getConnection } = await import("@/models");
      const connection = await getConnection(id);
      if (!connection) return { status: 404, body: { error: "Connection not found" } };
      const result = await fetchConnectionModels(connection);
      return result.error
        ? { status: result.status || 500, body: { error: result.error } }
        : { status: 200, body: { models: result.models, ...(result.warning ? { warning: result.warning } : {}) } };
    },
    getStoredModels: getCustomModels,
    saveRefreshAt: (id, at) => updateProviderConnection(id, { lastModelsRefreshAt: at }),
  };
}

/**
 * Refresh one connection. `deps` exists so the failure path is testable without
 * a database or network. Never throws: a failed fetch leaves stored rows alone
 * and returns the upstream status.
 */
export async function refreshModelsForConnection(connection, deps = defaultDeps()) {
  const live = await deps.fetchModels(connection.id);
  const models = live?.body?.models;
  if (live?.status !== 200 || !Array.isArray(models)) {
    return {
      ok: false,
      status: live?.status && live.status !== 200 ? live.status : 500,
      connectionId: connection.id,
      provider: connection.provider,
      error: live?.body?.error || "Failed to fetch models",
    };
  }

  const stored = (await deps.getStoredModels()).filter((m) => m.providerAlias === connection.provider);
  const { added, removed } = diffModelIds(models, stored);
  const lastModelsRefreshAt = new Date().toISOString();
  await deps.saveRefreshAt(connection.id, lastModelsRefreshAt);

  return {
    ok: true,
    connectionId: connection.id,
    provider: connection.provider,
    fetched: models.length,
    freeCount: models.filter(isFreeModel).length,
    added,
    removed,
    lastModelsRefreshAt,
    ...(live.body.warning ? { warning: live.body.warning } : {}),
  };
}

/** Look up the connection, take its refresh lock, then refresh it. */
export async function refreshConnectionModels(connectionId) {
  if (inFlight.has(connectionId)) {
    return { ok: false, status: 409, connectionId, error: "A models refresh is already running for this connection" };
  }
  inFlight.add(connectionId);
  try {
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return { ok: false, status: 404, connectionId, error: "Connection not found" };
    }
    return await refreshModelsForConnection(connection);
  } catch (error) {
    return { ok: false, status: 500, connectionId, error: error?.message || "Failed to refresh models" };
  } finally {
    inFlight.delete(connectionId);
  }
}
