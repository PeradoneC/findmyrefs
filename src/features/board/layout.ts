import type { BoardItem } from "../../lib/types";

export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 280;
export const GAP = 24;
export const BOARD_PADDING = 32;
export const MAX_BOARD_COORD = 20_000;

export function clampPosition(x: number, y: number): { x: number; y: number } {
  const c = (v: number) =>
    Math.round(Math.min(MAX_BOARD_COORD, Math.max(0, Number.isFinite(v) ? v : 0)));
  return { x: c(x), y: c(y) };
}

/** Next free slot in a simple grid, so new cards don't land on top of each other. */
export function nextFreePosition(
  items: Pick<BoardItem, "positionX" | "positionY" | "width" | "height">[],
  columns = 5,
): {
  x: number;
  y: number;
} {
  const overlaps = (x: number, y: number) =>
    items.some(
      (i) =>
        x < i.positionX + i.width &&
        x + CARD_WIDTH > i.positionX &&
        y < i.positionY + i.height &&
        y + CARD_HEIGHT > i.positionY,
    );
  for (let slot = 0; slot < 2000; slot++) {
    const x = BOARD_PADDING + (slot % columns) * (CARD_WIDTH + GAP);
    const y = BOARD_PADDING + Math.floor(slot / columns) * (CARD_HEIGHT + GAP);
    if (!overlaps(x, y)) return { x, y };
  }
  return { x: BOARD_PADDING, y: BOARD_PADDING };
}

export type ArrangedPosition = {
  id: string;
  positionX: number;
  positionY: number;
  sortOrder: number;
};

/**
 * Arranges cards in one column per group (groups sorted by name, ungrouped last).
 * Returns only the new geometry; the caller persists it.
 */
export function arrangeByGroup(items: BoardItem[]): {
  positions: ArrangedPosition[];
  groups: { name: string; x: number }[];
} {
  const groups = new Map<string, BoardItem[]>();
  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const g = item.groupName.trim();
    groups.set(g, [...(groups.get(g) ?? []), item]);
  }
  const names = [...groups.keys()].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );
  const positions: ArrangedPosition[] = [];
  const headers: { name: string; x: number }[] = [];
  let order = 0;
  names.forEach((name, col) => {
    const x = BOARD_PADDING + col * (CARD_WIDTH + GAP * 2);
    headers.push({ name: name || "Ungrouped", x });
    let y = BOARD_PADDING + 36;
    for (const item of groups.get(name) ?? []) {
      positions.push({ id: item.id, positionX: x, positionY: y, sortOrder: order++ });
      y += item.height + GAP;
    }
  });
  return { positions, groups: headers };
}

export function boardExtent(
  items: Pick<BoardItem, "positionX" | "positionY" | "width" | "height">[],
): {
  width: number;
  height: number;
} {
  let w = 1200;
  let h = 800;
  for (const i of items) {
    w = Math.max(w, i.positionX + i.width + 400);
    h = Math.max(h, i.positionY + i.height + 400);
  }
  return { width: w, height: h };
}
