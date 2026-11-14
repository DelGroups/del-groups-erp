"use client";

import { inlineParts, markdownBlocks } from "@/lib/guard/markdown";

/** A report's Markdown as React elements (headings, lists, paragraphs, bold); never raw HTML. */
export function ReportBody({ body }: { body: string }) {
  const parts = (text: string) => inlineParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>));
  return (
    <div className="flex flex-col gap-2 text-[length:var(--ds-text-sm)]">
      {markdownBlocks(body).map((b, i) => {
        if (b.type === "heading") {
          const Tag = (b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
          return (
            <Tag key={i} className={b.level === 1 ? "mt-1 text-[length:var(--ds-text-lg)] font-semibold" : "mt-2 font-semibold"}>
              {parts(b.text)}
            </Tag>
          );
        }
        if (b.type === "list") {
          const List = b.ordered ? "ol" : "ul";
          return (
            <List key={i} className={`${b.ordered ? "list-decimal" : "list-disc"} ms-5 flex flex-col gap-1`}>
              {b.items.map((item, j) => (
                <li key={j}>{parts(item)}</li>
              ))}
            </List>
          );
        }
        return <p key={i}>{parts(b.text)}</p>;
      })}
    </div>
  );
}
