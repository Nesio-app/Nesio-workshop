import Foundation
import Capacitor
import HealthKit

/**
 * NesioHealthKit —— 读 HealthKit,**只读,不写**。
 *
 * ## 这一层为什么这么薄
 *
 * 它只做一件事:把 HealthKit 里的样本原样倒出来。
 * **所有规则都不在这里** —— 单位换算、多设备去重(iPhone + Watch 的步数不能裸加)、
 * 离谱脏值丢弃、睡眠区间合并(概况段和 Core/Deep/REM 细分段时间重叠,裸加会 2–3× 翻倍)、
 * 按月序列、「最后一天是残缺的别当最新」…… 这些全在 JS 侧
 * `lib/portal/providers/apple-health.ts` 里,而且已经在真实的 Apple 健康导出上跑熟了。
 *
 * 理由很直接:**原生的每一次改动都要重新签名、重新装。** 规则是会一直改的东西
 * (每发现一个脏数据就要调一次),把它放在推一次部署就生效的那一侧。
 *
 * ## 所以出参是 Apple 导出的那个形状
 *
 * `fetchSamples` 回的是一批记录行,字段名和 Apple 自己的 `export.xml`
 * 里的 `<Record …>` 一一对应(type / sourceName / startDate / endDate / unit / value)。
 * JS 侧把它们拼成同样的文本,喂给**同一个**解析器 —— 一份规则,两个入口
 * (手动导入 XML 和真机直读),不会有两套逻辑各自漂移的那一天。
 *
 * 时间格式也照抄 Apple:`2026-07-31 09:15:00 +0800` —— 本地时间 + 偏移。
 * 必须是本地时间:JS 侧靠 `startDate.slice(0,10)` 取「哪一天」,
 * 用 UTC 的话时差大的地方整天都会错位。
 *
 * ## 一个 HealthKit 独有的坑
 *
 * **读权限的 `authorizationStatus` 永远返回 notDetermined** —— Apple 故意的,
 * 防止 App 靠权限状态反推「这人有没有某类数据」(比如查不查得到怀孕相关的类型)。
 * 所以「先看看授权了没」在这里根本不可靠,只能**直接查**:
 * 查得到就是给了,查不到就是没给或者确实没数据 —— 而这两种在产品上是同一种处理。
 */
@objc(NesioHealthKitPlugin)
public class NesioHealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NesioHealthKitPlugin"
    public let jsName = "NesioHealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchSamples", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    /**
     * 要读的类型 → 出参里的 unit 串。
     *
     * unit 串照 Apple 导出的写法(`count`/`km`/`kcal`/`degC`/`mg/dL`…),
     * 因为 JS 侧的 `convertUnit` 就是按这些串判的。这里**一律用规范单位取值**,
     * 于是 JS 那边的换算是个恒等变换 —— 但 unit 仍然如实写上,
     * 免得哪天这边改了取值单位而那边不知道。
     *
     * ⚠️ 这张表要和 JS 侧 `METRIC_DEFS` 的 `hk` 对得上。
     * 契约测试 `scripts/healthkit-type-parity.test.mjs` 会两边对一遍 ——
     * 少一个类型的后果是那条指标在真机上永远空着,而代码里看不出任何问题。
     */
    private static let quantityTypes: [(String, HKUnit, String)] = [
        ("HKQuantityTypeIdentifierStepCount", .count(), "count"),
        ("HKQuantityTypeIdentifierDistanceWalkingRunning", .meterUnit(with: .kilo), "km"),
        ("HKQuantityTypeIdentifierActiveEnergyBurned", .kilocalorie(), "kcal"),
        ("HKQuantityTypeIdentifierAppleExerciseTime", .minute(), "min"),
        ("HKQuantityTypeIdentifierFlightsClimbed", .count(), "count"),
        ("HKQuantityTypeIdentifierAppleStandTime", .minute(), "min"),
        ("HKQuantityTypeIdentifierRestingHeartRate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        ("HKQuantityTypeIdentifierWalkingHeartRateAverage", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        ("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", .secondUnit(with: .milli), "ms"),
        ("HKQuantityTypeIdentifierVO2Max", HKUnit(from: "ml/kg*min"), "mL/kg·min"),
        ("HKQuantityTypeIdentifierOxygenSaturation", .percent(), "%"),
        ("HKQuantityTypeIdentifierRespiratoryRate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        ("HKQuantityTypeIdentifierBloodPressureSystolic", .millimeterOfMercury(), "mmHg"),
        ("HKQuantityTypeIdentifierBloodPressureDiastolic", .millimeterOfMercury(), "mmHg"),
        ("HKQuantityTypeIdentifierBloodGlucose", HKUnit(from: "mg/dL"), "mg/dL"),
        ("HKQuantityTypeIdentifierBodyTemperature", .degreeCelsius(), "degC"),
        ("HKQuantityTypeIdentifierBodyMass", .gramUnit(with: .kilo), "kg"),
        ("HKQuantityTypeIdentifierBodyFatPercentage", .percent(), "%"),
        ("HKQuantityTypeIdentifierBodyMassIndex", .count(), "count"),
        ("HKQuantityTypeIdentifierLeanBodyMass", .gramUnit(with: .kilo), "kg"),
        ("HKQuantityTypeIdentifierHeight", .meterUnit(with: .centi), "cm"),
        ("HKQuantityTypeIdentifierWalkingSpeed", HKUnit.meterUnit(with: .kilo).unitDivided(by: .hour()), "km/hr"),
        ("HKQuantityTypeIdentifierAppleWalkingSteadiness", .percent(), "%"),
        ("HKQuantityTypeIdentifierDietaryEnergyConsumed", .kilocalorie(), "kcal"),
        ("HKQuantityTypeIdentifierDietaryProtein", .gram(), "g"),
        ("HKQuantityTypeIdentifierDietaryCarbohydrates", .gram(), "g"),
        ("HKQuantityTypeIdentifierDietaryFatTotal", .gram(), "g"),
        ("HKQuantityTypeIdentifierDietaryCaffeine", HKUnit.gramUnit(with: .milli), "mg"),
        ("HKQuantityTypeIdentifierDietaryWater", .liter(), "L"),
    ]

    /// iOS 16+ 才有的两个。分开列是因为 `HKQuantityTypeIdentifier(rawValue:)`
    /// 在旧系统上返回 nil —— 直接放进上面那张表会让整个查询在旧机上少一条而无声无息。
    private static let quantityTypesNewer: [(String, HKUnit, String)] = [
        ("HKQuantityTypeIdentifierTimeInDaylight", .minute(), "min"),
        ("HKQuantityTypeIdentifierAppleSleepingWristTemperature", .degreeCelsius(), "degC"),
    ]

    private static let categoryTypes = [
        "HKCategoryTypeIdentifierSleepAnalysis",
        "HKCategoryTypeIdentifierMindfulSession",
    ]

    // ── 权限 ────────────────────────────────────────────────────────────────

    private func readTypes() -> Set<HKObjectType> {
        var out = Set<HKObjectType>()
        for (raw, _, _) in Self.quantityTypes + Self.quantityTypesNewer {
            if let t = HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: raw)) { out.insert(t) }
        }
        for raw in Self.categoryTypes {
            if let t = HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: raw)) { out.insert(t) }
        }
        out.insert(HKObjectType.workoutType())
        return out
    }

    @objc public override func checkPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "read": "unavailable"]); return
        }
        // 见文件头:读权限查不出来。如实说「不知道」,别编一个状态出来。
        call.resolve(["available": true, "read": "unknown"])
    }

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["ok": false, "reason": "unavailable"]); return
        }
        store.requestAuthorization(toShare: [], read: readTypes()) { ok, err in
            if let err = err {
                call.resolve(["ok": false, "reason": "request_failed", "message": err.localizedDescription])
            } else {
                // ok=true 只代表「授权页走完了」,不代表用户勾了什么 —— 见文件头。
                call.resolve(["ok": ok, "read": "unknown"])
            }
        }
    }

    // ── 取数 ────────────────────────────────────────────────────────────────

    /**
     * 出参:
     *   rows:     `[{type, sourceName, startDate, endDate, unit, value}]`
     *   workouts: 窗口内锻炼次数
     *
     * 每类最多取 `perTypeCap` 条(按时间**倒序**取,所以拿到的一定是最近的)。
     * 不设上限的话,开了 CGM 的人一个月能有几万条血糖 —— 一次性桥过去会把
     * WebView 卡住好几秒(桥是 JSON over WKWebView,不是共享内存)。
     */
    @objc func fetchSamples(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["ok": false, "reason": "unavailable"]); return
        }
        let days = max(1, min(3650, call.getInt("days") ?? 30))
        let perTypeCap = max(50, min(20_000, call.getInt("perTypeCap") ?? 3_000))
        let end = Date()
        guard let start = Calendar.current.date(byAdding: .day, value: -days, to: end) else {
            call.resolve(["ok": false, "reason": "bad_range"]); return
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate])

        let group = DispatchGroup()
        let lock = NSLock()
        var rows: [[String: Any]] = []
        var workouts = 0

        func collect(_ made: [[String: Any]]) {
            lock.lock(); rows.append(contentsOf: made); lock.unlock()
        }

        // ① 数值类
        for (raw, unit, unitName) in Self.quantityTypes + Self.quantityTypesNewer {
            guard let type = HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: raw)) else { continue }
            group.enter()
            let q = HKSampleQuery(
                sampleType: type, predicate: predicate, limit: perTypeCap,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, samples, _ in
                defer { group.leave() }
                let made: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).compactMap { s in
                    // 单位对不上会抛 —— 比如设备存的是 mmol/L 而这里问 mg/dL。
                    // 抛出来整个查询就废了,所以先问一句能不能用这个单位。
                    guard s.quantity.is(compatibleWith: unit) else { return nil }
                    return [
                        "type": raw,
                        "sourceName": s.sourceRevision.source.name,
                        "startDate": Self.appleDate(s.startDate),
                        "endDate": Self.appleDate(s.endDate),
                        "unit": unitName,
                        "value": String(s.quantity.doubleValue(for: unit)),
                    ]
                }
                collect(made)
            }
            store.execute(q)
        }

        // ② 分类类(睡眠 / 正念)。value 要写成 Apple 导出里的那个枚举名 ——
        //    JS 侧靠 /Asleep/i、/Core/i、/Deep/i、/REM/i 认分期。
        for raw in Self.categoryTypes {
            guard let type = HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: raw)) else { continue }
            group.enter()
            let q = HKSampleQuery(
                sampleType: type, predicate: predicate, limit: perTypeCap,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, samples, _ in
                defer { group.leave() }
                let made: [[String: Any]] = (samples as? [HKCategorySample] ?? []).map { s in
                    return [
                        "type": raw,
                        "sourceName": s.sourceRevision.source.name,
                        "startDate": Self.appleDate(s.startDate),
                        "endDate": Self.appleDate(s.endDate),
                        "unit": "",
                        "value": raw.hasSuffix("SleepAnalysis")
                            ? Self.sleepValueName(s.value)
                            : "HKCategoryValueMindfulSession",
                    ]
                }
                collect(made)
            }
            store.execute(q)
        }

        // ③ 锻炼:只数个数。明细目前 JS 侧从 XML 导入那条路才用,真机这条不需要。
        group.enter()
        let wq = HKSampleQuery(
            sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { _, samples, _ in
            defer { group.leave() }
            lock.lock(); workouts = samples?.count ?? 0; lock.unlock()
        }
        store.execute(wq)

        group.notify(queue: .main) {
            // rows 为空**不是**错误 —— 可能是没授权,也可能是这台设备本来就没数据。
            // 两者在产品上都是「今天这条路没东西可拿」,JS 侧照此处理,不弹错。
            call.resolve([
                "ok": true,
                "rows": rows,
                "workouts": workouts,
                "importedAt": ISO8601DateFormatter().string(from: Date()),
            ])
        }
    }

    // ── 小工具 ──────────────────────────────────────────────────────────────

    /// Apple 导出的时间格式:`2026-07-31 09:15:00 +0800`。**本地时间**,见文件头。
    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        return f
    }()

    private static func appleDate(_ d: Date) -> String {
        return dateFormatter.string(from: d)
    }

    /// 睡眠分期枚举 → Apple 导出里的名字。JS 侧按名字里的 Core/Deep/REM/Awake 归类。
    private static func sleepValueName(_ v: Int) -> String {
        if #available(iOS 16.0, *) {
            switch v {
            case HKCategoryValueSleepAnalysis.inBed.rawValue: return "HKCategoryValueSleepAnalysisInBed"
            case HKCategoryValueSleepAnalysis.asleepCore.rawValue: return "HKCategoryValueSleepAnalysisAsleepCore"
            case HKCategoryValueSleepAnalysis.asleepDeep.rawValue: return "HKCategoryValueSleepAnalysisAsleepDeep"
            case HKCategoryValueSleepAnalysis.asleepREM.rawValue: return "HKCategoryValueSleepAnalysisAsleepREM"
            case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: return "HKCategoryValueSleepAnalysisAsleepUnspecified"
            case HKCategoryValueSleepAnalysis.awake.rawValue: return "HKCategoryValueSleepAnalysisAwake"
            default: return "HKCategoryValueSleepAnalysisAsleepUnspecified"
            }
        }
        // iOS 15:只有 inBed(0) / asleep(1)
        return v == 0 ? "HKCategoryValueSleepAnalysisInBed" : "HKCategoryValueSleepAnalysisAsleepUnspecified"
    }
}
