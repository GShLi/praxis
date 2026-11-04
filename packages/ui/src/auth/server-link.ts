/** A navigable Praxis origin, matching the auth client's accepted server addresses. */
export function serverLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return url.origin;
  } catch {
    // An incomplete address is normal while editing; never create a link from it.
    return null;
  }
}
