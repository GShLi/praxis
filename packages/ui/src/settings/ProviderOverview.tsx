import type { PraxisClient, Provider } from '../client-types.ts';
import type { useProviderCatalog } from './useProviderCatalog.ts';
export function ProviderOverview({
  provider,
  client,
  catalog,
  remove,
}: {
  provider: Provider;
  client: PraxisClient;
  catalog: ReturnType<typeof useProviderCatalog>;
  remove: () => void;
}) {
  return (
    <div role="tabpanel" id="provider-panel-overview" aria-labelledby="provider-tab-overview">
      <h4>连接信息</h4>
      <dl className="provider-facts">
        <div>
          <dt>Base URL</dt>
          <dd>{provider.baseUrl}</dd>
        </div>
        <div>
          <dt>接口适配器</dt>
          <dd>{provider.adapter ?? 'openai-compatible'}</dd>
        </div>
        <div>
          <dt>API Key</dt>
          <dd>{provider.keyConfigured ? '已保存 · 所有模型共享' : '尚未配置'}</dd>
        </div>
        <div>
          <dt>模型目录验证</dt>
          <dd>
            {catalog.state === 'success'
              ? `${catalog.checkedAt} · 获取成功 (${catalog.models.length} 个模型)`
              : catalog.state === 'error'
                ? '最近一次获取失败'
                : catalog.state === 'loading'
                  ? '正在获取…'
                  : '本次打开尚未验证'}
          </dd>
        </div>
      </dl>
      <button
        className="secondary-button"
        disabled={
          !provider.keyConfigured ||
          catalog.state === 'loading' ||
          Boolean(provider.adapter && provider.adapter !== 'openai-compatible')
        }
        onClick={() =>
          void catalog.fetch({
            baseUrl: provider.baseUrl,
            id: provider.id,
            expectedRevision: provider.revision,
          })
        }
      >
        {catalog.state === 'loading' ? '正在获取…' : '验证模型列表访问'}
      </button>
      {catalog.error && (
        <p className="settings-feedback error" role="alert">
          {catalog.error}
        </p>
      )}
      <p className="field-help" role="status">
        目录访问成功仅表示能获取模型列表，尚未验证模型的回答能力。验证状态只保留在本次打开期间。
      </p>
      <div className="provider-detail-note">
        <h4>ChatBot 与 Agent 共用配置</h4>
        <p>
          {client.desktop
            ? '桌面端通过本地 Host 直接连接模型供应商。'
            : 'Web 对话由 Praxis 服务端调用模型。'}{' '}
          桌面端和 CLI 登录后可使用同一份供应商配置。
        </p>
      </div>
      {client.deleteProvider && (
        <div className="provider-danger">
          <div>
            <h4>删除供应商</h4>
            <p>移除连接、Key 和关联模型。已有会话记录保留。</p>
          </div>
          <button className="danger-button" onClick={remove}>
            删除供应商
          </button>
        </div>
      )}
    </div>
  );
}
