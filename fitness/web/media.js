// 动作媒体：演示类型、肌肉区域、节奏、可选真人视频（Pexels CC0）
const MUSCLE_REGIONS = {
  glute: { zh: '臀大肌', color: '#e8612a' },
  quad: { zh: '股四头肌', color: '#f5c842' },
  ham: { zh: '腘绳肌', color: '#fb923c' },
  chest: { zh: '胸大肌', color: '#f87171' },
  core: { zh: '核心', color: '#3ecfb2' },
  back: { zh: '背部', color: '#60a5fa' },
  shoulder: { zh: '肩部', color: '#a78bfa' },
  tricep: { zh: '肱三头肌', color: '#f472b6' },
  hip: { zh: '髋关节', color: '#34d399' },
  calf: { zh: '小腿', color: '#94a3b8' },
};

const EX_MEDIA = {
  'glute-bridge': {
    demo: 'bridge', tempo: { down: 2, hold: 2, up: 1 },
    primary: ['glute'], secondary: ['ham', 'core'],
    video: 'https://videos.pexels.com/video-files/4755577/4755577-uhd_2560_1440_25fps.mp4',
    poster: 'https://images.pexels.com/photos/4755576/pexels-photo-4755576.jpeg?auto=compress&w=400',
  },
  'split-squat': {
    demo: 'lunge', tempo: { down: 3, hold: 1, up: 1 },
    primary: ['quad', 'glute'], secondary: ['hip', 'core'],
    video: 'https://videos.pexels.com/video-files/4761782/4761782-uhd_2560_1440_25fps.mp4',
    poster: 'https://images.pexels.com/photos/4761781/pexels-photo-4761781.jpeg?auto=compress&w=400',
  },
  'single-leg-rdl': {
    demo: 'hinge', tempo: { down: 3, hold: 1, up: 2 },
    primary: ['ham', 'glute'], secondary: ['back', 'core'],
    video: 'https://videos.pexels.com/video-files/4761782/4761782-uhd_2560_1440_25fps.mp4',
  },
  'incline-pushup': {
    demo: 'push', tempo: { down: 2, hold: 0, up: 1 },
    primary: ['chest'], secondary: ['shoulder', 'tricep', 'core'],
    video: 'https://videos.pexels.com/video-files/4761788/4761788-uhd_2560_1440_25fps.mp4',
  },
  'bear-squat': {
    demo: 'squat', tempo: { down: 3, hold: 1, up: 2 },
    primary: ['quad'], secondary: ['core', 'glute'],
    video: 'https://videos.pexels.com/video-files/4755577/4755577-uhd_2560_1440_25fps.mp4',
  },
  'side-plank': {
    demo: 'plank', tempo: { hold: 30 },
    primary: ['core'], secondary: ['shoulder', 'glute'],
    video: 'https://videos.pexels.com/video-files/4761788/4761788-uhd_2560_1440_25fps.mp4',
  },
  'glute-bridge-march': {
    demo: 'march', tempo: { down: 2, hold: 1, up: 2 },
    primary: ['glute'], secondary: ['core', 'ham'],
    video: 'https://videos.pexels.com/video-files/4755577/4755577-uhd_2560_1440_25fps.mp4',
  },
  'bench-dips': {
    demo: 'dip', tempo: { down: 2, hold: 0, up: 1 },
    primary: ['tricep'], secondary: ['chest', 'shoulder'],
    video: 'https://videos.pexels.com/video-files/4761788/4761788-uhd_2560_1440_25fps.mp4',
  },
  'step-up': {
    demo: 'step', tempo: { down: 2, hold: 1, up: 2 },
    primary: ['quad', 'glute'], secondary: ['hip'],
    video: 'https://videos.pexels.com/video-files/4761782/4761782-uhd_2560_1440_25fps.mp4',
  },
  'shoulder-taps': {
    demo: 'plank', tempo: { down: 2, hold: 1, up: 2 },
    primary: ['core'], secondary: ['shoulder'],
    video: 'https://videos.pexels.com/video-files/4761788/4761788-uhd_2560_1440_25fps.mp4',
  },
  'inchworm': {
    demo: 'mobility', tempo: { down: 3, hold: 1, up: 3 },
    primary: ['ham', 'core'], secondary: ['shoulder'],
    video: 'https://videos.pexels.com/video-files/4761788/4761788-uhd_2560_1440_25fps.mp4',
  },
  'deadbug': {
    demo: 'deadbug', tempo: { down: 2, hold: 1, up: 2 },
    primary: ['core'], secondary: ['hip'],
    video: 'https://videos.pexels.com/video-files/4755577/4755577-uhd_2560_1440_25fps.mp4',
  },
  'prone-swimmer': {
    demo: 'swim', tempo: { down: 2, hold: 2, up: 2 },
    primary: ['back'], secondary: ['glute', 'shoulder'],
    video: 'https://videos.pexels.com/video-files/4761788/4761788-uhd_2560_1440_25fps.mp4',
  },
  'cat-cow': {
    demo: 'mobility', tempo: { down: 3, hold: 1, up: 3 },
    primary: ['back', 'core'], secondary: ['hip'],
    video: 'https://videos.pexels.com/video-files/4755577/4755577-uhd_2560_1440_25fps.mp4',
  },
  '9090': {
    demo: 'mobility', tempo: { down: 3, hold: 2, up: 3 },
    primary: ['hip'], secondary: ['glute'],
    video: 'https://videos.pexels.com/video-files/4761782/4761782-uhd_2560_1440_25fps.mp4',
  },
  'spiderman': {
    demo: 'lunge', tempo: { down: 3, hold: 2, up: 2 },
    primary: ['hip'], secondary: ['glute', 'core'],
    video: 'https://videos.pexels.com/video-files/4761782/4761782-uhd_2560_1440_25fps.mp4',
  },
  'toetouch': {
    demo: 'mobility', tempo: { down: 3, hold: 1, up: 2 },
    primary: ['ham', 'hip'], secondary: ['core', 'shoulder'],
    video: 'https://videos.pexels.com/video-files/4755577/4755577-uhd_2560_1440_25fps.mp4',
  },
};

function getMediaForExercise(ex) {
  if (!ex) return null;
  return EX_MEDIA[ex.id] || {
    demo: ex.move?.[0] === 'squat' ? 'squat' : ex.move?.[0] === 'push' ? 'push' : ex.move?.[0] === 'hinge' ? 'hinge' : 'mobility',
    tempo: { down: 2, hold: 1, up: 1 },
    primary: ex.muscles.filter((m) => m.t === 'p').map((m) => muscleNameToRegion(m.n)),
    secondary: ex.muscles.filter((m) => m.t === 's').map((m) => muscleNameToRegion(m.n)),
  };
}

function muscleNameToRegion(name) {
  const map = {
    臀大肌: 'glute', 股四头肌: 'quad', 腘绳肌: 'ham', 胸大肌: 'chest', 核心: 'core',
    '深层核心': 'core', '核心稳定': 'core', 竖脊肌: 'back', 背部: 'back', '脊柱活动度': 'back',
    三角肌前束: 'shoulder', 肩袖: 'shoulder', 肱三头肌: 'tricep', 髂腰肌: 'hip',
    髋关节: 'hip', '髋内旋肌群': 'hip', '髋屈肌群': 'hip', 腹外斜肌: 'core', 腰方肌: 'back', 臀中肌: 'glute',
  };
  return map[name] || 'core';
}

function parseRepTarget(reps) {
  if (!reps) return { mode: 'reps', target: 8 };
  const s = String(reps).toLowerCase();
  if (s.includes('sec')) {
    const n = parseInt(s, 10) || 30;
    return { mode: 'time', target: n, perSide: s.includes('/side') || s.includes('/侧') };
  }
  if (s.includes('cycle')) return { mode: 'reps', target: parseInt(s, 10) || 5 };
  const nums = s.match(/\d+/g);
  const target = nums ? parseInt(nums[0], 10) : 8;
  return { mode: 'reps', target, perSide: s.includes('/side') || s.includes('/侧') };
}
