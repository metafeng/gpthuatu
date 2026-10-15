export class DrawError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DrawError';
    this.code = code;
    Object.assign(this, details);
  }
}

export function redact(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[redacted]');
  }
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/https?:\/\/[^\s"<>]+/g, '[remote URL]')
    .slice(0, 600);
}

export function safeError(error, secrets = []) {
  return {
    success: false,
    code: error.code ?? 'LOCAL_ERROR',
    message: redact(error.message ?? '操作失败', secrets),
    ...(error.status ? { status: error.status } : {}),
    ...(error.requestId ? { requestId: redact(error.requestId, secrets) } : {}),
    ...(error.attempts ? { attempts: error.attempts } : {}),
    ...(error.uncertain ? { uncertain: true } : {}),
    ...(error.files ? { files: error.files } : {}),
    ...(error.manifest ? { manifest: error.manifest } : {}),
    ...(error.provider ? { provider: error.provider } : {}),
    ...(error.initialProvider ? { initialProvider: error.initialProvider } : {}),
    ...(error.failover ? { failover: error.failover } : {}),
    ...(error.attemptLog ? { attemptLog: error.attemptLog } : {}),
    // Only known public setup pages may bypass signed-URL redaction.
    ...(['https://fangxinapi.com/keys', 'https://dashboard.ttapi.io', 'https://platform.openai.com/api-keys'].includes(error.setupUrl) ? { setupUrl: error.setupUrl } : {}),
  };
}
