# Praxis 实现记录

设计目标见 [开发计划](superpowers/plans/2026-11-03-praxis-development-plan.md)。此文件只记录已有实现及验证，不用设计文档的存在代替功能完成。

## 工程与协议

2026-11-03：建立 pnpm workspace、TypeScript strict、版本锁、共享 Zod 合同、JSON 行 RPC、独立 Host 和 CLI doctor。Host 支持主版本校验、实例 nonce 回传、心跳失效退出、管道断开退出及显式关闭；帧和发送缓冲有 8 MiB 上限，控制请求不等待慢业务请求完成。

本机验证：类型检查、3 个协议/子进程测试、CLI doctor 通过。依赖网络 DNS 被当前执行环境限制，使用本机 npm 缓存中的完整性校验包进行离线安装，并由 package-lock 导入 pnpm-lock；未完成联网的干净 pnpm 安装验证。验证时使用 `pnpm_config_verify_deps_before_run=false pnpm check`，避免 pnpm 对非 pnpm 安装目录自动联网重装。常规开发环境仍按 README 使用冻结锁文件安装。

测试入口使用 `node --import tsx`，避免 tsx CLI 创建不必要的本地 IPC 监听器。CI 配置覆盖 Linux、macOS、Windows 的 Node 22.15/24；配置尚未在远端运行，不代表已通过三平台验证。

## 执行核心与上下文

2026-11-03：SQLite WAL 保存 Session、输入去重、原始消息/工具结果、请求快照、版本化摘要、产物与 checkpoint。运行时实现多轮、queue/steer、安全边界、取消、工具预算、用户问题和中断恢复；工具包括版本化文件读写/补丁、目录/glob/字面量搜索、计划和产物读取。DeepSeek 适配收集完整 SSE/工具批次后才返回；流中断不重试工具。命令后端尚未接入，调用会明确拒绝。

本机类型检查及 14 项测试通过：真实 HTML 创建/修改、重复请求、陈旧版本/部分读取/补丁失败、越界链接、Chat 工具隔离、取消/挂起、未知工具恢复、事务事件发布、连续压缩与摘要失败、流式 UTF-8/参数重组和中断。测试模型通过依赖注入，仅用于测试；尚未使用真实模型 Key。搜索正则、子目录指令发现、跨进程工作区锁、原生路径竞态防护、平台执行、生产客户端接入仍需补齐。

## 尚未完成

服务端接入阶段：已增加 PostgreSQL 迁移、账号/Argon2id、短期凭据与刷新轮换、Praxis API Key、AES-GCM 厂商 Key 加密及统一配置接口；Web Chat 使用独立的 PostgreSQL 运行时和 SSE，不挂载 Agent 工具。CLI/Host 已接入平台认证、统一配置、真实 DeepSeek、多轮任务、历史继续和用户问题。进程内 HTTP 测试覆盖登录前拦截、Origin/CSRF、Web 禁止读取厂商 Key；18 项本机检查通过。PostgreSQL 查询和迁移尚未联调：执行环境禁止本地端口监听，Docker socket 访问也被拒绝。不能据此宣称服务端已完成部署验收。

执行/会话/压缩/文件工具、模型与身份、平台沙箱与进程回收、Web/桌面 UI、服务端存储、插件/MCP 及发布交付仍按开发计划继续实现。当前不开放未验证的命令执行后端。
