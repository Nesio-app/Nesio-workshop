/**
 * telemetry-labels —— 埋点事件名 → 人话(Bug4 图17「事件说人话」)。
 *
 * 面板上原来直接印 `memory_saved` / `ai_route` / `family_sharing_open`。
 * 这些是给代码看的键,不是给人看的名字 —— 看板的人得先在脑子里翻译一遍。
 *
 * 一份表放这里,`/admin` 的 Top 事件与漏斗、洞察·运营的行为画像都用它,
 * 不再各写一份(此前 AdminOpsPanel 自带一份 16 条的私表,还混进了三个
 * 根本不存在的事件名 —— mood_open2 / capture_camera_open / feature_used)。
 *
 * 红线:**没登记的照原样印**。猜一个好听的名字比印原始键更糟 ——
 * 印原始键至少还能 grep 到它在哪埋的。
 */

/** 键 = track() 里那个字符串;值 = [中文, English]。 */
export const TELEMETRY_LABEL: Record<string, [string, string]> = {
  app_open: ['打开 App', 'Open app'],
  first_memory: ['记下第一条', 'First memory'],
  memory_saved: ['存下一条记忆', 'Memory saved'],
  chat_send: ['和念念说话', 'Chat with Nessa'],
  capture_voice_open: ['开口说一句', 'Voice note'],
  travel_camera_open: ['拍小票 / 拍东西', 'Camera capture'],
  cooking_camera_open: ['拍食材', 'Pantry camera'],
  barcode_scan: ['扫条码', 'Scan barcode'],
  share_receive: ['从别处分享进来', 'Shared in'],
  share_save: ['把分享存成记忆', 'Saved a share'],
  wechat_reading_import: ['导入微信读书', 'Import WeRead'],

  insights_open: ['打开洞察', 'Open insights'],
  inventory_open: ['打开物品', 'Open items'],
  cooking_open: ['打开美味', 'Open cooking'],
  freeze_open: ['打开冷冻仓', 'Open vault'],
  mood_open: ['记一次心情', 'Log mood'],
  rewards_open: ['逛奖品', 'Rewards'],
  calendar_create_open: ['建个日程', 'Create event'],
  family_sharing_open: ['打开家庭共享', 'Family sharing'],
  brief_open: ['打开每日简报', 'Open daily brief'],
  brief_play: ['听简报', 'Play brief'],
  routine_brief_open: ['打开例行简报', 'Routine brief'],

  workout_start: ['开始跟练', 'Start workout'],
  routine_train_start: ['开始例行训练', 'Start routine'],
  routine_done: ['做完一件例行', 'Routine done'],
  routine_skip: ['跳过一件例行', 'Routine skipped'],
  routine_delete: ['删掉一件例行', 'Routine deleted'],
  focus_session: ['专注了一段', 'Focus session'],

  mirror_letter_generated: ['生成多面镜信', 'Mirror letter made'],
  mirror_letter_saved: ['存下多面镜信', 'Mirror letter saved'],

  feature_vote: ['给功能投票', 'Feature vote'],
  feature_wish: ['许愿一个功能', 'Feature wish'],
  plan_notify_optin: ['打开提醒推送', 'Notifications on'],
  pro_gate_shown: ['碰到 Pro 门', 'Hit the Pro gate'],
  impulse_persuaded: ['冲动被劝住了', 'Impulse talked down'],
  impulse_not_persuaded: ['冲动没劝住', 'Impulse not talked down'],
  experiment_checkin: ['实验打卡', 'Experiment check-in'],
  exp_exposure: ['实验分组曝光', 'Experiment exposure'],

  ai_route: ['调了一次 AI', 'AI call'],
  client_error: ['用户那边报错', 'Client error'],
  private_prune: ['清理私密数据', 'Private data pruned'],
};

/** 没登记就照原样印 —— 不猜。 */
export function telemetryLabel(name: string, en = false): string {
  const m = TELEMETRY_LABEL[name];
  return m ? (en ? m[1] : m[0]) : name;
}
