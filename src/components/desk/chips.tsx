import type { Priority, Status } from "@/lib/desk-data";
import { cn } from "@/lib/utils";

const PRIORITY_TONE: Record<Priority, string> = {
  P1: "border-red/30 text-red/90",
  P2: "border-amber/30 text-amber/90",
  P3: "border-line text-dim",
  P4: "border-line text-faint",
};

const STATUS_TONE: Record<Status, string> = {
  open: "border-line text-dim",
  pending: "border-accent/30 text-accent/80",
  on_hold: "border-amber/30 text-amber/80",
  resolved: "border-accent/40 text-accent",
  closed: "border-line text-faint",
};

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "rounded border px-1 font-mono text-[9px] uppercase tracking-wider",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: Priority }) {
  return <Chip className={PRIORITY_TONE[priority]}>{priority}</Chip>;
}

export function StatusChip({ status }: { status: Status }) {
  return <Chip className={STATUS_TONE[status]}>{status}</Chip>;
}

export function SlaText({ text, tone }: { text: string; tone: "red" | "amber" | "accent" | "dim" }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px]",
        tone === "red" && "text-red sla-over",
        tone === "amber" && "text-amber",
        tone === "accent" && "text-accent",
        tone === "dim" && "text-faint",
      )}
    >
      {text}
    </span>
  );
}
