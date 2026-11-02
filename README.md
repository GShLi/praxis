# 知行 Praxis

使用 TypeScript 开发的 ChatBot 与本地 Agent 应用。

- Web：纯对话 ChatBot。
- 桌面端：ChatBot 与本地 Agent。
- CLI：本地 Agent。
- 模型配置统一管理，桌面端和 CLI 直连模型厂商。
- 本地任务随应用退出停止，Session 保留历史，用户显式继续。
- Agent 工具采用真实操作系统沙箱，预期覆盖 macOS、Windows、Linux。

## 当前状态

已完成第一版核心模块与 MCP 的详细设计，正在进入开发准备。当前仓库尚无应用实现、依赖安装或可启动命令；不把设计目标视为已实现能力。

设计入口：[文档索引](docs/README.md)。[UI 基线](docs/superpowers/specs/2026-11-03-praxis-ui-design.md)参考 ChatGPT、Codex，保留 Praxis 的产品名称和模式边界；[开发计划](docs/superpowers/plans/2026-11-03-praxis-development-plan.md)规定工程基座、核心闭环、三端交付及平台验证的顺序。

## 开发与提交

在本目录维护独立 Git 仓库。使用开发者本机已有 Git 身份，不在项目配置中覆写作者或提交者。完成一个可验证的功能、修复或文档阶段后及时提交；提交说明包含具体变更及必要验证，未完成的能力保持明确状态。

不要提交密钥、真实用户会话、数据库、日志、生成产物或本机配置。示例只保存无秘密的配置模板。跨平台沙箱和进程清理必须逐平台验证。
