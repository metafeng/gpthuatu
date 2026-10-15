---
name: gpthuatu
description: GPT画图。通过用户配置的 OpenAI 兼容图片接口生成、编辑、合成或局部修改 PNG/JPEG 图片，支持 TTAPI、放心 API 和官方接口的配置。默认 gpt-image-2.5-flare；用于用户选择此技能或自备接口地址和 Key 的画图、改图请求。
---

# GPT画图

运行当前 SKILL.md 同目录的 `scripts/generate.mjs`。需要 Node.js 22.19+，建议 24 LTS；不需要 Python、npm install 或全局图片工具。

## 新手配置

先运行 `node <skill-root>/scripts/generate.mjs --doctor`，查看服务商、接口地址、模型、认证方式和已配置密钥数量，不输出密钥。

配置在安装目录 `.env`，按服务商分别保存 FANGXIN_API_KEY、TT_API_KEY、OPENAI_API_KEY。IMAGE_API_PROVIDER=fangxin|ttapi|openai 选择默认服务商，程序自动匹配地址与认证；IMAGE_API_MODEL 设置模型。用户说“用 TT 画图”时加 --provider ttapi，“用放心画图”时加 --provider fangxin；只影响本次请求，不修改默认配置。不指定时遵循默认配置；多家有 Key 且未设置默认时先让用户选择，不擅自切换。

其他兼容接口使用 IMAGE_API_PROVIDER=custom，并配置 IMAGE_API_BASE_URL、IMAGE_API_KEY。地址可为基础地址或完整 /images/generations 链接。只支持同步返回 data[].b64_json 或 data[].url 的 OpenAI 兼容图片接口；异步任务接口或其他协议需要单独适配，不能承诺任意链接都能画图。

- TTAPI：地址 https://api.ttapi.io/v1，默认自动选择 TT-API-KEY 认证；[获取 Key](https://dashboard.ttapi.io)。
- 放心 API：地址 https://fangxinapi.com/v1，默认 Bearer 认证；[获取画图分组 Key](https://fangxinapi.com/keys)，提醒选择支持所选画图模型的分组，以控制台为准。
- 其他服务：核对服务商文档；默认 Bearer，使用专用密钥请求头时设置 IMAGE_API_AUTH_TYPE=api-key 和 IMAGE_API_KEY_HEADER。不要根据 Key 外观推测认证。

不要把密钥写入源码、命令参数、提示词、结果或公开文档。先给缺少配置的用户清楚的配置步骤和对应服务商链接，不用示例密钥提交请求。所选服务商只读取对应名称的 Key，不混用其他服务商或通用 Key；放心和 TT 已分别配置时可按下方规则切换整份备用服务配置；已有 IMAGE_API_BASE_URL/IMAGE_API_KEY 配对配置及 FANGXIN_MODEL 仍兼容。

shell 同名变量优先于配置文件；文件由 IMAGE_API_ENV_FILE（兼容 FANGXIN_ENV_FILE）选择，默认安装目录 .env。多家 Key 可以同时保存，不根据外观猜归属。同一家内部轮换 Key；跨服务备用时使用另一家的完整地址、认证和 Key 配置。详见 [README](README.md)。

### 帮用户完成首次配置

用户要求配置、提供 Key 或首次画图缺少 Key 时，主动帮助保存，不只把环境变量说明发给用户让其自行处理。

1. 先确认归属。用户明确说“放心的 Key”“TT 的 Key”，给出 FANGXIN_API_KEY、TT_API_KEY 或 TT-API-KEY 标签，或明确将 Key 与已知服务商链接配对时，可以直接确定。只有一串 Key 且上下文没有明确来源时，只问：“这是放心 API、TTAPI、OpenAI 官方，还是其他服务商的 Key？”等待回答后再保存；不要根据 Key 长相、示例中的默认服务商或已有默认配置猜测，不向多家接口试发 Key。其他服务商还需确认接口链接和认证方式。
2. 确定私有配置文件：遵循 IMAGE_API_ENV_FILE / FANGXIN_ENV_FILE，否则使用当前安装目录 .env；Codex/Claude 软链接入口共用同一安装配置。增量合并已有文件，更新所选服务商的命名 Key，保留其他 Key、代理、模型和自定义设置，不复制空白示例覆盖旧文件。已有同名主 Key 时替换该项，用户明确说备用时才使用对应编号。用户没提供 Key 时，先给对应服务商的获取链接；仍不清楚服务商时先询问，不能擅自指定。
3. 首次保存第一家有效配置时，把 IMAGE_API_PROVIDER 设为这一家，包括覆盖空白模板中的默认 fangxin；已有可用的默认配置时，新增其他家的 Key 不改变默认，除非用户要求切换默认。无法确定现有默认时先保留其他配置，再请用户选择默认。普通画图请求切换服务商只用 --provider，不改持久默认。
4. 使用本地文件编辑能力保存，不把 Key 放进命令参数、脚本源码或生成的提示词。需要备份时存于技能扫描目录外的私有位置；配置和备份限制为当前用户可读写（macOS/Linux 文件 600，目录 700；Windows 使用当前用户权限）。更新使用同目录临时文件和原子替换，避免中断留下半份配置。用户已经贴到会话的 Key 不复述、不写进公开文件或发给其他模型。
5. 保存后运行所选服务商的 --doctor，核对服务商、keyVariable、接口和 keysConfigured；首次配置还检查不带 --provider 的默认结果。如果 shell 导出的同名变量覆盖了文件，要说明当前生效来源，不能声称文件中的新 Key 已生效。仅回复保存位置、对应服务商和检查结果，不展示 Key。doctor 只验证配置读入，不能声称密钥有效或出图成功；用户已要求画图时再继续实际生成，否则不额外收费测试。

## 出图与改图

```bash
node <skill-root>/scripts/generate.mjs --prompt "用户提示词" --json --outdir /absolute/output/path
node <skill-root>/scripts/generate.mjs --prompt "保留人物，背景换成海边" --image /absolute/reference.png --json
```

模型优先级：显式 --model → 对应服务商的 FANGXIN_API_MODEL / TT_API_MODEL / OPENAI_API_MODEL（放心兼容 FANGXIN_MODEL）→ IMAGE_API_MODEL → gpt-image-2.5-flare。不静默替换模型；使用备用服务时说明实际服务商。改图先查看用户引用图，多图重复 --image；拿不到原图时再请用户补充。

TTAPI 编辑使用文档定义的 JSON 图片引用；放心使用重复 image 的 multipart；其他服务默认 multipart image[]。这些上传方式可配置，TTAPI 当前仅文生图通过收费实测，不把编辑协议适配称为实测成功。详细边界见 [兼容性](references/compatibility.md)。

- 默认 size/quality 为 auto。按用户指定比例和尺寸选择，脚本会检查约束。
- PNG/JPEG 完整解码，格式不符会本地转码并保留原图；遮罩会本地合成以保留未选中区域。WebP 暂未开放。
- Flare 透明背景尚未通过当前服务商实测，默认阻止提交。用户明确接受试验性质时再加 --experimental，仍验收真实透明区域。
- 不使用旧 DALL·E 的 style/response_format 参数，2/2.5 不发送 input_fidelity。
- 退出码 0 且 success=true 才算成功。读取 files/warnings，区分请求尺寸与实际尺寸，展示图片并提供绝对路径。OUTPUT_VALIDATION_FAILED 保留图片但验收失败。
- 同名模型的请求名称不能证明第三方底层模型身份。

## 等待与错误

双向备用的触发原则：只有接口已明确拒绝/确认任务失败，或能确认请求尚未提交，才允许在预算内切换另一家。等待较久、没有马上出图、网络中断和笼统的“服务异常”都不能单独作为切换依据。判断不清、审核与故障混合、可能已经出图或扣费时，保留当前错误与请求编号，提示检查原服务商记录后停止；不要由 AI 另起脚本绕过这些边界。备用是同一任务内的串行恢复，不是同时向两家提交，也不自动更改后续任务的默认服务商。

默认单次 420 秒、总网络预算 600 秒、所有服务商和密钥合计最多 3 次 API 请求。脚本有统一重试层，等待其返回；用户取消则停止，不另起重复任务。

放心与 TTAPI 的 Key 都已配置时默认双向备用，--doctor 的 fallbackProvider 显示当前备用服务。不改持久默认；单次任务最多切换一次。默认先给首选服务最多 2 次机会，保留至少 1 次给备用；max-attempts=1 时不切换。模型、提示词和参数保持一致，编辑上传按备用服务协议重新构造，不采用另一家配置中的不同默认模型。用户要求“只用某家”时加 --no-fallback；IMAGE_API_FALLBACK=off 可永久关闭。OpenAI 官方和 custom 不参与自动双向备用。

401 先轮换同一家备用 Key；401/402/404、持续 429、明确未提交的连接失败，以及 4xx 中明确 task_failed/upstream_task_failed/image_generation_failed 且不含审核拒绝的信息，可在预算内切换另一家。429 的 Retry-After 约束同一家重试；等待超过 30 秒时可直接尝试另一家。403、审核类拒绝、普通参数错误停止。提交后断线或 5xx 默认不重发、不跨服务切换，说明执行和扣费状态不确定。成功响应异常、图片下载或验收失败也不触发备用。只有用户明确接受可能重复提交时才用 --retry-uncertain，仍不在有历史不确定请求的任务内跨服务重发。读取 provider、initialProvider、failover 和带服务商的 attempts，向用户说明实际出图来源；两家都失败则报告并停止，不手动再启动一轮。

错误中的 status、message、requestId 来自接口响应（message 会脱敏）；PROVIDER_ERROR 等分类、attempts 和本地校验错误由脚本生成。不要把服务商提示解读为已确认的底层根因。

默认 Node HTTP/1.1，HTTP/HTTPS 代理与 NO_PROXY 可配置；SOCKS 使用显式 --transport curl。在执行不确定时不要换通道重发。--dry-run 检查参数和参考图，--verify 检查本地图片，无需收费请求。

向用户解释完整流程、安装迁移或定位故障时，参照 [使用流程与故障处理](references/workflow.md)，区分配置检查、真实出图和模拟备用验证。
