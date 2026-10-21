export function projectionsPath() {
  return '/';
}

export function changeSetsPath(name: string, version: number) {
  return `/projections/${encodeURIComponent(name)}/v${version}`;
}

export function documentsPath(name: string, version: number, changeSetId: number, query?: URLSearchParams) {
  const search = query?.size ? `?${query}` : '';
  return `${changeSetsPath(name, version)}/change-sets/${changeSetId}${search}`;
}

export function parseVersion(segment: string) {
  const match = segment.match(/^v(\d+)$/);
  return match ? Number(match[1]) : undefined;
}
