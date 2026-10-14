---
name: fangxin-draw
description: 放心画图。使用放心 API 和 Node.js 生成图片、编辑 PNG/JPEG 参考图、合成多张图片或按遮罩局部修改。默认模型 gpt-image-2.5-flare；用于用户明确选择放心接口或此技能的画图、改图、合图请求。
---

# 放心画图

使用当前 SKILL.md 同目录的 `scripts/generate.mjs`。需要 Node.js 22.19+，建议 24 LTS；不依赖 Python、npm install 或全局图片工具。

## 执行

```bash
node <skill-root>/scripts/generate.mjs --doctor
node <skill-root>/scripts/generate.mjs --prompt "用户提示词" --json --outdir /absolute/output/path
```

默认模型 `gpt-image-2.5-flare`。优先级：显式 --model → 非空 FANGXIN_MODEL → 默认。按用户明确选择使用其他受支持 GPT Image 模型，不静默替换模型。

脚本读取 shell 配置，其次 FANGXIN_ENV_FILE 指定文件，否则 <skill-root>/.env。密钥变量为 FANGXIN_API_KEY，可选编号备用密钥。不得把密钥写进提示词、源码、命令参数、结果或公开文档；缺少配置时说明所需变量，不用示例密钥发请求。

文生图只传文字。改图先查看用户引用图片，再传本地路径或 HTTPS URL；多图重复 --image。引用不到原图时再请求补充，不凭空生成替代品。

```bash
node <skill-root>/scripts/generate.mjs --prompt "保留人物和构图，背景换成海边" --image /absolute/reference.png --json
```

参数和安装说明见 [README.md](README.md)；接口验收范围见 [兼容性说明](references/compatibility.md)。官方能力与放心实测分开。

## 参数与结果

- size 默认 auto；用户指定比例/尺寸时按要求选择。脚本检查 16 倍数、像素与比例限制。
- PNG/JPEG 输入输出完整解码；格式不符时本地转码并保留原图，遮罩编辑本地合成以保留未选中区域。WebP 暂未开放，先说明需要转换，不擅自改变用户要求。
- 质量默认 auto；2.5 可以传 xhigh/max，但不要把最高质量当作固定默认。
- 透明背景用 PNG；Flare 透明请求本次未通过实测，默认阻止提交。只有用户知悉试验性质且明确需要时增加 --experimental。压缩参数仅用于 JPEG。
- Flare 和 GPT Image 2 不发送 input_fidelity；可调旧模型按显式选择发送。不要使用旧 DALL·E 的 style/response_format 参数。
- 退出码 0 且 success=true 才是成功。读取 files 和 warnings，区分请求尺寸与解码所得实际尺寸。
- 展示图片，提供绝对路径或平台可访问链接。模型请求名称不能证明第三方底层模型身份。
- OUTPUT_VALIDATION_FAILED 已保留能解码的图片和记录；说明具体问题，不宣称验收通过。

## 时间与重试

默认单次 420 秒，总网络预算 600 秒，所有密钥合计最多 3 次 API 请求。脚本已有唯一重试层，等待其返回，用户取消时停止，不另起重复任务。

401 可在预算内切换已配置备用密钥；429 遵守 Retry-After。403 和参数错误停止。已提交后连接中断或 5xx 默认停止自动重发，说明执行和扣费状态不确定。不要自行附加 --retry-uncertain，只有用户了解可能重复提交并明确要求继续时使用。

默认 Node HTTP/1.1；--transport curl 是显式备用通道。不要在执行不确定时换通道重发。支持 HTTP/HTTPS 代理与 NO_PROXY；SOCKS 使用显式 curl 模式。

报错先读取脱敏错误码、请求编号和结果记录。--dry-run 检查参数，--verify 检查本地图片，无需收费请求。
