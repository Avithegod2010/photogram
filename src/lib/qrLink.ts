export interface QrLinks {
  qrPayload: string;
  handoffUrl: string | null;
}

export function buildQrLinks(rawLink: string): QrLinks {
  const token = extractToken(rawLink);
  if (!token) {
    return { qrPayload: rawLink, handoffUrl: null };
  }
  const tg = `tg://login?token=${token}`;
  return { qrPayload: tg, handoffUrl: tg };
}

function extractToken(link: string): string | null {
  const marker = "token=";
  const idx = link.indexOf(marker);
  if (idx === -1) return null;
  const rest = link.slice(idx + marker.length);
  const ampersand = rest.indexOf("&");
  const token = ampersand === -1 ? rest : rest.slice(0, ampersand);
  return token.length > 0 ? token : null;
}
