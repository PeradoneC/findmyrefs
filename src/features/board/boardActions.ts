import type { Backend } from "../../lib/backend";
import type { BoardItem, NewReference, SavedReference, SearchHit } from "../../lib/types";
import { CARD_HEIGHT, CARD_WIDTH, nextFreePosition } from "./layout";

export function toNewReference(
  projectId: string,
  hit: SearchHit,
  categoryName: string | null,
): NewReference {
  const r = hit.result;
  return {
    projectId,
    provider: r.provider,
    providerResultId: r.id,
    title: r.title,
    thumbnailUrl: r.thumbnailUrl ?? null,
    sourceUrl: r.sourceUrl,
    creatorName: r.creatorName ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    licenseLabel: r.licenseLabel ?? null,
    category: categoryName,
    isDemo: r.isDemo,
  };
}

/** Places a saved reference on the board in the next free slot (idempotent). */
export async function placeOnBoard(
  backend: Backend,
  reference: SavedReference,
  groupName: string,
): Promise<BoardItem> {
  const items = await backend.listBoardItems(reference.projectId);
  const existing = items.find((i) => i.referenceId === reference.id);
  if (existing) return existing;
  const { x, y } = nextFreePosition(items);
  return backend.addBoardItem({
    projectId: reference.projectId,
    referenceId: reference.id,
    groupName,
    positionX: x,
    positionY: y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });
}

export async function addHitToBoard(
  backend: Backend,
  projectId: string,
  hit: SearchHit,
  categoryName: string | null,
): Promise<{ reference: SavedReference; item: BoardItem }> {
  const reference = await backend.saveReference(toNewReference(projectId, hit, categoryName));
  const item = await placeOnBoard(backend, reference, categoryName ?? "");
  return { reference, item };
}
