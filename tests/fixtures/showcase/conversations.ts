import type { Snapshot, ViewMessage } from '@praxis/ui/client';

function chat(id: string, title: string, turns: string[], day: number): Snapshot {
  return {
    session: {
      id,
      title,
      kind: 'chat',
      status: 'completed',
      createdAt: `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`,
    },
    throughSeq: 0,
    turnId: null,
    messages: turns.map(
      (content, index): ViewMessage => ({
        id: `${id}-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content,
      }),
    ),
  };
}

/** Authored conversations, not model output or evidence of actual client work. */
export const conversations: Snapshot[] = [
  chat(
    'showcase-chat',
    '山岚工作室 · 官网策划',
    [
      '我们来为虚构的「山岚工作室」策划一个官网。团队专注品牌、空间与数字体验，希望访客先看到作品，再了解合作方式。整体安静、有留白，但不要显得空。',
      `## 让作品成为第一句话

建议以 **「让想法，在日常里发生。」** 为首页主张。用真实的设计过程建立信任，而不是堆叠服务标签。

| 页面 | 访客的问题 | 内容重点 |
| --- | --- | --- |
| 首页 | 你们做什么？ | 一句主张、精选作品、合作入口 |
| 作品 | 是否适合我的项目？ | 背景、设计决策与交付范围 |
| 关于 | 会和谁一起工作？ | 小团队介绍、方法与价值观 |
| 联系 | 如何开始？ | 项目类型、时间与联系邮箱 |

> 以下项目、客户和团队均为作品集演示设定。

视觉方向：纸白、墨绿、温暖的灰；大标题配克制的正文，不使用自动轮播。`,
      '首页用三个项目：茶品牌「一叶」、社区书店「慢读」、山间民宿「听松」。请把模块顺序和首屏文案收束一下。',
      `### 首页内容骨架

1. **首屏** — 让想法，在日常里发生。\n   山岚是一间独立设计工作室，连接品牌、空间与数字体验。
2. **精选作品** — 一叶 / 慢读 / 听松，各用一句话说明设计问题。
3. **合作方式** — 从理解问题，到共同落地。
4. **联系** — 有一个想法？我们一起聊聊。

按钮建议：**浏览作品**（主）与 **开始合作**（次）。移动端先保留标题和作品入口，避免首屏信息过密。`,
      '好，最后给我一版可以直接交给设计师的简短首页摘要。',
      `### 山岚 · 首页交接摘要

**让想法，在日常里发生。**\n一间连接品牌、空间与数字体验的独立设计工作室。

| 模块 | 内容 | 交互 |
| --- | --- | --- |
| 精选作品 | 一叶 · 慢读 · 听松 | 查看项目 |
| 合作方式 | 理解 → 设计 → 落地 | 了解流程 |
| 联系我们 | 从一个想法开始 | 开始合作 |

首屏保留留白，作品采用 **3 / 2 / 1 列**响应式布局。下一步：实现首页骨架与键盘焦点样式。`,
    ],
    4,
  ),
  chat(
    'showcase-code',
    '山岚工作室 · 响应式首页',
    [
      '延续山岚官网的方向，用 React + CSS 实现精选作品区。希望桌面三列、平板两列、手机一列；卡片本身是链接，键盘也能使用。此处只讨论代码，不执行文件操作。',
      `建议使用语义化列表和普通链接，避免给整张卡片绑定 click 事件。

\`\`\`tsx
type Project = { slug: string; title: string; discipline: string };

export function ProjectCard({ project }: { project: Project }) {
  return (
    <li>
      <a className="project-card" href={\`/work/\${project.slug}\`}>
        <h3>{project.title}</h3>
        <p>{project.discipline}</p>
        <span aria-hidden="true">↗</span>
      </a>
    </li>
  );
}
\`\`\`

项目数据与组件分开；图片提供宽高，避免加载时布局跳动。`,
      '移动端不要横向溢出，给链接加明显的键盘焦点。动效只要很轻的变化。',
      `可以使用 \`minmax(0, 1fr)\` 避免长标题撑破网格，并让焦点轮廓独立于 hover。

\`\`\`css
.project-card {
  display: block;
  color: inherit;
  text-decoration: none;
  transition: color 160ms ease;
}
.project-card:hover { color: #35594b; }
.project-card:focus-visible {
  outline: 2px solid #35594b;
  outline-offset: 6px;
}
@media (prefers-reduced-motion: reduce) {
  .project-card { transition: none; }
}
\`\`\`

验收时用 Tab 依次访问三个作品，再用 Enter 打开；长标题与 200% 缩放都需要检查。`,
      '请只留下最终的网格 CSS 和断点说明，方便对照实现。',
      `### 精选作品 · 响应式网格

\`\`\`css
.project-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  padding: 0;
  list-style: none;
}
@media (max-width: 960px) {
  .project-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .project-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
}
\`\`\`

**桌面 3 列 · 平板 2 列 · 手机 1 列。** 保留原生链接和可见焦点，不增加额外键盘脚本。`,
    ],
    4,
  ),
  chat(
    'showcase-copy',
    '山岚工作室 · 品牌文案',
    [
      '为虚构作品「一叶」写一个案例开场：它是一家社区茶铺，设计范围是品牌识别、包装和菜单。不要编造销售增长。',
      `### 一叶 · 把喝茶还给日常

一叶希望成为街角那间随时可以走进的茶铺。我们从茶叶展开的姿态寻找线索，用柔和的绿色、自然纸张与清晰的信息层级，让选择一杯茶变得轻松。

**设计范围**：品牌识别 / 包装系统 / 店内菜单。

不使用未经证实的经营数字，重点展示标签的阅读顺序、不同茶类的区分方式，以及纸张与印刷的选择。`,
      '再缩短成首页卡片和项目页导语两个长度。',
      `| 使用位置 | 建议文案 |
| --- | --- |
| 首页卡片 | 一叶 · 把喝茶还给日常 |
| 项目页导语 | 从一片茶叶出发，为街角茶铺建立轻松、清晰的品牌体验。 |
| 范围标签 | 品牌识别 · 包装 · 菜单 |

三种长度共享一个主题，避免首页与案例页重复长段文字。`,
    ],
    3,
  ),
  chat(
    'showcase-accessibility',
    '山岚官网 · 无障碍清单',
    [
      '官网以作品图片为主。请帮我做一份实际可操作的无障碍检查表，尤其是键盘导航、图片替代文本和减少动效。',
      `## 从完整浏览路径开始

- 从页首按 Tab，检查导航、作品与联系链接的顺序。
- 给正文增加跳转入口；焦点不能被固定导航遮住。
- 描述传递信息的图片，纯装饰图使用空 \`alt\`。
- 表单标签始终可见；错误提示关联到对应字段。
- 开启系统「减少动态效果」，确认滚动与过渡仍可使用。

这些是待执行检查，不代表网站已经通过任何合规认证。`,
      '用我们的三个案例举例，给设计和开发各一个明确交接点。',
      `| 案例 | 图片替代文本示例 | 交接检查 |
| --- | --- | --- |
| 一叶 | 绿色茶罐与标注茶类的纸质标签 | 包装信息不只依赖颜色 |
| 慢读 | 书店入口与可移动阅读书架 | 正文保留清晰标题层级 |
| 听松 | 木质客房窗框外的松林 | 图片说明与装饰图区分 |

**设计**：标注焦点与错误状态。\n**开发**：按键盘路径逐项记录结果，未测项保持「待验证」。`,
    ],
    3,
  ),
  chat(
    'showcase-content',
    '山岚工作室 · 内容模型',
    [
      '三个作品以后会继续增加。请设计一个简单的 TypeScript 内容模型，先用本地静态数据，不接 CMS。',
      `把用于列表的信息与案例详情分开，首版只保留当前会展示的字段。

\`\`\`ts
type Discipline = '品牌' | '空间' | '数字体验';
interface Project {
  slug: string;
  title: string;
  summary: string;
  disciplines: Discipline[];
  year: number;
  cover: { src: string; alt: string; width: number; height: number };
}
\`\`\`

用 \`slug\` 建立稳定 URL；年份表示项目年份，不表示客户合作或真实商业成果。演示图片需要明确来源与使用许可。`,
      '内容编辑交接时，哪些字段必须填？给我最小检查清单。',
      `### 内容发布前检查

- [ ] \`slug\` 唯一，链接稳定。
- [ ] 标题、摘要与设计范围已确认。
- [ ] 封面含宽高和适当的替代文本。
- [ ] 图片来源与授权已记录。
- [ ] 虚构项目保持演示标识。

首版用本地数组即可。确实需要多人编辑后，再评估 CMS。`,
    ],
    2,
  ),
  chat(
    'showcase-handoff',
    '山岚官网 · 设计交接',
    [
      '把官网第一版的设计交接整理成一页：包括基础样式、组件和上线前待办。这里是演示项目，没有真实客户。',
      `### 交接包结构

1. **基础样式**：颜色、文字、间距与断点。
2. **组件**：导航、作品卡片、联系入口、页脚。
3. **页面**：首页、作品详情、关于与联系。
4. **状态**：hover、focus、空内容与图片加载失败。

每个组件说明职责和内容约束；不要仅交付静态桌面稿。`,
      '请按负责人和完成条件收尾，尽量精简。',
      `| 负责人 | 下一步 | 完成条件 |
| --- | --- | --- |
| 设计 | 补齐手机稿与焦点状态 | 关键组件各有完整状态 |
| 内容 | 确认三个虚构案例 | 摘要与图片说明齐全 |
| 开发 | 完成响应式与导航 | 三个目标宽度可浏览 |
| 共同验收 | 浏览、键盘与内容复核 | 待办逐项记录结果 |

**演示交接说明**：不包含真实客户、部署凭据或已上线承诺。`,
    ],
    2,
  ),
];
