#!/bin/bash
# 本地验「登录路径时序」。dev server 需已带 SUPABASE_* / CLOUD_DB_ENABLED 起在 3000。
# 注意别用 pkill -f fake-supabase —— 那个模式会连调用它的 shell 一起杀掉(踩过)。
set +e
cd /home/user/Nesio-workshop
PIDF=/tmp/fakesb.pid

start_fake() {   # $1=profile 延迟ms  $2=user 延迟ms
  [ -f "$PIDF" ] && kill "$(cat $PIDF)" 2>/dev/null
  sleep 1
  FAKE_PORT=54321 PROFILE_DELAY_MS="${1:-0}" USER_DELAY_MS="${2:-0}" node scripts/auth-probe/fake-supabase.mjs >/dev/null 2>&1 &
  echo $! > "$PIDF"
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null --max-time 30 http://127.0.0.1:54321/__ready && return 0
    sleep 0.3
  done
  echo "假 Supabase 没起来"; exit 1
}

probe() { curl -s -b "baohe_auth_access=$1" -o /tmp/sess.json -w "%{time_total}" http://localhost:3000/api/auth/session; }
# 只带 refresh、不带 access —— 走续期分支
probe_refresh() { curl -s -b "baohe_auth_refresh=$1" -o /tmp/sess.json -w "%{time_total}" http://localhost:3000/api/auth/session; }

run() {  # $1=标题 $2=profile延迟 $3=user延迟 $4=等待秒 $5=cookie
  echo "════ $1 ════"
  start_fake "$2" "$3"
  T=$(probe "$5")
  echo "  /api/auth/session 返回用时: ${T}s"
  echo "  等 $4 秒…"; sleep "$4"
  echo "  ── 假 Supabase 收到的请求 ──"
  sed 's/^/  /' /tmp/fake-supabase.log
  echo
}

run "场景 A:profile 后端慢 3 秒" 3000 0 7 tok_a
run "场景 B:profile 后端挂死 20 秒(验 8 秒超时)" 20000 0 11 tok_b
run "场景 C:user 查询慢 2 秒(确认 knownUser 生效,响应后不再重复查 user)" 0 2000 7 tok_c

echo "════ 场景 D:只带 refresh cookie(续期分支,它也改了 after)════"
start_fake 3000 0
T=$(probe_refresh rtok)
echo "  /api/auth/session 返回用时: ${T}s"
python3 -c "
import json;d=json.load(open('/tmp/sess.json'))
print('  响应:', {k:d[k] for k in ('loggedIn','status','hasRefreshToken') if k in d})"
echo "  等 7 秒…"; sleep 7
echo "  ── 假 Supabase 收到的请求 ──"
sed 's/^/  /' /tmp/fake-supabase.log
echo

[ -f "$PIDF" ] && kill "$(cat $PIDF)" 2>/dev/null
exit 0
