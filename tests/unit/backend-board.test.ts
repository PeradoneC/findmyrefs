import { describe, expect, it } from "vitest";
import { createBrowserBackend } from "../../src/lib/backend/browserBackend";
import { addHitToBoard } from "../../src/features/board/boardActions";
import {
  arrangeByGroup,
  clampPosition,
  nextFreePosition,
  CARD_WIDTH,
} from "../../src/features/board/layout";
import { buildBoardExport, exportFileName } from "../../src/features/board/exportBoard";
import { dominantColors } from "../../src/features/board/swatches";
import type { BoardItem, SearchHit } from "../../src/lib/types";

/** Minimal Storage so two backend instances can share data (simulates an app restart). */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

function demoHit(id: string): SearchHit {
  return {
    key: `mock:${id}`,
    categories: ["subject"],
    queries: ["fox"],
    score: 1,
    result: {
      id,
      title: `Demo: fox #${id}`,
      sourceUrl: `https://example.com/demo/fox/${id}`,
      thumbnailUrl: "data:image/svg+xml,<svg/>",
      provider: "mock",
      isDemo: true,
    },
  };
}

describe("browser backend persistence", () => {
  it("persists projects, board positions and notes across restarts", async () => {
    const storage = new MemoryStorage();
    const first = createBrowserBackend({ storage });
    const project = await first.createProject("Winter fox");
    await first.updateProject(project.id, {
      originalPrompt: "a fox",
      structuredBriefJson: '{"x":1}',
    });
    const { reference, item } = await addHitToBoard(first, project.id, demoHit("1"), "Subject");
    await first.updateBoardItem(item.id, { positionX: 400, positionY: 250 });
    await first.updateReferenceNotes(reference.id, "fur texture");

    const reopened = createBrowserBackend({ storage });
    const p = await reopened.getProject(project.id);
    expect(p?.originalPrompt).toBe("a fox");
    const items = await reopened.listBoardItems(project.id);
    expect(items).toHaveLength(1);
    expect([items[0]?.positionX, items[0]?.positionY]).toEqual([400, 250]);
    expect(items[0]?.groupName).toBe("Subject");
    const refs = await reopened.listReferences(project.id);
    expect(refs[0]?.userNotes).toBe("fur texture");
    expect(refs[0]?.isDemo).toBe(true);
  });

  it("adding the same result twice is idempotent", async () => {
    const backend = createBrowserBackend({ storage: null });
    const project = await backend.createProject("P");
    const a = await addHitToBoard(backend, project.id, demoHit("1"), null);
    const b = await addHitToBoard(backend, project.id, demoHit("1"), null);
    expect(a.item.id).toBe(b.item.id);
    expect(await backend.listReferences(project.id)).toHaveLength(1);
  });

  it("new cards do not overlap existing ones", async () => {
    const backend = createBrowserBackend({ storage: null });
    const project = await backend.createProject("P");
    const a = await addHitToBoard(backend, project.id, demoHit("1"), null);
    const b = await addHitToBoard(backend, project.id, demoHit("2"), null);
    expect(b.item.positionX).toBeGreaterThanOrEqual(a.item.positionX + CARD_WIDTH);
  });

  it("deleting a project removes all its data", async () => {
    const backend = createBrowserBackend({ storage: null });
    const project = await backend.createProject("P");
    await addHitToBoard(backend, project.id, demoHit("1"), null);
    await backend.hideResult(project.id, "mock:2");
    await backend.deleteProject(project.id);
    expect(await backend.getProject(project.id)).toBeNull();
    expect(await backend.listReferences(project.id)).toEqual([]);
    expect(await backend.listBoardItems(project.id)).toEqual([]);
    expect(await backend.listHiddenResults(project.id)).toEqual([]);
  });

  it("validates input like the desktop backend", async () => {
    const backend = createBrowserBackend({ storage: null });
    await expect(backend.createProject("  ")).rejects.toMatchObject({ code: "invalid" });
    const project = await backend.createProject("P");
    const bad = {
      ...demoHit("x"),
      result: { ...demoHit("x").result, sourceUrl: "javascript:alert(1)" },
    };
    await expect(addHitToBoard(backend, project.id, bad, null)).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      backend.updateProject(project.id, { structuredBriefJson: "{bad" }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(backend.updateSettings({ maxImagesPerBatch: 0 })).rejects.toMatchObject({
      code: "invalid",
    });
    const { item } = await addHitToBoard(backend, project.id, demoHit("1"), null);
    await expect(backend.updateBoardItem(item.id, { positionX: Number.NaN })).rejects.toMatchObject(
      { code: "invalid" },
    );
  });

  it("defaults to free providers and never stores API keys", async () => {
    const backend = createBrowserBackend({ storage: null });
    const settings = await backend.getSettings();
    expect(settings.aiProvider).toBe("mock");
    expect(settings.searchProvider).toBe("mock");
    expect(settings.maxImagesPerBatch).toBe(3);
    await expect(backend.setApiKey("sk-ant-SECRET")).rejects.toMatchObject({
      code: "desktop_only",
    });
    const status = await backend.getAiStatus();
    expect(status.hasApiKey).toBe(false);
    expect(status.paid.available).toBe(false);
    expect(JSON.stringify(status)).not.toContain("SECRET");
    await expect(backend.anthropicAnalyzeBrief("x", true)).rejects.toMatchObject({
      code: "desktop_only",
    });
  });

  it("survives corrupted storage", async () => {
    const storage = new MemoryStorage();
    storage.setItem("findmyrefs:browser-backend:v1", "{corrupt");
    const backend = createBrowserBackend({ storage });
    expect(await backend.listProjects()).toEqual([]);
  });
});

describe("board layout and export", () => {
  const item = (id: string, group: string, order: number): BoardItem => ({
    id,
    projectId: "p",
    referenceId: `r${id}`,
    groupName: group,
    positionX: 999,
    positionY: 999,
    width: 220,
    height: 280,
    sortOrder: order,
    createdAt: "",
    updatedAt: "",
  });

  it("arranges cards in one column per group, ungrouped last", () => {
    const { positions, groups } = arrangeByGroup([
      item("1", "", 0),
      item("2", "Lighting", 1),
      item("3", "Color", 2),
      item("4", "Lighting", 3),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Color", "Lighting", "Ungrouped"]);
    const byId = Object.fromEntries(positions.map((p) => [p.id, p]));
    expect(byId["2"]?.positionX).toBe(byId["4"]?.positionX);
    expect(byId["4"]!.positionY).toBeGreaterThan(byId["2"]!.positionY);
    expect(byId["1"]!.positionX).toBeGreaterThan(byId["2"]!.positionX);
  });

  it("clamps positions and finds free slots", () => {
    expect(clampPosition(-50, Number.NaN)).toEqual({ x: 0, y: 0 });
    expect(clampPosition(1e9, 10)).toEqual({ x: 20_000, y: 10 });
    const first = nextFreePosition([]);
    const second = nextFreePosition([
      { positionX: first.x, positionY: first.y, width: 220, height: 280 },
    ]);
    expect(second).not.toEqual(first);
  });

  it("exports metadata and links only, flagging demo data", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const exported = buildBoardExport(
      {
        id: "p",
        name: "Fox",
        originalPrompt: "a fox",
        structuredBriefJson: null,
        createdAt: "",
        updatedAt: "",
      },
      null,
      [item("1", "Subject", 0)],
      [
        {
          id: "r1",
          projectId: "p",
          provider: "mock",
          providerResultId: "1",
          title: "Demo: fox",
          thumbnailUrl: "data:image/svg+xml,<svg/>",
          sourceUrl: "https://example.com/demo/1",
          creatorName: null,
          width: null,
          height: null,
          licenseLabel: "Demo",
          category: null,
          isDemo: true,
          userNotes: "note",
          analysisJson: null,
          createdAt: "",
        },
      ],
      now,
    );
    expect(exported.containsDemoData).toBe(true);
    expect(exported.references[0]).toMatchObject({
      sourceUrl: "https://example.com/demo/1",
      notes: "note",
      group: "Subject",
    });
    expect(JSON.stringify(exported)).not.toContain("svg");
    expect(exportFileName("Winter fox / v2")).toBe("Winter-fox-v2-board.json");
  });

  it("extracts dominant colors from pixel data", () => {
    const pixels: number[] = [];
    for (let i = 0; i < 30; i++) pixels.push(250, 10, 10, 255); // red
    for (let i = 0; i < 10; i++) pixels.push(10, 10, 250, 255); // blue
    for (let i = 0; i < 10; i++) pixels.push(0, 0, 0, 0); // transparent, ignored
    const colors = dominantColors(pixels, 3, 1);
    expect(colors[0]).toBe("#fa0a0a");
    expect(colors[1]).toBe("#0a0afa");
    expect(colors).toHaveLength(2);
  });
});
