export const CLI_HELP = `知行 Praxis

pnpm cli doctor
pnpm cli run --workspace /path/to/project [--prompt "任务"] [--resume SESSION_ID]
pnpm cli sessions
pnpm cli providers
pnpm cli plugins [list|inspect PATH|install PATH --digest SHA256|enable ID|disable ID]
pnpm cli mcp [list|import FILE|test ID|enable ID|disable ID|remove ID]
pnpm cli mcp list-prompts SESSION_ID SERVER_ID
pnpm cli mcp preview SESSION_ID SERVER_ID NAME --arguments '{"topic":"Hello"}'
pnpm cli run --resume SESSION_ID --apply-prompt PREVIEW_ID --content-hash HASH --provider PROVIDER_ID

配置 PRAXIS_SERVER_URL 和 PRAXIS_API_KEY；厂商 Key 在统一 Provider 设置中填写。
插件命令：--command 插件ID/命令名 [--arguments JSON]。
交互命令：/commands、/command 插件ID/命令名 JSON、/cancel、/steer 内容、/queue 内容、/exit。
MCP 凭据：mcp auth SERVER_ID / mcp clear-auth SERVER_ID；Token 通过 PRAXIS_MCP_BEARER 一次性输入。
run --mcp-bearer-server SERVER_ID 在当前运行设置凭据、检查并启用服务器，适用于临时内存凭据。
OAuth：mcp oauth SERVER_ID --issuer URL --client-id ID --redirect-uri http://127.0.0.1:4319/oauth/callback --scopes "docs:read"。
回调须事先注册；--no-browser 输出本机浏览器链接，--allow-private-issuer 明确允许此 issuer 的私网地址。
run --mcp-oauth-server SERVER_ID 加上上述 OAuth 参数，在当前前台运行授权、检查并启用，退出即停止。
MCP：/mcp-prompts SERVER_ID、/mcp-preview SERVER_ID {"name":"模板","arguments":{}}、/mcp-apply PREVIEW_ID HASH [queue|steer]。
预览只读取模板；检查完整 text 后再明确应用。Ctrl-C 请求取消，再按一次退出。`;
