/**
 * exif-gps — 零依赖 JPEG EXIF 解析:拍摄坐标(GPS IFD)+ 拍摄时间(DateTimeOriginal)。
 *
 * 批次 63(用户点名):相册上传的照片,识别**拍摄时**的地点与时间,而不是上传时 ——
 * 批量导入旧照片也能扩充时间线。只解析需要的四个字段,~120 行,不引 exifr 等大库;
 * compressToDataUrl 会剥掉 EXIF,所以必须在压缩**之前**从原始文件字节读。
 * 非 JPEG / 无 EXIF / 字段缺失一律返回 null 字段,绝不抛错拦截上传。
 */

export interface ExifCapture {
  lat: number | null;
  lon: number | null;
  /** 拍摄时间(本地无时区,EXIF 惯例)→ ISO 串;无则 null */
  takenAt: string | null;
}

const EMPTY: ExifCapture = { lat: null, lon: null, takenAt: null };

export async function readExifCapture(file: Blob): Promise<ExifCapture> {
  try {
    // EXIF 都在文件头部;读 256KB 足够(APP1 段上限 64KB)
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return EMPTY; // 非 JPEG

    // 找 APP1(0xFFE1)"Exif\0\0" 段
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1) {
        if (offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966 /* 'Exif' */) {
          return parseTiff(view, offset + 10);
        }
      }
      if ((marker & 0xff00) !== 0xff00 || size < 2) break;
      offset += 2 + size;
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

function parseTiff(view: DataView, tiff: number): ExifCapture {
  const le = view.getUint16(tiff) === 0x4949; // 'II' little-endian
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  if (u16(tiff + 2) !== 0x2a) return EMPTY;

  const ifd0 = tiff + u32(tiff + 4);
  let gpsIfd = 0;
  let exifIfd = 0;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    const tag = u16(e);
    if (tag === 0x8825) gpsIfd = tiff + u32(e + 8);   // GPS IFD pointer
    if (tag === 0x8769) exifIfd = tiff + u32(e + 8);  // Exif IFD pointer
  }

  let lat: number | null = null;
  let lon: number | null = null;
  if (gpsIfd > tiff && gpsIfd + 2 <= view.byteLength) {
    let latRef = 'N'; let lonRef = 'E';
    let latV: number | null = null; let lonV: number | null = null;
    const ng = u16(gpsIfd);
    for (let i = 0; i < ng; i++) {
      const e = gpsIfd + 2 + i * 12;
      const tag = u16(e);
      if (tag === 1) latRef = String.fromCharCode(view.getUint8(e + 8));       // GPSLatitudeRef
      if (tag === 3) lonRef = String.fromCharCode(view.getUint8(e + 8));       // GPSLongitudeRef
      if (tag === 2) latV = readDms(view, tiff + u32(e + 8), le);              // GPSLatitude
      if (tag === 4) lonV = readDms(view, tiff + u32(e + 8), le);              // GPSLongitude
    }
    if (latV != null && lonV != null && (latV !== 0 || lonV !== 0)) {
      lat = latRef === 'S' ? -latV : latV;
      lon = lonRef === 'W' ? -lonV : lonV;
    }
  }

  let takenAt: string | null = null;
  if (exifIfd > tiff && exifIfd + 2 <= view.byteLength) {
    const ne = u16(exifIfd);
    for (let i = 0; i < ne; i++) {
      const e = exifIfd + 2 + i * 12;
      if (u16(e) === 0x9003) { // DateTimeOriginal "YYYY:MM:DD HH:MM:SS"
        const p = tiff + u32(e + 8);
        let str = '';
        for (let j = 0; j < 19 && p + j < view.byteLength; j++) str += String.fromCharCode(view.getUint8(p + j));
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(str);
        if (m) {
          const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
          if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
        }
        break;
      }
    }
  }

  return { lat, lon, takenAt };
}

/** GPS 坐标是 3 个 RATIONAL(度/分/秒,各为 u32/u32) */
function readDms(view: DataView, o: number, le: boolean): number | null {
  if (o + 24 > view.byteLength) return null;
  const r = (i: number) => {
    const num = view.getUint32(o + i * 8, le);
    const den = view.getUint32(o + i * 8 + 4, le) || 1;
    return num / den;
  };
  const v = r(0) + r(1) / 60 + r(2) / 3600;
  return Number.isFinite(v) ? v : null;
}
