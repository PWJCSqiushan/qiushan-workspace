"use client";

import {categoryTextColor} from '@/lib/categories';
import type {Category} from '@/lib/categories';

export type {Category};

type CategoryBadgeProps = {
  category?: Category | null;
  className?: string;
};

/**
 * The compact, reusable category surface used by cards and the manager preview.
 * A missing category intentionally renders no node, so unclassified cards keep
 * the existing whitespace and visual hierarchy.
 */
export function CategoryBadge({category, className}: CategoryBadgeProps) {
  if (!category) return null;

  return (
    <span
      className={['category-badge', className || ''].filter(Boolean).join(' ')}
      style={{backgroundColor: category.color, color: categoryTextColor(category.color)}}
      title={category.name + (category.archived ? '（已停用）' : '')}
      aria-label={'分类：' + category.name + (category.archived ? '（已停用）' : '')}
      data-category-id={category.id}
    >
      {category.displayLabel || category.name}
    </span>
  );
}

export function categoryForTask(categories: readonly Category[] | undefined, task: {flow: string; categoryId?: string}) {
  if (!task.categoryId) return undefined;
  const category = categories?.find((candidate) => candidate.id === task.categoryId && candidate.flow === task.flow);
  return category;
}
