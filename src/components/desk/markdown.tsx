import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Inline formatting: **bold**, `code`, _italic_. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-fg">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded border border-line bg-raise px-1 py-px font-mono text-[11px] text-accent"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Deliberately small markdown subset (headings, lists, tables, code fences,
 * paragraphs) so knowledge base articles render without a heavy dependency.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;
  let fence: string[] | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p${key++}`} className="text-[13px] leading-relaxed text-dim">
        {inline(paragraph.join(" "), `p${key}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, idx) => (
      <li key={idx} className="text-[13px] leading-relaxed text-dim">
        {inline(item, `li${key}-${idx}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`l${key++}`} className="ml-4 list-decimal space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={`l${key++}`} className="ml-4 list-disc space-y-1">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  const flushTable = () => {
    if (!table || table.length === 0) return;
    const [head, ...rows] = table;
    blocks.push(
      <div key={`t${key++}`} className="overflow-hidden rounded-md border border-line">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-raise">
              {(head ?? []).map((cell, i) => (
                <th
                  key={i}
                  className="border-b border-line px-2.5 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-faint"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line/50 last:border-0">
                {row.map((cell, c) => (
                  <td key={c} className="px-2.5 py-1.5 text-dim">
                    {inline(cell, `td${r}-${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = null;
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith("```")) {
      if (fence) {
        blocks.push(
          <pre
            key={`c${key++}`}
            className="overflow-x-auto rounded-md border border-line bg-raise p-3 font-mono text-[11px] text-dim"
          >
            {fence.join("\n")}
          </pre>,
        );
        fence = null;
      } else {
        flushAll();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(raw);
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1]!.length;
      blocks.push(
        <h3
          key={`h${key++}`}
          className={cn(
            "font-semibold tracking-tight text-fg",
            level <= 2 ? "text-[14px]" : "text-[12px] uppercase tracking-wider text-faint",
          )}
        >
          {inline(heading[2] ?? "", `h${key}`)}
        </h3>,
      );
      continue;
    }

    if (/^\|(.+)\|$/.test(line.trim())) {
      const cells = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      flushParagraph();
      flushList();
      table = [...(table ?? []), cells];
      continue;
    }
    flushTable();

    const ordered = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (ordered || bullet) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const text = (ordered?.[1] ?? bullet?.[1] ?? "").trim();
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(text);
      continue;
    }
    flushList();

    paragraph.push(line.trim());
  }
  flushAll();

  return <div className={cn("space-y-3", className)}>{blocks}</div>;
}
