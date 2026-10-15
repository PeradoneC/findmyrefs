import type { Priority, ReferenceCategory } from "../../lib/types";
import { newManualCategory } from "./queryPlanner";

type Props = {
  categories: ReferenceCategory[];
  onChange: (next: ReferenceCategory[]) => void;
};

/** Edit categories and queries before searching. The user stays in control. */
export function CategoryEditor({ categories, onChange }: Props) {
  const update = (id: string, patch: Partial<ReferenceCategory>) =>
    onChange(categories.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const updateQuery = (c: ReferenceCategory, index: number, value: string) =>
    update(c.id, {
      searchQueries: c.searchQueries.map((q, i) => (i === index ? value.slice(0, 120) : q)),
    });

  return (
    <div>
      {categories.length === 0 && (
        <p className="muted">
          No categories yet. Analyze the brief, or add a category and type your own queries.
        </p>
      )}
      {categories.map((c) => {
        const enabled = c.enabled !== false;
        return (
          <fieldset
            key={c.id}
            className={`category-card ${enabled ? "" : "is-disabled"}`}
            style={{ margin: 0 }}
          >
            <legend className="visually-hidden">Category {c.name}</legend>
            <div className="category-head">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => update(c.id, { enabled: e.target.checked })}
                aria-label={`Include ${c.name} in search`}
                title="Include this category in the search"
              />
              <input
                type="text"
                value={c.name}
                maxLength={80}
                onChange={(e) => update(c.id, { name: e.target.value })}
                aria-label="Category name"
              />
              <select
                value={c.priority}
                onChange={(e) => update(c.id, { priority: e.target.value as Priority })}
                aria-label={`Priority for ${c.name}`}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onChange(categories.filter((x) => x.id !== c.id))}
                aria-label={`Remove category ${c.name}`}
              >
                Remove
              </button>
            </div>
            {c.purpose && (
              <div className="faint" style={{ marginTop: 4 }}>
                {c.purpose}
              </div>
            )}
            <div className="query-list">
              {c.searchQueries.map((q, i) => (
                <div className="query-row" key={i}>
                  <input
                    type="text"
                    value={q}
                    maxLength={120}
                    onChange={(e) => updateQuery(c, i, e.target.value)}
                    aria-label={`${c.name} query ${i + 1}`}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      update(c.id, { searchQueries: c.searchQueries.filter((_, j) => j !== i) })
                    }
                    aria-label={`Remove query ${q || i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={c.searchQueries.length >= 8}
                  onClick={() => update(c.id, { searchQueries: [...c.searchQueries, ""] })}
                >
                  + Add query
                </button>
              </div>
            </div>
          </fieldset>
        );
      })}
      <button
        type="button"
        className="btn btn-sm"
        style={{ marginTop: 10 }}
        disabled={categories.length >= 16}
        onClick={() => onChange([...categories, newManualCategory(categories)])}
      >
        + Add category
      </button>
    </div>
  );
}
