import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/desk/markdown";
import { useDesk, type KbArticle } from "@/lib/desk-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/kb")({
  validateSearch: (search: Record<string, unknown>): { a?: string } =>
    typeof search["a"] === "string" ? { a: search["a"] } : {},
  head: () => ({
    meta: [
      { title: "Knowledge Base — VANTA Desk" },
      {
        name: "description",
        content:
          "Searchable support knowledge base with category rails, helpfulness voting, draft workflow and a gap radar that shows which ticket topics have no article yet.",
      },
      { property: "og:title", content: "Knowledge Base — VANTA Desk" },
      {
        property: "og:description",
        content: "Self-service articles, deflection stats and a coverage gap radar for support teams.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KnowledgeBase,
});

const inputCls =
  "h-8 w-full rounded-md border border-line bg-raise px-2.5 text-[12px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none";

function KnowledgeBase() {
  const { a: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: "/kb" });
  const { state, isAgent, saveArticle, deleteArticle, voteArticle, registerArticleView } = useDesk();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [editing, setEditing] = useState<KbArticle | "new" | null>(null);

  const articles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.articles.filter((a) => {
      if (category === "drafts") return a.status === "draft";
      if (category !== "all" && a.categoryId !== category) return false;
      if (category !== "drafts" && !isAgent && a.status !== "published") return false;
      if (!q) return true;
      return `${a.title} ${a.summary} ${a.body} ${a.tags.join(" ")}`.toLowerCase().includes(q);
    });
  }, [state.articles, query, category, isAgent]);

  const active = state.articles.find((a) => a.id === selectedId) ?? articles[0] ?? null;
  const select = (id: string) => navigate({ search: { a: id } });

  useEffect(() => {
    if (active) void registerArticleView(active.id);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gap radar: ticket tags that no published article covers yet.
  const gaps = useMemo(() => {
    const covered = new Set(
      state.articles
        .filter((a) => a.status === "published")
        .flatMap((a) => [...a.tags, ...a.title.toLowerCase().split(/\s+/)])
        .map((t) => t.toLowerCase()),
    );
    const counts = new Map<string, number>();
    for (const t of state.tickets)
      for (const tag of t.tags) {
        const key = tag.toLowerCase();
        if (covered.has(key)) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [state.articles, state.tickets]);

  const totalViews = state.articles.reduce((a, x) => a + x.views, 0);
  const published = state.articles.filter((a) => a.status === "published").length;

  return (
    <>
      <section className="flex min-h-0 w-[330px] shrink-0 flex-col border-r border-line bg-ink">
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold tracking-tight">Knowledge Base</h2>
            {isAgent && (
              <button
                onClick={() => setEditing("new")}
                className="h-6 rounded-md bg-accent px-2 text-[10px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
              >
                + Article
              </button>
            )}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles…"
            className="mt-2.5 h-7 w-full rounded-md border border-line bg-raise px-2.5 font-mono text-[11px] text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <CategoryPill label="All" active={category === "all"} onClick={() => setCategory("all")} />
            {state.kbCategories.map((c) => (
              <CategoryPill
                key={c.id}
                label={c.name}
                active={category === c.id}
                onClick={() => setCategory(c.id)}
              />
            ))}
            {isAgent && (
              <CategoryPill
                label="Drafts"
                active={category === "drafts"}
                onClick={() => setCategory("drafts")}
              />
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line/60">
          {articles.map((a) => (
            <button
              key={a.id}
              onClick={() => select(a.id)}
              className={cn(
                "block w-full border-b border-line/60 px-3 py-2.5 text-left transition-colors",
                a.id === active?.id ? "border-l-2 border-l-accent bg-accent/[0.06]" : "hover:bg-raise",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-wider text-faint">
                  {state.kbCategories.find((c) => c.id === a.categoryId)?.name ?? "Uncategorised"}
                </span>
                {a.status === "draft" && (
                  <span className="rounded border border-amber/30 px-1 font-mono text-[9px] uppercase text-amber">
                    draft
                  </span>
                )}
                <span className="ml-auto font-mono text-[9px] text-faint">{a.views} views</span>
              </div>
              <div className="mt-1 text-[13px] font-medium leading-snug text-fg">{a.title}</div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-faint">{a.summary}</p>
            </button>
          ))}
          {articles.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-faint">No articles match.</p>
          )}
        </div>
      </section>

      <main className="flex min-h-0 min-w-0 flex-1 bg-ink">
        {editing ? (
          <ArticleEditor
            article={editing === "new" ? null : editing}
            categories={state.kbCategories}
            onClose={() => setEditing(null)}
            onSave={async (draft) => {
              const id = await saveArticle(draft);
              setEditing(null);
              if (id) select(id);
              toast.success(draft.status === "published" ? "Article published" : "Draft saved");
            }}
          />
        ) : active ? (
          <div className="flex min-h-0 min-w-0 flex-1">
            <article className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                <span>{state.kbCategories.find((c) => c.id === active.categoryId)?.name ?? "Uncategorised"}</span>
                <span>·</span>
                <span>{new Date(active.updatedAt).toLocaleDateString()}</span>
                <span>·</span>
                <span>{active.authorName || "Desk team"}</span>
              </div>
              <h1 className="mt-2 max-w-[70ch] text-[22px] font-semibold leading-tight tracking-tight text-fg">
                {active.title}
              </h1>
              <p className="mt-2 max-w-[70ch] text-[13px] text-dim">{active.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {active.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-6 max-w-[76ch] border-t border-line pt-5">
                <Markdown source={active.body} />
              </div>

              <div className="mt-8 flex max-w-[76ch] items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
                <span className="text-[12px] text-dim">Was this article helpful?</span>
                <button
                  onClick={() => {
                    void voteArticle(active.id, true);
                    toast.success("Thanks — logged as helpful");
                  }}
                  className="h-7 rounded-md border border-accent/40 bg-accent/10 px-3 text-[11px] text-accent transition-colors hover:bg-accent/20"
                >
                  Yes · {active.helpful}
                </button>
                <button
                  onClick={() => {
                    void voteArticle(active.id, false);
                    toast("Noted — we will improve this article");
                  }}
                  className="h-7 rounded-md border border-line px-3 text-[11px] text-dim transition-colors hover:border-red/40 hover:text-red"
                >
                  No · {active.notHelpful}
                </button>
                {isAgent && (
                  <div className="ml-auto flex gap-1.5">
                    <button
                      onClick={() => setEditing(active)}
                      className="h-7 rounded-md border border-line px-3 text-[11px] text-dim transition-colors hover:text-fg"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        void deleteArticle(active.id);
                        toast.success("Article deleted");
                      }}
                      className="h-7 rounded-md border border-line px-3 text-[11px] text-faint transition-colors hover:border-red/40 hover:text-red"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </article>

            <aside className="w-[264px] shrink-0 overflow-y-auto border-l border-line bg-panel px-4 py-4">
              <div className="text-[9px] uppercase tracking-[0.2em] text-faint">Deflection</div>
              <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
                <Stat label="Articles" value={String(published)} />
                <Stat label="Views" value={String(totalViews)} tone="accent" />
              </div>

              <div className="mt-5 text-[9px] uppercase tracking-[0.2em] text-faint">Article health</div>
              <div className="mt-2 space-y-2 rounded-md border border-line bg-raise p-3">
                <Row label="Helpful" value={`${active.helpful}`} />
                <Row label="Not helpful" value={`${active.notHelpful}`} />
                <Row
                  label="Score"
                  value={
                    active.helpful + active.notHelpful === 0
                      ? "—"
                      : `${Math.round((active.helpful / (active.helpful + active.notHelpful)) * 100)}%`
                  }
                />
                <Row label="Views" value={`${active.views}`} />
              </div>

              {isAgent && (
                <>
                  <div className="mt-5 text-[9px] uppercase tracking-[0.2em] text-faint">Gap radar</div>
                  <p className="mt-1.5 text-[11px] leading-snug text-faint">
                    Ticket topics with no published article yet.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {gaps.map(([tag, count]) => (
                      <button
                        key={tag}
                        onClick={() => setEditing("new")}
                        className="flex w-full items-center gap-2 rounded-md border border-line bg-raise px-2.5 py-1.5 text-left transition-colors hover:border-accent/40"
                      >
                        <span className="font-mono text-[11px] text-dim">{tag}</span>
                        <span className="ml-auto font-mono text-[10px] text-amber">{count} tickets</span>
                      </button>
                    ))}
                    {gaps.length === 0 && (
                      <p className="text-[11px] text-faint">Every ticket topic is covered.</p>
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-[12px] text-faint">
            No article selected.
          </div>
        )}
      </main>
    </>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-[11px] transition-colors",
        active
          ? "border-accent/30 bg-accent/10 font-medium text-accent"
          : "border-line text-dim hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <div className="bg-panel p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-faint">{label}</div>
      <div className={cn("mt-1 font-mono text-[14px]", tone === "accent" ? "text-accent" : "text-fg")}>
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="font-mono text-[11px] text-dim">{value}</span>
    </div>
  );
}

function ArticleEditor({
  article,
  categories,
  onClose,
  onSave,
}: {
  article: KbArticle | null;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSave: (draft: Partial<KbArticle> & { title: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: article?.title ?? "",
    summary: article?.summary ?? "",
    categoryId: article?.categoryId ?? categories[0]?.id ?? "",
    tags: (article?.tags ?? []).join(", "),
    body: article?.body ?? "## Cause\n\n## Resolution\n1. \n\n## Prevention\n",
    status: article?.status ?? ("draft" as KbArticle["status"]),
  });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const submit = async (status: KbArticle["status"]) => {
    if (!form.title.trim()) {
      toast.error("Give the article a title");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        ...(article?.id ? { id: article.id, slug: article.slug } : {}),
        title: form.title.trim(),
        summary: form.summary.trim(),
        categoryId: form.categoryId || null,
        tags: form.tags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
        body: form.body,
        status,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-4">
        <span className="text-[13px] font-medium text-fg">
          {article ? "Edit article" : "New article"}
        </span>
        <button
          onClick={() => setPreview((p) => !p)}
          className="ml-auto h-7 rounded-md border border-line px-3 text-[11px] text-dim transition-colors hover:text-fg"
        >
          {preview ? "Write" : "Preview"}
        </button>
        <button
          onClick={onClose}
          className="h-7 rounded-md border border-line px-3 text-[11px] text-faint transition-colors hover:text-fg"
        >
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={() => void submit("draft")}
          className="h-7 rounded-md border border-line px-3 text-[11px] text-dim transition-colors hover:text-fg disabled:opacity-50"
        >
          Save draft
        </button>
        <button
          disabled={busy}
          onClick={() => void submit("published")}
          className="h-7 rounded-md bg-accent px-3 text-[11px] font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          Publish
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-[76ch] space-y-3">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Article title"
            className="h-10 w-full rounded-md border border-line bg-raise px-3 text-[16px] font-semibold text-fg placeholder:text-faint focus:border-accent/40 focus:outline-none"
          />
          <input
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="One-line summary shown in search results"
            className={inputCls}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="h-8 w-full rounded-md border border-line bg-raise px-2 text-[12px] text-fg focus:border-accent/40 focus:outline-none"
            >
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="tags, comma, separated"
              className={inputCls}
            />
          </div>

          {preview ? (
            <div className="rounded-md border border-line bg-panel p-4">
              <Markdown source={form.body} />
            </div>
          ) : (
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="min-h-[420px] w-full resize-none rounded-md border border-line bg-raise px-3 py-2.5 font-mono text-[12px] leading-relaxed text-fg focus:border-accent/40 focus:outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
}
