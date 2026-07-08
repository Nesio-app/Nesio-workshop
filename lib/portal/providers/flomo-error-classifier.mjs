const FLOMO_AUTH_ERROR_PATTERN = /登录|login|过期|无效/i;

export function isFlomoAuthErrorMessage(error) {
  return FLOMO_AUTH_ERROR_PATTERN.test(String(error || ''));
}

