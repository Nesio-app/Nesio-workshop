# 端上文字识别插件(NesioVision)

「拍化验单」用的 OCR。**图片一个字节都不离开手机** —— Apple Vision framework 在本机跑。

## 你需要做的一件事:重出一次 IPA

插件是**原生代码**。你手机上现在装的那个 IPA 里没有它 ——
壳加载的是远端网页(`server.url`),所以网页改动会自动生效,**但原生插件不会**。

在此之前,健康页的「拍化验单」会明确告诉你:

> 这个版本的 App 还没带端上识别 —— 重新装一次新版本就有了。现在可以先手填。

不会静默失败,也不会偷偷改走云端(化验单是病历,不因为端上没有就换条路发出去)。

重出步骤照旧(`IOS-BUILD.md`):codemagic 出包 → 自签重装。插件已经登记进
`ios/App/App.xcodeproj/project.pbxproj`(PBXBuildFile / PBXFileReference /
group children / Sources 四处),不需要再动 Xcode。

> 这四处登记由 `scripts/vision-plugin-wiring.test.mjs` 锁着。
> 漏登记的症状极具欺骗性:Swift 文件在仓里、代码看着没问题,但它根本不参与编译 ——
> 重装完点「拍化验单」还是说「没带端上识别」。

## 分工

| 层 | 干什么 | 改了要重出 IPA 吗 |
|---|---|---|
| `NesioVisionPlugin.swift` | 图 → 逐行文字。**只做这一件事** | 要 |
| `lib/native/vision.ts` | 调插件、判可用性、超时、把机器原因翻成人话 | 不要 |
| `lib/health/lab-parse.ts` | 文字 → 指标行(名字/值/单位/参考区间/偏高偏低) | 不要 |
| `LabScanSheet.tsx` | 确认屏:逐项核对、成员、日期、入库 | 不要 |

原生那层刻意做得很薄:**每动它一次你就得重新签名重新装**。
识别准不准主要取决于 `lab-parse.ts` 的规则,那一层可单测、可随时改、改了刷新网页就生效。

## 识别质量上的两个选择

- `usesLanguageCorrection = false` —— 化验单上全是词典外的串(`HbA1c`、`10^9/L`、`ALT`),
  开着纠错反而会把它们改成别的词。
- 按 y 坐标重排并合并同一行的碎片。Vision 不保证按阅读顺序返回,而化验单是**表格** ——
  顺序错了整张单子就串行,`lab-parse` 需要「名字 值 单位 区间」在同一行里才解得出来。

## 为什么不用 olmOCR / 云端视觉

2026-07-29 评估过 [olmOCR](https://github.com/allenai/olmocr):7B 视觉语言模型,
最低 12GB VRAM 的 NVIDIA GPU。Vercel serverless 没有 GPU,iOS 更不可能 ——
只剩第三方推理商那条路,等于把化验单原图再发给一家供应商。

它唯一值得借的是思路:**先转成结构化文本再解析**,而不是让模型直接吐 JSON。
`lab-parse.ts` 就是这么做的,只不过「解析」那一步用规则而不是模型 ——
规则解不动会**留白让人填**,模型解不动会**编一个参考区间**。对医疗数据,前者好得多。
