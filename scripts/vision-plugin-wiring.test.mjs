/**
 * 行为契约:端上识别插件真的接上了(2026-07-29,健康镜头 B 屏)。
 *
 * 原生插件有一条**没有任何运行时症状**的断法:Swift 文件写了、也提交了,
 * 但没登记进 Xcode 工程 —— 于是它根本不参与编译。重出一次 IPA、重装一次,
 * 用户点「拍化验单」看到的还是「这个版本还没带端上识别」,而代码明明在仓里。
 * 这种事在沙箱里编译不了、测不出来,只能靠静态锁。
 *
 * 另外锁一条产品红线:**端上不可用时绝不改走云端**。化验单是病历,
 * 不因为端上没有就换条路发出去。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SWIFT = 'treasurebox-ios/ios/App/App/NesioVisionPlugin.swift';
const PBX = 'treasurebox-ios/ios/App/App.xcodeproj/project.pbxproj';

// ── ① Swift 文件在,且暴露成 JS 侧认得的名字 ──────────────────────────────────
{
  const sw = read(SWIFT);
  assert.match(sw, /public let jsName = "Vision"/, 'jsName 必须是 Vision —— JS 侧按这个名字找插件');
  assert.match(sw, /CAPPluginMethod\(name: "recognizeText"/, '必须暴露 recognizeText');
  assert.match(sw, /CAPPluginMethod\(name: "isAvailable"/, '必须暴露 isAvailable —— JS 靠它区分「没插件」和「没认出字」');
  // 化验单全是词典外的串,开纠错会把 HbA1c 改成别的词
  assert.match(sw, /usesLanguageCorrection = false/, '化验单识别必须关掉语言纠错');
  assert.match(sw, /recognitionLanguages = \["zh-Hans", "en-US"\]/, '中英文都要认');
  // 竖拍照片的 cgImage 是横的,不转向整页文字都躺着,一行都认不出来
  assert.match(sw, /orientation: cgOrientation\(/, '必须按 UIImage 方向转 —— 否则竖拍的单子一行都认不出来');
  // 识别是 CPU 密集活,占主线程会把整个 webview 卡住
  assert.match(sw, /DispatchQueue\.global/, '识别不许在主线程跑');
}

// ── ② 真的登记进了 Xcode 工程(四处缺一不可)────────────────────────────────
{
  const pbx = read(PBX);
  const need = [
    [/NesioVisionPlugin\.swift in Sources \*\/ = \{isa = PBXBuildFile/, 'PBXBuildFile'],
    [/NesioVisionPlugin\.swift \*\/ = \{isa = PBXFileReference/, 'PBXFileReference'],
  ];
  for (const [re, what] of need) {
    assert.match(pbx, re, `pbxproj 缺 ${what} —— 文件在仓里但不参与编译,重出 IPA 也不会有这个插件`);
  }
  // 两处挂载缺一不可,而且是**不同**的引用形态,别用一条模糊计数糊过去:
  //   group children  → `… /* NesioVisionPlugin.swift */,`        (Xcode 里看得见)
  //   Sources 阶段    → `… /* NesioVisionPlugin.swift in Sources */,`(真的参与编译)
  // 只有前者 = 文件在项目导航里躺着但不编译,症状和「没写这个文件」一模一样。
  assert.match(pbx, /\/\* NesioVisionPlugin\.swift \*\/,/, 'group children 里没挂 —— Xcode 里看不到这个文件');
  assert.match(pbx, /\/\* NesioVisionPlugin\.swift in Sources \*\/,/, 'Sources 编译阶段里没挂 —— 文件在项目里躺着,但不参与编译');
}

// ── ③ JS 桥:没插件要说清楚,且绝不改走云端 ────────────────────────────────
{
  const js = code('lib/native/vision.ts');
  assert.match(js, /'plugin_missing'/, '要能区分「这次构建没带插件」');
  assert.match(js, /'not_native'/, '要能区分「在网页里,压根没有原生壳」');
  // 这两个是不同的处境,给的下一步也不同 —— 混成一句用户不知道该重装还是该手填
  assert.ok(
    /not_native[\s\S]{0,400}ios_too_old/.test(read('lib/native/vision.ts')),
    'unavailableMessage 要逐个原因给不同的人话',
  );
  // 红线:这条路上一个字都不许发去云端
  for (const bad of [/fetch\s*\(/, /\/api\//, /analyze/, /openai|anthropic|gemini/i]) {
    assert.ok(!bad.test(js), `端上识别这条路不许出现云端调用(命中 ${bad}) —— 化验单是病历`);
  }
}

// ── ④ 确认屏:needsConfirm 恒真 + 失败态可见 + 不静默入库 ────────────────────
{
  const sheet = code('components/portal/health/LabScanSheet.tsx');
  // 入库只能从「确认」那个按钮出发,不许识别完直接写
  assert.match(sheet, /const commit = \(\) => \{/, '入库必须是一个显式的 commit 动作');
  const autoSave = /if \(!r\.ok\)[\s\S]{0,200}recordLab/.test(sheet) || /parseLabReport\([\s\S]{0,120}recordLab/.test(sheet);
  assert.ok(!autoSave, '识别完不许直接 recordLab —— 健康数据必须经人确认(needsConfirm 恒真)');
  // 四种坏结局都要有可见出口
  for (const p of ['blocked', 'failed', 'empty']) {
    assert.ok(sheet.includes(`s: '${p}'`), `缺 ${p} 分支 —— 这条路会静默回到空白`);
  }
  assert.ok((sheet.match(/role="alert"/g) || []).length >= 3, '三种坏结局各要一个 role=alert');
  // 改了值/区间要重算判定,否则用户填对了区间标记还停在旧结论
  assert.match(sheet, /flagOf\(next\.value, next\.low, next\.high\)/, '改动后必须重算偏高偏低');
  // 踩过的坑:先清 value 再读 files,FileList 当场变空
  assert.match(
    sheet, /const f = e\.currentTarget\.files\?\.\[0\];\s*\n\s*e\.currentTarget\.value = '';/,
    '必须先抓 File 再清 input.value —— 反了 FileList 会变空,表现是「点了没反应」',
  );
}

console.log('vision-plugin-wiring: OK(插件已进工程 · 端上不可用不改走云 · 入库必经确认)');
