# 训记训练数据：读取、趋势与安全写回

训记是可选连接器，不能阻断训练。先用 `references/connection-capabilities.js` 检查宿主实际工具：兼容训记连接器、受保护凭据入口、凭据是否就绪。不能根据设备名称猜测能力，上传 Skill 不等于注册连接器。

## 普通用户连接流程

1. 先判断能力，不先索取 Key。“连接训记”已表达连接意图，无需再次询问相同问题；仅提及训记不自动连接。
2. 连接器和凭据就绪：读取用户指定的一个日期验证；未指定则询问日期。成功空记录与请求失败分别说明。
3. 有连接器但缺凭据：引导宿主受保护输入入口；Windows Plugin 使用本地凭据配置脚本。禁止让用户在对话、截图或文件中提交 API Key。
4. 无兼容工具或安全配置入口：提供“导入文本/文件/截图”和“先开始训练”。HTTP/Docker 服务部署见仓库 README.raspberrypi.md；Windows stdio/DPAPI 仍需宿主支持。
5. 使用本文件的接口契约，不要求每个用户重新找 API 文档。接口变化时才请求不含 Key 的官方说明，并标记待验证。

## 手机导入与恢复

导出文本或文件优先。宿主支持图像识别时才接收截图，先展示日期、动作、组次、重量单位和 RPE/RIR 的核对摘要；模糊字段为未知，确认后再统计或预览写回。不把未记录日当休息日，不猜单位。按来源记录 ID 去重；无 ID 的疑似重复先确认。明确来源为用户导入，不等于连接成功。

鉴权失效重新配置；断网可用已有导入/缓存，但展示同步时间。缺数据仍可先训练，不制造趋势。误发 Key 时不复述或复制，提示到训记撤销后重新配置。

## 工具路由

- `xunji_get_training_day`：读取一个日期，优先使用本地缓存。
- `xunji_get_training_range`：读取最小必要日期范围，返回成功日期、缺失日期、缓存/网络来源和原始记录 ID。
- `xunji_get_training_trends`：读取范围并返回结构化趋势与本地自包含 HTML 面板内容。
- `xunji_extract_training_dna`：读取缓存训练范围并先生成标准复盘 facts + decision，再消费它们分别分析阻力与有氧反应，生成带证据范围和置信度的训练DNA，并在本机按账号指纹保存版本与变更记录；原始训练行不得绕过复盘层直接成为默认DNA证据。
- `xunji_preview_training_upsert`：绑定本机账号和内容，返回十分钟有效的 `preview_id`；不联网、不修改训记记录。
- `xunji_upsert_training_records`：确认匹配预览后携带 `preview_id`，按 localid upsert。
- `xunji_reconcile_training_upsert`：结果未知时读服务端核对；用户确认未写入后，凭五分钟有效的 `verification_id` 解除本地提交锁。

## 读取规则

连接器调用 `POST https://trains.xunjiapp.cn/api_trains_for_llm_v2`，请求包含 `schema_version: "train_open_api_v2"`、`datestr: YYYY-MM-DD` 和 `include_full_data`。核心数据在 `res.trains`，不要求存在 success 字段。保留结构化原训练 `train`（含 localid、start/end、movements、note）、record_date、fetched_at 和警告。普通读取默认 `include_full_data: false`；修改旧记录或读取 RPE、心率、未完成组、递减组、备注时必须先用 `include_full_data: true`。超级组读取 sets[].items，递减组读取 sets[].dropSets，心率读取整次或各组摘要，不要求原始心率数组。

同一训练日普通读取至少间隔 15 秒，完整模式至少 30 秒；服务端限频时遵守 retry_after_seconds。最近七天缓存满五分钟自动更新；更早日期默认读缓存。补录使用 `refresh_dates`，明确整段刷新用 `refresh_all: true`；范围、趋势和DNA均支持。刷新失败标记 `refresh_failed_using_cache`，不得称为最新数据。缓存按凭据 fingerprint 隔离，不能跨账号复用。

## 趋势模式

用户请求趋势面板时调用 `xunji_get_training_trends`，再把返回的 `dashboard_html` 保存为工作区 `fitness-reports/` 下的非 PII 文件。报告必须说明：

- 日期范围与数据新鲜度；
- 训练日数、记录数、组数、次数和可解析训练量；
- 每周训练频率和训练量；
- 动作/训练主题频次；
- 缺失日期、解析警告和无法结构化的原文数量。

HTML 不得加载外部 CDN，不得上传用户数据。文件名冲突时使用 `references/report-artifact.js` 追加后缀，不覆盖既有文件。

## 训练DNA模式

用户要求“提炼训练DNA”“建立训练系统”或“更新下一周期”时调用 `xunji_extract_training_dna`。它先复用训练日缓存，生成标准复盘 facts + decision，再由DNA消费层读取，不在DNA层重新解释原始记录；最后返回八类DNA维度、事实/推断边界、未知项、证据台账和版本变更。首次样本只标记为观察中；连续2～3个复盘窗口且条件可比时，才允许提升置信度。

DNA版本只保存在本机`HealthyFitnessCoach/training-dna/`，文件名使用账号单向fingerprint，不保存API Key或原始凭据。读取失败时可以继续返回当前分析，但必须标记未持久化；不得为了生成完整DNA而填补缺失训练数据。

## 写回规则

写回使用 `/api_upsert_trains_for_llm_v2`，不是整天覆盖删除：

1. 先调用 `xunji_preview_training_upsert`；
2. 确认 `records` 是 v2 训练对象数组、最多 4 条，每条最多 15 个动作、每动作最多 20 组/轮；超级组按最多子项数计入动作数；
3. 确认所有记录 datestr 都属于同一天，格式 YYYY-MM-DD，且在今天前后各六个月内；
4. 修改已有记录必须从完整模式的 train 复制，保留 localid、start、end、全部 movements/sets 及 note 元数据；只改用户指定字段，不丢弃未完成组。动作只传标准中文 name，不传内部 key；不确定时查询官方动作名表 https://github.com/Foveluy/Xunji-movements，不编造名称。RPE 合法值为字符串 6–10、步进 0.5，清空用空字符串；difficulty 仅 easy/normal/hard。原生有氧用 cardio:true 和顶层 metrics，不传 sets；
5. 只有用户明确确认后，调用 `xunji_upsert_training_records` 并传 `confirm: true` 和预览的 `preview_id`；内容、账号改变或过期必须重新预览；
6. 写入成功后，以服务端返回的 `res` 作为最终结果并更新当天缓存；
7. 不在本次 `res` 中的旧训练不会被删除。

写回修改训记；核对工具仅可能修改本地提交锁。写回前后保留日期、localid、start/end 和原始结构化对象；失败时不伪造成功结果。

## 隐私与安全

- 不在聊天内容、日志、Markdown、HTML、结构化输出或 Git 中保存 API key；
- 使用本机 `set-credential.ps1` 通过 Windows DPAPI 保存和读取凭据，不要求用户在对话中粘贴 key；
- Garmin 来源记录在面向模型输出前过滤；来源未知时降低置信度；
- 红旗症状或数据不完整时，安全分流优先于读取、趋势分析和写回；
- 真实账号 smoke test 只在用户本机配置凭据后手动触发，自动化测试使用 mock/fixture。

## 写回结果

- `not_submitted`：本地校验失败或明确拒绝，修复后重新预览。
- `confirmed`：服务端响应已验证；`cache_saved: false` 仅提示同步失败，禁止重复提交。
- `unknown`：已发请求但超时或响应无法确认，禁止自动重试。
- `reconciliation_required`：同批已有提交，先核对服务端记录的日期、ID、动作和组次。

核对失败、记录过滤或解析不全时不解除锁。用户看过最新完整结果并明确确认未写入后，才传 `confirm_not_applied: true` 和 `verification_id`，再新建预览确认。生产日志位于本机 `HealthyFitnessCoach/write-operations/`，只保存账号关联的摘要哈希、日期和状态，重启仍阻止同批重发；这不是服务端幂等保证，改动批次仍需核对已有 ID。

## v2 写入与范围

写入请求使用 schema_version、稳定的 client_request_id、dry_run:false 和 include_full_data:true。写回同一日 45 秒限频，不自动重试不明确的写入。restTime/warn_restTime 是正式/热身组的目标休息秒数；sets[].restSeconds 是实际休息时长。

官方计划另有只读 POST https://api.xunjiapp.cn/open/plan/query_gzip（plan_open_api_v1，action:list/get）；当前七个 MCP 工具尚未封装该接口。饮食、身体指标 API 也不在此连接器范围内。
