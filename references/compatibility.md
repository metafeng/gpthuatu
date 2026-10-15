# 接口兼容性

使用配置的 HTTPS 基础地址，拼接 `/images/generations` 或 `/images/edits`。完整生成链接会自动规范化；TTAPI 自动使用 TT-API-KEY，其他服务默认 Bearer，可显式配置专用请求头。只支持同步 OpenAI 兼容响应 `data[].b64_json` 或 `data[].url`，不把异步任务 ID 当成出图成功。

TTAPI 的编辑接口按其 [OpenAPI 文档](https://docs.ttapi.io/openapi/en/openai.json) 使用 JSON images/image_url；放心使用 multipart image，其他服务默认 multipart image[]。认证、地址、JSON/multipart 和字段可配置；代码适配不代表所有服务商的编辑能力都已通过实测。同名模型不等于第三方所有官方参数已验证。

| 能力 | 官方规则 | 本技能行为 |
|---|---|---|
| 文生图 | JSON，GPT Image 返回 Base64 | 完整解码验收 |
| 多图编辑 | 官方 multipart 示例用 image[]；还支持 JSON 图片引用 | 放心使用重复 image 文件字段 |
| 图片链接 | 官方可引用 URL/文件 ID | 下载、按真实内容验证后上传 |
| 格式 | 官方 PNG/JPEG/WebP | 开放完整解码的 PNG/JPEG；上游忽略格式时本地转码并保留原图 |
| 压缩 | JPEG/WebP 使用 output_compression | PNG 不发送；JPEG 范围 0～100 |
| input_fidelity | GPT Image 2 省略，旧模型可调 | 2/2.5 不发送，旧模型按参数检查 |
| streaming | 官方定义 stream/partial_images | 尚未开放第三方流式功能 |

官方依据：[生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)、[编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)、[参数指南](https://developers.openai.com/api/docs/guides/image-prompting)。

## 验收记录

本地检查覆盖配置优先级、参数冲突、完整解码、遮罩、尺寸差异、脱敏、重试预算、网络中断、curl 和旧版替换回滚。第三方记录在实测完成后填写；未验证项不能当作已交付能力的证明。

双向备用的本地模拟检查覆盖放心→TT、TT→放心、共享次数和总时间预算、各家认证隔离、编辑上传协议重建、备用配置损坏、取消、审核拒绝、提交状态不明和图片验收失败时停止。实际出图模型不随服务商切换而改变；未对两家做收费故障切换演练。

2026-10-15（Asia/Shanghai），gpt-image-2.5-flare 的实测：

| 场景 | 结果 | 说明 |
|---|---|---|
| Node HTTP/1.1 文生图 | 成功 | PNG 实际 1254×1254；请求 1024×1024，已报告差异 |
| 单图编辑 | 成功 | 上传及解码通过，内容已人工检查 |
| 两图合成 | 成功 | 两图上传及返回解码通过 |
| 遮罩编辑 | 成功 | 参考图及遮罩上传通过，本地合成额外保留未选中像素 |
| JPEG 参数 | 上游忽略 | 实际返回 PNG；已用真实返回图片完成本地转码及 JPEG 解码验收 |
| 透明背景 | 未通过 | 一次请求返回 HTTP 400；不推断永久不支持，默认关闭，需显式 --experimental |
| xhigh/max、4K、超过两张参考图、一次多张输出 | 未进行第三方实测 | 本地校验存在，未测组合不称为已验收 |

未对 OpenAI 官方端点做收费测试；以上结果仅属于放心接口。

## 后续实测：2026-10-15

- 放心接口再次测试两个普通提示词，最终均返回 HTTP 477，上游提示任务失败或需审核；期间遇到两次 HTTP 429。此前成功不代表持续可用。
- TTAPI 的 `/v1/images/generations`：同一风景提示词、gpt-image-2.5-flare、1024×1024 PNG，一次 HTTP 200，耗时 15.7 秒；完整解码与人工查看通过。该次复用了原 Skill 引擎，临时适配地址和认证。
- 通用配置版本的单元测试验证地址规范化、认证选择、密钥隔离、JSON/multipart 编辑结构及返回验收；不以本地模拟测试替代真实服务商验收。
- TTAPI 编辑、透明背景和多张输出尚未收费实测。单次文生图成功不构成长期稳定性保证。

通用配置版直接运行实测：同一 TTAPI 接口、完整生成链接配置、默认认证自动识别，一次 HTTP 200，16.1 秒，1024×1024 PNG，完整解码与人工查看通过；未使用临时适配器。
