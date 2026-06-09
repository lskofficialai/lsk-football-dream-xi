# LSK 足球混搭梦幻十一人

移动端 H5 足球组队小游戏。玩家根据每轮给出的「真实俱乐部 + 现实年代 + 位置」条件挑选球员，组出 11 人阵容，并生成预测战绩、评级和分享海报。

第一版玩法只使用真实足球逻辑：

- 真实俱乐部
- 现实年代
- 多位置球员
- 位置匹配与放宽

不会把 FC Online 卡种、OVR、工资、强化、className、seasonKey 当作玩法条件。

## 本地运行

```bash
npm install
npm run dev
```

项目内保留的 fallback 数据只用于本地预览 UI，避免页面白屏。fallback 不是正式题库，也不会通过 `check:career`。

## 生成正式数据

```bash
npm run build:data
```

真实数据链路：

1. `scripts/fetch-wikidata.ts` 从 Wikidata Query Service 抓取 P54 球队效力记录，并读取 P580/P582 年份限定。
2. `scripts/normalize-players.ts` 清洗球员、俱乐部效力年份、位置和年代标签。
3. 可选读取本地 LSK 数据补全中文名和多位置，但只作为增强数据。
4. `scripts/build-squad-pools.ts` 生成 `clubKey__era__position` 候选池。
5. `scripts/check-career.ts` 检查数据质量。
6. 只有检查通过，才把 `data/generated` 发布到 `public/data`。

正式输出：

- `public/data/players.json`
- `public/data/squadPools.json`

玩家打开网页时不会访问 Wikidata，只读取这些静态 JSON。

## 数据质量闸门

`npm run check:career` 会检查：

- `source` 必须是 `wikidata` 或 `wikidata+lsk-local`
- `playersWithDatedClubHistory > 500`
- `generatedPeriodCandidates > 3000`
- `strictPoolCount > 300`
- pool key 必须是 `clubKey__era__position`
- pool key 不能包含 `25ucl`、`24ucl`、`wg`、`ws`、`dp`、`icontm`、`el`、`bdo`、`salary`、`wage`、`ovr`、`className`、`seasonKey`

如果 Wikidata 无法访问，脚本会提示：

```text
当前环境无法访问 Wikidata，请在 GitHub Actions 或可访问外网环境运行 npm run build:data。
```

此时不会把 fallback 覆盖为正式数据。

## 本地 LSK 增强数据

本地 LSK AI / FC Online 数据只用于增强：

- 中文名补全
- 多位置补全
- 常见球员名匹配

不会用于推断年代，也不会使用卡种、OVR、工资或 seasonKey。

可选环境变量：

```bash
LSK_LOCAL_DATA_DIR=/path/to/FCOnline_Player_DB/data npm run build:data
LSK_LOCAL_PLAYERS_JSON=/path/to/players_all.json npm run build:data
LSK_LOCAL_POSITIONS_JSON=/path/to/player_positions.json npm run build:data
LSK_LOCAL_SQLITE=/path/to/players.sqlite npm run build:data
```

如果这些本地文件不存在，构建会仅使用 Wikidata。

## 中国大陆网络说明

中国大陆本地环境可能无法稳定访问 `query.wikidata.org`。推荐使用 GitHub Actions 生成正式数据，再把静态 JSON 部署到 GitHub Pages。

## GitHub Actions 每日更新

`.github/workflows/update-data.yml` 每天运行：

```bash
npm install
npm run build:data
npm run check:career
npm run build
```

如果 `check:career` 不满足阈值，workflow 会失败，不会提交新的 `public/data/squadPools.json`。

## 构建与预览

```bash
npm run build
npm run preview
```

## GitHub Pages 部署

1. 推送代码到 GitHub。
2. 进入仓库 Settings -> Pages。
3. Source 选择 `GitHub Actions`。
4. 推送 `main` 分支。
5. `.github/workflows/deploy-pages.yml` 会自动构建并部署 `dist`。

`vite.config.ts` 支持 GitHub Pages 子路径：

- 本地默认 `base = "/"`
- GitHub Actions 自动使用 `/${repoName}/`
- 可用 `VITE_BASE_PATH` 手动覆盖

## package scripts

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "fetch:data": "tsx scripts/fetch-wikidata.ts",
  "normalize:data": "tsx scripts/normalize-players.ts",
  "build:pools": "tsx scripts/build-squad-pools.ts",
  "check:career": "tsx scripts/check-career.ts",
  "build:data": "tsx scripts/build-all.ts"
}
```
