# Praxis 实现记录

设计目标见 [开发计划](superpowers/plans/2026-11-03-praxis-development-plan.md)。此文件只记录已有实现及验证，不用设计文档的存在代替功能完成。

## 工程与协议

2026-11-03：建立 pnpm workspace、TypeScript strict、版本锁、共享 Zod 合同、JSON 行 RPC、独立 Host 和 CLI doctor。Host 支持主版本校验、实例 nonce 回传、心跳失效退出、管道断开退出及显式关闭；帧和发送缓冲有 8 MiB 上限，控制请求不等待慢业务请求完成。

本机验证：类型检查、3 个协议/子进程测试、CLI doctor 通过。依赖网络 DNS 被当前执行环境限制，使用本机 npm 缓存中的完整性校验包进行离线安装，并由 package-lock 导入 pnpm-lock；未完成联网的干净 pnpm 安装验证。验证时使用 `pnpm_config_verify_deps_before_run=false pnpm check`，避免 pnpm 对非 pnpm 安装目录自动联网重装。常规开发环境仍按 README 使用冻结锁文件安装。

测试入口使用 `node --import tsx`，避免 tsx CLI 创建不必要的本地 IPC 监听器。CI 配置覆盖 Linux、macOS、Windows 的 Node 22.15/24；配置尚未在远端运行，不代表已通过三平台验证。

## 尚未完成

执行/会话/压缩/文件工具、模型与身份、平台沙箱与进程回收、Web/桌面 UI、服务端存储、插件/MCP 及发布交付仍按开发计划继续实现。当前不开放未验证的命令执行后端。
