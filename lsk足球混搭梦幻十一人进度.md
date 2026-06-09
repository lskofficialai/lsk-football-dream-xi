# LSK 足球混搭梦幻十一人进度

更新时间：2026-06-09

## 1. 数据阶段

- Wikidata + LSK 本地增强已跑通。
- historical 数据已生成并发布到 `public/data`。
- `source = wikidata+lsk-local`。
- `strictPlayablePoolCount = 965`。
- `relaxedPlayablePoolCount = 2674`。
- `lowCandidatePoolsAfterRelaxed = 46`。
- `shortfalls` 全部为 0。
- `forbiddenKeyCount = 0`。

## 2. 当前模式

- 随机混搭挑战。
- 单一队套挑战。

## 3. 当前交互

- 先选模式，再进入对应配置：
  - 随机混搭挑战：选择阵型后进入组队。
  - 单一队套挑战：选择球队 + 阵型后进入组队。
- 选人后自动跳到下一个位置。
- 更换球队 3 次。
- 更换年代 3 次。
- 已选球员可点击换位。
- 换位会校验多位置和 `acceptedPositions`。

## 4. 当前不要再改

- 数据抓取逻辑。
- playable pool 逻辑。
- 随机逻辑。
- 模式逻辑。
- 换位逻辑。

## 5. 下一阶段

- UI / 字体 / LSK logo 风格优化。
- 结算页视觉优化。
- 海报优化。
- 移动端适配。
- 最后部署 H5 / 研究小程序联动。
