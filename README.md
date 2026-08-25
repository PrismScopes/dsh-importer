# dsh-importer

把 chat.deepseek.com（DeepSeek 网页版）的会话同步到 DeepSeek Harness（DSH），作为 AI 上下文使用。

## 功能

- **自动同步**：首次配置 token 后自动触发官方全量导出，导入会话清单（含真实消息数）；之后按设定间隔（2/5/10 分钟）自动检查新会话并拉取内容。
- **已拉取会话自动刷新**：远端有更新的已拉取会话会自动重新拉取，本地内容保持新鲜。
- **设置页**：DSH 设置中新增"网页版同步"分节，含三个子页面：
  - 会话列表：搜索 / 排序（最近活动、标题、消息数）/ 分页 / 按需拉取 / 行内查看（含思考过程）
  - 本地会话：已拉取内容的会话，支持"发送"（把引用本地文件的提示词填入输入框，AI 自行读取文件）、查看、删除
  - 设置：token 管理、自动同步开关与间隔、获取 token 帮助、操作记录
- **安全**：token 接口校验 Origin，只接受 chat.deepseek.com 与本机来源；token 只存节点侧。

## 安装

在 DSH web profile 中安装（本地路径方式）：

```bash
dsh plugin --profile web add link:C://path//to//dsh-importer
```

或在 `H:\dsh-data\profiles\web\package.json` 的 dependencies 加入：

```json
"dsh-importer": "link:C://path//to//dsh-importer"
```

然后重启 DSH。设置页出现"网页版同步"即安装成功。

## 使用

1. 打开 DSH 设置 → 网页版同步 → 设置，粘贴 token（获取方法见设置页帮助）。
2. 保存后自动开始全量初始化，等待完成。
3. 之后会话自动同步；在"本地会话"中点某会话行的"发送"，提示词（引用 `dsweb-sessions-<id>.json` 文件路径）会填入输入框，确认后发送，AI 通过文件读取工具直接读取完整会话内容。

## 数据文件

（相对 DSH 启动目录，沿用旧动态插件命名以便无缝迁移）

- `dsweb-token.json` — 登录 token
- `dsweb-config.json` — 开关 / 间隔 / 上次同步 / 初始化版本
- `dsweb-index.json` — 会话索引（消息数、content_fetched 标记）
- `dsweb-sessions-<id>.json` — 每个会话的完整内容

## 开发

纯 JS 双面插件，无需构建：

```bash
node --check lib/index.js && node --check lib/client.js
```

- Host half：`lib/index.js` — 网络层走 subprocess + curl（带浏览器头绕过风控），数据落盘用 fs 服务，暴露 `POST /plugins/dsh-importer/api`（body `{ action, args }`）与兼容书签的 `POST /api/dsweb/token`。
- Client half：`lib/client.js` — 惰性 CJS client bundle，填充 `settings.section` slot，通过同源 fetch 调用节点端点。

## License

MIT
