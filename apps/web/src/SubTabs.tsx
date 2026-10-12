import React from 'react';

/** The one switch under a view tab: papers, issues and knowledge all use it, never nested. */
export function SubTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="subtabs" role="tablist" aria-label={label}>{options.map(([id, name]) => <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}>{name}</button>)}</div>;
}
