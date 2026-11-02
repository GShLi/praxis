# 知行 Praxis 内置工具详细设计草案

日期：2026-11-02

状态：根据已确认的本地 Agent、三平台系统沙箱及应用退出即停止任务要求细化；工具范围、参数和默认限额是设计提案，尚未实现。本文细化[总体设计第 9 节](2026-11-02-praxis-design.md#9-工具与权限)，不改变 ChatBot 无操作工具的边界。

## 1. 设计目标与 DSH 参考

工具服务于本地任务闭环：发现文件 → 读取并理解 → 修改 → 运行验证 → 观察结果 → 继续或结束。长任务还需要可持久化的计划、必要时询问用户，以及按需读取大输出。工具数量不按 DSH 插件数量复制，先保证这些闭环。

| DSH 当前能力 | 源码依据 | Praxis 的取舍 |
| --- | --- | --- |
| `read`、`write`、`edit`、有条件注册的 `read_image` | [文件工具](../../../../deepseek-harness/packages/fs/tool-fs/README.md) | 分段读、先读后改、版本冲突检查、可重放 diff；图像读取作为能力扩展 |
| `glob`、`grep` | [搜索工具](../../../../deepseek-harness/packages/fs/tool-fs-search/README.md) | 区分文件名查找与内容检索；明确搜索范围、忽略规则和输出截断 |
| 文件观察记录及版本核对 | [观察策略](../../../../deepseek-harness/packages/fs/fs-observation-policy/src/index.ts) | 作为内置文件修改的强制规则，不因未加载可选插件而失效 |
| `bash` / `pwsh`、持久 Shell 可选实现 | [Bash 工具](../../../../deepseek-harness/packages/shell/tool-bash/src/index.ts)、[持久 Shell](../../../../deepseek-harness/packages/shell/tool-bash-persistent/README.md) | 一个跨平台命令接口，第一版每次新进程；不继承上一条命令的 cwd 或 export |
| `job_output`、`job_list`、`job_kill` | [Jobs 工具](../../../../deepseek-harness/packages/jobs/tool-jobs/README.md) | 统一查询、列举和取消命令；不照搬空闲时自动唤醒新 turn 的机制 |
| `todo_write` | [Todo 工具](../../../../deepseek-harness/packages/todo/tool-todo/src/index.ts) | 全量提交计划，保留计划版本及跨 turn 历史 |
| `ask_user_question` | [用户提问工具](../../../../deepseek-harness/packages/interaction/tool-ask-user/src/index.ts) | 与权限审批分开；第一版支持阻塞等待，缺少回答不能当成授权 |
| 工具 Schema、结构化值、模型投影、UI 投影 | [工具执行管线](../../../../deepseek-harness/docs/subsystems/tools.md) | 一个规范结果分别投影给模型与界面；权限判断集中在 Host |

上述是本工作空间 DSH 代码的参考关系，并不表示 Praxis 继承其全部边界。尤其 DSH 的搜索工具可直接依赖 subprocess 而不经过文件 Provider；Praxis 必须另外保证搜索结果和子进程搜索均遵守自身读取策略。

## 2. 第一版工具范围与命名

第一版建议保留 13 个核心内置工具。启用 MCP 后再有条件注册 3 个桥接工具及选中的外部工具，详见[MCP 设计第 7 节](2026-11-02-praxis-mcp-design.md#7-模型工具的按需加载)。内部使用带命名空间的 ID；传给模型的名称采用显式注册的下划线名称。两者一一映射，不依赖把点简单替换为下划线推导，插件不得占用内置名称。Provider 在创建请求前验证名称和 Schema 能否表达，不支持时明确失败，不静默丢弃约束。

| 内部 ID | 模型名称 | 用途 | 效果类别 |
| --- | --- | --- | --- |
| `fs.list` | `fs_list` | 查看一层目录 | 文件读取 |
| `fs.find` | `fs_find` | 按文件名或 glob 查找 | 文件读取 |
| `fs.search` | `fs_search` | 搜索文本内容 | 文件读取 |
| `fs.read` | `fs_read` | 分段读取文本 | 文件读取 |
| `fs.write` | `fs_write` | 新建或完整替换文件 | 文件修改 |
| `fs.apply_patch` | `fs_apply_patch` | 对单文件做精确文本替换 | 文件修改 |
| `process.exec` | `process_exec` | 启动受沙箱限制的命令 | 外部执行，默认视为可能写入 |
| `process.read` | `process_read` | 获取命令状态及增量输出 | 读取执行状态 |
| `process.list` | `process_list` | 列出本会话命令 | 读取执行状态 |
| `process.cancel` | `process_cancel` | 取消本会话命令 | 执行控制 |
| `task.update_plan` | `task_update_plan` | 创建或更新任务计划 | Session 状态修改 |
| `user.ask` | `user_ask` | 询问需求、选项和缺失信息 | 等待用户输入 |
| `artifact.read` | `artifact_read` | 分段查看较大的工具输出 | 受控产物读取 |

这些工具仅注册给 Agent。Web 和桌面 ChatBot 不发送工具定义，也不存在可通过伪造工具名调用这些执行器的入口。

以下属于后续专门能力，不阻塞当前闭环：图像读取、网页搜索与抓取、浏览器交互、LSP、Git 专用操作、Skills 读取和子 Agent。MCP 已从该占位清单移出，形成独立接入设计；接入外部 MCP 不等于已经实现上述每项原生能力。构建、测试及 Git 本地命令可通过 `process.exec` 使用。没有浏览器或图像能力时不能声称已验证页面视觉效果。

## 3. 公共工具协议与执行管线

### 3.1 定义、调用和执行身份

每个工具定义包含 `id`、`modelName`、版本、描述、输入及输出 JSON Schema、效果类别、权限需求推导函数、执行函数、模型内容渲染器和纯 UI 展示投影。Schema 由共享声明生成并在 Host 运行时校验；不接受未知字段，不把 TS 类型当作 JSON 校验。支持的 Schema 子集与具体 Provider 适配另行锁定，不自建 DSH 那样完整的类型 DSL。

执行上下文由 Host 注入：用户身份、`sessionId`、`turnId`、`stepId`、`toolCallId`、工作区、策略版本、取消信号、截止时间，以及受限文件/进程/产物服务。模型不能提交或覆盖用户身份、授权票据、真实 PID、Host 数据目录及可信环境变量。

每个模型工具调用有独立 `toolCallId`。进程启动后另有 `executionId`：一次 `process.exec` 可以返回 running，此时该工具调用已经完成返回，但进程仍在运行；后续 `process.read` 是新工具调用，引用相同 `executionId`。不能让一个已经返回的 tool result 反复变成不同结果。

一个 step 固定工具定义与参数 Schema 快照。工具参数流式到达时仅展示预览，收到完整 JSON 并校验前不执行。审批使用已解析、规范化和冻结的参数，不能审批一份参数再执行另一份。

### 3.2 执行顺序

1. 按本会话注册表查找工具，验证 JSON、参数数量、长度和总大小。
2. 注入可信上下文，解析绝对资源目标，计算所需权限和本次执行预算。
3. 运行 Host 必选规则及插件附加检查；插件可以进一步限制，不能撤销 Host 拒绝或签发授权。
4. 必要时进入 `waiting_approval`；未获得匹配的单次授权不调用工具主体。
5. 审批后重新校验文件身份、策略版本、取消状态和预算，持久化执行意图。
6. 调用文件执行器、系统沙箱进程执行器或 Session 服务；始终传递取消信号。
7. 校验结果值，保存执行事实、输出及产物引用，生成模型内容和可重放的界面数据。
8. 提交 `tool/result` 后才对外发布确定结果，执行循环消费它并推进下一步。

审批等待不计入命令的运行时长，但受 turn 的总预算与应用生命周期约束。后置展示插件不能把失败改成成功、扩大权限或把未提交的输出发布为已确认事实。

普通工具按顺序执行。第一版每个会话最多有一个活动命令；该命令可能在工具返回 running 后继续执行。活动命令占用本会话的文件修改执行位，`fs.write`、`fs.apply_patch` 和新的 `process.exec` 返回 `WORKSPACE_BUSY`，避免命令与文件工具交错写入。只读工具、状态查询、计划和提问仍可使用；读取正在变化的文件必须检测不稳定结果。跨会话工作区锁沿用总体设计。

本地 MCP 从准备启动到全部子孙回收同样占用此执行位，不能与命令或专用文件修改并发。它是用途为 mcp-server 的受管进程，stdin 承载协议，不适用普通 process.exec 的关闭 stdin 规则；模型通过 MCP 工具使用它，不获得原始协议管道或任意 PID。

### 3.3 统一结果

以下为协议类型草案，具体成功 `data` 由各工具输出 Schema 定义；数据必须是可序列化 JSON，不能返回 Error 实例或进程对象。

```ts
type ToolStatus =
  | "succeeded" | "running" | "failed" | "denied"
  | "cancelled" | "timed_out" | "unknown";

type EffectState = "none" | "committed" | "partial" | "unknown";

type JsonValue = null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };

interface ToolResult {
  callId: string;
  toolId: string;
  toolVersion: number;
  status: ToolStatus;
  effectState: EffectState;
  data?: JsonValue;
  error?: {
    code: string;
    message: string;
    recovery: "none" | "read_again" | "adjust_input"
      | "request_access" | "inspect_state" | "retry_read";
  };
  artifactIds: string[];
  truncated: boolean;
  durationMs: number;
}
```

跨字段也要校验：running 必须携带执行 ID；failed/denied 等必须有对应错误或终止原因；纯读取不能宣称修改已提交。进程退出码和信号保留在 `data`，非零退出对应命令失败，不能仅因“成功启动进程”返回 succeeded。

`effectState` 描述本次调用实际可能造成的变化，与返回状态分开。例如命令超时可能已经修改了文件；没有证据时为 unknown。文件修改已经提交后到达的取消不把它伪装成“已取消且未写入”。输出渲染或结果 Schema 出错也不能擦掉执行收据：记录 `INVALID_TOOL_OUTPUT` 并保留已知效果，无法确定则标 unknown，禁止自动重放。

模型可见内容只包括本次任务需要的结果、稳定错误码、下一步提示及有界预览；界面可以展示更完整的 diff、时间和命令状态。规范结果及产物也按敏感信息策略处理，不承诺保存未脱敏原始输出。输出内容作为数据，不作为新的系统指令。全部可见模型内容必须能从 Session 和关联产物重建。

### 3.4 公共权限申请

文件读取、写入、搜索和命令启动的输入 Schema 可合并公共字段 `requestedAccess`，包含具体 `readPaths`、`writePaths`、受支持的网络权限申请及非空 `reason`。这是模型表达所需资源的请求，不是授权结果。列表长度、路径长度和申请范围由 Host 限制；不接受 `approved: true`、任意 `policy` 或用户身份。

首次调用已经明确所需资源时可以先审批再执行，不要求故意失败一次。默认调用被拒绝后，模型可以参考结构化拒绝信息提交新调用，但不能自动复用旧参数或盲目重复已有副作用。无沙箱执行若开放，必须是独立且醒目的申请，不由一个目录申请隐式触发。

## 4. 目录与搜索工具

### 4.1 `fs.list`

输入：`path?: string`（默认工作区）、`includeHidden?: boolean`（默认 false）、`limit?: number`（默认 100，上限 500）、`cursor?: string`。

返回：规范化目录路径、`entries[{name,path,type,size?}]`、`nextCursor?`、`truncated`。类型区分 file、directory、symlink 和其他类型；不自动递归，也不为列目录读取全部文件内容。空目录是成功的空列表。

按稳定名称顺序分页。游标引用 Host 保存的有界枚举快照，绑定参数摘要、会话和策略版本；失效返回 `CURSOR_EXPIRED`，不能悄悄从头开始造成重复。目录在枚举期间变化时不承诺文件系统事务快照；发现不稳定则标记并建议重查。只有通过授权检查的条目可以进入结果。

### 4.2 `fs.find`

输入：`pattern: string`、`path?: string`、`includeHidden?: boolean`、`respectIgnore?: boolean`（默认 true）、`limit?: number`（默认 200，上限 1000）。

glob 针对搜索根的相对路径；`*.ts` 仅匹配该层，递归必须写 `**/*.ts`。默认只返回文件，不跟随目录符号链接，不遍历 `.git`、`.hg`、`.svn` 的内部目录。隐藏文件与忽略规则分别控制，设置 includeHidden 不等于关闭 `.gitignore`。忽略规则是检索偏好，不是授权规则。

返回：`root`、`paths[]`、`truncated`、`incomplete`、`artifactId?`。已收集结果按相对路径排序，不保证扫描过程中的全局最新顺序。无匹配是成功；权限或 I/O 错误必须标记搜索不完整，不能给出“整个项目没有匹配”的结论。

### 4.3 `fs.search`

输入：`query: string`、`path?: string`、`syntax?: "literal" | "regex"`（默认 literal）、`include?: string[]`、`caseSensitive?: boolean`（默认 true）、`includeHidden?: boolean`、`respectIgnore?: boolean`（默认 true）、`contextLines?: number`（默认 0，上限 5）、`limit?: number`（默认 100，上限 500）。

返回：`matches[{path,line,column,text,contextBefore?,contextAfter?,lineTruncated}]`、`truncated`、`incomplete`、`artifactId?`。行、列从 1 开始；列定义为 Unicode 码点位置，后端字节偏移必须转换。第一版仅单行 regex，语法以所选搜索后端支持子集为准，不承诺任意 JavaScript 正则或 PCRE。

优先使用打包的 ripgrep，Host 构造参数数组并正确终止选项解析，不拼接 Shell 字符串；后端进程按本次读取策略约束。不能只在拿到结果后过滤路径来代替进程访问限制。未提供支持策略的搜索后端时返回不可用，不自动退成无限制宿主搜索。二进制默认跳过；已跳过、失败或截断均在统计中明确。

find/search 在配置的扫描时长、结果字节和扫描量预算内收集。超出行数显示上限的已收集结果保存到产物，超出扫描预算则同时标 `incomplete: true`。产物只包含实际收集的结果，不能称为完整仓库结果。用户可缩小 path/include，或用 `artifact.read` 继续查看已收集内容。

## 5. 文件读取和修改

### 5.1 公共文件规则

相对路径始终相对 Session 的固定 Workspace 根，命令的 cwd 不改变后续文件工具的基准。绝对路径接受，但必须属于当前授权范围。路径在 Host 解析，不能按字符串前缀判断包含关系。结果保留操作时的规范化路径，历史重放不重新解析到另一个目标。

第一版处理普通 UTF-8 文本文件，拒绝不支持的编码、设备、FIFO、Socket 和二进制。读取允许授权范围内的文件符号链接目标，遍历默认不跟随目录链接；对修改目标及其祖先的链接/重解析点进行身份核验，无法安全验证时拒绝。现存多硬链接文件的专用修改工具先拒绝，避免修改或替换语义不明确；Shell 的平台边界独立验证。

每个文件在当前 Session 维护观察记录：规范化目标身份、内容版本、已返回的完整行范围，以及返回内容是否被截断或脱敏。`fileVersion` 是 Host 生成的不透明版本值，不是可凭空提交的授权。文件修改成功也刷新观察记录。列表和搜索命中不算完成文件读取；恢复会话后必须重新读取，不能使用历史中的版本直接覆盖。

### 5.2 `fs.read`

输入：`path: string`、`startLine?: number`（默认 1）、`lineCount?: number`（默认 200，上限 2000）。

返回：`path`、`fileVersion`、`lines[{number,text,ending}]`、`eof`、`nextStartLine?`、`truncated`、`encoding`、`newline`。ending 保留每行实际的 LF、CRLF 或末行无换行事实，支持混合换行文件的精确编辑。每条结果还有整体字节上限，不能因单行很长而无界返回。若单行被截断，显式标记，不把残缺文本当作可直接替换的完整原文；第一版建议通过受控命令处理这种大单行文件。

为给出可靠版本，第一版专用文本工具支持的文件大小设上限，并在上限内读取和校验完整字节；显示给模型的仍是指定区间。读取前后身份或内容不稳定返回 `FILE_CHANGED_DURING_READ`，不更新可写观察记录。文件不存在返回 `FILE_NOT_FOUND` 并记录当时不存在，后续创建仍必须使用排他创建。

版本与观察记录用于发现陈旧输入，不保证模型理解了全部内容。部分读取只授予已完整返回、未脱敏范围的编辑依据，不能用于直接完整覆盖未读文件。

### 5.3 `fs.write`

输入是两种互斥形式：

```ts
type WriteInput =
  | { path: string; mode: "create"; content: string; createParents?: boolean }
  | { path: string; mode: "replace"; content: string; expectedVersion: string };
```

create：目标必须不存在，即使另一个进程在路径检查后创建了文件，也不能被覆盖。`createParents` 默认 false；显式创建父目录时逐层检查授权，只创建缺失目录，失败时如实记录已经创建的目录，不删除并非本次创建的内容。

replace：必须先在本 Session 完整读取同一版本，或由本 Session 成功创建并掌握完整内容；参数版本必须匹配 Host 观察记录和当前文件。仅通过搜索结果看到片段不能完整覆盖文件。

返回：`path`、`operation: "created" | "replaced"`、`beforeVersion?`、`afterVersion`、`bytesWritten`、`createdDirectories[]`、`diffArtifactId?`。界面展示创建内容或完整替换 diff；模型只需要精简确认和新版本，不再回显整份新文件。

### 5.4 `fs.apply_patch`

第一版使用有明确匹配数量的结构化文本编辑，不实现模糊匹配，也不执行 patch 内容中携带的命令。工具名表示应用修改，参数不兼容任意 unified diff。

```ts
interface ApplyPatchInput {
  path: string;
  expectedVersion: string;
  edits: Array<{
    oldText: string;
    newText: string;
    expectedMatches: number;
  }>;
}
```

`oldText` 非空且不能等于 `newText`；删除一段文本使用空的 newText。`expectedMatches` 必须为正整数，通常为 1；数量不符返回 `PATCH_MATCH_COUNT_MISMATCH`，不猜测选哪处。匹配区间不得重叠，newText 中包含 oldText 不导致递归替换。

所有 edits 针对同一原始版本求匹配，不能让后一个编辑依赖前一个编辑生成的文本。每个匹配范围必须已被完整读取且未被展示截断或脱敏。全部验证通过后一次发布新内容；任何一个匹配失败，整个文件不变。多个文件分别调用，不承诺跨文件事务；需保留多文件部分成功事实。

返回：`path`、`beforeVersion`、`afterVersion`、`replacements`、`diffArtifactId`。保持未修改区间的原始换行与 UTF-8 BOM；精确匹配不暗中去空格或统一换行。已有内容版本发生变化时返回 `FILE_VERSION_CONFLICT`，模型重新读取后决定新改动。

### 5.5 发布、并发和恢复边界

单文件修改在 Host 的目标级锁内完成，优先使用同目录临时文件及原子发布机制，保留常规权限，不引入可执行权限提升。create 需要真正的排他创建/发布保证。替换在发布前再次核验目标身份与版本，但普通文件系统不能为所有不配合的外部编辑器提供通用的原子 compare-and-swap；不得把检查加 rename 描述成绝对不会与外部写入竞态。

多写入者风险通过工作区写锁、最晚版本检查、变更前内容的受控产物及发布后核对降低。检测到发布期间冲突或无法确认结果时标明冲突或 unknown，保留恢复依据，不自动覆盖第二次。涉及敏感文件的旧内容产物沿用敏感数据策略，不能因做备份扩大模型读取权限。

专用文件工具的观察规则不意味着任意 Shell 命令都具备内容版本保护。命令在沙箱允许范围内仍可能覆盖文件；提示模型优先使用专用工具，界面与审计不得把命令修改伪装成受版本核验的编辑。

## 6. 命令执行及长命令管理

### 6.1 `process.exec`

公共输入：`cwd?: string`（默认工作区）、`description: string`、`env?: Record<string,string>`、`timeoutMs?: number`、`yieldMs?: number`；命令形式是两种互斥对象之一：

```ts
type CommandInput =
  | { kind: "exec"; executable: string; args: string[] }
  | { kind: "shell"; shell: "bash" | "pwsh"; script: string };
```

公共字段与上述对象合并为完整输入。exec 模式不解释管道、重定向或变量；Shell 模式显式解释 script。Shell 使用非登录、无用户 profile 的启动方式；可执行文件解析路径和启动参数由 Host 在审批前固定。系统上没有所选 Shell 就返回 `EXECUTABLE_NOT_FOUND`，不偷偷改用另一种语法。Windows 的 `.cmd` 等启动规则由适配器明确支持，否则要求显式 Shell 模式。

`env` 只是经过策略审核的覆盖项，不能注入 Praxis 内部配置、动态加载或解释器启动劫持变量。模型若确需特殊变量按命令权限策略处理，不将过滤后的命令伪称为原样执行。提供可信的最小环境及环境摘要，普通日志不回显秘密。

`timeoutMs` 是实际运行的最长时间，默认 120 秒，上限提议 30 分钟，并受 turn 剩余预算约束；`yieldMs` 是本次工具等待多久再返回，默认 1000 毫秒，上限 10000 毫秒。前者到期触发终止，后者到期只返回 running，二者不能混淆。若需要更长任务，用户可以调整 Host 配置，模型不能自己扩大系统上限。

进程默认非交互，stdin 关闭；不运行无限等待密码、确认或 REPL 的命令。第一版不提供持久 Shell、PTY 和输入注入工具。每次执行从声明的 cwd 和环境开始，前一次 `cd`、alias、export 不保留。

运行结果包含 `executionId`、`processState`、`exitCode?`、`signal?`、`sandbox`（后端、策略版本、实际权限）、首段 stdout/stderr、`nextCursor` 及产物引用。非零退出保留输出和退出码；沙箱拒绝、沙箱不可用与普通程序错误分开。运行中进程可能已有副作用，不能把 running 解读为尚未执行。

`processState` 为 running、cancelling、succeeded、failed、cancelled、timed_out 或 unknown。只有进程结束且清理完成才提交确定终态；取消原因和运行超时原因优先保留，不能用随后收到的普通退出码覆盖它们。

### 6.2 `process.read`

输入：`executionId`、`cursor?: string`、`waitMs?: number`（默认 0，上限 10000）、`maxBytes?: number`（默认 16 KiB，上限 64 KiB）。

返回：`processState`、`chunks[{sequence,stream,text}]`、`nextCursor`、`hasMore`、`outputTruncated`、`exitCode?`、`signal?`、`artifactIds`。stdout 与 stderr 标注来源；sequence 表示 Host 收到数据的顺序，不承诺还原操作系统的绝对输出顺序。

查询成功时，`process.read` 自身的 ToolResult.status 是 succeeded，即使 data.processState 为 failed 或 running；查询工具执行成功不等于被查询命令成功。模型投影必须明确展示命令状态，不能只输出查询成功。

游标显式传递，不维护模型与 UI 共用的“读过位置”；同一 cursor 重复请求可以读到相同前缀而不吞掉输出。UI 使用自己的订阅游标，不能抢走模型输出。等待超时仍返回 running，不取消命令。进程已经退出但还有未读输出时返回终态和 `hasMore: true`。

首次不传 cursor 从已保留输出起点读起。游标过旧、产物过期或保存因配额截断时明确返回缺口/失效信息，不把尾部当作完整日志。运行数据存储有界，按第 8 节管理。

### 6.3 `process.list`

输入：`includeFinished?: boolean`（默认 false）、`limit?: number`（默认 20，上限 100）。只列出当前 Session 所有或最近的执行，返回 ID、标签、状态、开始/结束时间、cwd、终止原因和输出是否尚未读取。超限提示缩小范围，不扫描其他会话或整个操作系统进程表。

运行时在每个模型 step 提供当前会话的活动执行摘要；完整清单按需读取。上下文压缩后不必依赖模型记住很早以前的执行 ID。

### 6.4 `process.cancel`

输入：`executionId`、`reason?: string`。先验证归属；请求取消后按平台终止受管理进程树并等待清理。结果明确区分 `cancellation_requested`、`terminated`、`already_finished`；只有确认进程退出才能展示“已终止”。清理尚未完成时仍可通过 read 查询，工具取消成功不等于所有文件修改回滚。

重复取消是幂等请求，不重用已结束进程的 PID；使用 Host 签发的执行 ID 和实际进程句柄。用户界面直接取消 turn 时走相同取消服务，无需等待模型调用此工具。

### 6.5 所有权及终态

每个命令归属当前 turn 和 Host。完成、失败、取消或预算耗尽收尾时停止仍活动的命令并记录结果；第一版不提供在最终回答后继续运行的会话级开发服务器。任务运行期间可以启动临时服务用于检查，但最终结束前必须清理。后续若需要用户接管开发服务器，应增加明确的会话服务生命周期设计。

命令完成事件先持久化，再通知执行循环；模型空闲等待长命令时继续当前 turn，不能暗中创建一个不受原预算控制的新任务。应用退出按总体生命周期停止命令；重新打开仅查看历史，不附着或自动恢复旧进程。取消等待查询不等于取消被查询命令，取消整个 turn 则取消其全部命令。

## 7. 计划与用户交互

### 7.1 `task.update_plan`

输入：`expectedRevision: number`（首次为 0）、`items[{id,title,status}]`、`explanation?: string`。status 为 pending、in_progress、completed、blocked 或 cancelled。ID 在计划内唯一，标题非空，每次提交完整列表，第一版最多一个 in_progress。

返回：`revision`、当前完整计划和状态计数。Session 追加 `plan/updated` 事件后更新投影，失败时不更新界面。不同于 DSH 的 turn 开始清空当前 todo 投影，Praxis 的计划跨 turn 保留；新任务需要显式替换计划，旧版本仍留在 Session。后续继续长任务能看到完成项、剩余项和阻塞原因。

计划是可审计的工作说明，不是可执行调度图。把某项标为 completed 不证明测试通过，不自动完成 turn，也不授权其描述中的文件或命令操作。取消所有工作由 turn 取消控制，不能只把计划改成 cancelled 就认为子进程已停止。

### 7.2 `user.ask`

输入：`questions[{id,prompt,options?}]`，一次 1–3 题，选项含稳定 ID、label 和可选 description；第一版单选加自由文本，也支持不提供选项的纯文本题。题目 ID 在本次调用内唯一。不得要求在普通回答中输入 API Key，凭据配置使用专用设置入口。

Host 创建 `questionId`，Session 记录 `question/asked`，运行状态变为 `waiting_input`，暂停后续模型步骤。桌面展示表单，交互 CLI 展示选择或输入；无交互终端且没有预配置回答通道时返回 `INPUT_UNAVAILABLE`，不能无限挂起。等待上限由 Host 配置和 turn 剩余预算决定；有限等待到期返回超时并把任务标为需要用户输入，不自动选择默认选项。

客户端通过 `question/respond` 提交 questionId 和答案，Host 验证会话、题目版本及待答状态，再记录 `question/answered` 并返回工具结果。重复相同答复去重，过期答复拒绝；取消、退出后不得用旧答复唤醒执行。等待期间收到其他消息可以排队，但不冒充这道题的答案。

工具返回 `questionId` 及 `answers[{id,selectedOptionId?,text?,skipped}]`，选项和自由文本分开保留，明确区分跳过与给出空答案。回答必须来自实际的用户通道，模型或插件不能伪造为用户来源。

用户回答表达需求，不能替代精确的执行审批。即使回答“可以”，需要额外路径或网络权限的后续工具调用仍必须走 Approval Service。Agent 在等待输入期间受管理命令仍受原运行截止时间控制，不能因等待用户无限延长。

## 8. 产物、大输出和上下文

### 8.1 `artifact.read`

输入：`artifactId: string`、`cursor?: string`、`maxBytes?: number`（默认 16 KiB，上限 64 KiB）。第一版只读取可安全展示的文本或结构化文本，不接受用户传入任意文件路径。

返回：产物类型、片段文本、`nextCursor?`、`eof`、源工具调用或执行 ID、内容版本、是否包含截断/缺失区间。游标按 UTF-8 完整边界返回，不能截断多字节字符。未指定 cursor 从头开始；不可用时区分不存在、无权限、过期和存储失败。

Artifact 是 Host 签发的、归属 Session 的引用，不是访问整个 Host 文件系统的入口。读取时验证归属、当前读取策略和敏感标记；策略收紧后不能绕过限制读取之前保留的敏感副本。产物目录不作为工作区可写目录授予命令，不能让模型篡改审计输出后再把它作为执行证据。

### 8.2 输出保留与预算

较大结果只把摘要、有限预览、执行状态和产物 ID 放入模型上下文；原始 Session 保留规范事件和产物关联。压缩保留活动 executionId、当前计划、关键文件版本提示和未解决问题；旧文件版本仍必须重新验证，摘要不能恢复写入授权。

建议所有以下值集中在 Host 配置中，模型只能在上限内选择参数；实施时根据模型窗口和实际体验调整：

| 项目 | 第一版提议值 | 超限行为 |
| --- | --- | --- |
| 工具参数 JSON | 2 MiB | 执行前拒绝 |
| 专用文本文件大小 | 2 MiB | 提示使用分块方案或受控命令，不在内存无限加载 |
| 单次完整写入 content | 1 MiB | 执行前拒绝 |
| 单次补丁编辑数 | 50 | 执行前拒绝 |
| 模型单次工具内容 | 16 KiB，含状态和元数据 | 保留必要字段，溢出内容使用产物；再服从本次模型 token 预算 |
| 分段读取原始文本上限 | 64 KiB | 明确区分读取范围与最终模型展示范围 |
| 搜索时长 / 保留结果 | 30 秒 / 8 MiB | 停止扫描，标 incomplete，保留已取得结果 |
| 单个命令输出存储 | 20 MiB | 继续排空 stdout/stderr，保留有界头尾并记录缺失区间，不因此卡死子进程 |
| 单会话产物总量 | 200 MiB | 拒绝新增需要产物的操作或降为明确的截断记录，不静默删除被引用产物 |
| 命令运行时长 | 默认 120 秒，上限 30 分钟 | 触发受管理进程终止 |
| 命令工具等待 | 默认 1 秒，上限 10 秒 | 返回 running，不终止命令 |

对读取工具，只有最终完整展示给模型的范围可作为观察记录，不把因渲染预算再次截断的内容算作已读。文件大小、参数大小和模型请求窗口是不同限制，不能因为 Host 允许 1 MiB 写入就保证模型能一次生成该大小内容。

## 9. 错误、取消与重试约定

| 错误码示例 | 含义 | 模型下一步 |
| --- | --- | --- |
| `INVALID_ARGUMENT` / `TOOL_NOT_AVAILABLE` | 参数不合法或本会话没有工具 | 调整参数或明确能力不足 |
| `ACCESS_DENIED` / `SANDBOX_DENIED` | 访问不在当前策略内 | 申请具体权限，或解释停止；不换工具绕过 |
| `APPROVAL_REJECTED` / `INPUT_UNAVAILABLE` | 人工决定拒绝或无法获得输入 | 停止依赖该决定的动作 |
| `SANDBOX_UNAVAILABLE` / `UNSUPPORTED_POLICY` | 无法落实系统限制 | 不启动命令，报告缺失能力 |
| `FILE_NOT_OBSERVED` / `FILE_VERSION_CONFLICT` | 未读或文件已变化 | 重新读取并生成修改 |
| `PATCH_MATCH_COUNT_MISMATCH` | 匹配数量不符 | 读取相应范围，不模糊替换 |
| `FILE_TOO_LARGE` / `UNSUPPORTED_ENCODING` | 专用文件工具不支持 | 选择受控替代方案或说明限制 |
| `WORKSPACE_BUSY` | 活动命令占用文件修改执行位 | 读取结果、等待或取消命令 |
| `EXECUTION_NOT_FOUND` / `CURSOR_EXPIRED` | 旧执行或游标不可用 | 查询当前会话，不使用其他会话 ID |
| `OUTPUT_LIMIT_EXCEEDED` / `ARTIFACT_UNAVAILABLE` | 输出不完整或不可取得 | 缩小查询范围，不能断言不存在相关内容 |

读取类暂时故障可做有次数和时间上限的重试；文件修改、命令启动和其他副作用工具不得因网络断流、日志失败或未知状态自动重放。工具调用去重按 Host 分配的调用身份和参数摘要进行，不能仅按模型生成的 ID 跨请求去重。

取消是协作取消加执行器清理。文件发布前取消不得发布，发布后不能撤回已成功事实；进程取消需要结束受管理进程树。Host 停止时所有等待审批、等待用户、查询等待和命令任务都进入一致终态。崩溃期间结果未提交的调用恢复为 interrupted/unknown，先核对状态再继续。

## 10. 界面与跨端协议

| 工具族 | 桌面展示 | CLI 展示 |
| --- | --- | --- |
| 目录与搜索 | 可展开文件列表、匹配行和定位入口 | 路径及行号，截断/不完整提示 |
| 读取 | 文件路径、范围、版本和内容 | 有行号的片段 |
| 写入与补丁 | 新文件/修改 diff、提交或冲突状态 | 变更摘要及可选 diff |
| 命令 | 命令、cwd、沙箱状态、输出流、退出码和取消按钮 | 命令与状态行，流式输出及取消入口 |
| 计划 | 当前计划列表及版本 | 紧凑列表 |
| 用户问题 | 可回答表单 | 交互输入；非交互模式明确失败 |
| 审批 | 独立权限卡片，显示实际操作和范围 | 独立权限提示，不混为普通提问 |

新增 Host 方法提议：`question/respond`。进程列举、读取和取消服务同时供 UI 使用；UI 不伪造模型 tool call，其控制操作记录为 user 来源。所有请求都从已认证的 Host 通道派生会话归属，不能因知道 executionId 就操作另一个会话。

运行状态新增 `waiting_input`。pending 工具展示、输出 delta 和进程进度可为临时事件；权限、提问答复、规范工具结果、计划和进程终态持久化。UI 重放只读取已保存的展示数据，不为渲染历史再次读取当前文件或运行命令。

## 11. 两个任务示例

### 11.1 创建 HelloWorld 页面

用户请求：“创建一个 HTML 文件，打开后显示 HelloWorld！！！”

1. 必要时 `fs.list` 确认工作区；不为简单单文件任务强制创建计划。
2. `fs.write` 使用 create，文件名为 `index.html`，内容为完整 HTML。
3. 若文件已存在，返回 `FILE_ALREADY_EXISTS`；Agent 读取已有文件，再判断如何修改，不直接覆盖。
4. 成功后 `fs.read` 检查实际文件内容，回复文件路径及打开方式。
5. 没有浏览器验证时只报告文件已生成并检查内容，不报告“视觉效果测试通过”。

模型调用示例：

```json
{
  "name": "fs_write",
  "arguments": {
    "path": "index.html",
    "mode": "create",
    "content": "<!doctype html>\n<html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>HelloWorld</title><h1>HelloWorld！！！</h1></html>\n"
  }
}
```

### 11.2 修改项目并运行较长测试

用户请求：“把登录页改成深色主题，运行测试并修复失败。”

1. `task.update_plan` 记录检查、修改、验证三项。
2. `fs.find` 定位登录页，`fs.search` 查找相关样式，`fs.read` 获取完整修改区间和版本。
3. `fs.apply_patch` 提交精确修改，任何版本变化都要求重新读取。
4. `process.exec` 启动适合该系统的测试命令；在已授予范围内直接执行，需要额外范围先审批。
5. 1 秒后未结束返回 running；Agent 使用 `process.read` 等待和读取，必要时 `artifact.read` 查看更早的失败输出。
6. 命令结束后再编辑；每轮重新获取可能被测试程序修改过的文件版本。
7. 记录测试退出码和失败详情。达到预算仍未解决时如实报告未完成项，不把计划全标 completed。
8. 最终回答前确认无剩余命令，再报告改动、验证结果和限制。

## 12. 模块组织与插件接口

```text
packages/tools/              注册表、Schema、调度、结果和模型/UI 投影
packages/permissions/        权限决策、审批、策略版本和单次授权
packages/sandbox/            平台后端及策略能力核验
packages/process-runtime/    执行 ID、受管理进程、输出游标和清理
packages/storage-local/      Session、文件观察辅助状态和产物存储
plugins/tools-files/         fs.list/find/search/read/write/apply_patch
plugins/tools-shell/         process.exec/read/list/cancel
plugins/tools-task/          task.update_plan
plugins/tools-interaction/   user.ask
plugins/tools-artifacts/     artifact.read
```

这是逻辑职责，可在实现初期合并小包。Agent Runtime 通过接口调用，不依赖 Electron 或 CLI；桌面和 CLI 组装同一套工具实现。插件使用相同注册与执行协议，内置规则由 Host 强制落实。可信同进程插件仍属于宿主信任范围，不因经过 SDK 就获得恶意代码隔离保证。

## 13. 验收与未决细节

| 编号 | 验收要求 |
| --- | --- |
| T01 | ChatBot 看不到且不能通过伪造调用执行 Agent 工具；内部名与模型名唯一映射。 |
| T02 | 不完整或未知参数、超限内容、伪造身份和授权字段均在执行前拒绝。 |
| T03 | list/find/search 的忽略规则、空结果、权限范围和不完整状态可区分；搜索进程不能绕过读取策略。 |
| T04 | 分段读取、长行、UTF-8 边界和输出二次截断不产生虚假的已读记录。 |
| T05 | create 不覆盖并发创建文件；replace 拒绝未完整读取和陈旧版本。 |
| T06 | 补丁数量不符、匹配重叠或版本不符时整个单文件不变；跨文件部分成功有记录。 |
| T07 | 执行启动失败、普通非零退出、沙箱拒绝和沙箱不可用的结果互不混淆。 |
| T08 | yield 超时保持进程运行，运行 timeout 触发清理；三平台分别验证子进程终止。 |
| T09 | UI 与模型分别读取输出不互相消耗游标，重复读取和截断缺口均可观察。 |
| T10 | 活动命令阻止冲突写入；列举、读取和取消均限制在所属 Session。 |
| T11 | 计划的版本冲突、恢复和跨 turn 保留可验证；计划完成不伪造工具成功。 |
| T12 | 问题回答去重、过期和非交互失败可验证；普通回答不能生成执行授权。 |
| T13 | 产物 ID 不能越权访问任意文件，敏感副本和权限收紧规则同样生效。 |
| T14 | 结果渲染失败、持久化失败和退出中断保留已知效果或 unknown，不自动重放副作用。 |
| T15 | 两个任务示例通过假 Provider 的完整执行测试，少量真实模型验证参数可用性。 |

网络授权、产物保留和清理合同已细化到[沙箱与交付设计](2026-11-02-praxis-sandbox-delivery-design.md)，输入/取消/恢复见[执行核心](2026-11-02-praxis-runtime-session-design.md)。实施计划仍需锁定 JSON Schema 校验器及 Provider 支持子集、三平台搜索依赖、最低系统版本/架构和原生后端参数。本文给出的数值和工具名称可在设计评审中调整；未完成原生系统测试前不能宣称三平台沙箱已实现。

MCP 另有 M01–M20 验收，覆盖外部协议、按需定义、凭据、目录变化和未知效果；不把核心工具 T01–T15 通过当作 MCP 已验证。
