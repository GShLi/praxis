# Shared UI

Web 与桌面端共用 React UI，应用通过 `PraxisClient` 注入运行环境能力。

## 表单与控件

`src/styles/form-controls.css` 管理共享控件的视觉规则，最后由 `src/styles.css`
导入，以覆盖页面历史样式。页面 CSS 继续负责布局、宽度和组合关系。

- 标准输入框、下拉框、文本域：1px 实线边框、8px 圆角、最小高度 40px、14px 字号。
- 主要操作使用 `.primary-button` 实心按钮；次要操作使用 `.secondary-button`
  outline 按钮；危险操作使用 `.danger-button` 或 `.secondary-button.danger`。
- 键盘聚焦显示 2px 焦点环。错误字段设置 `aria-invalid="true"`，并提供关联错误说明；
  原生校验使用 `:user-invalid`，避免未操作时把必填字段标红。
- 禁用字段和按钮使用弱化背景与不可操作光标；只读字段仍保留可读文字。
- 搜索框和对话输入区由外层绘制边框与焦点环，内部编辑器不重复绘制。
  对话输入区保留 16px 字号和多行布局；复选框、单选框保持原生小尺寸。
- 图标按钮、文字操作和分段选择器保留各自语义，不能为统一外观全部改成实心按钮。

优先调整 `--control-*` 变量，不在新增页面重复定义控件边框和状态。
使用同一套规则适配浅色、深色、系统高对比度及减少动态效果偏好。

## 验证

在项目根目录运行：

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx scripts/build.ts
PRAXIS_UI_BROWSER_TESTS=1 node --import tsx --test tests/ux-visual.test.ts
```

浏览器验证使用独立临时 Electron 配置，检查 980px / 360px 视口下的浅色、深色控件、
聚焦、禁用和错误状态；不读取真实账号或调用模型。须在可启动 Electron 的环境运行。
