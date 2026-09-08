"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  groupExpenseCategoriesForSelect,
  type ExpenseCategoryOption,
} from "@/lib/finance/financialCategories";

interface Props {
  categories: ExpenseCategoryOption[];
  value: string;
  onChange: (categoryId: string) => void;
  className?: string;
  required?: boolean;
  placeholder?: string;
}

export default function ExpenseCategorySelect({
  categories,
  value,
  onChange,
  className = "app-input text-sm",
  required,
  placeholder,
}: Props) {
  const { t } = useI18n();
  const groups = groupExpenseCategoriesForSelect(categories);

  if (categories.length === 0) {
    return (
      <select className={className} value="" disabled>
        <option value="">{placeholder || t("common.noData")}</option>
      </select>
    );
  }

  return (
    <select
      className={className}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder || t("expenses.selectCategory")}</option>
      {groups.map((group) =>
        group.parentId ? (
          <optgroup key={group.parentId} label={group.parentName}>
            {group.items.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </optgroup>
        ) : (
          group.items.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))
        )
      )}
    </select>
  );
}
