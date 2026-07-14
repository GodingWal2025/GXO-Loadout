import type { StagingLaneObject } from './types/ontology';

let _apiBase = '/api';

/** Call once at app startup to set the API base URL for the ontology client */
export function setOntologyApiBase(url: string): void {
  _apiBase = url || '/api';
}

function api(path: string): string {
  return `${_apiBase}${path}`;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(api(path));
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T = void>(actionType: string, params: object): Promise<T> {
  const res = await fetch(api('/ontology/actions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Action ${actionType} failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data as T;
}

export const ontologyClient = {
  getStagingLanes: async (): Promise<StagingLaneObject[]> => {
    const data = await get<{ objects: StagingLaneObject[] }>('/ontology/staging-lanes');
    return data.objects;
  },

  executeAction: async (actionType: string, params: object): Promise<void> => {
    await post(actionType, params);
  },
};
