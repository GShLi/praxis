import { lookup } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export type Address = { address: string; family: number };
export interface HttpDependencies {
  resolve(hostname: string): Promise<Address[]>;
  request(
    url: URL,
    options: RequestOptions,
    response: (value: IncomingMessage) => void,
  ): ClientRequest;
}
export const defaults: HttpDependencies = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: (url, options, response) =>
    (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, response),
};
/** The lookup may not support cancellation; late DNS results must never open a socket. */
export async function resolveWithin(
  resolve: Promise<Address[]>,
  signal: AbortSignal,
  cancelled: () => Error,
) {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      resolve,
      new Promise<never>((_, reject) => {
        abort = () => reject(cancelled());
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
