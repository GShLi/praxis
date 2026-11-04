import type { PraxisClient, Snapshot } from '@praxis/ui/client';
import { profile, providers, mcpServers } from './catalog.ts';
import { conversations } from './conversations.ts';
import { completed, awaitingApproval, completedId, fileChanges } from './agent.ts';

export const demoRestriction = '只读演示：不调用模型、不连接服务、不保存配置或修改文件。';

async function rejectOperation(): Promise<never> {
  throw new Error(demoRestriction);
}

const blockedOperations = {
  login: rejectOperation,
  logout: rejectOperation,
  create: rejectOperation,
  send: rejectOperation,
  cancel: rejectOperation,
  saveProvider: rejectOperation,
  deleteProvider: rejectOperation,
  respondApproval: rejectOperation,
  setPermissions: rejectOperation,
  saveMcp: rejectOperation,
  deleteMcp: rejectOperation,
  testMcp: rejectOperation,
  enableMcp: rejectOperation,
  disableMcp: rejectOperation,
} satisfies Partial<PraxisClient>;

/** Independent immutable snapshots. No Host, transport, key storage or event producer. */
export function createShowcaseClient(options: { desktop?: boolean } = {}): PraxisClient {
  const desktop = options.desktop ?? true;
  const snapshots: Snapshot[] = desktop
    ? [...conversations, completed, awaitingApproval]
    : conversations;
  const find = (id: string) => {
    const value = snapshots.find((snapshot) => snapshot.session.id === id);
    if (!value) throw new Error(`演示会话不存在：${id}`);
    return value;
  };
  return {
    ...blockedOperations,
    desktop,
    draftNamespace: 'showcase-fictional-only',
    async current() {
      return true;
    },
    async profile() {
      return structuredClone(profile);
    },
    async providers() {
      return structuredClone(providers);
    },
    async list() {
      return structuredClone(snapshots.map((snapshot) => snapshot.session));
    },
    async read(id) {
      return structuredClone(find(id));
    },
    async discoverModels(input) {
      const provider = providers.find((item) => item.baseUrl === input.baseUrl);
      if (!provider) throw new Error(demoRestriction);
      return provider.models?.map((model) => ({ id: model.model })) ?? [];
    },
    async readArtifact(id, artifactId) {
      find(id);
      if (id !== completedId || !Object.hasOwn(fileChanges, artifactId))
        throw new Error('该演示会话没有此文件变更。');
      const change = fileChanges[artifactId as keyof typeof fileChanges];
      return { kind: 'file-change', content: JSON.stringify(change) };
    },
    async mcpServers() {
      return structuredClone(mcpServers);
    },
    async plugins() {
      return { revision: 0, value: [] };
    },
    async diagnostics() {
      return { fixture: true, mode: '静态演示 · 未连接 Host', project: '山岚工作室（虚构）' };
    },
    listen() {
      return () => {};
    },
  };
}
