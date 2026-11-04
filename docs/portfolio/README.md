# Praxis 项目介绍与高清素材

- `praxis.json`：可导入 folio-nest 的单项目对象，包含 12 个内容章节、8 张界面图和品牌封面。
- `images.json`：图片原名、尺寸、SHA-256 与已验证 CDN 地址的映射。
- 本地截图：`out/portfolio/01-web-chat.png` 至 `08-file-diff.png`，均为 **2880 × 1920**。
- 封面 / 缩略图：`assets/portfolio/praxis-cover.png`，**1536 × 1024**；生成提示词见该目录 README。

## 导入 folio-nest

依据 `GShLi/folio-nest` 的 `public/content/project.schema.json` 和 `src/content/schema.ts`，参考提交 `6e15171bb9ebf6bea9e5d46de7f4309d773779f9`。已使用其真实 `projectSchema` 及合并后的 `parsePortfolio` 验证，包含分类存在、章节 ID 唯一和首页精选数量约束。

将 `praxis.json` 对象加入 folio-nest 的 `content/portfolio.json` 的 `projects` 数组；若已有 `slug: praxis`，替换对应对象。使用已有 `web` 分类，`featured: false` 不争用当前首页精选。`status: published` 表示作品页可展示，不代表 Praxis 软件已正式生产发布。然后在 folio-nest 项目运行 `pnpm content:validate` 和其正常构建流程。本任务未修改或部署 folio-nest 网站。

## 展示内容

| 文件                    | 场景                                  |
| ----------------------- | ------------------------------------- |
| 01-web-chat.png         | 官网定位、文案与首页结构的多轮讨论    |
| 02-web-code.png         | 响应式 CSS 代码、断点说明与代码块复制 |
| 03-model-providers.png  | 三家供应商、模型容量与默认模型管理    |
| 04-desktop-agent.png    | 本地工作区、任务概览和开发结果        |
| 05-desktop-approval.png | 创建发布检查清单的单次审批            |
| 06-mcp-connections.png  | 两项 MCP 配置与启用状态               |
| 07-dark-chat.png        | 深色主题下的多轮对话                  |
| 08-file-diff.png        | CSS 历史差异、新增行和删除行          |

演示数据包含虚构的林知遥账户、山岚工作室、八个会话、三家供应商的八个模型和两项 MCP 配置。真实组件通过只读 `PraxisClient` 渲染，不访问账户服务、模型、工作区或远端 MCP。任务状态、耗时与工具结果是展示数据，不是验收证据。截图在独立临时 Electron profile 中完成，HTTP/HTTPS 请求被阻止；未改变真实用户的偏好或数据。

## 重新截图与上传

在 Praxis 根目录执行：

```sh
node --import tsx scripts/portfolio/capture.ts
node --import tsx scripts/portfolio/upload-images.ts --dry-run assets/portfolio/praxis-cover.png out/portfolio/*.png
node --import tsx scripts/portfolio/upload-images.ts assets/portfolio/praxis-cover.png out/portfolio/*.png
```

截图调用已有 Electron/React 实现，CSS 视口 1440 × 960，像素密度 2。上传使用本机全局 **PicGo 3.2.0**，读取 `~/.picgo/config.json` 的七牛配置到权限受限的临时文件，使用完删除，不修改默认配置。SDK 实例的上传请求转为 HTTPS。目标固定为 bucket `doublefloat`、目录 `folio-nest/praxis/`、域名 `https://cdn.doublefloat.cn`；没有保存 Key 或 Token 到项目中。

上传文件以内容 SHA-256 命名。输出地址前校验公网 HTTPS 图片与本地 PNG 的字节完全一致。重新截图若内容变化会得到新地址，需同步更新项目 JSON 和图片清单；脚本不会删除旧图片。

## 验证记录

- `pnpm typecheck`、`pnpm structure` 和 `tests/portfolio-showcase.test.ts` 通过。
- 8 个场景真实浏览器截图完成，无页面横向溢出；全部截图已逐张视觉检查。
- 9 张图片通过 PicGo 上传，公网响应与本地文件字节一致。
- 项目对象和合并到参考作品集后的整体约束均验证通过。
- 发行验收与正式签名限制详见 `../releasing.md`，与虚构展示数据分开记录。
