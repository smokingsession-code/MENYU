/** Lower-case, accent-free text for forgiving search ("café" matches "cafe"). */
export function searchable(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query appears somewhere in the haystack. */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = searchable(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const h = searchable(haystack);
  return words.every((w) => h.includes(w));
}
