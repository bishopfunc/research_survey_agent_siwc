/** Shared close / cancel mark: two rounded strokes on the same grid as the other icons. */
export function CloseIcon({ size = 16 }: { size?: number }) {
  return <svg className="icon close-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>;
}
