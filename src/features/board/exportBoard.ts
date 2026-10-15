// Board metadata export (JSON). Contains links and attribution, never image data.

import type { ArtBrief, BoardItem, Project, SavedReference } from "../../lib/types";

export type BoardExport = {
  format: "findmyrefs-board";
  version: 1;
  exportedAt: string;
  project: { name: string; brief: string };
  containsDemoData: boolean;
  references: {
    title: string;
    sourceUrl: string;
    provider: string;
    creator: string | null;
    license: string | null;
    group: string;
    notes: string;
    position: { x: number; y: number };
    isDemo: boolean;
  }[];
};

export function buildBoardExport(
  project: Project,
  brief: ArtBrief | null,
  items: BoardItem[],
  references: SavedReference[],
  now = new Date(),
): BoardExport {
  const byId = new Map(references.map((r) => [r.id, r]));
  const rows = [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((item) => {
      const ref = byId.get(item.referenceId);
      if (!ref) return [];
      return [
        {
          title: ref.title,
          sourceUrl: ref.sourceUrl,
          provider: ref.provider,
          creator: ref.creatorName,
          license: ref.licenseLabel,
          group: item.groupName,
          notes: ref.userNotes,
          position: { x: item.positionX, y: item.positionY },
          isDemo: ref.isDemo,
        },
      ];
    });
  return {
    format: "findmyrefs-board",
    version: 1,
    exportedAt: now.toISOString(),
    project: { name: project.name, brief: brief?.originalPrompt ?? project.originalPrompt },
    containsDemoData: rows.some((r) => r.isDemo),
    references: rows,
  };
}

export function exportFileName(projectName: string): string {
  const safe =
    projectName
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "board";
  return `${safe}-board.json`;
}

/** Triggers a browser download of JSON text. */
export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
