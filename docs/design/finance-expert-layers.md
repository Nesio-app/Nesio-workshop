# 财务专家体系:三层架构设计(财务⑫)

> 对标健康版面的分层(apple-health 解析 → health-clinical 判定 → health-risk 评分 → health-guidelines 知识),
> 把财务从「聚合 + 几条 findings」升级为可审计的专家体系。**全部确定性、纯函数、带出处、非 LLM**;
> LLM 只在叙事层引用这些结论(与健康侧 `<guidelines>` 注入同法)。

## 现状与缺口

已有:
- 数据层:`bank-tx.ts`(月汇总/分类占比/商户 Top/定期识别/调整对折叠/退款证据门/资产小结)
- 判定层:`finance-insight.ts` 四种 findings(净支出激增 / 单类激增 / 订阅涨价 / 现金流跑道)+ 未来账单
- 出口:`domain-insights.ts` 统一读出(财务页 / Today / 问一问同源)

缺口(用户实测反馈「提高财务分析能力和内容」):
- 异常检测只有「环比 >50%」一刀切,没有**个人基线**(median/MAD 稳健统计),小基数靠下限硬挡;
- 没有收入检测 → 没有储蓄率、收支平衡判断;
- 没有费用体检(银行费/利息/外币手续费)、灰色扣费(试用转付费/价格爬升)检测;
- 没有面向未来的余额投影(账单日历 vs 存款);
- 没有综合「财务健康分」——健康侧有 VO₂max/BMI/GMI 分级,财务侧没有对应物。

## L1 特征层(`lib/portal/finance-features.ts`,新)

纯函数,输入 `BankTx[]/BankAccount[]`,输出结构化特征。全部稳健统计(median/MAD),
拒绝被单月尖峰污染(业界共识:偏态消费数据用 MAD/modified z-score 而非均值 z-score)。

- **分类个人基线** `categoryBaseline(txs, cat)`:近 6 个完整月该类月支出的 median 与 MAD。
- **收入检测** `detectIncome(txs)`:INCOME 类 + 负数大额规律进账(同 detectRecurring 的周期化:
  半月/双周/月薪),输出月收入 median 与发薪周期(Plaid 亦以 description+amount+cadence 聚流,
  ≥3 次成熟流,与我们 detectRecurring 同构)。
- **月度收支** `monthlyCashflow(txs)`:income − netSpend 序列(已有 summarizeMonth 之上薄封装)。
- **订阅负担** `subscriptionLoad(txs)`:detectRecurring 中账单类月化合计。
- **余额投影** `balanceProjection(txs, accounts, days=30)`:存款余额 − 未来 30 天
  upcomingRecurring 账单 + 预计发薪(直接法现金流预测:已知流入/流出逐日滚动)。

## L2 判定层(`finance-insight.ts` 扩展,id 稳定)

新增 findings(全部 warm-coach 语气,红=真实风险):

| id | 判定 | 依据 |
|----|------|------|
| `finance-cat-drift-<CAT>` | 某类本月支出 modified z-score >3.5(vs 个人基线,·0.6745/MAD),替代现在的粗环比 | 稳健异常检测惯例(阈 3.5) |
| `finance-fee-audit` | 本月 BANK_FEES(ATM/透支/外币/利息)> $0 → 列明细合计 | 灰色费用年均 ~$350(BillGuard) |
| `finance-new-recurring` | 新出现的定期扣款(首次成熟)→「新订阅,是否知情?」 | 试用转付费是最常见灰色扣费 |
| `finance-price-creep` | 已有订阅金额较基线 +$1 以上且 ≥5%(扩展现 subscription_hike,含小额爬升) | BillGuard micro-change 检测 |
| `finance-balance-risk` | 余额投影 30 天内 < 0 或 < 未来账单合计 → 真实风险(可用 --status-risk) | 直接法现金流预测 |
| `finance-savings-rate` | 月储蓄率 = (收入−净支出)/收入,连续 2 月 <0 → attention | 50/30/20 规则(20% 储蓄向) |

现 `finance-net-surge`/`finance-cat-surge` 迁移到基线口径后保留 id 兼容(Today 去重依赖 id)。

## L3 评分层(`lib/portal/finance-risk.ts`,新;对标 health-risk)

`computeFinanceScores(features): RiskScore[]`——复用健康侧 `RiskScore` 形状(label/value/category/detail/source),
数据不齐的项不硬算(与健康侧「不为凑指标编分」同则):

| 分项 | 分级 | 出处 |
|------|------|------|
| 应急金月数 = 存款 ÷ 月净支出 median | <1 high / 1–3 moderate / 3–6 low / ≥6 info | 3–6 个月应急金共识(Fidelity/NerdWallet/圣路易斯联储) |
| 储蓄率 = 1 − 净支出/收入(需收入检测) | <0 high / 0–10% moderate / 10–20% low / ≥20% info | 50/30/20(Warren 规则) |
| 信用卡利用率 = credit 欠款 ÷ 额度(**需 /liabilities**,额度缺失不算) | >30% moderate、>50% high | FICO 利用率 30% 经验阈 |
| 订阅负担率 = 订阅月化 ÷ 收入 | >10% moderate | Rocket Money 实践口径(策展) |

综合呈现为「财务体检」卡(不合成单一总分——CFPB Financial Well-Being 是问卷量表(0–100,四维度),
交易数据只能近似其客观面;分项呈现更诚实,总分留待接入问卷)。

## 知识层(`lib/portal/finance-guidelines.ts`,新;对标 health-guidelines)

策展语料 + 主题键检索(非向量),每条:topic(对应 finding/score id 前缀)+ [zh,en] 要点 + source + url。
条目:应急金 3–6 月、50/30/20、FICO 利用率 30%、TIR 式订阅审计习惯、灰色扣费类型(试用转付费/价格爬升)、
稳健统计口径说明。注入「问一问」prompt 的 `<guidelines>` 块,让 AI 引用真出处而非编造。

## 实施切块(每块一 PR,契约随块)

1. **L1**:finance-features.ts(基线/收入/订阅负担/余额投影)+ 契约(合成流水验证各特征)。
2. **L2**:findings 扩展(基线漂移/费用体检/新订阅/价格爬升/余额风险/储蓄率)+ 迁移 surge 到基线口径,契约扩 finance-insight。
3. **L3+知识层**:finance-risk.ts + finance-guidelines.ts + 财务页「财务体检」卡 + 问一问 guidelines 注入,契约对标 health-risk 测试。
4. (后续开口)/liabilities 接入(信用卡额度/APR → 利用率与利息成本)、CFPB 问卷卡片。

## 出处(调研 2026-07)

- Plaid recurring streams:description+amount+cadence 聚流、≥3 次成熟 —— plaid.com/docs/transactions、plaid.com/blog/recurring-transactions
- 稳健异常检测:MAD、modified z-score(·0.6745,阈 3.5)优于均值 z-score(偏态/含离群)—— apriorit.com、datasciencewithmarco.com
- CFPB Financial Well-Being Scale:0–100 问卷量表,四维度 —— consumerfinance.gov(Quick Guide / Technical Report)
- 应急金 3–6 个月 —— Fidelity Viewpoints、NerdWallet、圣路易斯联储 Page One Economics
- 50/30/20 —— NerdWallet 等通行表述;FICO 利用率 30% —— CNBC/FICO 通行阈
- 灰色扣费(试用转付费/价格爬升/年均 $350)—— BillGuard(debt.org/finextra 回顾)、Rocket Money 订阅检测实践
