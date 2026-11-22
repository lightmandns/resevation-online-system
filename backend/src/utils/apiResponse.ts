import { Response } from 'express';

export interface ApiErrorItem {
  code: string;
  field?: string;
}

export interface PaginationMeta {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message = 'Berhasil',
  statusCode = 200
): Response => {
  return res.status(statusCode).json({
    status: 'success',
    data,
    message,
    errors: null,
  });
};

export const sendPaginated = <T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
  message = 'Berhasil',
  statusCode = 200
): Response => {
  return res.status(statusCode).json({
    status: 'success',
    data,
    meta,
    message,
    errors: null,
  });
};

export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  errors: ApiErrorItem[] = []
): Response => {
  return res.status(statusCode).json({
    status: 'error',
    data: null,
    message,
    errors: errors.length > 0 ? errors : null,
  });
};

export const formatWibIso = (date: Date): string => {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}` +
    `T${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())}+07:00`
  );
};

/**
 * JSON replacer global untuk Express (`app.set('json replacer', wibJsonReplacer)`).
 * Mengonversi seluruh nilai Date menjadi ISO 8601 WIB (+07:00) sesuai TSD Bagian 3.1.
 */
export function wibJsonReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  if (this && typeof this === 'object' && this[key] instanceof Date) {
    return formatWibIso(this[key] as Date);
  }
  return value;
}

export const parsePagination = (
  pageRaw: unknown,
  perPageRaw: unknown
): { page: number; perPage: number; offset: number } => {
  const parsedPage = Number.parseInt(String(pageRaw ?? '1'), 10);
  const parsedPerPage = Number.parseInt(String(perPageRaw ?? '15'), 10);

  const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const perPage =
    Number.isNaN(parsedPerPage) || parsedPerPage < 1
      ? 15
      : Math.min(parsedPerPage, 100);

  return {
    page,
    perPage,
    offset: (page - 1) * perPage,
  };
};
