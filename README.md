# 放心画图

在 Codex、Claude Code 等支持本地 Skill 的 AI 工具中，用自然语言画图、改图、合图。使用 [放心 API](https://fangxinapi.com)，默认模型 `gpt-image-2.5-flare`。

只需要 **Node.js 22.19 或更新版本**，推荐 [Node.js 24 LTS](https://nodejs.org/)。日常使用不需要 Python，也不用 `npm install`，图片解码组件已随技能打包。默认通过 Node HTTP/1.1 请求接口，curl 是可选备用通道。

## 安装

下载本仓库 ZIP 并解压，或用 Git：

```bash
git clone https://github.com/metafeng/fangxin-image-gen.git fangxin-draw
cd fangxin-draw
node scripts/install.mjs
```

程序默认将一份共享技能安装到 `~/.agents/skills/fangxin-draw`，为 Codex 和 Claude Code 建立入口。重新打开 AI 工具或刷新技能列表，显示名称为 **放心画图**，调用标识 `$fangxin-draw`。

只安装到一个工具：

```bash
node scripts/install.mjs --agents codex
node scripts/install.mjs --agents claude
```

其他工具可指定技能目录；空 agents 表示不创建 Codex/Claude 入口：

```bash
node scripts/install.mjs --agents "" --target /absolute/path/to/skills/fangxin-draw
```

`node scripts/install.mjs --dry-run` 预览将替换的目录，不修改文件。

## 已经安装过 fangxin-image-gen 的用户

**无需手动卸载，也无需重新填写已有密钥。** 如果旧版从这个仓库克隆，在原仓库目录执行：

```bash
git pull --ff-only
node scripts/install.mjs
```

原目录有未提交修改时，Git 会停止更新；请保留原目录，下载本仓库 ZIP，在解压目录运行同一个安装命令。

程序自动处理已识别的旧版目录、Codex/Claude 旧入口以及嵌套安装：

1. 先准备完整新版，检查目录归属。
2. 将旧目录和配置移到 `~/.agents/skill-backups/`；备份在技能扫描目录之外，旧版不再重复出现。
3. 保留已有 `.env` 和密钥；私有配置仅当前用户可读写。旧脚本中的内置密钥也能迁入私有配置，新源码不携带密钥。
4. 安装新版并建立选中的工具入口，中途失败会回滚已移动目录。

配置中显式选择的模型也会保留；希望使用默认 Flare 时，删除 `.env` 中的 FANGXIN_MODEL 行即可。结果会显示备份位置，备份含旧配置，不要上传 GitHub。重新打开 AI 工具后使用「放心画图」。

Git 安装的新版可在 `~/.agents/skills/fangxin-draw` 执行 `git pull --ff-only` 获取最新内容。ZIP 安装用户下载最新 ZIP，再运行安装程序，会继续备份并保留配置。

## 配置密钥

到 [放心 API](https://fangxinapi.com) 创建自己的 API Key。首次安装且没有旧配置时，将 `.env.example` 复制成安装目录中的 `.env`，在编辑器填写：

```dotenv
FANGXIN_API_KEY=你的密钥
```

macOS/Linux 可这样准备文件：

```bash
cp ~/.agents/skills/fangxin-draw/.env.example ~/.agents/skills/fangxin-draw/.env
chmod 600 ~/.agents/skills/fangxin-draw/.env
```

已有 `.env` 时直接编辑，不要复制覆盖。Windows 在文件管理器中复制、编辑即可。

可选配置：

```dotenv
FANGXIN_API_KEY1=备用密钥
FANGXIN_MODEL=gpt-image-2.5-flare
HTTPS_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1
```

shell 变量优先，其次 FANGXIN_ENV_FILE 指定文件；未指定时读取 Skill 安装目录的 `.env`。不执行配置文件中的脚本。所有密钥共享同一请求次数上限。

不要把密钥贴进聊天、命令参数或公开仓库。源码、安装包不含预设密钥，`.env` 已被 Git 忽略。

检查环境与配置，不调用接口：

```bash
node ~/.agents/skills/fangxin-draw/scripts/generate.mjs --doctor
```

Windows 将路径换成实际安装目录，例如 `C:\Users\用户名\.agents\skills\fangxin-draw\scripts\generate.mjs`。以下命令默认在 Skill 根目录运行。

## 自然语言使用

选择「放心画图」，或输入 `$fangxin-draw`，描述需求：

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
| --outdir | ./outputs/fangxin-draw | 相对于当前工作目录；结果输出绝对路径 |
| --transport | node | curl 为显式备用通道；SOCKS 使用 curl |
| --timeout | 420 秒 | 单次请求上限 |
| --connect-timeout | 15 秒 | 连接阶段上限 |
| --total-timeout | 600 秒 | 含下载、等待、重试的总网络预算 |
| --max-attempts | 3 | 全任务出图请求上限，所有密钥合计 |
| --experimental | 关闭 | 显式试验尚未验收的 Flare 透明背景，仍校验真实透明区域 |
| --strict-size | 关闭 | 实际尺寸不符则验收失败，仍保留有效图片 |
| --json | 关闭 | stdout 输出一个 JSON 结果，进度写 stderr |

自定义尺寸两边需为 16 的倍数，最长边≤3840，长短边比≤3，总像素 655360～8294400。像素量大于 2560×1440 的范围属于官方实验性能力，第三方效果仍需实测。[官方参数指南](https://developers.openai.com/api/docs/guides/image-prompting)

提前拒绝空提示词、无效尺寸、超范围数量、透明背景配 JPEG、PNG 压缩参数和不适用的模型参数。style、response_format 不属于当前 GPT Image 用法：风格写进提示词，返回 Base64 自动解码保存。

## 输出与验收

完整解码每张图片，检查实际尺寸、真实格式、透明区域，不只因 HTTP 200 报告成功。随机任务编号避免同时调用覆盖文件。

保存图片及 `result-任务编号.json`。记录请求参数、实际图片信息、脱敏请求编号、尝试次数、耗时和 SHA-256，不记录密钥、提示词原文或带授权参数的图片链接。上游格式不符时本地转码并保留原图；透明 PNG 转 JPEG 使用白底。遮罩编辑会按遮罩本地合成，使未选中区域保留参考图像素；JPEG 导出仍有有损压缩。

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

只有接受可能重复提交时才显式增加 --retry-uncertain。不会自动切模型、切服务商或在不确定状态下换通道重发。

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
