/**
 * 行为契约:export_cda.xml(HL7 CDA)解析(批次 48 / D2)。
 * 验证:化验单数值+单位+日期+参考范围+异常标记、诊断、用药提取;去重;脏值不抛。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/cda-parse.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Math, Number, RegExp, String, Array, Set, console });
const { parseCda } = mod.exports;

const xml = `
<ClinicalDocument>
 <component><structuredBody>
  <component><section><entry>
    <observation classCode="OBS" moodCode="EVN">
      <code code="2089-1" displayName="LDL Cholesterol"/>
      <effectiveTime value="20240115"/>
      <value xsi:type="PQ" value="160" unit="mg/dL"/>
      <referenceRange><observationRange><value><low value="0"/><high value="130"/></value></observationRange></referenceRange>
    </observation>
  </entry></section></component>
  <component><section><entry>
    <observation>
      <code displayName="Vitamin D"/>
      <effectiveTime value="20240110"/>
      <value xsi:type="PQ" value="45" unit="ng/mL"/>
    </observation>
  </entry></section></component>
  <component><section><entry>
    <observation>
      <code displayName="LDL Cholesterol"/>
      <effectiveTime value="20240115"/>
      <value xsi:type="PQ" value="160" unit="mg/dL"/>
    </observation>
  </entry></section></component>
  <component><section><entry>
    <observation>
      <code displayName="Problem"/>
      <value xsi:type="CD" code="E11" displayName="Type 2 diabetes mellitus"/>
    </observation>
  </entry></section></component>
  <component><section><substanceAdministration>
    <consumable><manufacturedProduct><manufacturedMaterial>
      <code displayName="Metformin 500mg"/>
    </manufacturedMaterial></manufacturedProduct></consumable>
  </substanceAdministration></section></component>
 </structuredBody></component>
</ClinicalDocument>`;

const c = parseCda(xml);

// 化验单
assert.equal(c.labs.length, 2, `D2:2 项化验(去重重复的 LDL),实得 ${c.labs.length}`);
const ldl = c.labs.find((l) => /LDL/.test(l.name));
assert.ok(ldl && ldl.value === 160 && ldl.unit === 'mg/dL', 'D2:LDL 值+单位');
assert.equal(ldl.date, '2024-01-15', 'D2:CDA 日期 20240115→2024-01-15');
assert.equal(ldl.high, 130, 'D2:参考范围上限');
assert.equal(ldl.flag, 'high', 'D2:160>130 标记 high');
const vitd = c.labs.find((l) => /Vitamin D/.test(l.name));
assert.ok(vitd && vitd.value === 45 && !vitd.flag, 'D2:无参考范围则不标记');

// 诊断 + 用药
assert.ok(c.conditions.includes('Type 2 diabetes mellitus'), 'D2:CD 值→诊断');
assert.ok(c.medications.includes('Metformin 500mg'), 'D2:manufacturedMaterial→用药');

// 脏值/空:不抛,返回空结构(逐字段断言 —— vm 沙箱返回对象跨 realm,不用 deepEqual 比原型)
const empty = parseCda('<ClinicalDocument></ClinicalDocument>');
assert.equal(empty.labs.length, 0, 'D2:无化验');
assert.equal(empty.medications.length, 0, 'D2:无用药');
assert.equal(empty.conditions.length, 0, 'D2:无诊断');
assert.doesNotThrow(() => parseCda('garbage <observation> not closed'), 'D2:脏输入不抛');

console.log('cda-parse: OK');
