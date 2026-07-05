import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const profileCardPath = path.join(root, 'components', 'portal', 'NesioProfileCard.tsx');
const profileSettingsRoutePath = path.join(root, 'app', 'api', 'cloud', 'profile-settings', 'route.ts');
const profileStorePath = path.join(root, 'lib', 'portal', 'profile.ts');
const packagePath = path.join(root, 'package.json');

// 批次 11:重载后换签名的逻辑上移到全站共享的 useProfileAvatar。
// 批次 34:头像「时不时消失」根治 —— 上传时先存一份永久本地 data: 头像(不会像签名 URL 过期),
//         云端只存 storagePath 做跨设备;hook 只在没有本地永久头像时才换签名 URL。
const avatarHookPath = path.join(root, 'components', 'portal', 'use-profile-avatar.ts');

const profileCard = fs.readFileSync(profileCardPath, 'utf8');
const avatarHook = fs.readFileSync(avatarHookPath, 'utf8');
const profileSettingsRoute = fs.readFileSync(profileSettingsRoutePath, 'utf8');
const profileStore = fs.readFileSync(profileStorePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

assert.match(
  profileCard,
  /createAppApiClient/,
  'NesioProfileCard must use the app API client for cloud-backed avatar upload.',
);
assert.match(
  profileCard,
  /uploadCloudAsset\(\{\s*file,\s*purpose:\s*['"]avatar['"]/s,
  'Avatar upload must call /api/cloud/assets with purpose=avatar for cross-device storage.',
);
// 批次 34:上传必须先落一份永久本地 data: 头像(readAvatarFile → saveProfileSettings avatarUrl),
// 这样签名 URL 过期也不会「头像消失」。
assert.match(
  profileCard,
  /readAvatarFile\(file\)[\s\S]{0,200}saveProfileSettings\(\{\s*avatarUrl:\s*avatar\s*\}\)/s,
  'Avatar upload must persist a permanent local data-URL avatar so it never expires.',
);
// 云端 storagePath 必须持久化(供跨设备),本地也存一份 storagePath 供 hook 换签名。
assert.match(
  profileCard,
  /saveCloudProfileSettings\(\{\s*avatarStoragePath:\s*result\.storagePath\s*\}\)/s,
  'Cloud profile settings must persist the private storagePath for cross-device avatar.',
);
assert.match(
  profileCard,
  /saveProfileSettings\(\{\s*avatarStoragePath:\s*result\.storagePath\s*\}\)/s,
  'Local profile settings must remember avatarStoragePath (for the hook to refresh a signed URL on other devices).',
);
assert.match(
  profileCard,
  /useProfileAvatar/,
  'NesioProfileCard must consume the shared avatar hook so refresh logic stays global.',
);
// hook:有 storagePath 时通过签名 read URL 刷新(仅在没有永久本地头像时)。
assert.match(
  avatarHook,
  /fetchCloudAssetReadUrl\(\{\s*storagePath\s*\}\)/s,
  'Shared avatar hook must refresh a signed read URL from storagePath (cross-device).',
);
assert.match(
  avatarHook,
  /avatarStoragePath\s*&&\s*!profile\.avatarUrl\?\.startsWith\(['"]data:['"]\)/s,
  'Hook must NOT overwrite a permanent local data: avatar with an expiring signed URL.',
);
assert.match(
  fs.readFileSync(path.join(root, 'components', 'portal', 'TodayFeed.tsx'), 'utf8'),
  /useProfileAvatar/,
  'Today header avatar must consume the shared avatar hook (fixes intermittent avatar loss).',
);
assert.match(
  profileSettingsRoute,
  /avatarStoragePath/,
  '/api/cloud/profile-settings must accept avatarStoragePath for private asset references.',
);
assert.match(
  profileStore,
  /avatarStoragePath/,
  'Local profile settings must remember avatarStoragePath for signed read refreshes.',
);
assert.equal(
  pkg.scripts['test:profile-avatar-cloud-sync'],
  'node scripts/profile-avatar-cloud-sync.test.mjs',
  'package.json must expose test:profile-avatar-cloud-sync.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:profile-avatar-cloud-sync/,
  'test:contracts must include profile avatar cloud sync coverage.',
);

console.log('profile avatar cloud sync contract passed');
