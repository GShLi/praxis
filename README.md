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

在“设置 → 模型提供商”填写 Base URL 和 API Key，点击“获取模型列表”，选择模型后保存。当前支持公网 HTTPS 的 OpenAI 兼容 Chat Completions 接口；Base URL 应包含厂商要求的 `/v1` 等前缀，列表通过其下的 `GET /models` 获取。查询不会保存配置；接口不支持或列表为空时，可手动输入模型 ID。上下文窗口和输出上限在“高级设置”中调整。编辑时可复用同一地址已保存的 Key；修改地址须重新填写对应的 Key。Web 由服务端查询，桌面端由本地 Host 直连厂商。

CLI 使用平台签发的 Praxis API Key；厂商 Key 在统一 Provider 设置中保存。配置 `PRAXIS_SERVER_URL` 和 `PRAXIS_API_KEY` 后运行 `pnpm cli run --workspace /path/to/project`，或追加 `--prompt "创建 HelloWorld 页面"` 执行单次任务。`--resume SESSION_ID` 继续历史会话；`pnpm cli sessions` 查看 ID。退出会停止本客户端任务。当前命令沙箱尚不可用，Agent 只能使用已实现的文件和会话工具。

在本目录维护独立 Git 仓库。使用开发者本机已有 Git 身份，不在项目配置中覆写作者或提交者。完成一个可验证的功能、修复或文档阶段后及时提交；提交说明包含具体变更及必要验证，未完成的能力保持明确状态。

不要提交密钥、真实用户会话、数据库、日志、生成产物或本机配置。示例只保存无秘密的配置模板。跨平台沙箱和进程清理必须逐平台验证。

界面开发预览：运行 `pnpm ui:preview` 后打开 `.cache/ui-preview/index.html`，默认展示 Web ChatBot；在地址末尾添加 `?client=desktop` 查看桌面 Agent 样例。预览使用明确标注的测试数据，不连接模型、认证服务或工作区。

## 插件模型适配器

统一模型配置的“高级设置 → 模型适配器”默认是 `openai-compatible`，兼容已有配置。可信插件用 `registerProvider('custom', client)` 注册后，填写 `插件ID/custom`。当前插件接口仅定义生成，不约定模型发现协议，因此插件模型按作者说明手动填写 ID。更改适配器与更改地址一样，需要重新填写 Key；未安装或未启用该适配器时明确失败，不会把凭据交给默认适配器。当前 turn 的生成和压缩固定同一个插件版本。

Web 只使用部署者在服务端安装的纯 Provider 插件。可通过 `PRAXIS_SERVER_PLUGIN_DIRECTORY` 指向已有的 `PluginInstaller` 注册目录（绝对路径，清单须声明 `server` 与 `chat`）；启用记录和包摘要均在启动时校验，启动失败不退回默认适配器。网页用户不能上传或安装服务端插件。桌面/CLI 则使用本地已信任并启用的插件；服务器和客户端必须分别安装需要在其上运行的适配器。

## PostgreSQL 集成测试

`pnpm test:postgres` 使用真实数据库和 HTTP，只调用测试模型，不使用模型厂商 Key。每个用例创建独立的 `praxis_test_<随机 ID>` 数据库并在结束后删除；请使用专用测试实例及具备创建数据库权限的测试账号。

- 本机安装了 PostgreSQL：设置 `PRAXIS_TEST_PG_BIN` 为其 `bin` 目录，脚本创建临时 Unix socket 实例，结束后停止并删除；不注册系统服务。便携构建可另设 `PRAXIS_TEST_PG_SHARE` 指定其共享数据目录。
- 已有独立测试服务或 CI：设置 `PRAXIS_TEST_DATABASE_URL` 后执行，不连接项目 `.env` 中的生产地址。
- CI 的 `postgres` job 已配置 PostgreSQL 18 服务；该配置仍需在远端实际运行。

示例：`PRAXIS_TEST_PG_BIN=/path/to/postgresql/bin pnpm test:postgres`。普通 `pnpm check` 保持无需数据库服务，包含结构检查、类型检查和核心回归。

### MCP 远程工具

桌面端在“设置 → MCP 连接”保存固定端点，先检查连接，再点击“启用 Agent 工具”。当前支持无认证 Streamable HTTP 工具与文本资源；每次业务调用或资源读取展示实际参数与目标地址并等待单次审批。添加时勾选资源能力（或配置 `capabilities.resources: true`）后才开放资源目录与读取。ChatBot 不接入 MCP。停用或编辑会取消活动操作；断流、取消和重启不会自动重放调用。

CLI 与桌面使用独立 profile，可通过以下命令管理 CLI 的服务器：

```sh
pnpm cli mcp import /absolute/path/server.json
pnpm cli mcp test SERVER_ID
pnpm cli mcp enable SERVER_ID
pnpm cli mcp list
pnpm cli mcp disable SERVER_ID
```

`enable` 会先检查该版本，成功才启用；`test` 本身不启用。配置示例（替换 ID、名称与固定 HTTPS 地址）：

```json
{
  "id": "ffdb764e-d237-49dd-914f-fd7dd66c1ced",
  "namespace": "docs",
  "displayName": "文档工具",
  "revision": 1,
  "enabled": false,
  "protocol": "auto",
  "transport": {
    "type": "streamable-http",
    "endpoint": "https://your-server.example/mcp",
    "allowPrivateDestination": false,
    "auth": { "type": "none" }
  },
  "capabilities": { "tools": true, "resources": false, "prompts": false }
}
```

使用 `pnpm cli run --workspace /absolute/path/project` 进入交互模式才能确认 MCP 业务调用；非交互运行在需要审批时返回明确错误。资源 URI 只交给远端 MCP 服务处理，不直接读取 Host 文件或访问任意 URL；文本保存为会话快照，二进制明确标为不支持。stdio、Bearer/OAuth、提示词及 MRTR 表单续交尚未接入。详见 [实现记录](docs/implementation.md)。

## 用户主动执行插件命令

可信插件可以注册 `registerCommand(name, callback, parameters)`；第三个参数为 JSON Schema，省略时只接受空对象。命令仅在用户明确选择时执行，不暴露为模型工具。桌面端输入框旁的“插件命令”可选择命令、查看参数结构并提交；CLI 交互使用 `/commands` 和 `/command 插件ID/命令名 {"参数":"值"}`，非交互使用 `pnpm cli run --workspace /path/to/project --command 插件ID/命令名 --arguments '{"参数":"值"}'`。

命令需要有效 Praxis 身份，不需要模型厂商配置；每次提交使用请求 ID 去重，并保存命令身份、委托工具记录和结果产物。Agent 命令通过 `services.invokeCore` 使用原有权限、预算和审批通道；Chat 命令不能取得 Agent 工具。单次命令限时 120 秒，取消或退出后撤销本次委托能力。插件仍是用户信任的本地代码，不构成隔离边界；服务端 Web 暂不开放用户命令插件安装。
