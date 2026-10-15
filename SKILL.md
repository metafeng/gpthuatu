---
name: gpthuatu
description: GPT画图。通过用户配置的 OpenAI 兼容图片接口生成、编辑、合成或局部修改 PNG/JPEG 图片，支持 TTAPI、放心 API 和官方接口的配置。默认 gpt-image-2.5-flare；用于用户选择此技能或自备接口地址和 Key 的画图、改图请求。
---

# GPT画图

运行当前 SKILL.md 同目录的 `scripts/generate.mjs`。需要 Node.js 22.19+，建议 24 LTS；不需要 Python、npm install 或全局图片工具。

## 新手配置

先运行 `node <skill-root>/scripts/generate.mjs --doctor`，查看服务商、接口地址、模型、认证方式和已配置密钥数量，不输出密钥。

配置在安装目录 `.env`，支持 IMAGE_API_BASE_URL、IMAGE_API_KEY、IMAGE_API_MODEL。地址可为带 /v1 的基础地址，也可直接填完整的 /images/generations 链接，脚本会规范化。只支持同步返回 data[].b64_json 或 data[].url 的 OpenAI 兼容图片接口；异步任务接口或其他协议需要单独适配，不能承诺任意链接都能画图。

- TTAPI：地址 https://api.ttapi.io/v1，默认自动选择 TT-API-KEY 认证；[获取 Key](https://dashboard.ttapi.io)。
- 放心 API：地址 https://fangxinapi.com/v1，默认 Bearer 认证；[获取画图分组 Key](https://fangxinapi.com/keys)，提醒选择支持所选画图模型的分组，以控制台为准。
- 其他服务：核对服务商文档；默认 Bearer，使用专用密钥请求头时设置 IMAGE_API_AUTH_TYPE=api-key 和 IMAGE_API_KEY_HEADER。不要根据 Key 外观推测认证。

不要把密钥写入源码、命令参数、提示词、结果或公开文档。先给缺少配置的用户清楚的配置步骤和对应服务商链接，不用示例密钥提交请求。已有 FANGXIN_API_KEY/FANGXIN_MODEL 配置可继续使用；一旦选择新 IMAGE_API 配置，不回退使用旧服务商的 Key。

shell 变量优先于配置文件；文件由 IMAGE_API_ENV_FILE（兼容 FANGXIN_ENV_FILE）选择，默认安装目录 .env。可用独立配置文件切换服务商，不覆盖原配置。详见 [README](README.md)。

## 出图与改图

```bash
node <skill-root>/scripts/generate.mjs --prompt "用户提示词" --json --outdir /absolute/output/path
node <skill-root>/scripts/generate.mjs --prompt "保留人物，背景换成海边" --image /absolute/reference.png --json
```

模型优先级：显式 --model → IMAGE_API_MODEL（旧配置兼容 FANGXIN_MODEL）→ gpt-image-2.5-flare。不静默替换模型或服务商。改图先查看用户引用图，多图重复 --image；拿不到原图时再请用户补充。

TTAPI 编辑使用文档定义的 JSON 图片引用；放心使用重复 image 的 multipart；其他服务默认 multipart image[]。这些上传方式可配置，TTAPI 当前仅文生图通过收费实测，不把编辑协议适配称为实测成功。详细边界见 [兼容性](references/compatibility.md)。

- 默认 size/quality 为 auto。按用户指定比例和尺寸选择，脚本会检查约束。
- PNG/JPEG 完整解码，格式不符会本地转码并保留原图；遮罩会本地合成以保留未选中区域。WebP 暂未开放。
- Flare 透明背景尚未通过当前服务商实测，默认阻止提交。用户明确接受试验性质时再加 --experimental，仍验收真实透明区域。
- 不使用旧 DALL·E 的 style/response_format 参数，2/2.5 不发送 input_fidelity。
- 退出码 0 且 success=true 才算成功。读取 files/warnings，区分请求尺寸与实际尺寸，展示图片并提供绝对路径。OUTPUT_VALIDATION_FAILED 保留图片但验收失败。
- 同名模型的请求名称不能证明第三方底层模型身份。

## 等待与错误

默认单次 420 秒、总网络预算 600 秒、所有密钥合计最多 3 次 API 请求。脚本有统一重试层，等待其返回；用户取消则停止，不另起重复任务。

401 可切换同一配置中的备用 Key；429 遵守 Retry-After；403 和参数错误停止。提交后断线或 5xx 默认不重发，说明执行和扣费状态不确定。只有用户明确接受可能重复提交时才用 --retry-uncertain。

错误中的 status、message、requestId 来自接口响应（message 会脱敏）；PROVIDER_ERROR 等分类、attempts 和本地校验错误由脚本生成。不要把服务商提示解读为已确认的底层根因。

默认 Node HTTP/1.1，HTTP/HTTPS 代理与 NO_PROXY 可配置；SOCKS 使用显式 --transport curl。在执行不确定时不要换通道重发。--dry-run 检查参数和参考图，--verify 检查本地图片，无需收费请求。
