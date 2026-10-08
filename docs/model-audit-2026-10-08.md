# 模型更新与迁移（2026-10-08）

按用户要求新增适合文本摘要／字幕翻译的新型号，有上位替代时移除旧选项，并移除全部 GPT-5 选择。现有八家供应商共保留 19 个型号。旧型号仅作为设置迁移的输入保留，不再出现在选择列表或实际请求中。

| 供应商 | 更新后型号 | 旧选择迁移 |
| --- | --- | --- |
| DeepSeek | V4.1 Flash、V4 Pro | Flash 继续使用 `deepseek-flash`；Pro 移除 legacy 标注 |
| OpenAI | GPT-6.1 Sol、GPT-6 Luna、GPT-6 Astra | 5.6 Sol / Terra → 6.1 Sol；5.6 Luna → 6 Luna；此前发布的 GPT-5 / GPT-5 Mini / GPT-4.1 别名直接映射至新目标 |
| Claude | Sonnet 5.5、Opus 5.5、Haiku 5.5、Fable 5.1 | Sonnet 5 → 5.5；Opus 5 / 4.8 → 5.5；Haiku 4.5 → 5.5 |
| Gemini | 3.8 Flash、3.1 Pro Preview | 3.7 Flash / 2.5 Flash / 2.5 Flash Lite → 3.8 Flash；2.5 Pro → 3.1 Pro Preview，保留 Pro 档位 |
| Kimi | K3 | K2.6 / K2.5 及旧错误 thinking ID → K3 |
| Qwen | 3.8 Max、3.7 Plus、3.8 Flash | 3 Max → 3.8 Max；3.5 Plus → 3.7 Plus；3.5 / 3.7 Flash → 3.8 Flash |
| GLM | 5.3、5.3 Flash、5.3 FlashX | 5.2 → 5.3；4.5 / 4.5 Air → 5.3 Flash；FlashX 为额外高速选项 |
| Grok | 4.7 | 4.3 和此前错误的 4.1 Fast ID → 4.7 |

## 请求兼容性

翻译仍使用现有 `disableThinking` 工作流开关，但强制推理模型将其解释为最低有效推理档位：

- OpenAI：6 Luna 使用 `reasoning_effort: none`；6.1 Sol / Astra 使用 `low`。继续使用 Chat Completions 的 `developer` 指令和 `max_completion_tokens`，省略采样参数。本项目没有工具调用，不需要为本次升级改用 Responses。
- Claude：Sonnet 5.5 使用 `thinking.type: between_tools`，Haiku 5.5 使用 `disabled`；Opus 5.5 / Fable 5.1 使用 `adaptive`。翻译均使用 `output_config.effort: low`，省略采样参数。普通摘要保留官方默认自适应推理。
- Gemini：3.8 Flash 和 3.1 Pro Preview 翻译使用 `generationConfig.thinkingConfig.thinkingLevel: low`，不发送不支持的 `minimal`。两者输入窗口均为 1,048,576。流式解析忽略标注为 `thought` 的推理内容。默认仍为 3.8 Flash，Pro 使用官方实际 ID `gemini-3.1-pro-preview`。
- Kimi：K3 省略固定采样参数，不再发送 K2.x 的 `thinking` 字段，翻译使用 `reasoning_effort: low`。
- Qwen：保持 `enable_thinking: false`；三个型号上下文均为 1M。
- GLM：三个 5.3 型号均不能关闭思考；翻译使用 `thinking.type: enabled` 和 `reasoning_effort: low`。国内官方文档已确认模型代码与现有 Chat Completions 端点兼容。
- Grok：4.7 不能关闭推理，翻译使用 `reasoning_effort: low`。上下文改为 500K。
- DeepSeek：保持现有思考控制。官方后续公告明确继续提供 V4 Pro 服务，9 月 11 日旧核查中预计 9 月 14 日转发至 Flash 的结论已过时。

## 选择与价格影响

- 各供应商默认继续使用对应的原有产品档位：DeepSeek Flash、OpenAI Sol、Claude Sonnet、Gemini Flash、Kimi 通用旗舰、Qwen Max、GLM 旗舰、Grok 通用模型。Astra / Fable 为手动可选项，不设为默认。
- OpenAI Sol 标准输入／输出从 $4／$20 降至 $2／$10，Luna 从 $0.20／$1.20 降至 $0.10／$0.50，单位为每百万 tokens。超过 272K 输入存在长上下文加价；推理 token 消耗也会影响总费用。
- Haiku 5.5 的输入不超过 100K 时标准输入／输出为 $0.10／$0.50，超过后为 $0.50／$2.50。五种语言说明均提示长输入阶梯价格，不将最低价格误作所有输入的统一价格。
- Grok 从 4.3 的 $1.25／$2.50 升至 4.7 的 $2／$6，同时窗口从 1M 降为 500K。本次按用户要求采用新版，不属于同价替换。
- Gemini 3.6 / 3.7 / 3.8 Flash 标准文本输入／输出单价相同：截至 2026-12-31 为 $0.75／$3.75，自 2027-01-01 起为 $1.50／$7.50。3.1 Pro Preview 输入不超过 200K 时为 $2／$12，超过 200K 时为 $4／$18。均以每百万 tokens 计，输出含思考 tokens；相同单价不意味着相同总费用。本项目使用标准流式调用，不适用 Batch 折扣。
- 未为 Coding 专用的 Kimi K2.7 Code 新增选项；项目的使用场景是文本摘要和字幕翻译。

## 官方来源

- DeepSeek：[模型与首次调用](https://api-docs.deepseek.com/)、[更新公告](https://api-docs.deepseek.com/updates/)（更新公告通过官方搜索内容核实，直接页面读取失败）。
- OpenAI：[模型目录](https://developers.openai.com/api/docs/models/all)、[GPT-6 迁移指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)、[6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[旧 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[旧 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)。
- Claude：[模型目录](https://platform.claude.com/docs/en/models/overview)、[思考配置](https://platform.claude.com/docs/en/build-with-claude/thinking)、[Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)。
- Gemini：[3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)、[3.1 Pro Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview)、[官方价格](https://ai.google.dev/gemini-api/docs/pricing)、[GenerateContent API](https://ai.google.dev/api/generate-content)。
- Kimi：[模型目录](https://platform.kimi.ai/docs/models)、[参数对照](https://platform.kimi.ai/docs/api/models-overview)。
- Qwen：[文本生成模型](https://help.aliyun.com/zh/model-studio/text-generation-model)。
- GLM：[国内 5.3 文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)、[国内 Flash / FlashX 文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)。网页读取失败后，通过官方 `.md` 文档完整获取所需规格和请求示例。
- Grok：[模型目录](https://docs.x.ai/developers/models)、[推理控制](https://docs.x.ai/developers/model-capabilities/text/reasoning)、[4.3 价格与窗口](https://docs.x.ai/developers/migration/may-15-retirement)。

验证范围：设置迁移与请求体契约测试、实际流式请求链路的模拟测试、五种语言说明完整性检查、TypeScript 检查和生产构建。未使用用户 API Key，没有付费调用；账户权限和真实模型输出质量仍未实测。
