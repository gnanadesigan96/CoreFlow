import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Ticket as TicketIcon,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { deskMetrics, isOpenStatus, useDesk } from "@/lib/desk-store";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { initialsOf } from "@/lib/desk-data";
import { useTheme } from "@/lib/theme";

import { cn } from "@/lib/utils";

type NavItem = { label: string; to: "/" | "/kb" | "/dashboard" | "/contacts" | "/settings"; icon: LucideIcon };

const AGENT_NAV: NavItem[] = [
  { label: "Tickets", to: "/", icon: TicketIcon },
  { label: "Knowledge Base", to: "/kb", icon: BookOpen },
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Contacts", to: "/contacts", icon: Users },
  { label: "Settings", to: "/settings", icon: SettingsIcon },
];

const GUEST_NAV: NavItem[] = [
  { label: "My tickets", to: "/", icon: TicketIcon },
  { label: "Knowledge Base", to: "/kb", icon: BookOpen },
];

function Metric({ value, label, tone }: { value: string; label: string; tone?: "red" | "accent" }) {
  return (
    <div className="flex items-baseline gap-2 px-4">
      <span
        className={cn(
          "font-mono text-[18px] leading-none",
          tone === "red" && "text-red",
          tone === "accent" && "text-accent",
          !tone && "text-fg",
        )}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
    </div>
  );
}

export function DeskShell({ children }: { children: ReactNode }) {
  const { state, me, isAgent, now } = useDesk();
  const { theme, toggleTheme } = useTheme();

  const NAV = isAgent ? AGENT_NAV : GUEST_NAV;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const metrics = deskMetrics(state.tickets, now);
  const openCount = state.tickets.filter((t) => isOpenStatus(t.status)).length;
  const expanded = pinned;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-ink text-fg">
      {/* Zoho-style module rail: icon strip that expands on hover, pinnable */}
      <nav
        className={cn(
          "relative z-30 flex shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-200 ease-out",
          pinned ? "w-[212px]" : "w-[56px]",
        )}
      >
        <div className="relative flex h-12 items-center gap-2 border-b border-line px-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-accent/30 bg-accent/10 font-mono text-[11px] font-semibold text-accent">
            V
          </span>
          <span
            className={cn(
              "flex min-w-0 flex-col leading-none transition-opacity duration-150",
              expanded ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <span className="text-[12px] font-semibold tracking-tight text-fg">VANTA</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">desk</span>
          </span>
        </div>

        <div className="relative flex flex-1 flex-col gap-1 py-2">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group relative mx-2 flex h-9 items-center gap-3 rounded-md px-2 transition-colors",
                  active ? "bg-accent/10 text-accent" : "text-dim hover:bg-raise hover:text-fg",
                )}
              >
                {active && (
                  <span className="absolute -left-2 top-1.5 h-6 w-[2px] rounded-full bg-accent shadow-[0_0_10px] shadow-accent/60" />
                )}
                <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
                {expanded && (
                  <span className={cn("min-w-0 flex-1 truncate text-[13px]", active && "font-medium")}>
                    {item.label}
                  </span>
                )}
                {!expanded && (
                  <span className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 z-50 -translate-y-1/2 translate-x-[-6px] whitespace-nowrap rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12px] text-fg opacity-0 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
                    {item.label}
                    {item.to === "/" && openCount > 0 && (
                      <span className="ml-2 rounded bg-raise px-1.5 font-mono text-[10px] text-faint">{openCount}</span>
                    )}
                  </span>
                )}
                {item.to === "/" && openCount > 0 && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 font-mono text-[10px] transition-opacity duration-150",
                      active ? "bg-accent/20 text-accent" : "bg-raise text-faint",
                      expanded ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {openCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="relative border-t border-line px-2 py-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-raise font-mono text-[9px] text-dim"
            >
              {initialsOf(me.name || me.email)}
            </span>
            <div
              className={cn(
                "min-w-0 flex-1 transition-opacity duration-150",
                expanded ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <div className="truncate text-[11px] text-fg">{me.name || me.email}</div>
              <div className="truncate font-mono text-[9px] uppercase tracking-wider text-faint">
                {me.role}
              </div>
            </div>
            <button
              onClick={() => void signOut()}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:text-red",
                expanded ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <LogOut className="size-[15px]" strokeWidth={1.75} />
            </button>
          </div>
          <button
            onClick={() => setPinned((p) => !p)}
            className="mt-1 flex h-8 w-full items-center gap-3 rounded-md px-2 text-faint transition-colors hover:bg-raise hover:text-fg"
          >
            {pinned ? (
              <ChevronsLeft className="size-[18px] shrink-0" strokeWidth={1.75} />
            ) : (
              <ChevronsRight className="size-[18px] shrink-0" strokeWidth={1.75} />
            )}
            <span
              className={cn(
                "truncate text-[12px] transition-opacity duration-150",
                expanded ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              {pinned ? "Collapse" : "Pin open"}
            </span>
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel/80 px-3 backdrop-blur-sm">
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-faint md:inline">
            {NAV.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))?.label ??
              "Desk"}
          </span>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-7 max-w-md flex-1 items-center gap-2 rounded-md border border-line bg-raise px-2.5 font-mono text-[11px] text-dim transition-colors hover:border-accent/40"
          >
            <span className="text-faint">/</span>
            <span className="text-faint">Search tickets, agents, macros…</span>
            <span className="ml-auto flex gap-1">
              <kbd className="rounded border border-line px-1 py-px text-[9px] text-faint">⌘</kbd>
              <kbd className="rounded border border-line px-1 py-px text-[9px] text-faint">K</kbd>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              className="grid size-7 place-items-center rounded-md border border-line bg-raise text-dim transition-colors hover:border-accent/40 hover:text-accent"
            >
              {theme === "dark" ? (
                <Sun className="size-[14px]" strokeWidth={1.75} />
              ) : (
                <Moon className="size-[14px]" strokeWidth={1.75} />
              )}
            </button>
            <span className="rounded-md border border-line bg-raise px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
              {me.role}
            </span>

            <button
              onClick={() => void signOut()}
              className="h-7 rounded-md border border-line px-2 font-mono text-[10px] text-dim transition-colors hover:border-red/40 hover:text-red"
            >
              Sign out
            </button>
          </div>
        </header>

        {isAgent && (
          <div className="flex h-11 shrink-0 items-center divide-x divide-line border-b border-line bg-ink">
            <Metric value={String(metrics.open)} label="Open" />
            <Metric value={String(metrics.overdue)} label="Overdue" tone="red" />
            <Metric value={`${metrics.avgFirstResponse}m`} label="First resp" />
            <Metric value={`${metrics.csat}%`} label="CSAT" tone="accent" />
            <div className="ml-auto flex items-center gap-1.5 px-4 font-mono text-[10px] text-faint">
              queue depth <span className="text-dim">{metrics.open}</span> · sync{" "}
              <span className="text-accent">now</span>
            </div>
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="max-w-lg overflow-hidden border-line bg-panel p-0">
          <Command className="bg-panel [&_[cmdk-input-wrapper]]:border-line">
            <CommandInput placeholder="Jump to a ticket, page or agent…" className="text-[13px]" />
            <CommandList className="max-h-80">
              <CommandEmpty className="py-6 text-center text-[12px] text-faint">
                No matches.
              </CommandEmpty>
              <CommandGroup heading="Navigate">
                {NAV.map((item) => (
                  <CommandItem
                    key={item.to}
                    value={`go ${item.label}`}
                    onSelect={() => {
                      setPaletteOpen(false);
                      navigate({ to: item.to });
                    }}
                    className="text-[12px]"
                  >
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Tickets">
                {state.tickets.slice(0, 12).map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.code} ${t.subject} ${t.company}`}
                    onSelect={() => {
                      setPaletteOpen(false);
                      navigate({ to: "/", search: { t: t.id } });
                    }}
                    className="gap-2 text-[12px]"
                  >
                    <span className="font-mono text-[10px] text-faint">{t.code}</span>
                    <span className="truncate">{t.subject}</span>
                    <span className="ml-auto font-mono text-[10px] text-faint">{t.company}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}
