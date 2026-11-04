# 山岚工作室 · Praxis 展示数据

用于高清作品集截图的**虚构演示**。通过真实 `@praxis/ui` 的 `App` 和类型化
`PraxisClient` 渲染现有功能，不包含替代 UI、真实客户、账号、凭据或文件操作。
人物林知遥、山岚工作室、三个案例、模型供应商、容量数字和 MCP 状态均为编写的样例。
历史任务中的工具结果和完成状态也只是静态数据，不是实际执行或测试的证据。

## 入口与所有权

- 浏览器入口：`tests/fixtures/showcase/entry.tsx`，HTML 需有 `<div id="root"></div>`。
- `createShowcaseClient({ desktop: true })` 从 `client.ts` 导出；不访问 Host 或网络。
- `mountShowcase(root, query)` 从 `entry.tsx` 导出，返回卸载函数；该文件同时自动挂载
  `#root`，正常浏览器入口不需要再调用一次。纯数据消费者只导入 `client.ts`。
- `showcaseScenes` 从 `scenes.ts` 导出，包含场景 ID、会话 ID、按钮文字或设置 hash。
- 截图脚本、HTML 包装与图片资产由主代理管理，不属于本目录。

参数 `?client=desktop&theme=light` / `?client=web&theme=dark`；默认桌面、浅色。
主题只设置当前文档，入口不会覆写浏览器保存的偏好。实际 App 的常规交互可能保存
浏览器外观偏好或草稿，因此截图应使用隔离的临时浏览器 profile。
构建时同时加载 esbuild 生成的 CSS。建议 CSS 视口 **1440 × 960**，像素密度 **2**。

## 场景与真实导航

入口不伪造会话路由，不自动选中会话。等待 `.product-shell` 出现后，按下表点击。
会话按钮是 `.history-session[title="完整标题"]`，选中后等待 `.message`。
桌面 Agent 场景先点击 `.mode-switch button` 中文字为 `Agent` 的按钮；聊天场景点击
`聊天`。Web 客户端仅提供六个 Chat 会话，隐藏 Agent 数据。

| 场景 ID           | 会话 ID / 路由             | 完整按钮文字            |
| ----------------- | -------------------------- | ----------------------- |
| `chat`            | `showcase-chat`            | 山岚工作室 · 官网策划   |
| `code`            | `showcase-code`            | 山岚工作室 · 响应式首页 |
| `agent-completed` | `showcase-agent-completed` | 山岚官网 · 实现与验收   |
| `approval`        | `showcase-approval`        | 山岚官网 · 发布前检查   |
| `models`          | `#settings/models`         | 模型供应商              |
| `mcp`             | `#settings/mcp`（桌面）    | MCP 连接                |
| `account`         | `#settings/account`        | 账户与安全              |

其余聊天：`showcase-copy`（品牌文案）、`showcase-accessibility`（无障碍清单）、
`showcase-content`（内容模型）、`showcase-handoff`（设计交接）。每个都有多轮内容。
主要聊天最新回复保持短表格或代码，较早消息提供背景、推导和完整示例。

完成任务的计划使用现有 Markdown 与 `task.update_plan` 工具结果展示。
打开 `.task-result-details` 的 summary，再点击 `src/styles/projects.css` 可显示真实
变更面板；另一个文件是 `src/content/projects.ts`。也可从工具卡点击「查看文件变更」。
审批场景可点击「前往处理」定位审批卡，展开「查看本次操作的完整参数」。

## 无外部效果

三个供应商包含八个模型；`keyConfigured: true` **仅模拟已配置状态**，没有 Key 字符串、
系统凭据存储或认证请求。模型发现只返回本地静态列表。两个 MCP 配置分别模拟已启用和
未启用状态；启用标识不是连接测试结果，所有端点都使用保留的 `.invalid` 域名。

发送、创建、取消、审批、配置保存、删除、权限更改和 MCP 检查均明确拒绝，显示
「只读演示」提示；不把失败伪装成成功，不改变快照。订阅不发送事件、不启动计时器。
读取返回独立克隆，文件差异严格限定在完成任务所属会话。不会启动模型、进程或工具。

审批有效期固定为 2099 年，仅为静态展示；不是可提交到真实 Host 的授权。
所有历史日期固定在 2026-11-02 至 2026-11-04；侧栏日期分组随截图时钟变化。
审批场景没有伪造已完成耗时；UI 显示「暂无时间记录」。

## 验证

```sh
node --import tsx --test tests/portfolio-showcase.test.ts
pnpm typecheck
pnpm structure
```

测试位于根 `tests/portfolio-showcase.test.ts`，已纳入 `pnpm test`。测试覆盖场景关联、读取隔离、
文件差异归属、操作拒绝和真实 App 的浏览器打包；实际截图由独立 capture runner 验证。
