# 知行 Praxis

使用 TypeScript 开发的 ChatBot 与本地 Agent 应用。

- Web：纯对话 ChatBot。
- 桌面端：ChatBot 与本地 Agent。
- CLI：本地 Agent。
- 模型配置统一管理，桌面端和 CLI 直连模型厂商。
- 本地任务随应用退出停止，Session 保留历史，用户显式继续。
- Agent 工具采用真实操作系统沙箱，预期覆盖 macOS、Windows、Linux。

## 当前状态

已实现多轮 Agent、版本化文件工具、上下文压缩、服务端身份/模型配置、Web/桌面界面、HTTP MCP 与可信插件。真实命令沙箱和发行交付仍在开发，第一版尚未完成全部验收。最新进度和验证限制见 [V1 台账](docs/v1-completion.md)。

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

模型适配器的 `ModelRequest.beforeRetry` 是预算边界：首次调用由运行时计费，适配器每次额外发送前必须调用此回调；回调抛错时立即停止。内置适配器已将 HTTP 重试接入任务及摘要预算。可信插件须遵守同一契约；同进程 SDK 无法强制拦截插件自行联网。

Web 只使用部署者在服务端安装的纯 Provider 插件。可通过 `PRAXIS_SERVER_PLUGIN_DIRECTORY` 指向已有的 `PluginInstaller` 注册目录（绝对路径，清单须声明 `server` 与 `chat`）；启用记录和包摘要均在启动时校验，启动失败不退回默认适配器。网页用户不能上传或安装服务端插件。桌面/CLI 则使用本地已信任并启用的插件；服务器和客户端必须分别安装需要在其上运行的适配器。

## PostgreSQL 集成测试

`pnpm test:postgres` 使用真实数据库和 HTTP，只调用测试模型，不使用模型厂商 Key。每个用例创建独立的 `praxis_test_<随机 ID>` 数据库并在结束后删除；请使用专用测试实例及具备创建数据库权限的测试账号。

- 本机安装了 PostgreSQL：设置 `PRAXIS_TEST_PG_BIN` 为其 `bin` 目录，脚本创建临时 Unix socket 实例，结束后停止并删除；不注册系统服务。便携构建可另设 `PRAXIS_TEST_PG_SHARE` 指定其共享数据目录。
- 已有独立测试服务或 CI：设置 `PRAXIS_TEST_DATABASE_URL` 后执行，不连接项目 `.env` 中的生产地址。
- CI 的 `postgres` job 已配置 PostgreSQL 18 服务；该配置仍需在远端实际运行。

示例：`PRAXIS_TEST_PG_BIN=/path/to/postgresql/bin pnpm test:postgres`。普通 `pnpm check` 保持无需数据库服务，包含结构检查、类型检查和核心回归。

### MCP 远程工具

桌面端在“设置 → MCP 连接”保存固定端点，先检查连接，再点击“启用 Agent 工具”。当前支持无认证、Bearer 或 OAuth 的 Streamable HTTP 工具与文本资源；每次业务调用或资源读取展示实际参数与目标地址并等待单次审批。添加时勾选资源能力（或配置 `capabilities.resources: true`）后才开放资源目录与读取。ChatBot 不接入 MCP。停用或编辑会取消活动操作；断流、取消和重启不会自动重放调用。

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

使用 `pnpm cli run --workspace /absolute/path/project` 进入交互模式才能确认 MCP 业务调用；非交互运行在需要审批时返回明确错误。资源 URI 只交给远端 MCP 服务处理，不直接读取 Host 文件或访问任意 URL；文本保存为会话快照，二进制明确标为不支持。stdio 尚未接入。OAuth、提示词与表单交互见下文；当前验收缺口见 [V1 台账](docs/v1-completion.md)。

## 用户主动执行插件命令

可信插件可以注册 `registerCommand(name, callback, parameters)`；第三个参数为 JSON Schema，省略时只接受空对象。命令仅在用户明确选择时执行，不暴露为模型工具。桌面端输入框旁的“插件命令”可选择命令、查看参数结构并提交；CLI 交互使用 `/commands` 和 `/command 插件ID/命令名 {"参数":"值"}`，非交互使用 `pnpm cli run --workspace /path/to/project --command 插件ID/命令名 --arguments '{"参数":"值"}'`。

命令需要有效 Praxis 身份，不需要模型厂商配置；每次提交使用请求 ID 去重，并保存命令身份、委托工具记录和结果产物。Agent 命令通过 `services.invokeCore` 使用原有权限、预算和审批通道；Chat 命令不能取得 Agent 工具。单次命令限时 120 秒，取消或退出后撤销本次委托能力。插件仍是用户信任的本地代码，不构成隔离边界；服务端 Web 暂不开放用户命令插件安装。

## 文件搜索语法

`fs_search` 支持 `literal`（默认）和 `regex`。正则使用 Node 的 Unicode 单行表达式，不接受 `/pattern/flags` 包装；大小写由 `caseSensitive` 控制，每行返回首次命中，列号从 1 开始按 Unicode 码点计数。支持字符类、分组、量词、断言等当前 Node 引擎语法；实际换行不能用于表达式。每个文件的匹配限时 1 秒，超时报 `SEARCH_TIMEOUT`；32 MiB 扫描文本或遍历预算用尽会标记 `incomplete`，命中数量超限标记 `truncated`。搜索遵守原有工作区、敏感路径、忽略文件和符号链接限制。

## 项目指令

Agent 在创建会话时记录根 `AGENTS.md`，访问子目录或遍历搜索时发现更具体规则；不向工作区外自动扫描。每次模型请求刷新已发现的文件，最多 32 个文件、累计 64 KiB，超限明确报错。指令快照保留来源、范围、摘要与完整文本产物，修改或删除不会抹去旧版本。若生成写入后才发现新规则或规则已变，工具返回 `INSTRUCTIONS_CHANGED` 并等待模型下一步重新决定。项目规则不能扩大权限；Chat 不读取这些文件。

## MCP 提示词

桌面 Agent 输入区的“MCP 提示词”可列出已启用服务器的模板、填写公开参数、获取并查看完整预览，再确认加入队列或追加指导。模板的 user/assistant 角色只作为外部来源标记；应用后是一条用户选用材料，不伪造本 Session 的回答或工具动作。预览绑定会话、服务器配置版本、目录版本与内容摘要，有效期 10 分钟；服务器配置改变后需重新获取。取消、退出及服务器停用会中止预览请求。ChatBot 不连接 MCP。

CLI 交互支持 `/mcp-prompts SERVER_ID`、`/mcp-preview SERVER_ID {"name":"模板","arguments":{}}`、`/mcp-apply PREVIEW_ID CONTENT_HASH [queue|steer]`。也可分两次运行：

```sh
pnpm cli mcp preview SESSION_ID SERVER_ID NAME --arguments '{"topic":"Hello World"}'
# 阅读输出的完整 text，确认后使用其中的 previewId、contentHash：
pnpm cli run --resume SESSION_ID --provider PROVIDER_ID --apply-prompt PREVIEW_ID --content-hash CONTENT_HASH
```

获取预览不会启动模型；应用精确的本地快照，不重新请求远端模板。文本之外的内容明确报不支持，避免悄悄丢弃模板的一部分。

### MCP 人工表单

交互式 CLI 和桌面 Agent 支持新版 MRTR 与旧版 form elicitation，覆盖工具调用、文本资源读取和提示词预览。服务器要求补充信息时展示来源、字段及约束；回答格式验证通过后才保存和续交，新增参数还需单次执行确认。非交互 CLI 不声明表单能力。

每轮最多 12 个字段、每个操作最多 8 次续交；支持文本、数值、布尔、字符串数组及枚举，Schema 中未实现的约束会明确拒绝。跳过必填项表示拒绝表单；取消、退出或停用服务器会关闭等待。Key、密码和支付秘密不得通过表单填写，已知凭据会在保存/发送前拦截。服务器私有 requestState 仅在当前操作内原样续交，不写入 Session 或恢复 checkpoint。

CLI 获取预览期间仍可回答问题、`/approve`、`/deny` 或 `/cancel`。桌面预览等待输入时会让出对话里的回答/审批卡片。重复提交相同回答或审批决定只返回已保存的回执，不产生第二份执行授权。

### MCP Bearer 凭据

桌面端在“设置 → MCP 连接”展开服务器的“设置 Bearer Token”。Token 只用于当前用户/客户端的固定服务器端点；保存或更换后连接停用，需要重新检查并启用。设置页分别显示系统存储、仅本次运行有效和凭据缺失。清除只删除本地凭据，不代表远端撤销 Token。

macOS 使用 Keychain（已在本机完成真实读写/删除测试）；Windows Credential Manager 和 Linux Secret Service（需 `secret-tool`）适配代码仍待目标系统实测。系统存储不可用时明确使用当前 Host 内存，不写入 JSON、Session、日志或 checkpoint。`PRAXIS_SECRET_STORE=memory` 可显式选择临时存储。退出后内存凭据失效。

CLI 从 `PRAXIS_MCP_BEARER` 一次性读取专用 Token，并在启动 Host 前从继承环境移除；不要将 Token 放在命令行参数中。设置后状态输出不含 Token：

```sh
pnpm cli mcp auth SERVER_ID
pnpm cli mcp clear-auth SERVER_ID
```

使用临时存储时，在同一次前台运行内设置、检查并启用服务器：

```sh
pnpm cli run --workspace /absolute/path/project --mcp-bearer-server SERVER_ID
```

认证版本与配置版本绑定目录；更换凭据取消旧操作。业务调用收到 401 不自动重放，服务器回显已知凭据会在保存和交给模型前拒绝。`pnpm native:build` 构建本机 Keychain/Credential Manager helper；秘密经私有管道传输，不放入 helper 参数。

### MCP OAuth

在桌面“设置 → MCP 连接 → OAuth 浏览器授权”填写 Issuer、公共客户端 ID、已经注册的本机回调地址及权限范围。点击开始后，在系统浏览器完成授权，再检查连接并启用。支持授权码 + PKCE S256；不自动注册客户端。服务器声明支持 Client ID Metadata Document 时，也可使用对应的 HTTPS URL 作为客户端 ID。

CLI 示例（替换为服务器的实际注册信息）：

```sh
pnpm cli mcp oauth SERVER_ID \
  --issuer https://auth.example.com \
  --client-id praxis-public \
  --redirect-uri http://127.0.0.1:4319/oauth/callback \
  --scopes "docs:read"
```

回调仅监听配置的 `127.0.0.1` 或 `::1` IP、固定端口和路径，5 分钟后关闭；端口不可用会报错，不私自更改已注册地址。无自动浏览器的本机终端可加 `--no-browser`，手动打开输出的链接；这不是设备授权流。私网 Issuer 需要显式传入 `--allow-private-issuer`，该许可不会扩大到元数据声明的其他私网域名。

Token 使用与 Bearer 相同的系统凭据存储。没有系统存储时，使用 `run --mcp-oauth-server SERVER_ID` 加上上述参数，可在同一次前台运行中授权并使用内存 Token。关闭客户端会取消授权并关闭回调；内存凭据随进程退出失效。刷新按凭据引用合并并发请求；原子保存轮换结果后更新认证版本，旧目录和执行范围失效。刷新结果未确认时要求重新授权，不重放工具调用。清除本地凭据不会撤销远端授权，远端撤销须在服务商账户中操作。

连接可在桌面设置中编辑或删除，CLI 用 `mcp import FILE` 更新已有 ID、用 `mcp remove SERVER_ID` 删除。编辑后需要重新检查并启用；同一端点保留当前客户端的凭据，换地址或传输会先停用并清理旧凭据。导入文件里的 HTTP 凭据引用不会作为授权来源。删除或更换地址时若系统凭据清理失败，旧配置保持停用并保留引用，刷新设置后可重试。

## 用户指令

Web 与桌面“设置 → 个性化”支持编辑并启用用户指令。桌面 ChatBot 和 Agent 共用该桌面账号的指令，CLI 与 Web 分别管理自己的指令；每次任务/回复开始时固定版本，编辑从下一次生效。当前指令计入上下文预算，压缩后仍按原文重建；启用时的正文、版本和摘要保留在请求历史中，禁用不会删除已有历史。

CLI 使用 `pnpm cli instructions show` 查看版本，再运行 `pnpm cli instructions set /path/to/instructions.txt --revision N`，或 `pnpm cli instructions disable --revision N`。指令文件必须是最多 16 KiB 的 UTF-8 文本；版本冲突不会覆盖更新。指令不授予工具权限，请勿填写密码或 API Key。

这批功能增加 PostgreSQL 迁移 v2。升级服务端时先停止服务、按部署备份流程备份，再执行 `pnpm db:migrate` 后启动；迁移保留账号、统一模型配置和历史，服务运行中会拒绝迁移。本地 SQLite 仍为 v2，不需要迁移；当前 CLI 会话备份不包含客户端设置文件，但包含历史中已使用的指令快照。

## 诊断导出

桌面和服务端的诊断功能独立于用户指令设置；诊断包不会包含指令正文。

桌面“设置 → 关于”可以显式导出诊断包；CLI 可使用 `pnpm cli data export-diagnostics /absolute/path/existing-directory --client cli`（或 `desktop`），运行中的目标客户端也可只读导出。诊断包仅含运行标识、固定错误分类、耗时和计数，不含对话、文件正文、Key、路径或 URL，不会自动上传。最多 2 MiB / 5000 条，截断及无效行会在包中标明。

服务端运维人员可运行 `pnpm server export-diagnostics /absolute/path/existing-directory`，需要本机日志目录的读取权限，不需要连接数据库。`PRAXIS_SERVER_LOG_DIR` 可指定服务日志目录；默认在 Praxis 数据目录的 `server/<公共来源摘要>/diagnostics/`。服务端日志包含多账号运行标识，不通过用户 HTTP 接口导出。

诊断日志默认单文件 50 MiB、最多 5 个、保留 14 天，在启动和写入时轮换清理；停止后不启动后台清理进程。诊断不替代以下会话备份。

## 本地会话备份与恢复

配置通常使用的 `PRAXIS_SERVER_URL`、`PRAXIS_API_KEY`，关闭要维护的 CLI 或桌面客户端后执行：

```sh
pnpm cli data backup /absolute/path/existing-backup-parent --client cli
pnpm cli data inspect /absolute/path/praxis-backup-... --client cli
pnpm cli data restore /absolute/path/praxis-backup-... --client cli --confirm SHA256
```

`--client desktop` 管理桌面端的数据。备份目录由程序唯一命名；输出清单列出账号、Praxis 服务地址、客户端类型、记录数量与 SHA256。恢复必须使用 `inspect` 得到的精确摘要，并绑定原账号、服务地址及客户端；它会替换该客户端的全部会话。运行中的客户端持有写入锁时拒绝备份或恢复。

备份保存完整会话历史、工具记录、所有上下文版本、checkpoint 和数据库内的文本产物；不包含模型/MCP 凭据存储、插件安装文件或工作区实际文件。会话正文可能包含用户输入的敏感信息，请妥善保存备份。当前支持格式 v1、数据库 v2，单库上限 2 GiB。

恢复前自动在 profile 的 `recovery-backups/` 下创建当前数据的回退备份，随后事务替换。程序拒绝身份、摘要、数据库结构或记录校验不符的备份。若提交结果无法确认，会报告 `BACKUP_RESTORE_UNKNOWN` 和回退路径；先检查当前数据，不自动重试。重新打开客户端后，未完成任务标为中断，待处理输入保持暂停，需要显式继续。恢复历史不会恢复项目文件，也不会重放工具调用。

### 旧版本地账号目录

新建 profile 按 Praxis 服务来源、客户端类型和用户 ID 隔离，同一 ID 在不同服务上不会共享会话、MCP 配置或插件。旧版目录没有来源信息，首次使用新版时会报 `PROFILE_BINDING_REQUIRED`，不会自动猜测归属。

确认 `PRAXIS_SERVER_URL` 指向原服务、API Key 属于原账号，关闭对应客户端后，在自己的终端执行 `pnpm cli data bind-legacy --confirm https://原服务地址 --client cli`；桌面端使用 `--client desktop`。这只为旧目录写入不可变来源标记，不移动或删除会话、配置、插件文件。重复确认同一来源可重试；其他来源或已存在的新数据冲突会明确拒绝合并。不要把旧数据绑定到新建的同名账号或不同服务。

## 原生文件组件

文件读取、目录遍历与写入现在依赖 `pnpm native:build` 生成的 `praxis-files`。它固定根目录身份，通过原生目录句柄逐段访问；写入准备完成后再次向 Host 获取权限确认。组件缺失时明确失败，不自动降低文件访问边界。目录列表超过单目录 10,000 项会标明 `incomplete`，搜索继续使用总遍历预算。

当前 macOS ARM64 已完成真实文件回归。Linux 与 Windows 的源码和构建入口已提供，目标系统验证仍待完成；Windows 仅设计支持本地盘符路径。实现边界见 [原生组件说明](native/files/README.md)，命令执行沙箱仍未开放。

## 工作区配置与生效快照

Agent 可以读取工作区根目录的 `.praxis/config.json`（UTF-8 JSON，最多 32 KiB），例如：

```json
{
  "schemaVersion": 1,
  "ignore": ["node_modules/", "dist/"],
  "context": { "language": "zh-CN", "responseStyle": "concise" },
  "validationCommands": ["pnpm check"]
}
```

`ignore` 使用 Git ignore 语法，只影响 `respectIgnore: true` 的文件查找和文本搜索；直接读取仍按权限和路径策略检查。`context.language` 支持 auto/zh-CN/en，`responseStyle` 支持 auto/concise/detailed。验证命令只是模型可见建议，保存配置不会执行它们。未识别字段、非法类型、符号链接和超限内容会明确报错。模型文件工具不能读写 `.praxis`；配置由用户在编辑器维护，不能设置模型 Key、安装插件、改变服务地址或扩大权限。ChatBot 不读取此文件。

每次任务固定配置，修改下次任务生效；原配置版本与来源/hash 留在 Session。桌面“设置 → Agent → 工作区配置”可以查看最近任务快照，CLI 使用 `pnpm cli config SESSION_ID`。快照列出实际预算、模型引用、插件版本和任务开始时的权限，查询另返回当前权限；权限控制仍即时生效。用户指令正文保留在其专用快照中，配置查询只显示版本和摘要。不要把任何凭据放进项目配置。

工作区可进一步限制模型侧的 MCP：配置 `"mcp": { "servers": [{ "serverId": "已启用连接的 UUID", "tools": ["远端原始工具名"] }] }`。省略 mcp 沿用个人已启用集合；`servers: []` 使此任务没有 MCP 工具和资源；指定服务器但省略 tools 允许其已启用的工具，`tools: []` 关闭该服务器工具，资源仍遵从个人配置。重复/未知/未启用连接会拒绝，不会自动添加连接或启用权限。目录筛选和实际调用均应用固定白名单，业务调用仍需单次审批。用户主动选择的 MCP 提示词预览沿用个人设置和显式确认，不从项目文件获得授权。

## 明确上下文溢出的恢复

内置适配器仅将 HTTP 400/422 的有界 JSON `error.code: context_length_exceeded` 识别为窗口溢出，不从普通错误正文猜测。可信 Provider 可在尚未产生任何增量时抛出 `PraxisError('MODEL_CONTEXT_OVERFLOW', ...)`；宿主只保留固定安全说明。若该 step 尚未发布输出，本地与 Web 会保留最新输入、强制压缩较老完整协议组，并在上下文版本前进且候选确实缩小输入后重试一次。失败、取消、重复溢出或半截流均停止，不重复相同请求。原始历史仍保留，恢复产生新的上下文版本和请求快照，计入既有模型尝试预算。

模型用量保留厂商报告的输入、输出、缓存和推理数字；缺失为 unknown（记录中为 null），不记作零。缓存命中仍占输入窗口。每个会话按供应商、配置版本、模型和适配器分别校准 UTF-8 估算，只提高系数并留出 10% 余量；重新打开会话后继续使用已保存的校准，修改配置版本后重新开始。生成和摘要请求都保存请求 ID、估计及成功响应的实际用量；这是预算辅助和使用记录，不是精确 tokenizer 或计费账本。
