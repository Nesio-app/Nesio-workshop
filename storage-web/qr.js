/* QR 容器编码 · rearbase://c/{CODE} */

const QR_PREFIX = 'rearbase://c/';

function parseContainerQr(text) {
  if (!text) return null;
  const t = text.trim();
  if (t.startsWith(QR_PREFIX)) return t.slice(QR_PREFIX.length).toUpperCase();
  if (/^RB-[A-Z0-9]{2,3}-\d{3,4}$/i.test(t)) return t.toUpperCase();
  return null;
}

function containerQrPayload(code) {
  return QR_PREFIX + code;
}

function nextContainerCode(spaceId, containers) {
  const abbr = { master: 'MS', kitchen: 'KT', desk: 'DK' }[spaceId] || spaceId.slice(0, 2).toUpperCase();
  const re = new RegExp(`^RB-${abbr}-(\\d+)$`, 'i');
  let max = 0;
  containers.forEach((c) => {
    const m = c.code?.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `RB-${abbr}-${String(max + 1).padStart(3, '0')}`;
}

let qrScanner = null;

async function startQrScanner(elementId, onCode) {
  if (typeof Html5Qrcode === 'undefined') {
    onCode(null, '扫码库未加载');
    return;
  }
  await stopQrScanner();
  const el = document.getElementById(elementId);
  if (!el) return;

  qrScanner = new Html5Qrcode(elementId);
  const cameras = await Html5Qrcode.getCameras().catch(() => []);
  const cam = cameras.find((c) => /back|rear|environment/i.test(c.label)) || cameras[0];
  if (!cam) {
    onCode(null, '未找到摄像头，请检查权限');
    return;
  }

  await qrScanner.start(
    cam.id,
    { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 },
    (decoded) => {
      const code = parseContainerQr(decoded);
      if (code) {
        stopQrScanner();
        onCode(code, null);
      }
    },
    () => {}
  );
}

async function stopQrScanner() {
  if (!qrScanner) return;
  try {
    if (qrScanner.isScanning) await qrScanner.stop();
    await qrScanner.clear();
  } catch (_) { /* ignore */ }
  qrScanner = null;
}

async function renderQrToCanvas(canvas, code, size) {
  if (typeof QRCode === 'undefined') return false;
  await QRCode.toCanvas(canvas, containerQrPayload(code), {
    width: size || 200,
    margin: 2,
    color: { dark: '#f0f0f8', light: '#13131a' },
  });
  return true;
}
