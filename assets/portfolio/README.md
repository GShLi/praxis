# Praxis 作品集封面

`praxis-cover.png` 是作品集缩略图 / 封面，1536 × 1024，3:2。它采用用户确认的第一版 P 路径图标；不是产品界面截图。实际界面由 `scripts/portfolio/capture.ts` 使用真实 React 组件与虚构演示数据截取，输出到 `out/portfolio/`。

生成方式：Codex 内置 imagegen；参考图为 `assets/branding/praxis-icon-source.png`。没有调用外部 CLI，也没有使用模型厂商 Key。

最终提示词：

> Use case: logo-brand. Asset type: premium project portfolio cover / thumbnail for 知行 Praxis, landscape 3:2, high resolution. Reference image is the selected official Praxis app icon: retain its ivory P/upward path and amber square on charcoal rounded tile faithfully; no Chinese-character replacement. Design a refined editorial brand cover, warm ivory backdrop with a subtle thin graphite baseline/grid and one restrained amber accent. Large official app icon as the hero on the left, crisp refined black typography on the right. Exact text only: "知行 Praxis" and beneath in smaller letters "From thought to action", then small "Chat · Code · Create". Plenty of breathing room, balanced 3:2 layout, all essential text and icon within center 80% safe area for cropped portfolio cards. Slight material depth only on the icon; overall quiet, precise and contemporary. This is a brand thumbnail, not a screenshot: do not invent app UI, dashboards, metrics, browser frames or product capabilities. No watermark, no neon gradients, no floating random ornaments.
