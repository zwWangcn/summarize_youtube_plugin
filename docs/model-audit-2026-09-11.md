# 模型与调用方式核查（2026-09-11）

范围：扩展当前接入的八家供应商。依据公开官方文档；没有使用用户 API Key 查询账户模型权限，也没有发起付费推理请求。搜索摘要与实际页面有明显时间差，以下以实际打开的页面为准。模型是否对具体账户开放仍须实际调用验证。

## OpenAI 价格与加入条件

标准文本 API，美元／百万 tokens；输入列为未命中缓存价格。

| 模型 | 输入 | 缓存输入 | 输出 |
| --- | ---: | ---: | ---: |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | 10 | 1 | 50 |
| [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | 4 | 0.40 | 20 |
| [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | 2 | 0.20 | 12 |
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 0.20 | 0.02 | 1.20 |

GPT-6 Astra 的输入／输出单价均为 Sol 的 2.5 倍。官方模型目录与精确名称检索未找到 GPT-6 Light 的公开模型 ID 或价格，因此不加入未确认的 Light，也不自动切换到更贵的 Astra。项目已经有 Luna。Sol 页面注明当前优惠价格至少持续至 2026-11-21；上述模型超过 272K 输入时有长上下文加价，应按各模型页面重新计算。

Astra 支持 Chat Completions 和 Responses，现有传输接口可继续使用；但 reasoning effort 只支持 low / medium / high / xhigh / max，不能照搬现有 GPT-5.6 的 none 或旧模型的 minimal。将来加入 Astra 时，需要单独设置最低推理档位。此次没有加入 Astra，也没有改变 GPT-5.6 调用策略。

## 核查结果与本次处理

| 供应商 | 官方现状与调用差异 | 本次处理 |
| --- | --- | --- |
| DeepSeek | V4.1 Flash 于 9 月 10 日发布，推荐 ID 为 `deepseek-flash`；旧 V4 Flash ID 仅兼容转发。V4 Pro 将于 9 月 14 日北京时间 12:00 起转发至 V4.1 Flash，V4.1 Pro 尚未发布。Chat Completions 和 thinking 开关继续有效。 | 更新默认 ID、显示名及五种语言描述；旧 Flash 设置迁移。暂保留 Pro 为 legacy，避免提前改变仍有效的用户选择；移除不能直接沿用到 V4.1 的旧 Flash 参数量。新价格页本次读取失败，不引用旧 V4 价格作为 V4.1 价格。 |
| OpenAI | GPT-6 Astra；GPT-5.6 Sol / Terra / Luna 仍可用。 | 按价格条件保持现有三款。 |
| Anthropic | 当前列表为 Fable 5.1、Opus 5、Sonnet 5、Haiku 4.5；Opus 4.8 已属于旧代。Messages API 仍可用；Sonnet 5 / Opus 4.8 的采样限制已在项目处理。 | 已按用户确认升级到 Opus 5（1M）；旧 Opus 4.8 设置直接迁移，并保留省略采样参数的限制。Fable 仍为可选升级。 |
| Gemini | `gemini-3.7-flash` 是稳定型号，输入上限 1,048,576；thinking 支持 low / medium / high，minimal 不支持。 | 修正输入窗口；当前 streamGenerateContent + x-goog-api-key 调用保留。当前不会发送无效的 minimal。若优化翻译延迟，可另行评估 low 档。 |
| Kimi | 新通用模型 K3，另有 K2.7 Code；K2.6 仍可用，K2.5 已于 8 月 31 日停用并返回 404。未找到 `kimi-k2.6-thinking` 这一独立 ID。K2.6 思考由 thinking 控制，temperature 不能任意设置。 | 删除停用／错误选项，旧设置迁移到仍支持非思考模式的 K2.6；修正窗口为 256K；省略 temperature，并让禁用思考设置生效。K3 始终推理，需改用 reasoning_effort，未直接套用 K2.x 参数。 |
| Qwen | 当前推荐 `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash`，均为 1M；现有 Qwen3 Max / 3.5 系列仍有文档。 | 已按用户确认新增 Qwen3.7 Flash，保留 3.5 Flash 及原有选择；沿用 enable_thinking=false。其余新型号仍为可选升级。 |
| GLM | GLM-5.2 的上下文已为 1M；支持 thinking.type=disabled。 | 修正窗口；让翻译的禁用思考设置生效。 |
| Grok | 最新为 `grok-4.6`，500K，上下文并非简单随版本增大。历史 Fast 正确 ID 为 `grok-4-1-fast-reasoning` 等，已退役并转向 4.3；项目的 `grok-4.1-fast` 不在官方列表。 | 删除错误 Fast 选项并将旧设置迁移至已有的 `grok-4.3`。4.6 留作可选升级；其价格输入 $2、输出 $6，4.3 为 $1.25／$2.50，不能作为等价低价替换。 |

本次以修复已确认的失效 ID、请求参数与元数据为范围。新一代可选模型需要按摘要／字幕翻译的成本和效果选用，不能仅因版本更大而替换。当前三种适配器继续使用，无需为了普通文本流式生成整体重写为 Responses API。

## 官方来源

- DeepSeek：[首次调用](https://api-docs.deepseek.com/)、[更新日志](https://api-docs.deepseek.com/updates/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。
- OpenAI：[完整模型列表](https://developers.openai.com/api/docs/models/all)，价格及参数见上表各模型页面。
- Claude：[当前模型列表](https://platform.claude.com/docs/en/models/overview)、[Opus 4.8 与 Sonnet 5 规格](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-5)、[Sonnet 5 API 变化](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5)。旧页面与当前目录的新模型、价格存在时间差；最新名单采用当前目录。
- Gemini：[3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)、[思考参数](https://ai.google.dev/gemini-api/docs/thinking)。
- Kimi：[模型列表与停用通知](https://platform.kimi.ai/docs/models)、[参数对照](https://platform.kimi.ai/docs/api/models-overview)。
- Qwen：[文本模型列表](https://help.aliyun.com/zh/model-studio/text-generation-model)、[思考模式](https://help.aliyun.com/zh/model-studio/deep-thinking)。
- GLM：[5.2 规格](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2)、[思考参数](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)（直接页面读取失败，依据官方搜索结果中的完整规格和参数说明）。
- Grok：[模型目录](https://docs.x.ai/developers/models)、[历史型号退役通知](https://docs.x.ai/developers/migration/may-15-retirement)。

## 用户确认后的升级

- Opus 4.8 → Opus 5：标准输入／输出仍为 $5／$25 每百万 tokens，缓存读取仍为 $0.50。两个旧 ID（含此前错误日期后缀）均直接归一化为 `claude-opus-5`，避免多步别名解析遗漏。
- 新增 `qwen3.7-flash`：北京地域输入不超过 32K 时，输入／输出为 ¥0.2／¥0.8，较 3.5 Flash 的 ¥0.2／¥2 输出便宜 60%。五种语言均注明短输入条件。保留 3.5 Flash，不自动替换其已保存选择，也不改变 Qwen 默认模型。
- 单价相同不保证实际 token 消耗相同。未发起付费模型实测。

来源：[Claude 定价](https://platform.claude.com/docs/en/about-claude/pricing)、[Opus 5 迁移](https://platform.claude.com/docs/zh-CN/models/opus-5/migration-guide)、[百炼定价](https://help.aliyun.com/zh/model-studio/model-pricing)、[Qwen 思考开关](https://help.aliyun.com/zh/model-studio/deep-thinking)。
