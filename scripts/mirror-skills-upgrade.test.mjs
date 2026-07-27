/**
 * 多面镜五层 Skill + 选项扩容 + 三重验证线索契约。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const letters = read('lib/portal/mirror-letters.ts');
assert.match(letters, /coach.*暖教练|id: 'coach'/, '暖教练镜');
assert.match(letters, /id: 'body'/, '身体镜');
assert.match(letters, /id: 'time'/, '时间镜');
assert.match(letters, /id: 'inverse'/, '逆向镜');
assert.match(letters, /id: 'editor'/, '编辑镜');
assert.match(letters, /id: 'money'/, '主题:钱');
assert.match(letters, /id: 'learning'/, '主题:学习');

const skills = read('lib/portal/mirror-skills.ts');
assert.match(skills, /expressionDna/, '表达DNA');
assert.match(skills, /honesty/, '诚实边界');
assert.match(skills, /renderMirrorSkillPrompt/, 'Skill→prompt');
assert.match(skills, /MIRROR_SKILLS/, '全镜注册表');

const evidence = read('lib/portal/mirror-evidence.ts');
assert.match(evidence, /buildEvidenceLenses/, '三重验证');
assert.match(evidence, /verifiedLenses/, '过关线索');

const route = read('app/api/portal/mirror-letter/route.ts');
assert.match(route, /renderMirrorSkillPrompt/, '路由用五层 Skill');
assert.match(route, /verifiedLenses/, '路由吃过关线索');
assert.match(route, /failsFidelity/, '保真闸');
assert.match(route, /保留矛盾/, '矛盾纪律');

const tab = read('components/portal/insights/MirrorLetterTab.tsx');
assert.match(tab, /verifiedLenses:\s*summary\.verifiedLenses/, 'UI 上传线索');

const living = read('lib/platform/living-model.ts');
assert.match(living, /buildEvidenceLenses/, '摘要接三重验证');

console.log('mirror-skills-upgrade: OK');
