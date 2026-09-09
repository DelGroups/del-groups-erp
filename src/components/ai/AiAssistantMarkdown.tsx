"use client";

import React from "react";
import Link from "next/link";
import { isSafeInternalHref } from "@/lib/ai/links";

export { isSafeInternalHref };

const TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TOKEN_RE.source, "g");

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const nodeKey = `${keyPrefix}-${match.index}`;
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={nodeKey} className="font-semibold text-app">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={nodeKey} className="rounded bg-app-card-hover px-1 py-0.5 font-mono text-[11px]">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch?.[2] || "";
      const label = linkMatch?.[1] || href;
      if (isSafeInternalHref(href)) {
        nodes.push(
          <Link
            key={nodeKey}
            href={href}
            className="font-semibold text-sky-500 underline-offset-2 hover:underline"
          >
            {label}
          </Link>
        );
      } else {
        nodes.push(label);
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function parseMarkdownTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
  const rows = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  if (rows.length < 2) return null;
  const headers = rows[0];
  const body = rows.slice(1).filter((row) => !isSeparatorRow(row));
  if (!headers.length) return null;
  return { headers, rows: body };
}

export function AiAssistantTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-app">
      <table className="min-w-full text-left text-[12px]">
        <thead className="bg-app-card-hover text-app-muted">
          <tr>
            {headers.map((header, index) => (
              <th key={`${header}-${index}`} className="px-2 py-1.5 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-app">
              {headers.map((_, cellIndex) => (
                <td key={cellIndex} className="px-2 py-1.5 text-app">
                  {renderInline(row[cellIndex] || "", `t-${rowIndex}-${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AiAssistantMarkdown({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/);

  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-app">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim().length > 0);
        const table = parseMarkdownTable(lines);
        if (table) {
          return <AiAssistantTable key={blockIndex} headers={table.headers} rows={table.rows} />;
        }
        const isList = lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line.trim()));
        if (isList) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-4">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.trim().replace(/^[-*]\s+/, ""), `${blockIndex}-${lineIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={blockIndex} className="whitespace-pre-wrap">
            {lines.map((line, lineIndex) => (
              <React.Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, `${blockIndex}-${lineIndex}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
