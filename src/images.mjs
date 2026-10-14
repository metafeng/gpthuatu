import codecs from '../vendor/image-codecs.cjs';
import { DrawError } from './errors.mjs';
const { PNG, jpeg } = codecs;
const MAX_PIXELS = 40_000_000;

export function inspectImage(data) {
  if (!Buffer.isBuffer(data) || data.length < 24) throw new DrawError('INVALID_IMAGE', '图片内容为空、过短或已损坏。');
  let decoded;
  let format;
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (!width || !height || width * height > MAX_PIXELS) throw new DrawError('INVALID_IMAGE', 'PNG 尺寸超出解码限制。');
    // Explicitly validate the container, CRCs and end marker before full pixel decoding.
    let offset = 8, ended = false, ihdr = false;
    while (offset + 12 <= data.length) {
      const len = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
      if (offset + 12 + len > data.length) throw new DrawError('INVALID_IMAGE', 'PNG 数据被截断。');
      if (!ihdr && (type !== 'IHDR' || len !== 13)) throw new DrawError('INVALID_IMAGE', 'PNG 缺少有效 IHDR。');
      ihdr = true;
      if (type === 'IEND') {
        if (len !== 0 || offset + 12 !== data.length) throw new DrawError('INVALID_IMAGE', 'PNG 结束标记无效。');
        ended = true;
      }
      offset += 12 + len;
      if (ended) break;
    }
    if (!ended) throw new DrawError('INVALID_IMAGE', 'PNG 缺少结束标记。');
    try { decoded = PNG.sync.read(data, { checkCRC: true }); } catch {
      throw new DrawError('INVALID_IMAGE', 'PNG 无法完整解码或校验失败。');
    }
    format = 'png';
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    if (data.at(-2) !== 0xff || data.at(-1) !== 0xd9) throw new DrawError('INVALID_IMAGE', 'JPEG 数据被截断。');
    try { decoded = jpeg.decode(data, { useTArray: true, tolerantDecoding: false,
      maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 256 }); } catch {
      throw new DrawError('INVALID_IMAGE', 'JPEG 无法完整解码或尺寸过大。');
    }
    format = 'jpeg';
  } else throw new DrawError('INVALID_IMAGE', '目前支持完整验证 PNG/JPEG，请先转换其他图片格式。');
  if (!decoded.width || !decoded.height || decoded.width * decoded.height > MAX_PIXELS) throw new DrawError('INVALID_IMAGE', '图片尺寸无效。');
  let hasTransparency = false;
  if (format === 'png') for (let i = 3; i < decoded.data.length; i += 4) {
    if (decoded.data[i] !== 255) { hasTransparency = true; break; }
  }
  return { format, width: decoded.width, height: decoded.height, size: `${decoded.width}x${decoded.height}`,
    bytes: data.length, hasTransparency };
}

export function decodeBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new DrawError('INVALID_RESPONSE', '接口返回的 Base64 图片为空或编码无效。');
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.toString('base64') !== value) throw new DrawError('INVALID_RESPONSE', '接口返回的 Base64 编码不完整。');
  return buffer;
}

function pixels(bytes) {
  return bytes[0] === 137 ? PNG.sync.read(bytes, { checkCRC: true })
    : jpeg.decode(bytes, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
}

export function convertFormat(bytes, format, quality = 100) {
  const image = pixels(bytes);
  if (format === 'png') return PNG.sync.write(image);
  // JPEG has no alpha channel: explicitly flatten over white instead of discarding alpha.
  const rgba = Buffer.from(image.data);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * alpha + 255 * (1 - alpha));
    rgba[i + 3] = 255;
  }
  return jpeg.encode({ width: image.width, height: image.height, data: rgba }, Math.max(1, quality)).data;
}

export function applyMask(source, generated, mask) {
  const original = pixels(source), edited = pixels(generated), selection = pixels(mask);
  if (original.width !== edited.width || original.height !== edited.height ||
      original.width !== selection.width || original.height !== selection.height) {
    throw new DrawError('MASK_SIZE_MISMATCH', '输出尺寸与参考图不同，无法可靠应用遮罩；已保留原始结果。');
  }
  const output = new PNG({ width: original.width, height: original.height });
  for (let i = 0; i < output.data.length; i += 4) {
    const weight = 1 - selection.data[i + 3] / 255;
    for (let c = 0; c < 4; c++) output.data[i + c] = Math.round(original.data[i + c] * (1 - weight) + edited.data[i + c] * weight);
  }
  return PNG.sync.write(output);
}
