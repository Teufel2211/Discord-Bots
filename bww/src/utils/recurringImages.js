const crypto = require('node:crypto');

const BUCKET = 'bww-recurring-images';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function getStorageConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) throw new Error('Supabase Storage ist nicht konfiguriert.');
  return { url, key };
}

function extensionFor(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };
  const extension = extensions[mime];
  if (!extension) throw new Error('Bitte ein PNG-, JPG-, GIF-, WEBP- oder AVIF-Bild hochladen.');
  return { mime, extension };
}

async function uploadBuffer(buffer, contentType, guildId) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Das Bild darf maximal 10 MB groß sein.');
  }
  const { mime, extension } = extensionFor(contentType);
  const { url, key } = getStorageConfig();
  const filePath = guildId + '/' + crypto.randomUUID() + '.' + extension;
  const response = await fetch(url + '/storage/v1/object/' + BUCKET + '/' + filePath, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': mime,
      'x-upsert': 'false',
      'cache-control': '31536000'
    },
    body: buffer
  });
  if (!response.ok) throw new Error('Bild konnte nicht dauerhaft gespeichert werden (Storage HTTP ' + response.status + ').');
  return url + '/storage/v1/object/public/' + BUCKET + '/' + filePath;
}

async function saveDiscordAttachment(attachment, guildId) {
  if (!attachment?.url) return '';
  if (attachment.size && attachment.size > MAX_IMAGE_BYTES) throw new Error('Das Bild darf maximal 10 MB groß sein.');
  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('Discord-Bild konnte nicht geladen werden (HTTP ' + response.status + ').');
  const contentType = response.headers.get('content-type') || attachment.contentType || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadBuffer(buffer, contentType, guildId);
}

async function migrateDiscordImageUrl(imageUrl, guildId) {
  if (!imageUrl || !/^https?:\/\/(?:cdn|media)\.discordapp\.net\//i.test(imageUrl)) return imageUrl || '';
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Das bisherige Discord-Bild ist bereits abgelaufen und kann nicht mehr übernommen werden.');
  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadBuffer(buffer, contentType, guildId);
}

module.exports = { saveDiscordAttachment, migrateDiscordImageUrl, MAX_IMAGE_BYTES, BUCKET };
