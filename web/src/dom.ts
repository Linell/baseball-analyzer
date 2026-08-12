// Element construction for a framework-free app: el('div', { className: 'x' },
// child, 'text') in place of the createElement / assign / appendChild
// boilerplate. Views rebuild their whole subtree on every state change, so
// construction is where readability is won or lost.

/**
 * Build an element from writable properties (className, title, onclick, …) and
 * children. `false`/`null` children are dropped, so callers can write
 * `condition && child` inline.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Array<Node | string | false | null>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    if (child !== false && child !== null) node.append(child);
  }
  return node;
}
