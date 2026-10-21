import { signal } from '@preact/signals';

import type { ChangeSet, Document, OpenApi, Page, Projection } from './types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const openapi = signal<OpenApi | undefined>(undefined);

export async function getProjections(): Promise<Projection[]> {
  const response = await get('/api/projections');
  return response.json();
}

export async function getOpenApi(): Promise<OpenApi> {
  if (!openapi.value) {
    const response = await get('/api/openapi.json');
    openapi.value = await response.json();
  }
  return openapi.value as OpenApi;
}

export async function getChangeLog(name: string, version: number): Promise<ChangeSet[]> {
  const response = await get(`/api/changelog?${new URLSearchParams({ projection: name, version: String(version) })}`);
  return response.json();
}

export async function getDocuments(name: string, version: number, changeSetId: number, query: URLSearchParams): Promise<Page> {
  const params = new URLSearchParams(query);
  params.set('changeSetId', String(changeSetId));
  const response = await get(`${projectionPath(name, version)}?${params}`);
  const documents: Document[] = await response.json();
  const total = Number(response.headers.get('X-Total-Count') ?? documents.length);
  return { documents, total, ...parseLink(response.headers.get('Link')) };
}

export function projectionPath(name: string, version: number) {
  return `/api/projections/${encodeURIComponent(name)}/v${version}`;
}

export function parseLink(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(',').flatMap((entry) => {
      const match = entry.match(/<([^>]*)>\s*;\s*rel="([^"]*)"/);
      return match ? [[match[2] as string, match[1] as string]] : [];
    }),
  );
}

async function get(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.ok) return response;
  throw new ApiError(response.status, await errorMessage(response));
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') return body.error;
  } catch {}
  return response.statusText || `Request failed with status ${response.status}`;
}
