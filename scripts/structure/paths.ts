/** Stable checker keys across hosts; Node's Windows filesystem APIs also accept '/'. */
export function structurePath(file: string): string {
  return file.replaceAll('\\', '/');
}
