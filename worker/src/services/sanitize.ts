export function sanitizeUsername(name: string | null | undefined): string {
  if (!name) return 'Anónimo';
  return name.replace(/[\r\n\t]/g, ' ').slice(0, 30);
}
