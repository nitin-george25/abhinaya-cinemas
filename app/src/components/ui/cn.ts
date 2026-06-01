// Tiny conditional class joiner. Avoids pulling in clsx for ~10 LOC.
export function cn(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}
