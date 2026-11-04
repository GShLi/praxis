/** The popover stays in the top layer, including inside a modal dialog. */
export function trackDropdownPosition(trigger: HTMLElement, popup: HTMLElement) {
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
    const topEdge = (viewport?.offsetTop ?? 0) + 8;
    const rightEdge = leftEdge + (viewport?.width ?? innerWidth) - 16;
    const bottomEdge = topEdge + (viewport?.height ?? innerHeight) - 16;
    const compact = popup.dataset.size === 'compact';
    popup.style.minWidth = `${Math.min(rect.width, rightEdge - leftEdge)}px`;
    if (!compact)
      popup.style.width = `${Math.min(Math.max(rect.width, 240), rightEdge - leftEdge)}px`;
    const width = popup.getBoundingClientRect().width;
    const below = bottomEdge - rect.bottom - 8;
    const above = rect.top - topEdge - 8;
    const desired = Math.min(popup.scrollHeight, 360);
    const up = below < desired && above > below;
    popup.style.maxHeight = `${Math.max(0, Math.min(360, up ? above : below))}px`;
    const alignRight =
      popup.dataset.align === 'end' ||
      (popup.dataset.align !== 'start' &&
        (rect.left + width > rightEdge || rect.left > leftEdge + (rightEdge - leftEdge) / 2));
    popup.style.left = `${Math.max(leftEdge, Math.min(alignRight ? rect.right - width : rect.left, rightEdge - width))}px`;
    popup.style.top = `${up ? Math.max(topEdge, rect.top - popup.offsetHeight - 8) : Math.max(topEdge, rect.bottom + 8)}px`;
    popup.dataset.side = up ? 'top' : 'bottom';
  };
  position();
  const observer = new ResizeObserver(position);
  observer.observe(trigger);
  observer.observe(popup);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    window.visualViewport?.removeEventListener('resize', position);
    window.visualViewport?.removeEventListener('scroll', position);
  };
}
