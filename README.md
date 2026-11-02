# 知行 Praxis

使用 TypeScript 开发的 ChatBot 与本地 Agent 应用。

- Web：纯对话 ChatBot。
- 桌面端：ChatBot 与本地 Agent。
- CLI：本地 Agent。
- 模型配置统一管理，桌面端和 CLI 直连模型厂商。
- 本地任务随应用退出停止，Session 保留历史，用户显式继续。
- Agent 工具采用真实操作系统沙箱，预期覆盖 macOS、Windows、Linux。

## 当前状态

已建立 TypeScript workspace、共享协议、私有 stdio Host、CLI 环境诊断和基础自动测试。Agent 执行核心正在开发，尚不能据此认定第一版完整可用。阶段进度和验证限制见[实现记录](docs/implementation.md)。

设计入口：[文档索引](docs/README.md)。[UI 基线](docs/superpowers/specs/2026-11-03-praxis-ui-design.md)参考 ChatGPT、Codex，保留 Praxis 的产品名称和模式边界；[开发计划](docs/superpowers/plans/2026-11-03-praxis-development-plan.md)规定工程基座、核心闭环、三端交付及平台验证的顺序。

## 开发与提交

使用 Node 22.15+（22 系列）或 Node 24+、pnpm 11.9.0：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm cli doctor
```

`doctor` 启动独立 Host，检查协议和环境后关闭 Host。`pnpm host` 是内部 JSON 行协议入口，不是交互聊天命令。当前只验证了本机 macOS ARM64；CI 已配置三平台检查，但尚未运行远端 CI。

在本目录维护独立 Git 仓库。使用开发者本机已有 Git 身份，不在项目配置中覆写作者或提交者。完成一个可验证的功能、修复或文档阶段后及时提交；提交说明包含具体变更及必要验证，未完成的能力保持明确状态。

不要提交密钥、真实用户会话、数据库、日志、生成产物或本机配置。示例只保存无秘密的配置模板。跨平台沙箱和进程清理必须逐平台验证。
