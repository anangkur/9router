import { describe, it, expect, vi } from "vitest";
import { diffModelIds, refreshModelsForConnection } from "@/lib/providerModelsRefresh.js";

const connection = { id: "conn-1", provider: "openrouter" };

describe("diffModelIds", () => {
  it("splits live ids against stored custom rows", () => {
    const live = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const stored = [{ id: "b" }, { id: "c" }, { id: "d" }];
    expect(diffModelIds(live, stored)).toEqual({ added: ["a"], removed: ["d"] });
  });

  it("tolerates missing input", () => {
    expect(diffModelIds(undefined, undefined)).toEqual({ added: [], removed: [] });
  });
});

describe("refreshModelsForConnection", () => {
  it("returns the upstream error and leaves stored state untouched on failure", async () => {
    const getStoredModels = vi.fn();
    const saveRefreshAt = vi.fn();

    const result = await refreshModelsForConnection(connection, {
      fetchModels: async () => ({ status: 502, body: { error: "Failed to fetch models: 502" } }),
      getStoredModels,
      saveRefreshAt,
    });

    expect(result).toMatchObject({ ok: false, status: 502, error: "Failed to fetch models: 502" });
    expect(getStoredModels).not.toHaveBeenCalled();
    expect(saveRefreshAt).not.toHaveBeenCalled();
  });

  it("treats an empty live catalog as a failure instead of a wipe", async () => {
    const saveRefreshAt = vi.fn();
    const result = await refreshModelsForConnection(connection, {
      fetchModels: async () => ({ status: 200, body: { models: undefined } }),
      getStoredModels: async () => [{ providerAlias: "openrouter", id: "kept" }],
      saveRefreshAt,
    });

    expect(result.ok).toBe(false);
    expect(saveRefreshAt).not.toHaveBeenCalled();
  });

  it("reports added/removed, free count and stamps the refresh time", async () => {
    const saveRefreshAt = vi.fn().mockResolvedValue(undefined);
    const result = await refreshModelsForConnection(connection, {
      fetchModels: async () => ({
        status: 200,
        body: { models: [{ id: "a" }, { id: "b", isFree: true }, { id: "c-free" }] },
      }),
      getStoredModels: async () => [
        { providerAlias: "openrouter", id: "a" },
        { providerAlias: "openrouter", id: "gone" },
        { providerAlias: "other", id: "other-1" },
      ],
      saveRefreshAt,
    });

    expect(result).toMatchObject({
      ok: true,
      connectionId: "conn-1",
      provider: "openrouter",
      fetched: 3,
      freeCount: 2,
      added: ["b", "c-free"],
      removed: ["gone"],
    });
    expect(saveRefreshAt).toHaveBeenCalledWith("conn-1", result.lastModelsRefreshAt);
  });
});
