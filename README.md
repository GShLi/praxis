# 知行 Praxis

使用 TypeScript 开发的 ChatBot 与本地 Agent 应用。

- Web：纯对话 ChatBot。
- 桌面端：ChatBot 与本地 Agent。
- CLI：本地 Agent。
- 模型配置统一管理，桌面端和 CLI 直连模型厂商。
- 本地任务随应用退出停止，Session 保留历史，用户显式继续。
- Agent 工具采用真实操作系统沙箱，预期覆盖 macOS、Windows、Linux。

## 当前状态

已实现多轮 Agent、版本化文件工具、上下文压缩、服务端身份/模型配置与 Web/桌面界面。真实命令沙箱、MCP 和插件仍在开发，第一版尚未完成全部验收。阶段进度和验证限制见[实现记录](docs/implementation.md)。

设计入口：[文档索引](docs/README.md)。[UI 基线](docs/superpowers/specs/2026-11-03-praxis-ui-design.md)参考 ChatGPT、Codex，保留 Praxis 的产品名称和模式边界；[开发计划](docs/superpowers/plans/2026-11-03-praxis-development-plan.md)规定工程基座、核心闭环、三端交付及平台验证的顺序。

## 开发与提交

使用 Node 22.15+（22 系列）或 Node 24+、pnpm 11.9.0：

```sh
pnpm install --frozen-lockfile
pnpm native:build
pnpm check
pnpm cli doctor
```

`doctor` 启动独立 Host，检查协议和环境后关闭 Host。`pnpm host` 是内部 JSON 行协议入口，不是交互聊天命令。当前只验证了本机 macOS ARM64；CI 已配置三平台检查，但尚未运行远端 CI。

服务端使用 PostgreSQL，先复制 `.env.example` 为私有 `.env`，设置数据库连接和独立主密钥（可用 `pnpm server:keygen` 在自己的终端生成），再运行：

```sh
pnpm db:migrate
pnpm server:create-user
pnpm build
pnpm server
```

服务启动后在 `http://127.0.0.1:4310` 打开 Web ChatBot。桌面端运行 `pnpm desktop`（须先构建，Electron 二进制由依赖安装阶段下载）。开发 Web 可运行 `pnpm web`，此时将服务端 `PRAXIS_PUBLIC_ORIGIN` 设为 `http://127.0.0.1:4311`，使代理后的浏览器来源与 CSRF 检查一致。

`pnpm ui:preview` 生成 `.cache/ui-preview/index.html`，可以直接打开检查界面。该入口只有明确标注的测试数据，没有模型调用或文件执行能力，也不属于生产构建。

CLI 使用平台签发的 Praxis API Key；厂商 Key 在统一 Provider 设置中保存。配置 `PRAXIS_SERVER_URL` 和 `PRAXIS_API_KEY` 后运行 `pnpm cli run --workspace /path/to/project`，或追加 `--prompt "创建 HelloWorld 页面"` 执行单次任务。`--resume SESSION_ID` 继续历史会话；`pnpm cli sessions` 查看 ID。退出会停止本客户端任务。当前命令沙箱尚不可用，Agent 只能使用已实现的文件和会话工具。

在本目录维护独立 Git 仓库。使用开发者本机已有 Git 身份，不在项目配置中覆写作者或提交者。完成一个可验证的功能、修复或文档阶段后及时提交；提交说明包含具体变更及必要验证，未完成的能力保持明确状态。

不要提交密钥、真实用户会话、数据库、日志、生成产物或本机配置。示例只保存无秘密的配置模板。跨平台沙箱和进程清理必须逐平台验证。
