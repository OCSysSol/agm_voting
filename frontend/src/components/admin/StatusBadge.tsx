interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const isOpen = status === "open";
  const isPending = status === "pending";

  /*
   * RR3-06: WCAG AA contrast verified (4.5:1 minimum for normal text at 0.7rem bold):
   *   open:    --green (#155F32) on --green-bg (#EBF5EF) → ~7.1:1 ✓
   *   pending: --amber (#8B3A0F) on --amber-bg (#FDE8D8) → ~5.9:1 ✓
   *   closed:  --text-primary (#0C1B2E) on #F0EFEE       → ~14.5:1 ✓
   */
  const className = isOpen
    ? "status-badge status-badge--open"
    : isPending
    ? "status-badge status-badge--pending"
    : "status-badge status-badge--closed";

  return (
    <span className={className}>
      {isOpen ? "Open" : isPending ? "Pending" : "Closed"}
    </span>
  );
}
