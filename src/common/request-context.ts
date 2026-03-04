import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContextStore = {
  userId?: string;
  userRole?: string;
};

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getRequestActor() {
  return requestContext.getStore()?.userId ?? 'system';
}

