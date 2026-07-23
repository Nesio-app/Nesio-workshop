/**
 * exercise-library — 动作库(批次 46)。
 * 移植 fitness/web/app.js 的 EX(17 个自重动作,Verna 康复风),字段完整:
 *   肌群(主/次) · 肌群标签 · 动作模式 · 器械 · 难度 · 技术要点(cues) ·
 *   神经提示(neural,「想象…」) · 常见错误(warnings) · 变式(mods)。
 * 纯数据 + 筛选/查找,给动作库 UI 和跟练播放器用。
 */

export type MuscleTag = 'glute' | 'hip' | 'chest' | 'shoulder' | 'core' | 'back';
export type Equip = 'bodyweight' | 'dumbbell' | 'bench' | 'wall';
export type MoveTag = 'squat' | 'hinge' | 'push' | 'pull' | 'core_s' | 'mobility';
export type Diff = 'easy' | 'med' | 'hard';

export interface Exercise {
  id: string;
  name: string;
  muscles: Array<{ n: string; t: 'p' | 's' }>;
  tags: MuscleTag[];
  move: MoveTag[];
  equip: Equip[];
  diff: Diff;
  cues: string[];
  neural: string[];
  warnings: string[];
  mods: string[];
}

export const MUSCLE_LABEL: Record<MuscleTag, [string, string]> = {
  glute: ['臀', 'Glutes'], hip: ['髋', 'Hips'], chest: ['胸', 'Chest'],
  shoulder: ['肩', 'Shoulders'], core: ['核心', 'Core'], back: ['背', 'Back'],
};
export const EQUIP_LABEL: Record<Equip, [string, string]> = {
  bodyweight: ['徒手', 'Bodyweight'], dumbbell: ['哑铃', 'Dumbbell'], bench: ['凳台', 'Bench'], wall: ['墙', 'Wall'],
};
export const MOVE_LABEL: Record<MoveTag, [string, string]> = {
  squat: ['蹲', 'Squat'], hinge: ['髋铰链', 'Hinge'], push: ['推', 'Push'],
  pull: ['拉', 'Pull'], core_s: ['核心稳定', 'Anti-core'], mobility: ['活动度', 'Mobility'],
};
export const DIFF_LABEL: Record<Diff, [string, string]> = {
  easy: ['入门', 'Beginner'], med: ['进阶', 'Intermediate'], hard: ['挑战', 'Advanced'],
};

export const EXERCISES: readonly Exercise[] = [
  { id: 'glute-bridge', name: 'Glute Bridge', muscles: [{ n: '臀大肌', t: 'p' }, { n: '腘绳肌', t: 's' }], tags: ['glute', 'hip'], move: ['hinge', 'core_s'], equip: ['bodyweight'], diff: 'easy',
    cues: ['双脚踩地与髋同宽，脚跟离臀约一拳', '呼气时收紧臀部向上顶髋，顶点停 1-2 秒', '下降时控制速度，不要塌腰', '腰部酸说明臀没用力，减小幅度重新找发力感'],
    neural: ['想象你要用臀部把地面推穿——不是用背把自己撑起来'],
    warnings: ['避免用腰部代偿——顶点时腹部微收紧', '脚跟太远会过度激活腘绳肌'],
    mods: ['Heels Elevated：脚跟放凳子，增加臀肌拉伸幅度', '单腿版本：一侧腿伸直'] },
  { id: 'split-squat', name: 'Split-Squat', muscles: [{ n: '股四头肌', t: 'p' }, { n: '臀大肌', t: 's' }], tags: ['glute', 'hip'], move: ['squat'], equip: ['bodyweight'], diff: 'med',
    cues: ['前脚完全踩地，膝盖追踪第二脚趾方向', '后腿膝盖朝地面，躯干保持直立', '下降至前腿平行地面或略低', '控制离心：2-3 秒向下，1 秒向上'],
    neural: ['想象前脚像树根一样扎进地——驱动力来自前腿的臀和股四头'],
    warnings: ['膝痛：缩小蹲深，从四分之一程开始', '前膝超脚尖太多：臀部再后推一点'],
    mods: ['借椅背辅助平衡（初期推荐）', 'Bulgarian Split Squat：后脚上台（进阶）'] },
  { id: 'single-leg-rdl', name: 'Single-Leg RDL', muscles: [{ n: '腘绳肌', t: 'p' }, { n: '臀大肌', t: 'p' }, { n: '竖脊肌', t: 's' }], tags: ['hip', 'back'], move: ['hinge'], equip: ['bodyweight', 'wall', 'dumbbell'], diff: 'med',
    cues: ['支撑腿微屈，不要锁死膝关节', '臀部向后推，躯干随之前倾——髋铰链而非弯腰', '后伸腿与躯干保持一条线', '背部中立——不弓背不过度拱腰'],
    neural: ['想象臀部向后去撞一扇紧闭的大门——用臀推门，不是用腰弯腰'],
    warnings: ['腰部紧张：减少前倾幅度', '摇晃正常——借墙没问题，重点是髋铰链感'],
    mods: ['手扶墙/椅：消除平衡挑战（Verna 推荐）', '手持哑铃：增加负荷同时助平衡'] },
  { id: 'incline-pushup', name: 'Incline Push-Up', muscles: [{ n: '胸大肌', t: 'p' }, { n: '三角肌前束', t: 's' }, { n: '肱三头肌', t: 's' }], tags: ['chest', 'shoulder'], move: ['push'], equip: ['bodyweight', 'bench'], diff: 'easy',
    cues: ['双手略宽于肩，身体保持一条直线', '下降时肘部外展约 45°', '胸部触碰台面再推起', '不要耸肩——肩胛骨下沉后收'],
    neural: ['想象把台面推离你的身体——力量从胸部中心爆发'],
    warnings: ['台面越低难度越大，从胸口高度开始', '手腕疼痛：尝试拳头俯卧撑'],
    mods: ['台面越高越简单', '标准俯卧撑：地面最大难度'] },
  { id: 'bear-squat', name: 'Bear Squat', muscles: [{ n: '股四头肌', t: 'p' }, { n: '核心', t: 's' }], tags: ['hip', 'core'], move: ['squat', 'core_s'], equip: ['bodyweight'], diff: 'med',
    cues: ['四点跪姿，膝盖悬空 2-3 厘米', '臀部向脚跟方向缓慢下降，背部平直', '膝盖全程不触地', '控制速度，感受股四头离心发力'],
    neural: ['想象膝盖下方有一块薄冰——轻轻悬浮，永远不要打碎它'],
    warnings: ['腰部塌陷：核心是关键', '幅度不够：从小幅度建立控制感'],
    mods: ['减小悬空高度', '加重版：膝盖上放重物'] },
  { id: 'side-plank', name: 'Side Planks', muscles: [{ n: '腹外斜肌', t: 'p' }, { n: '腰方肌', t: 'p' }, { n: '臀中肌', t: 's' }], tags: ['core'], move: ['core_s'], equip: ['bodyweight'], diff: 'med',
    cues: ['手肘在肩膀正下方', '从头到脚踝保持一条直线', '下方髋部向上顶，避免下沉', '均匀呼吸，不要憋气'],
    neural: ['想象你的骨盆是一碗水——动作期间水绝对不能从侧面洒出来'],
    warnings: ['手肘疼痛：确认肘在肩下方', '腰痛：先用短杠杆（膝盖弯曲）'],
    mods: ['Short Lever（Verna 推荐）：膝盖弯曲叠放', '进阶：加髋部抬起'] },
  { id: 'glute-bridge-march', name: 'Glute Bridge March', muscles: [{ n: '臀大肌', t: 'p' }, { n: '核心', t: 's' }], tags: ['glute', 'core'], move: ['hinge', 'core_s'], equip: ['bodyweight'], diff: 'med',
    cues: ['先做标准桥到顶点并保持', '交替将一侧膝盖抬至 90°', '保持骨盆绝对水平', '动作要慢：2 秒抬起，2 秒放下'],
    neural: ['想象骨盆上放着一杯水，抬腿时水不能洒'],
    warnings: ['骨盆下沉是最常见错误', '腰部疼痛：降低桥的高度'],
    mods: ['Heels Elevated 版本', '仅做顶点保持不抬腿'] },
  { id: 'bench-dips', name: 'Bench Dips', muscles: [{ n: '肱三头肌', t: 'p' }, { n: '三角肌前束', t: 's' }], tags: ['chest', 'shoulder'], move: ['push'], equip: ['bodyweight', 'bench'], diff: 'easy',
    cues: ['双手放凳子边缘，手指朝前', '膝盖弯曲 90°，双脚踩地', '身体紧贴凳子下沉，肘部向后弯', '上推时肘部伸直但不锁死'],
    neural: ['专注于肱三头肌——想象用肘关节后侧把自己推起来'],
    warnings: ['肩膀疼痛：不要下沉过深', '脚越远越难，初期保持膝盖弯曲'],
    mods: ['双脚靠近身体：降低难度', '双脚抬高（进阶）'] },
  { id: 'step-up', name: 'Step-Up', muscles: [{ n: '股四头肌', t: 'p' }, { n: '臀大肌', t: 'p' }], tags: ['glute', 'hip'], move: ['squat', 'hinge'], equip: ['bodyweight', 'bench'], diff: 'med',
    cues: ['台阶高度在膝盖以下（胫骨中段）开始', '前脚完全踩实台面，驱动力来自前腿', '后腿上来后不借台面发力', '向心和离心各控制 2 秒'],
    neural: ['把前脚想象成一个活塞——有控制地推地，臀和股四头同时点火'],
    warnings: ['台面太高代偿腰部', '膝关节内扣：追踪第二脚趾'],
    mods: ['从最低台阶逐步加高', '手持哑铃：增加负荷'] },
  { id: 'shoulder-taps', name: 'Shoulder Taps', muscles: [{ n: '核心稳定', t: 'p' }, { n: '肩袖', t: 's' }], tags: ['core', 'shoulder'], move: ['core_s', 'push'], equip: ['bodyweight'], diff: 'med',
    cues: ['平板支撑位，双手与肩同宽', '单手触碰对侧肩膀，立即放回', '骨盆全程水平——不要左右晃动', '核心像防弹背心一样提前收紧'],
    neural: ['想象骨盆焊在地上——每次抬手都要提前抵御地面给核心的一拳'],
    warnings: ['速度越快越容易旋转——慢才是对的（Verna 特别标注）', '双脚适当分开增加支撑面'],
    mods: ['双腿宽距', '膝盖着地：降低核心要求'] },
  { id: 'inchworm', name: 'Inchworm', muscles: [{ n: '腘绳肌', t: 'p' }, { n: '核心', t: 's' }], tags: ['core', 'back'], move: ['hinge', 'core_s', 'mobility'], equip: ['bodyweight'], diff: 'easy',
    cues: ['站立开始，双手摸地（膝盖微屈）', '手往前爬至平板支撑位', '保持 1 秒，再用脚走回来', '缓慢进行，感受每个姿势过渡'],
    neural: ['这是用全身动作语言跟神经系统说：我们今天要动了'],
    warnings: ['腰部塌陷：核心抗伸展是重点', '头晕：放慢速度'],
    mods: ['缩小爬行距离', '加俯卧撑（进阶）'] },
  { id: 'deadbug', name: 'Deadbug w/ Wall Press', muscles: [{ n: '深层核心', t: 'p' }, { n: '髂腰肌', t: 's' }], tags: ['core'], move: ['core_s'], equip: ['bodyweight', 'wall'], diff: 'med',
    cues: ['仰卧，腰部自然曲度贴地', '双手推墙，提供对侧张力', '交替伸展对侧腿，核心对抗旋转', '呼气时感受深层核心激活'],
    neural: ['把腰部想象成一个被按死的遥控器——腿不管怎么动，腰都不离开地面'],
    warnings: ['腰部拱起离地：缩小腿的伸展幅度', '越慢效果越好——这是神经控制训练'],
    mods: ['无墙版本：双手放胸前', '加弹力带：增加对抗张力'] },
  { id: 'prone-swimmer', name: 'Prone Swimmer Hovers', muscles: [{ n: '竖脊肌', t: 'p' }, { n: '臀大肌', t: 's' }], tags: ['back', 'shoulder'], move: ['pull', 'core_s'], equip: ['bodyweight'], diff: 'easy',
    cues: ['俯卧，双臂 Y 字或 T 字形伸展', '收紧臀部和背部，手臂和腿微微离地', '保持 2-3 秒，感受脊柱两侧发力', '下降时控制，不要直接放落'],
    neural: ['想象你要用整个后背把天花板托起来'],
    warnings: ['颈部不要过度抬起：眼睛看地面', '离地 1-2cm 的激活就足够'],
    mods: ['单侧版本：对侧手臂和腿', '加弹力带增加肩部负荷'] },
  { id: 'cat-cow', name: 'Cat-Cow w/ Belly Breathing', muscles: [{ n: '脊柱活动度', t: 'p' }, { n: '横膈膜', t: 's' }], tags: ['back', 'core'], move: ['mobility'], equip: ['bodyweight'], diff: 'easy',
    cues: ['四点跪姿，腕在肩下，膝在髋下', '猫式：呼气，脊柱向天花板弓起', '牛式：吸气，肚子向下，抬头', '节奏与呼吸完全同步'],
    neural: ['让呼吸来驱动动作，而不是肌肉——顺从身体的节律'],
    warnings: ['颈椎不要用力', '腕部压力大：拳头支撑'],
    mods: ['坐姿版：坐椅子上做脊柱屈伸'] },
  { id: '9090', name: '90-90 Hip Rotations', muscles: [{ n: '髋内旋肌群', t: 'p' }, { n: '梨状肌', t: 's' }], tags: ['hip'], move: ['mobility'], equip: ['bodyweight'], diff: 'easy',
    cues: ['坐地，双腿 90-90°', '躯干直立，重心缓慢向前腿转换', '感受髋关节内外旋', '换侧通过髋关节旋转'],
    neural: ['想象大腿骨在髋臼里旋转——骨盆是地球，大腿骨是卫星'],
    warnings: ['膝关节疼痛：调整角度找无痛范围', '不要强迫幅度'],
    mods: ['靠墙坐：提供躯干支撑'] },
  { id: 'spiderman', name: 'Spiderman Lunge', muscles: [{ n: '髋屈肌群', t: 'p' }, { n: '臀大肌', t: 's' }], tags: ['hip'], move: ['squat', 'mobility'], equip: ['bodyweight'], diff: 'easy',
    cues: ['俯卧撑位开始，一只脚跨步至同侧手外侧', '前脚踩实，骨盆下沉', '可加上臂开合增加胸椎旋转', '控制换侧，每次下沉 2-3 秒'],
    neural: ['每一步落地，都在告诉神经系统：这个活动范围是安全的'],
    warnings: ['前膝不要内扣', '腰部不要塌陷'],
    mods: ['减小跨步幅度', '加旋转：手臂向上'] },
  { id: 'toetouch', name: 'Toe Touch to Squat + Overhead Reach', muscles: [{ n: '腘绳肌', t: 'p' }, { n: '髋关节', t: 's' }], tags: ['hip', 'shoulder'], move: ['hinge', 'mobility'], equip: ['bodyweight'], diff: 'easy',
    cues: ['站立，双手摸脚趾（膝盖微屈）', '过渡到深蹲位，双手向头顶伸展', '从深蹲站起——连续流动动作', '缓慢进行，感受每个过渡'],
    neural: ['这个动作在用全身幅度跟神经系统打招呼'],
    warnings: ['腰部圆背：膝盖弯曲更多', '头晕：减慢过渡速度'],
    mods: ['只做触脚趾', '只做深蹲'] },
];

export function exerciseById(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id);
}

export function filterExercises(f: { muscle?: MuscleTag | 'all'; equip?: Equip | 'all'; move?: MoveTag | 'all' }): Exercise[] {
  return EXERCISES.filter((ex) =>
    (!f.muscle || f.muscle === 'all' || ex.tags.includes(f.muscle)) &&
    (!f.equip || f.equip === 'all' || ex.equip.includes(f.equip)) &&
    (!f.move || f.move === 'all' || ex.move.includes(f.move)),
  );
}
