import { Request } from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ServiceError } from './errors.js';

export interface ParsedMultipartResult {
  fields: Record<string, string>;
  file?: {
    fieldName: string;
    originalName: string;
    mimeType: string;
    extension: '.jpg' | '.png';
    buffer: Buffer;
  };
}

const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MB (TSD 3.1 & FSD-2.8)

const detectImageExtension = (buf: Buffer): '.jpg' | '.png' | null => {
  // JPEG magic bytes: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return '.jpg';
  }
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return '.png';
  }
  return null;
};

/**
 * Parser multipart/form-data ringan tanpa dependency eksternal untuk unggah bukti transfer
 * (JPG/JPEG/PNG, maks 10 MB) + validasi magic bytes.
 */
export const parsePaymentProofMultipart = async (
  req: Request
): Promise<ParsedMultipartResult> => {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!contentType.toLowerCase().includes('multipart/form-data') || !boundaryMatch) {
    throw new ServiceError(
      422,
      'ERR-FILE-01',
      'Permintaan harus menggunakan multipart/form-data dengan berkas JPG atau PNG (maksimal 10 MB).',
      'berkas_bukti'
    );
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBodyBytes = MAX_PROOF_BYTES + 256 * 1024;

  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        reject(
          new ServiceError(
            422,
            'ERR-FILE-01',
            'Berkas harus berformat JPG atau PNG dengan ukuran maksimal 10 MB.',
            'berkas_bukti'
          )
        );
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve());
    req.on('error', (err) => reject(err));
  });

  const bodyBuffer = Buffer.concat(chunks);
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const headerSep = Buffer.from('\r\n\r\n');

  const fields: Record<string, string> = {};
  let uploadedFile: ParsedMultipartResult['file'];

  let pos = bodyBuffer.indexOf(boundaryBuf);
  while (pos !== -1) {
    const nextPos = bodyBuffer.indexOf(boundaryBuf, pos + boundaryBuf.length);
    if (nextPos === -1) break;

    // Skip boundary + CRLF
    let partStart = pos + boundaryBuf.length;
    if (bodyBuffer[partStart] === 0x0d && bodyBuffer[partStart + 1] === 0x0a) {
      partStart += 2;
    }
    // Trim trailing CRLF sebelum boundary berikutnya
    let partEnd = nextPos;
    if (partEnd >= 2 && bodyBuffer[partEnd - 2] === 0x0d && bodyBuffer[partEnd - 1] === 0x0a) {
      partEnd -= 2;
    }

    const part = bodyBuffer.subarray(partStart, partEnd);
    const sepIdx = part.indexOf(headerSep);
    if (sepIdx !== -1) {
      const headerText = part.subarray(0, sepIdx).toString('utf8');
      const contentBuf = part.subarray(sepIdx + 4);

      const nameMatch = headerText.match(/name="([^"]+)"/i);
      const filenameMatch = headerText.match(/filename="([^"]*)"/i);
      const mimeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (filenameMatch) {
          const originalName = filenameMatch[1];
          const mimeType = (mimeMatch ? mimeMatch[1].trim() : '').toLowerCase();

          if (contentBuf.length === 0 || contentBuf.length > MAX_PROOF_BYTES) {
            throw new ServiceError(
              422,
              'ERR-FILE-01',
              'Berkas harus berformat JPG atau PNG dengan ukuran maksimal 10 MB.',
              'berkas_bukti'
            );
          }

          const ext = detectImageExtension(contentBuf);
          const allowedMime =
            !mimeType ||
            mimeType === 'image/jpeg' ||
            mimeType === 'image/jpg' ||
            mimeType === 'image/png';

          if (!ext || !allowedMime) {
            throw new ServiceError(
              422,
              'ERR-FILE-01',
              'Berkas harus berformat JPG atau PNG dengan ukuran maksimal 10 MB.',
              'berkas_bukti'
            );
          }

          uploadedFile = {
            fieldName,
            originalName,
            mimeType: ext === '.png' ? 'image/png' : 'image/jpeg',
            extension: ext,
            buffer: Buffer.from(contentBuf),
          };
        } else {
          fields[fieldName] = contentBuf.toString('utf8').trim();
        }
      }
    }

    pos = nextPos;
  }

  return { fields, file: uploadedFile };
};

/**
 * Menyimpan berkas bukti transfer ke direktori penyimpanan di luar web root dengan nama acak UUID.
 */
export const savePaymentProofFile = async (
  buffer: Buffer,
  extension: '.jpg' | '.png'
): Promise<string> => {
  const storageDir = path.resolve(process.cwd(), 'storage', 'payment-proofs');
  await fs.mkdir(storageDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}${extension}`;
  const fullPath = path.join(storageDir, fileName);
  await fs.writeFile(fullPath, buffer);
  return `storage/payment-proofs/${fileName}`;
};
