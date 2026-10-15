# GPT画图 · gpthuatu

在 Codex、Claude Code 等支持本地 Skill 的 AI 工具中，用自然语言画图、改图或合图。填写自己的接口链接和 Key，即可使用兼容 OpenAI 图片协议的服务。默认模型 `gpt-image-2.5-flare`。

中文名称：**GPT画图**。英文标识：**gpthuatu**。调用：**`$gpthuatu`**。

支持 TTAPI、放心 API、OpenAI 官方及同协议服务。需要服务商支持所选模型；只提供异步任务编号或其他协议的接口需要另外适配，不是任意网址都能直接出图。TTAPI 文生图已实测成功。

## 1. 安装

需要 **Node.js 22.19+**，推荐 [Node.js 24 LTS](https://nodejs.org/)。无需 Python，也不用 `npm install`。

把下面这句话发给你的 AI 工具，让它帮助安装和配置：

> 请安装 https://github.com/metafeng/fangxin-image-gen 的 GPT画图 Skill，运行安装程序并检查配置。已有旧版时先备份，保留我的配置，只保留 gpthuatu 入口。

也可以下载仓库 ZIP 解压，或自己运行：

```bash
git clone https://github.com/metafeng/fangxin-image-gen.git gpthuatu
cd gpthuatu
node scripts/install.mjs
```

默认安装到 `~/.agents/skills/gpthuatu`，为 Codex 和 Claude Code 建立入口。重新打开 AI 工具或刷新技能列表后，选择「GPT画图」或输入 `$gpthuatu`。

只安装到一个工具：`node scripts/install.mjs --agents codex` 或 `--agents claude`。其他工具用 `--agents "" --target /absolute/path/to/skills/gpthuatu`。`--dry-run` 可预览安装计划。

## 2. 填写接口链接和 Key

### 推荐：让 AI 帮你保存

选择「GPT画图」或输入 `$gpthuatu`，告诉 AI：“帮我配置放心 API 的 Key”或“帮我配置 TTAPI 的 Key”。AI 会给你对应的获取链接；拿到 Key 后，说明来自哪一家，让 AI 保存在你电脑的私有配置里。不要在公开群聊或 GitHub 中发送 Key。

如果你只粘贴了一串 Key，AI 应先问：“这是放心 API、TTAPI、OpenAI 官方，还是其他服务商的 Key？”你回复服务商后再保存，不需要自己写变量名称。如果前文已明确来源，或你同时提供对应接口链接，就可以直接保存，不重复询问。其他服务商还需要提供接口链接和认证方式。

保存位置默认为 `~/.agents/skills/gpthuatu/.env`；自定义安装目录或配置文件时使用实际路径。AI 会将放心 Key 保存到 FANGXIN_API_KEY，TT Key 保存到 TT_API_KEY；两家可以同时保留。首次配置的一家设为默认，后续添加其他家的 Key 会保留原默认选择，除非你要求更改。

保存后，AI 会检查是否正确读入，并告诉你服务商、保存位置和结果，不回显 Key。这一步不会提交收费出图请求，也不能证明 Key 有效；你提出画图要求后再实际调用。以后只要说“用 TT 画图”或“用放心画图”即可。

### 也可以手动填写

第一次使用，在安装目录把 `.env.example` 复制为 `.env`，用编辑器填写。已有 `.env` 时直接编辑，**不要复制覆盖**。Key 只保存在自己的私有配置中，不要公开发布。

macOS/Linux 可先准备文件：

```bash
cp ~/.agents/skills/gpthuatu/.env.example ~/.agents/skills/gpthuatu/.env
chmod 600 ~/.agents/skills/gpthuatu/.env
```

Windows 在文件管理器中复制、编辑即可；路径例如 `C:\Users\用户名\.agents\skills\gpthuatu\.env`。

### 按服务商分别保存 Key

两家的 Key 可以同时放在同一个私有文件中，各填各的位置：

```dotenv
# 默认用哪家：fangxin 或 ttapi
IMAGE_API_PROVIDER=fangxin
FANGXIN_API_KEY=填写你自己的放心密钥
TT_API_KEY=填写你自己的TTAPI密钥
IMAGE_API_MODEL=gpt-image-2.5-flare
```

只用一家时，另一家的 Key 留空即可。两家都配置时，用 IMAGE_API_PROVIDER 选择默认服务商；不指定默认且存在多家 Key 时会提示选择，不猜测。只配置一家且没有旧通用配置时会自动选择该家。

| 配置名称 | 对应接口 | 自动使用的认证方式 | 获取 Key |
|---|---|---|---|
| FANGXIN_API_KEY | https://fangxinapi.com/v1 | Authorization: Bearer | [放心 API](https://fangxinapi.com/keys) |
| TT_API_KEY | https://api.ttapi.io/v1 | TT-API-KEY | [TTAPI](https://dashboard.ttapi.io) |
| OPENAI_API_KEY | https://api.openai.com/v1 | Authorization: Bearer | [OpenAI 官方](https://platform.openai.com/api-keys) |

首次使用放心 API，请点击上表链接，登录或注册后选择**支持画图模型的画图分组**，确认支持所选模型；实际支持范围以控制台为准。TTAPI 和官方账号也需要有对应模型的使用权限。

已知服务的地址、认证方式不必手动填写。OPENAI_API_KEY 使用官方服务时，设置 IMAGE_API_PROVIDER=openai；模型名称按所用账号实际支持情况填写。

### 其他兼容服务

使用自己的接口链接和 Key 时，填写：

```dotenv
IMAGE_API_PROVIDER=custom
IMAGE_API_BASE_URL=https://example.com/v1
IMAGE_API_KEY=填写这个服务商自己的密钥
IMAGE_API_MODEL=gpt-image-2.5-flare
```

地址也可以直接填完整 /v1/images/generations 链接。未知服务默认使用 Authorization: Bearer；如果文档要求专用请求头，增加：

```dotenv
IMAGE_API_AUTH_TYPE=api-key
IMAGE_API_KEY_HEADER=X-API-Key
```

X-API-Key 必须换成服务商文档规定的头名。通用 IMAGE_API_KEY 只用于这份地址配置，不会作为已明确选择的放心或 TT 服务商的备用 Key。

### 检查配置

运行以下检查，不调用出图接口，也不产生出图费用：

```bash
node ~/.agents/skills/gpthuatu/scripts/generate.mjs --doctor
```

会显示服务商、接口地址、Key 变量名、认证方式、模型和密钥数量，不会显示 Key。也可以对 AI 说：“检查 GPT画图是否配置好了，不要提交出图请求。”

下面的直接运行示例均在 Skill 安装目录中执行。

## 已经安装过旧版的用户

不用先手动卸载。在原仓库目录更新并运行安装程序：

```bash
git pull --ff-only
node scripts/install.mjs
```

若原目录有未提交修改，请保留原目录，另行下载最新 ZIP，在解压目录运行安装程序。

安装程序会识别旧 `fangxin-image-gen` 和临时 `fangxin-draw`，先备份到 `~/.agents/skill-backups/`，再替换为 `gpthuatu`。旧入口移出技能列表，已有 `.env` 逐字保留；安装失败会回滚。备份含旧配置，请勿公开上传。重新打开 AI 工具后使用「GPT画图」和 `$gpthuatu`。

已有 FANGXIN_API_KEY、FANGXIN_MODEL 和 FANGXIN_ENV_FILE 仍可使用。旧 IMAGE_API_BASE_URL + IMAGE_API_KEY 配对配置也继续兼容。要改成多服务商保存方式，请将原 Key 放到对应的 FANGXIN_API_KEY 或 TT_API_KEY 中，再设置 IMAGE_API_PROVIDER；程序不会自动猜测通用 Key 的归属。不要把空白示例覆盖到现有私有配置上。

Git 安装用户可在 `~/.agents/skills/gpthuatu` 执行 `git pull --ff-only` 更新；ZIP 安装用户下载最新 ZIP，再运行安装程序。仓库地址保持原链接，避免已有分享链接失效。

## 切换服务商

配置好两家的 Key 后，可以直接对 AI 说：“用 TT 画一只猫”或“用放心画一张海报”。AI 会为本次请求选择对应服务商，不修改默认设置。

直接运行时加 --provider：

```bash
node scripts/generate.mjs --provider ttapi --doctor
node scripts/generate.mjs --provider fangxin --doctor
node scripts/generate.mjs --provider ttapi --prompt "一只晒太阳的小猫"
```

默认首选服务商由 .env 中的 IMAGE_API_PROVIDER 决定；命令参数 --provider 优先级更高。首选服务商只使用自己的命名 Key；未填写时提示补充。两家 Key 已配置时，运行中的明确失败可以触发下面的备用机制。

### 放心与 TT 自动互为备用

只要保存了 FANGXIN_API_KEY 和 TT_API_KEY，备用机制默认开启，不需要再填开关：

- 首选放心时：放心持续失败 → 尝试 TT 出图。
- 首选 TT 时：TT 持续失败 → 尝试放心出图。
- 一次任务最多切换一次，默认设置不变；结果会显示实际使用的服务商。

默认整个任务合计最多请求 3 次、共用 600 秒总时间，包含两家的所有 Key。首选服务最多先尝试 2 次，为备用留至少 1 次机会；明确的账号拒绝或过长的限流等待可以提前切换。不会分别给两家各重试 3 次，也不会来回循环。设置 --max-attempts 1 时不启用备用。

可自动切换：401/402/404、持续限流 429、明确尚未提交的连接失败，以及 4xx 中以明确任务失败代码返回且不含审核信息的响应。不会自动切换：审核拒绝、403、普通参数错误、提交后断线、5xx 执行状态不明、成功响应异常、图片下载或验收失败。服务商的“失败或需要审核”这类混合提示也先停止，不能确定为普通故障。避免重复提交已经可能出图的任务。

备用会使用该家的地址、Key 和上传协议，但保持本次模型、提示词及其他画图参数不变。只有一家的 Key 时照常使用这一家；OpenAI 官方和 custom 不自动加入这对备用服务。

只想使用指定服务商，可对 AI 说“这次只用 TT，不要切换备用”，对应：

```bash
node scripts/generate.mjs --provider ttapi --no-fallback --prompt "一只晒太阳的小猫"
```

长期关闭时在私有 .env 中设置 IMAGE_API_FALLBACK=off；恢复设为 auto。--doctor 会显示 fallbackProvider；--dry-run 显示本次是否有备用机会。双向切换、总预算、编辑协议和不确定请求停止已通过本地模拟测试，不代表已对两家做收费故障演练。

各家的模型可分别设置 FANGXIN_API_MODEL、TT_API_MODEL、OPENAI_API_MODEL；未填时使用 IMAGE_API_MODEL，再未填时使用默认模型。--model 可指定本次模型。放心的旧 FANGXIN_MODEL 仍兼容。

同一家备用 Key 使用 FANGXIN_API_KEY1、TT_API_KEY1 等编号变量；也支持 KEY2、KEY_BACKUP、KEYS（例如 TT_API_KEY_BACKUP、TT_API_KEYS）。只在所选服务商内部轮换，所有 Key 共享总请求次数上限。

也可以通过 IMAGE_API_ENV_FILE 指定独立私有配置文件；兼容旧 FANGXIN_ENV_FILE。shell 同名变量优先于文件，切换时注意清除旧的导出变量。

高级设置：已命名服务的覆盖项使用 FANGXIN_API_ / TT_API_ / OPENAI_API_ 前缀，例如 TT_API_BASE_URL、TT_API_EDIT_FORMAT。地址仅允许对应服务商域名；其他服务使用 custom。编辑格式 EDIT_FORMAT=json|multipart，multipart 字段 IMAGE_FIELD=image|image[]；已知 TTAPI 默认 JSON，放心默认 multipart image，官方默认 multipart image[]。custom 使用 IMAGE_API_EDIT_FORMAT 等通用变量。详见 [兼容性说明](references/compatibility.md)。

## 自然语言使用

选择「GPT画图」，或输入 `$gpthuatu`，描述需求：

> 画一张极简风格红色纸飞机海报，奶油色背景，横版。
>
> 保持这张图的人物和构图不变，把背景换成海边。
>
> 将这两张参考图里的产品放进同一张自然的场景图。

支持 PNG/JPEG 本地参考图和 HTTPS 图片链接。链接按真实内容识别格式，不依赖网址后缀。实际验收范围见 [兼容性说明](references/compatibility.md)。

## 直接运行

文生图、改图、多图合成：

```bash
node scripts/generate.mjs --prompt "在月亮上钓鱼的猫，水彩风" --size 1024x1024
node scripts/generate.mjs --prompt "保留人物，背景换成摄影棚" --image /path/photo.png
node scripts/generate.mjs --prompt "将两个产品组合成场景图" --image /path/a.png --image /path/b.jpeg
```

局部编辑：遮罩小于 4 MiB，是含透明区域的 PNG，与第一张参考图同尺寸。透明处表示编辑区域。

```bash
node scripts/generate.mjs --prompt "将遮罩对应区域换成绿植" --image /path/photo.png --mask /path/mask.png
```

JPEG 可以直接导出；若服务商返回 PNG，会在本地转换为 JPEG 并保留原图。透明背景本次未通过第三方实测，默认不提交请求；明确需要试验时才加 --experimental：

```bash
node scripts/generate.mjs --prompt "透明背景红色纸飞机素材" --background transparent --output-format png --experimental
node scripts/generate.mjs --prompt "晴天街景" --output-format jpeg --output-compression 85
```

## 参数

| 参数 | 默认 | 用法 |
|---|---|---|
| --model | gpt-image-2.5-flare | 显式参数优先于配置，支持脚本列出的 GPT Image 模型 |
| --size | auto | 常用 1024x1024、1536x1024、1024x1536；2.5/2 可传符合约束的自定义尺寸 |
| --quality | auto | low/medium/high；2.5 另可传 xhigh/max，第三方支持情况见实测说明 |
| --n | 1 | 1～10 |
| --background | auto | opaque/transparent；Flare 透明背景目前仅在 --experimental 下试验 |
| --output-format | png | png/jpeg；WebP 暂未开放，需先转换输入图或选择支持格式 |
| --output-compression | JPEG 为 100 | 0～100；PNG 不发送 |
| --moderation | auto | auto/low |
| --image | 无 | 可重复最多 16 张；单张小于 50 MiB，合计≤100 MiB |
| --mask | 无 | 同尺寸 PNG 遮罩，透明区域需要编辑 |
| --input-fidelity | 省略 | 仅可调旧模型使用；Flare/2 请省略 |
| --outdir | ./outputs/gpthuatu | 相对于当前工作目录；结果输出绝对路径 |
| --transport | node | curl 为显式备用通道；SOCKS 使用 curl |
| --timeout | 420 秒 | 单次请求上限 |
| --connect-timeout | 15 秒 | 连接阶段上限 |
| --total-timeout | 600 秒 | 含下载、等待、重试的总网络预算 |
| --max-attempts | 3 | 全任务出图请求上限，所有服务商和密钥合计 |
| --no-fallback | 关闭 | 本次只使用首选服务，不自动切换备用 |
| --experimental | 关闭 | 显式试验尚未验收的 Flare 透明背景，仍校验真实透明区域 |
| --strict-size | 关闭 | 实际尺寸不符则验收失败，仍保留有效图片 |
| --json | 关闭 | stdout 输出一个 JSON 结果，进度写 stderr |

自定义尺寸两边需为 16 的倍数，最长边≤3840，长短边比≤3，总像素 655360～8294400。像素量大于 2560×1440 的范围属于官方实验性能力，第三方效果仍需实测。[官方参数指南](https://developers.openai.com/api/docs/guides/image-prompting)

提前拒绝空提示词、无效尺寸、超范围数量、透明背景配 JPEG、PNG 压缩参数和不适用的模型参数。style、response_format 不属于当前 GPT Image 用法：风格写进提示词，返回 Base64 自动解码保存。

## 输出与验收

完整解码每张图片，检查实际尺寸、真实格式、透明区域，不只因 HTTP 200 报告成功。随机任务编号避免同时调用覆盖文件。

保存图片及 `result-任务编号.json`。记录首选及实际服务商、备用切换、请求参数、实际图片信息、脱敏请求编号、尝试次数、耗时和 SHA-256，不记录密钥、提示词原文或带授权参数的图片链接。上游格式不符时本地转码并保留原图；透明 PNG 转 JPEG 使用白底。遮罩编辑会按遮罩本地合成，使未选中区域保留参考图像素；JPEG 导出仍有有损压缩。

尺寸不符时保存并提醒；硬性尺寸要求使用 --strict-size。格式、透明区域、数量或解码不符合要求时返回失败，保留能解码的图片供检查。

退出码：0 成功；1 请求或验收失败；2 配置/环境问题；4 输入问题。

不产生出图费用的检查：

```bash
node scripts/generate.mjs --prompt "测试" --size 1024x1024 --dry-run
node scripts/generate.mjs --verify /path/image.png
```

--dry-run 检查参数和参考图；远程参考图仍会被下载，但不提交出图请求。

## 等待与重试

运行时定期显示等待状态；不要因等待较久再启动相同任务。取消可按 Ctrl+C。

- 401：在预算内尝试下一把已配置密钥。
- 429：遵守 Retry-After；没有该信息时逐步延长等待。
- 400、422、403：停止并给出错误原因。
- 提交前连接错误：可在预算内重试。
- 已提交后超时、中断或 5xx：执行状态不确定，默认停止，先检查服务商记录，避免重复扣费。

只有接受可能重复提交时才显式增加 --retry-uncertain。不会自动切模型，也不会在出现执行状态不确定的请求后跨服务或换通道重发；明确失败时的双向备用遵循上面的规则。

默认模式支持 HTTP/HTTPS 代理和 NO_PROXY。SOCKS 使用已有 curl：

```bash
node scripts/generate.mjs --prompt "晴天街景" --transport curl
```

curl 也使用 HTTP/1.1，密钥经标准输入传递，不写进启动参数；请求头与正文分开读取，临时文件清理。HTTPS 校验始终开启。

## 维护者检查

普通用户不用执行以下命令。维护者修改解码组件后，通过锁定依赖构建：

```bash
npm ci
npm run build
npm test
```

解码组件来自 pngjs、jpeg-js，许可文件在 [vendor/LICENSES.md](vendor/LICENSES.md)。网络、配置和安装逻辑使用 Node 内置模块。
