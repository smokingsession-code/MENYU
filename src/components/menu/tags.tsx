import type { ItemTag } from "@/lib/menu/types";
import type { DinerStrings } from "./menu-app";

const STYLE: Record<ItemTag, string> = {
  popular: "bg-accent-soft text-ink",
  spicy: "bg-danger-soft text-danger",
  vegetarian: "bg-brand-soft text-brand-dark",
  new: "bg-[#e8f0fe] text-[#174ea6]",
};

export function TagList({ tags, s }: { tags: ItemTag[]; s: DinerStrings }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag} className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${STYLE[tag] ?? STYLE.new}`}>
          {s.tags[tag] ?? tag}
        </li>
      ))}
    </ul>
  );
}
