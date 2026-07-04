import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const profileCardPath = path.join(root, 'components', 'portal', 'NesioProfileCard.tsx');
// 旧代 Settings.tsx 已删;avatar 上传流程活在 NesioProfileCard(设置入口)
const settingsPath = path.join(root, 'components', 'portal', 'NesioProfileCard.tsx');
const profileSettingsRoutePath = path.join(root, 'app', 'api', 'cloud', 'profile-settings', 'route.ts');
const profileStorePath = path.join(root, 'lib', 'portal', 'profile.ts');
const packagePath = path.join(root, 'package.json');

// 批次 11:重载后换签名的逻辑上移到全站共享的 useProfileAvatar
// (此前只有设置页会刷新,主页读到过期签名 URL 就「头像丢失」)
const avatarHookPath = path.join(root, 'components', 'portal', 'use-profile-avatar.ts');

const profileCard = fs.readFileSync(profileCardPath, 'utf8');
const avatarHook = fs.readFileSync(avatarHookPath, 'utf8');
const settings = fs.readFileSync(settingsPath, 'utf8');
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
  'Avatar upload must call /api/cloud/assets with purpose=avatar before falling back to local-only storage.',
);
assert.match(
  profileCard,
  /fetchCloudAssetReadUrl\(\{\s*storagePath:\s*result\.storagePath\s*\}\)/s,
  'Uploaded avatar must request a signed read URL from /api/cloud/assets using the returned storagePath.',
);
assert.match(
  avatarHook,
  /avatarStoragePath[\s\S]*fetchCloudAssetReadUrl\(\{\s*storagePath\s*\}\)/s,
  'Stored avatarStoragePath must be refreshed through a signed read URL after page reload (shared hook).',
);
assert.match(
  profileCard,
  /useProfileAvatar/,
  'NesioProfileCard must consume the shared avatar hook so refresh logic stays global.',
);
assert.match(
  fs.readFileSync(path.join(root, 'components', 'portal', 'TodayFeed.tsx'), 'utf8'),
  /useProfileAvatar/,
  'Today header avatar must consume the shared avatar hook (fixes intermittent avatar loss).',
);
assert.match(
  profileCard,
  /saveCloudProfileSettings\(\{\s*avatarStoragePath:\s*result\.storagePath\s*\}\)/s,
  'Cloud profile settings must persist the private storagePath, not only a temporary/public URL.',
);
assert.match(
  profileCard,
  /saveProfileSettings\(\{[\s\S]*avatarUrl:\s*displayUrl[\s\S]*avatarStoragePath:\s*result\.storagePath[\s\S]*\}\)/s,
  'Successful cloud avatar upload must keep local display URL and private storagePath together.',
);
assert.match(
  profileCard,
  /readAvatarFile\(file\)[\s\S]*saveProfileSettings\(\{[\s\S]*avatarUrl:\s*avatar[\s\S]*avatarStoragePath:\s*['"]{2}[\s\S]*\}\)/s,
  'Avatar upload must keep a local fallback when cloud storage is unavailable.',
);
assert.match(
  settings,
  /createAppApiClient/,
  'Settings avatar upload must use the same app API client cloud path as the profile page.',
);
assert.match(
  settings,
  /uploadCloudAsset\(\{\s*file,\s*purpose:\s*['"]avatar['"]/s,
  'Settings avatar upload must call /api/cloud/assets with purpose=avatar before falling back to local-only storage.',
);
assert.match(
  settings,
  /fetchCloudAssetReadUrl\(\{\s*storagePath:\s*result\.storagePath\s*\}\)/s,
  'Settings uploaded avatar must request a signed read URL from /api/cloud/assets using the returned storagePath.',
);
assert.match(
  settings,
  /saveCloudProfileSettings\(\{\s*avatarStoragePath:\s*result\.storagePath\s*\}\)/s,
  'Settings avatar upload must persist avatarStoragePath to cloud profile settings.',
);
assert.match(
  settings,
  /saveProfileSettings\(\{[\s\S]*avatarUrl:\s*displayUrl[\s\S]*avatarStoragePath:\s*result\.storagePath[\s\S]*\}\)/s,
  'Settings successful cloud avatar upload must keep local display URL and private storagePath together.',
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
