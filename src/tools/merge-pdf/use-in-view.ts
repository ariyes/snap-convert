import { useCallback, useEffect, useState } from 'react';

/**
 * True while the element is on screen (or within `rootMargin` of it). Used so long page grids only
 * render the thumbnails people can see. Without IntersectionObserver everything counts as visible.
 */
export function useInView<T extends Element>(
  rootMargin = '200px',
): [ref: (el: T | null) => void, inView: boolean] {
  const [element, setElement] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useCallback((el: T | null) => setElement(el), []);
  const supported = typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    if (!element || !supported) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rootMargin, supported]);

  return [ref, inView || !supported];
}
