# Spotify Album Art Mosaic

把 Spotify 歌单变成一张整齐的专辑封面拼贴：每张封面只出现一次，面积随该专辑在歌单中的曲目数（或手动权重）变化，排列随机但外形规整、左右对称。

纯前端（原生 JavaScript + Vite），没有后端。

## 功能

- 通过 Spotify Playlist URL 导入歌单（OAuth PKCE，浏览器端，无需 client secret）
- 按专辑聚合曲目，默认权重 = 曲目数；同封面的专辑（如普通版 / 豪华版）自动合并
- 随机拼贴排版：大封面均匀分布，空缺只出现在对称的角落；Shuffle 一键重新打乱
- 手动调整权重、隐藏专辑、撤销 / 重做
- 导出 PNG 图片（约 2400 px 宽，角落透明）
- 保存 / 加载布局 JSON（包含随机种子，可完全还原排版）
- 不登录也可以用演示歌单体验全部编辑和导出功能

## 本地运行

需要 Node.js 18 或更高版本。

```bash
npm install
npm run dev      # 开发服务器 http://127.0.0.1:5173/
npm test         # 排版算法测试
npm run build    # 构建到 dist/
```

建议使用 `http://127.0.0.1:5173/` 而不是 `http://localhost`，Spotify 不接受 `localhost` 作为 Redirect URI。

## Spotify 登录

只有“导入歌单”需要登录 Spotify，其余功能都不需要。点击 Import 时如果尚未登录，会自动跳转到 Spotify 授权，回来后继续导入。

项目内置了一个 Client ID（见 `src/spotify.js`，也可以在构建时用环境变量 `VITE_SPOTIFY_CLIENT_ID` 覆盖）。PKCE 流程中 Client ID 是公开信息，不是密钥。

注意 Spotify 的开发模式限制：

- 应用处于 Development Mode 时，只有在 Developer Dashboard 的 **User Management** 中被添加的 Spotify 账号才能登录使用；
- Playlist Items API 只能读取当前用户创建或协作的歌单；
- 每个部署地址都需要加入应用的 **Redirect URIs**，例如：
  - `http://127.0.0.1:5173/`（本地开发）
  - `https://<用户名>.github.io/spotify-album-art-treemap/`（GitHub Pages）

想用自己的 Spotify 应用？在页面导入区点击“使用自己的 Client ID”即可（只保存在当前浏览器）。

## 部署

推送到 `main` 分支后，GitHub Actions（`.github/workflows/deploy.yml`）会运行测试、构建并发布到 GitHub Pages。构建使用相对路径（`base: "./"`），可以部署在任意子路径下。

## 排版算法

`src/layout.js`：

1. 每张专辑是一个正方形，边长与权重的平方根成正比；
2. 选取若干候选外形：接近正方形的矩形，或在底部两角 / 四个角挖去相同缺口的矩形；
3. 从左上到右下逐格填充，每一步优先选择“落后于整体进度”的尺寸，使大封面均匀分布；必要时允许个别封面大小 ±1～2 格来补缝，并用有限回溯搜索寻找完美填充；
4. 按最终外形打分（内部空洞、边缘中部凹口、左右不对称都会扣分），选出最整齐的一种；
5. 同一随机种子总是得到同样的结果。

## 关于封面与导出

导出的图片包含 Spotify 提供的专辑封面，请仅用于个人用途，并遵守 Spotify Developer Terms、Design Guidelines 以及版权方的相关条款。本项目与 Spotify 无隶属关系。

## 目录结构

- `src/spotify.js`：PKCE 登录、token 刷新、Playlist API
- `src/layout.js`：拼贴排版算法
- `src/export.js`：PNG 导出
- `src/main.js`：界面、编辑交互、历史记录、布局 JSON
- `src/style.css`：深色 UI
- `test/`：排版算法测试（`node --test`）
