"use client";

import { useRef } from "react";
import { setLocale } from "@/app/actions/session";

export default function LanguageSelect({
  locale,
  label,
  options,
}: {
  locale: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={setLocale}>
      <label className="cp-field" style={{ marginBottom: 0 }}>
        <span>{label}</span>
        <select
          className="cp-input"
          name="locale"
          defaultValue={locale}
          onChange={() => form.current?.requestSubmit()}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
