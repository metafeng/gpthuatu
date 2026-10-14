# 接口兼容性

仅调用 https://fangxinapi.com/v1/images/generations 和 /v1/images/edits。同名模型不等于第三方所有官方参数已验证。

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
