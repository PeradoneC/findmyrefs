import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { BoardItem, SavedReference } from "../../lib/types";
import { safeImageSrc } from "../../lib/url";
import { clampPosition } from "./layout";

export function groupColor(name: string): string {
  if (!name.trim()) return "#6b7280";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 60%)`;
}

type Props = {
  item: BoardItem;
  reference: SavedReference;
  groups: string[];
  dimmed: boolean;
  swatches?: string[];
  onMove: (x: number, y: number) => void;
  onNotes: (notes: string) => void;
  onGroup: (group: string) => void;
  onRemove: () => void;
  onOpen: () => void;
  onSwatches: () => void;
};

export function BoardCard({
  item,
  reference,
  groups,
  dimmed,
  swatches,
  onMove,
  onNotes,
  onGroup,
  onRemove,
  onOpen,
  onSwatches,
}: Props) {
  const [pos, setPos] = useState({ x: item.positionX, y: item.positionY });
  const [dragging, setDragging] = useState(false);
  const [notes, setNotes] = useState(reference.userNotes);
  const [group, setGroup] = useState(item.groupName);
  const drag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    x: number;
    y: number;
  } | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = `groups-${item.id}`;

  // Adopt new values from the parent (e.g. "Arrange by group") without an effect.
  const [synced, setSynced] = useState({
    x: item.positionX,
    y: item.positionY,
    group: item.groupName,
  });
  if (
    synced.x !== item.positionX ||
    synced.y !== item.positionY ||
    synced.group !== item.groupName
  ) {
    setSynced({ x: item.positionX, y: item.positionY, group: item.groupName });
    setPos({ x: item.positionX, y: item.positionY });
    setGroup(item.groupName);
  }
  useEffect(
    () => () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    },
    [],
  );

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      x: pos.x,
      y: pos.y,
    };
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const next = clampPosition(d.originX + e.clientX - d.startX, d.originY + e.clientY - d.startY);
    d.x = next.x;
    d.y = next.y;
    setPos(next);
  }

  function onPointerUp() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    // Read the live position from the ref: state may not have re-rendered yet.
    if (d.x !== item.positionX || d.y !== item.positionY) onMove(d.x, d.y);
  }

  function onHandleKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 50 : 10;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const next = clampPosition(pos.x + d[0], pos.y + d[1]);
    setPos(next);
    onMove(next.x, next.y);
  }

  function changeNotes(value: string) {
    setNotes(value);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => onNotes(value), 700);
  }

  function flushNotes() {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = null;
    if (notes !== reference.userNotes) onNotes(notes);
  }

  const src = safeImageSrc(reference.thumbnailUrl);
  return (
    <div
      className={`board-card ${dragging ? "is-dragging" : ""}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: item.width,
        height: item.height,
        opacity: dimmed ? 0.35 : undefined,
      }}
      data-testid="board-card"
    >
      <div
        className="board-card-handle"
        role="button"
        tabIndex={0}
        aria-label={`Move "${reference.title}". Drag, or use arrow keys (Shift for bigger steps).`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onHandleKey}
      >
        <span className="group-dot" style={{ background: groupColor(group) }} aria-hidden />
        <span className="title" title={reference.title}>
          {reference.title}
        </span>
        {reference.isDemo && <span className="badge badge-demo">Demo</span>}
      </div>
      {src ? (
        <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} />
      ) : (
        <div className="thumb-missing">No preview</div>
      )}
      <div className="board-card-body">
        <input
          type="text"
          list={listId}
          value={group}
          placeholder="Group / section"
          maxLength={100}
          aria-label={`Group for "${reference.title}"`}
          onChange={(e) => setGroup(e.target.value)}
          onBlur={() => group !== item.groupName && onGroup(group)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <datalist id={listId}>
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <textarea
          value={notes}
          placeholder="Notes…"
          maxLength={10_000}
          aria-label={`Notes for "${reference.title}"`}
          onChange={(e) => changeNotes(e.target.value)}
          onBlur={flushNotes}
        />
        {swatches && swatches.length > 0 && (
          <div className="swatches" aria-label="Approximate colors">
            {swatches.map((c) => (
              <span key={c} className="swatch" style={{ background: c }} title={c} />
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 2 }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onOpen}
            title={reference.sourceUrl}
          >
            Source
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onSwatches}
            title="Extract approximate colors locally"
          >
            Colors
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onRemove}
            aria-label={`Remove "${reference.title}" from board`}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
