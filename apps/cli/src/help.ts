export const CLI_HELP = `知行 Praxis

pnpm cli doctor
pnpm cli run --workspace /path/to/project [--prompt "任务"] [--resume SESSION_ID]
pnpm cli sessions
pnpm cli providers
pnpm cli plugins [list|inspect PATH|install PATH --digest SHA256|enable ID|disable ID]
pnpm cli mcp [list|import FILE|test ID|enable ID|disable ID]
pnpm cli mcp list-prompts SESSION_ID SERVER_ID
pnpm cli mcp preview SESSION_ID SERVER_ID NAME --arguments '{"topic":"Hello"}'
pnpm cli run --resume SESSION_ID --apply-prompt PREVIEW_ID --content-hash HASH --provider PROVIDER_ID

配置 PRAXIS_SERVER_URL 和 PRAXIS_API_KEY；厂商 Key 在统一 Provider 设置中填写。
插件命令：--command 插件ID/命令名 [--arguments JSON]。
交互命令：/commands、/command 插件ID/命令名 JSON、/cancel、/steer 内容、/queue 内容、/exit。
MCP：/mcp-prompts SERVER_ID、/mcp-preview SERVER_ID {"name":"模板","arguments":{}}、/mcp-apply PREVIEW_ID HASH [queue|steer]。
预览只读取模板；检查完整 text 后再明确应用。Ctrl-C 请求取消，再按一次退出。`;
