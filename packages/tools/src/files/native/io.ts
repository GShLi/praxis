import { assert } from '@praxis/contracts';
import path from 'node:path';
import type { Loaded } from '../types.ts';
import {
  decodeResponse,
  encodeRequest,
  listResponse,
  readResponse,
  writeResponse,
} from './protocol.ts';
import { nativeRequest } from './request.ts';

export class NativeWorkspaceIo {
  constructor(
    private root: string,
    private rootIdentity: string,
  ) {}
  private payload(
    operation: number,
    target: string,
    content = '',
    before?: Loaded,
    createParents = false,
  ) {
    const relative = path.relative(this.root, target).split(path.sep).join('/');
    assert(
      !relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative),
      'ACCESS_DENIED',
      '目标不在工作区内。',
    );
    return encodeRequest(
      operation,
      [
        this.root,
        relative,
        this.rootIdentity,
        before?.identity ?? '',
        before?.text ?? '',
        content,
      ].map((value) => Buffer.from(value)),
      createParents,
      before?.mode ?? 0o644,
    );
  }
  async read(target: string, signal = AbortSignal.timeout(15000)) {
    const response = decodeResponse(await nativeRequest(this.payload(1, target), signal));
    const metadata = readResponse.parse(response.metadata);
    assert(
      response.body.length === metadata.bytes,
      'FILE_NATIVE_PROTOCOL',
      '原生读取字节数不匹配。',
    );
    return { ...metadata, buffer: response.body };
  }
  async list(target: string, signal = AbortSignal.timeout(15000)) {
    const response = decodeResponse(await nativeRequest(this.payload(2, target), signal));
    assert(!response.body.length, 'FILE_NATIVE_PROTOCOL', '目录响应包含多余字节。');
    return listResponse.parse(response.metadata);
  }
  async write(
    target: string,
    content: string,
    before: Loaded | undefined,
    createParents: boolean,
    beforeCommit: () => void,
    signal: AbortSignal,
  ) {
    const response = decodeResponse(
      await nativeRequest(
        this.payload(before ? 4 : 3, target, content, before, createParents),
        signal,
        beforeCommit,
      ),
    );
    assert(!response.body.length, 'FILE_NATIVE_PROTOCOL', '写入响应包含多余字节。');
    return writeResponse
      .parse(response.metadata)
      .createdDirectories.map((directory) => path.join(this.root, directory));
  }
}
