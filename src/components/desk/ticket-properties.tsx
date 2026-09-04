import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import { PROPERTY_GROUPS, propertyCompleteness, type PropertyDef } from "@/lib/ticket-properties";
import { useDesk } from "@/lib/desk-store";
import { cn } from "@/lib/utils";

export function TicketProperties({ ticketId, readOnly }: { ticketId: string; readOnly?: boolean }) {
  const { state, setProperty } = useDesk();
  const values = state.props[ticketId] ?? {};
  const [open, setOpen] = useState<Record<string, boolean>>({ request: true, info: true, additional: false });
  const done = useMemo(() => propertyCompleteness(values), [values]);

  return (
    <div className="rounded-md border border-line bg-raise">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[10px] uppercase tracking-[0.2em] text-faint">Ticket properties</span>
        <span
          className={cn(
            "ml-auto rounded border px-1 font-mono text-[9px]",
            done.filled === done.total ? "border-accent/30 text-accent" : "border-amber/30 text-amber",
          )}
        >
          {done.filled}/{done.total} required
        </span>
      </div>

      <div className="divide-y divide-line/60">
        {PROPERTY_GROUPS.map((group) => {
          const isOpen = open[group.id] ?? false;
          const filled = group.fields.filter((f) => (values[f.key] ?? "") !== "").length;
          return (
            <div key={group.id}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [group.id]: !isOpen }))}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <ChevronDown className={cn("size-3 text-faint transition-transform", !isOpen && "-rotate-90")} />
                <span className="text-[12px] font-medium text-fg">{group.label}</span>
                <span className="ml-auto font-mono text-[9px] text-faint">
                  {filled}/{group.fields.length}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-1 px-2 pb-3">
                  {group.fields.map((f) => (
                    <PropertyRow
                      key={f.key}
                      def={f}
                      value={values[f.key] ?? ""}
                      readOnly={Boolean(readOnly)}
                      onChange={(v) => void setProperty(ticketId, f.key, v)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Zoho-style inline field: click the value to edit it, Enter/blur saves, Esc cancels. */
function PropertyRow({
  def,
  value,
  readOnly,
  onChange,
}: {
  def: PropertyDef;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [chip, setChip] = useState("");
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = (next = draft) => {
    setEditing(false);
    if (next !== value) onChange(next);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const label = (
    <span className={cn("text-[10px]", def.required ? "text-fg/70" : "text-faint")}>
      {def.label}
      {def.required && <span className="text-red"> *</span>}
    </span>
  );

  const empty = value.trim() === "";

  // Toggles and chip lists edit in place with no separate mode.
  if (def.type === "checkbox") {
    return (
      <div className="rounded px-1 py-1">
        {label}
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(value === "true" ? "false" : "true")}
          className={cn(
            "mt-1 flex h-6 w-full items-center gap-2 rounded-md border px-2 text-left text-[11px] transition-colors",
            value === "true" ? "border-accent/40 bg-accent/10 text-accent" : "border-line/70 text-dim",
            !readOnly && "hover:border-accent/40",
          )}
        >
          <span
            className={cn(
              "size-2.5 rounded-sm border",
              value === "true" ? "border-accent bg-accent" : "border-line",
            )}
          />
          {value === "true" ? "Yes" : "No"}
        </button>
      </div>
    );
  }

  if (def.type === "chips") {
    const list = value.split(",").map((c) => c.trim()).filter(Boolean);
    return (
      <div className="rounded px-1 py-1">
        {label}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {list.map((c) => (
            <span
              key={c}
              className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-dim"
            >
              {c}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onChange(list.filter((x) => x !== c).join(","))}
                  className="text-faint transition-colors hover:text-red"
                  aria-label={`Remove ${c}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {!readOnly && (
            <input
              value={chip}
              onChange={(e) => setChip(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && chip.trim()) {
                  e.preventDefault();
                  onChange([...list, chip.trim()].join(","));
                  setChip("");
                }
              }}
              placeholder={list.length ? "add…" : def.hint ?? "add…"}
              className="w-20 border-b border-dashed border-line bg-transparent text-[11px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
            />
          )}
          {readOnly && list.length === 0 && <span className="text-[12px] text-faint">—</span>}
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? -1 : 0}
        onClick={() => !readOnly && setEditing(true)}
        onKeyDown={(e) => {
          if (!readOnly && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={cn(
          "group rounded px-1 py-1 transition-colors",
          !readOnly && "cursor-text hover:bg-accent/[0.06]",
        )}
      >
        {label}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate border-b border-transparent text-[12px]",
              empty && def.required ? "text-red/80" : empty ? "text-faint" : "text-fg",
              !readOnly && "group-hover:border-dashed group-hover:border-line",
            )}
          >
            {empty ? (def.required ? "Required" : "—") : value}
          </span>
          {!readOnly && (
            <Pencil className="size-2.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
      </div>
    );
  }

  const base =
    "mt-1 w-full rounded-md border border-accent/50 bg-panel px-2 text-[11px] text-fg placeholder:text-faint focus:outline-none";

  return (
    <div className="rounded bg-accent/[0.04] px-1 py-1">
      {label}
      {def.type === "select" ? (
        <select
          ref={(el) => {
            ref.current = el;
          }}
          value={draft}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => e.key === "Escape" && cancel()}
          className={cn(base, "h-7")}
        >
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : def.type === "textarea" ? (
        <textarea
          ref={(el) => {
            ref.current = el;
          }}
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          }}
          placeholder={def.hint ?? ""}
          className={cn(base, "resize-none py-1.5")}
        />
      ) : (
        <input
          ref={(el) => {
            ref.current = el;
          }}
          type={def.type === "number" ? "number" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter") commit();
          }}
          placeholder={def.hint ?? ""}
          className={cn(base, "h-7")}
        />
      )}
    </div>
  );
}
