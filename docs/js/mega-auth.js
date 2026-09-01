const MEGA_MODULE_URL = "https://esm.sh/megajs@1.3.5/dist/main.browser-es.mjs";

const EMAIL_KEY = "docshelf_mega_email";

let megaStorage = null;
let megaEmail = null;
let loginPromise = null;

export function isMegaConnected() {
  return Boolean(megaStorage);
}

export function getMegaEmail() {
  return megaEmail || sessionStorage.getItem(EMAIL_KEY) || "";
}

export function getMegaStorage() {
  if (!megaStorage) {
    throw new Error("يلزم تسجيل الدخول إلى MEGA أولاً.");
  }
  return megaStorage;
}

export function logoutMega() {
  try {
    megaStorage?.close?.();
  } catch {
    /* ignore */
  }
  megaStorage = null;
  megaEmail = null;
  loginPromise = null;
  sessionStorage.removeItem(EMAIL_KEY);
}

export async function loginToMega(email, password) {
  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("أدخل بريد MEGA وكلمة المرور.");
  }

  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    logoutMega();
    const { Storage } = await import(MEGA_MODULE_URL);
    const storage = new Storage({
      email: normalizedEmail,
      password: normalizedPassword,
    });
    await storage.ready;
    megaStorage = storage;
    megaEmail = normalizedEmail;
    sessionStorage.setItem(EMAIL_KEY, normalizedEmail);
    return storage;
  })();

  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}
