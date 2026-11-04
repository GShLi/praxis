# 知行 Praxis 图标

采用用户选定的第一版：米白色「P」延伸为向上的路径，琥珀色方块代表目标完成，置于炭黑色圆角底板上，呼应“从思考到行动”。保留透明外边距，以便在不同系统的启动器中保持合适的视觉尺寸。

- `praxis-icon-source.png`：内置 imagegen 生成的原始图像，保留透明通道。
- `praxis-icon.png`：1024 × 1024 主图标，供 Linux 打包使用。
- `praxis.icns`：macOS 多分辨率应用图标。
- `praxis.ico`：Windows 16–256px 多分辨率应用图标。
- `../../apps/web/public/` 中的 32px、192px、512px PNG：浏览器标签、共享品牌组件与桌面窗口使用。

生成日期：2026-11-04。使用内置 imagegen，不使用外部 API Key。生成图作为原始素材；平台文件仅缩放、封装，不重新绘制。

在 macOS 上更新原图后运行 `pnpm icons:build`。该命令使用系统 `sips`、`iconutil`，并生成保留透明度的 PNG-in-ICO。派生文件一并提交，日常 Windows/Linux 构建无需安装图像工具。

## 最终生成提示词

```text
Use case: logo-brand. Create one finished desktop application icon for 知行 Praxis, a thoughtful local AI coding agent. A single original geometric monogram combining a lowercase p with an upward/rightward step or pathway, expressing thought becoming action. Restrained, confident, highly legible at 32px. A warm ivory sculptural ribbon glyph centered on a near-black charcoal rounded-square tile, with one small warm amber square at the path's endpoint. Flat vector-like geometry, precise consistent optical weight, very subtle material depth only, generous negative space. The tile occupies approximately 84 percent of a square 1024x1024 canvas and is centered, leaving a truly transparent outer margin. Crisp silhouette and rounded corners suitable for macOS, Windows and Linux launchers. No lettering or words, no mockup, no device, no background scene, no grid, no variants, no AI sparkle, no robot head, no neural network, no OpenAI knot. Deliver only the single high-resolution icon with alpha transparency outside the tile.
```
