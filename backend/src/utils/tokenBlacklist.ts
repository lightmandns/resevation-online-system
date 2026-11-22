/**
 * In-memory JWT blacklist (pengganti sementara sebelum Redis aktif).
 * Token disimpan hingga waktu kadaluarsanya (exp) lalu dibersihkan otomatis.
 */
const blacklistedTokens = new Map<string, number>();

export const blacklistToken = (token: string, expSeconds?: number): void => {
  const expiresAtMs = expSeconds ? expSeconds * 1000 : Date.now() + 24 * 60 * 60 * 1000;
  blacklistedTokens.set(token, expiresAtMs);
};

export const isTokenBlacklisted = (token: string): boolean => {
  const expiresAtMs = blacklistedTokens.get(token);
  if (expiresAtMs === undefined) {
    return false;
  }
  if (Date.now() >= expiresAtMs) {
    blacklistedTokens.delete(token);
    return false;
  }
  return true;
};
