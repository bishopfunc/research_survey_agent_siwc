import { useEffect, useState } from 'react';

export type MobileView = 'survey' | 'detail' | 'chat' | 'collections';

/** The keyboard changes the visual viewport on mobile Safari without resizing the layout viewport. */
export function useMobileLayout() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const [view, setView] = useState<MobileView>('survey');
  const [viewport, setViewport] = useState({ height: window.innerHeight, top: 0, keyboard: false });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const visual = window.visualViewport;
    const update = () => {
      setCompact(media.matches);
      const focused = document.activeElement?.matches('input, textarea, [contenteditable="true"]') ?? false;
      const height = visual?.height ?? window.innerHeight;
      const keyboard = focused && (visual?.scale ?? 1) === 1 && window.innerHeight - height > 120;
      setViewport({ height, top: visual?.offsetTop ?? 0, keyboard });
    };
    const changeLayout = () => { setView('survey'); update(); };
    media.addEventListener('change', changeLayout);
    window.addEventListener('resize', update);
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    update();
    return () => {
      media.removeEventListener('change', changeLayout);
      window.removeEventListener('resize', update);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  useEffect(() => {
    if (!compact || view === 'survey') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setView('survey'); };
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); };
  }, [compact, view]);
  return { compact, view, setView, ...viewport };
}
