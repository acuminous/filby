export type Projection = { name: string; version: number; description: string | null };

export type ChangeSet = { id: number; effective: string; description: string; lastModified: string; entityTag: string; reissuedFrom?: number };

export type Schema = {
  type?: string | string[];
  format?: string;
  enum?: string[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  anyOf?: Schema[];
  minimum?: number;
  maximum?: number;
  default?: number;
  'x-filby-on'?: Record<string, string>;
};

export type Parameter = { name: string; in: string; schema: Schema; required?: boolean; style?: string; explode?: boolean };

export type Operation = {
  operationId: string;
  summary: string;
  description?: string;
  parameters?: Parameter[];
  responses: Record<string, { description: string; content?: Record<string, { schema: Schema }> }>;
};

export type OpenApi = { openapi: string; paths: Record<string, { get: Operation }> };

export type Document = Record<string, unknown>;

export type Page = { documents: Document[]; total: number; next?: string; prev?: string };
