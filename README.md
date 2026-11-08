# Coverwall · 歌单封面墙

**在线使用 / Live:** https://getawaycar1024.github.io/Coverwall/

把 Spotify 歌单变成一面专辑封面墙：每张封面只出现一次，面积随该专辑在歌单中的曲目数（或手动权重）变化，排列随机但始终是一个连通、对称的整体。

Turn a Spotify playlist into an album cover wall: every cover appears once, sized by its track count (or a manual weight), randomly arranged into one connected, symmetric shape.

纯前端（原生 JavaScript + Vite），无后端。界面支持中文 / English 切换。

## 功能 / Features

- 从 Spotify 导入：歌单、专辑、歌曲、艺人链接，可一次粘贴多个、混合粘贴（OAuth PKCE，浏览器端，无需 client secret）
- 形状预设：经典（近似长方形）、爱心、圆形、菱形、六边形
- 打乱排列；同一随机种子总是得到同样的结果
- **合并相似专辑**：同一艺人的不同版本（Deluxe、Remastered、Anniversary…）按标题或封面相似度识别并合并，曲目数相加；合并后可在编辑面板选择使用哪个版本的封面，也可以拆分回去
- 手动调整权重、隐藏专辑、撤销 / 重做
- 导出 PNG（约 2400 px 宽，空白处透明）；保存 / 载入布局 JSON
- 不登录也能用示例歌单体验全部功能

## 本地运行 / Development

需要 Node.js 18+。

```bash
npm install
npm run dev      # http://127.0.0.1:5173/
npm test         # 排版与合并逻辑测试
npm run build    # 构建到 dist/
```

请使用 `http://127.0.0.1:5173/` 而不是 `localhost`，Spotify 不接受 `localhost` 作为 Redirect URI。

## 导入 / Import

在输入框粘贴任意 Spotify 链接（或 `spotify:` URI），可以多个、混合：

| 链接 | 导入方式 |
|---|---|
| 自己创建或协作的歌单 | 读取全部歌曲，按专辑聚合 |
| 他人的歌单 | Spotify 不开放内容（见下），会提示改用下面的复制粘贴方式 |
| 歌曲（可多首） | 逐首查询，按专辑聚合 |
| 专辑（可多张） | 每张专辑按其总曲目数计入 |
| 艺人 | 该艺人的所有专辑 |

**导入别人的歌单**：自 2026 年 2 月起，开发模式的应用只能读取用户自己创建或协作的歌单内容，这一点无法绕过。替代方法：在 Spotify 桌面版打开该歌单，按 Ctrl/⌘+A 全选、Ctrl/⌘+C 复制（得到每首歌的链接），然后：

- 直接粘贴到 Coverwall 导入（逐首查询，歌曲多时较慢），或
- 粘贴（Ctrl/⌘+V）到你自己的新歌单，再导入那个歌单（更快）。

## Spotify 登录

只有导入需要登录。点击“导入”时若未登录，会跳转到 Spotify 授权，回来后自动继续导入。

项目内置了 Client ID（`src/spotify.js`，可在构建时用 `VITE_SPOTIFY_CLIENT_ID` 覆盖）。PKCE 流程中 Client ID 是公开信息，不是密钥。用户也可以在页面上改用自己的 Client ID（只保存在本地浏览器）。

Spotify 开发模式的限制：

- 只有在 Developer Dashboard → **User Management** 中添加的账号可以登录；
- 只能读取当前用户创建或协作的歌单内容（专辑、歌曲、艺人不受此限制）；
- 请求配额较小，遇到限流（HTTP 429）时会按 `Retry-After` 自动等待重试；
- 每个部署地址都要加入 **Redirect URIs**，例如 `http://127.0.0.1:5173/` 和 `https://getawaycar1024.github.io/Coverwall/`。

## 排版算法 / Layout

`src/layout.js`：

1. 每张专辑是一个正方形，边长与权重的平方根成正比；
2. 生成目标轮廓：经典模式为接近正方形的矩形（可在底部两角或四角挖去相同缺口），预设模式为按面积缩放的爱心 / 圆形 / 菱形 / 六边形栅格；
3. 逐格填充，优先放置“落后于整体进度”的尺寸，使大封面均匀分布；个别封面可以 ±1～2 格补缝，并用有限回溯搜索寻找完美填充；
4. 按最终外形打分（内部空洞、不对称、偏离轮廓都会扣分），不连通的结果直接淘汰，并有一个保证连通的兜底排法。

## 目录结构

- `src/layout.js` 排版算法与形状预设
- `src/merge.js` 相似专辑识别（标题归一化 + 封面差异哈希）与合并 / 拆分
- `src/spotify.js` PKCE 登录、token 刷新、歌单 API
- `src/export.js` PNG 导出
- `src/i18n.js` 中英文文案
- `src/icons.js` 界面线性图标
- `src/main.js` 界面与交互
- `public/` 应用图标（`icon.svg` 为唯一源文件）与 Web App Manifest
- `test/` `node --test` 测试

## 许可 / License

代码以 [MIT License](LICENSE) 开源。

MIT 许可只覆盖本项目的代码。专辑封面的版权归各自所有者：导出的图片包含 Spotify 提供的封面，请仅用于个人用途，并遵守 Spotify 与版权方的条款。本项目与 Spotify 无隶属关系。

The code is released under the [MIT License](LICENSE). The license covers the code only — album artwork belongs to its respective owners. Not affiliated with Spotify.
