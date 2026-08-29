import { VAULT_PASSWORD } from "./config.js";
import {
  authenticateUser,
  getStoredUser,
  isAdmin,
  listPendingUsers,
  processApprovalAction,
  registerUser,
  setStoredUser,
} from "./auth-service.js";

const AUTH_KEY = "docshelf_auth";

let captchaAnswer = 0;

export function getVaultPassword() {
  return VAULT_PASSWORD;
}

export function getCurrentUser() {
  return getStoredUser();
}

export function isAuthenticated() {
  return sessionStorage.getItem(AUTH_KEY) === "1" && Boolean(getStoredUser());
}

function showAuthMessage(el, message, isError = true) {
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("hidden", !message);
  el.classList.toggle("auth-success", !isError && Boolean(message));
  el.classList.toggle("auth-error", isError && Boolean(message));
}

function switchAuthPanel(panel) {
  document.getElementById("login-panel")?.classList.toggle("hidden", panel !== "login");
  document.getElementById("signup-panel")?.classList.toggle("hidden", panel !== "signup");
}

function refreshCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  captchaAnswer = a + b;
  const label = document.getElementById("captcha-label");
  if (label) label.textContent = `كم يساوي ${a} + ${b}؟`;
  const input = document.getElementById("signup-captcha");
  if (input) input.value = "";
}

export async function handleApprovalFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const token = params.get("token");
  if (!action || !token) return null;

  window.history.replaceState({}, "", window.location.pathname);
  try {
    const result = await processApprovalAction(action, token);
    const banner = document.getElementById("auth-action-banner");
    if (banner) {
      banner.classList.remove("hidden");
      banner.classList.add("auth-success");
      banner.textContent =
        result.type === "approve"
          ? `تمت الموافقة على حساب ${result.user.username} وإرسال بريد تأكيدي.`
          : `تم رفض طلب التسجيل لـ ${result.user.username}.`;
    }
    return result;
  } catch (error) {
    const banner = document.getElementById("auth-action-banner");
    if (banner) {
      banner.classList.remove("hidden");
      banner.classList.add("auth-error");
      banner.textContent = error.message;
    }
    return null;
  }
}

export function initAuthPage({ onLoginSuccess }) {
  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app-view");
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const loginError = document.getElementById("login-error");
  const signupError = document.getElementById("signup-error");
  const signupSuccess = document.getElementById("signup-success");
  const showSignupBtn = document.getElementById("show-signup");
  const showLoginBtn = document.getElementById("show-login");
  const refreshCaptchaBtn = document.getElementById("refresh-captcha");

  showSignupBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    switchAuthPanel("signup");
    showAuthMessage(loginError, "");
    showAuthMessage(signupError, "");
    showAuthMessage(signupSuccess, "", false);
    refreshCaptcha();
  });

  showLoginBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    switchAuthPanel("login");
    showAuthMessage(signupError, "");
    showAuthMessage(signupSuccess, "", false);
  });

  refreshCaptchaBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    refreshCaptcha();
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      const user = await authenticateUser(username, password);
      setStoredUser(user);
      sessionStorage.setItem(AUTH_KEY, "1");
      showAuthMessage(loginError, "");
      await onLoginSuccess(user);
    } catch (error) {
      showAuthMessage(loginError, error.message);
    }
  });

  signupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const captchaValue = Number(document.getElementById("signup-captcha").value);
    if (captchaValue !== captchaAnswer) {
      showAuthMessage(signupError, "إجابة التحقق غير صحيحة.");
      refreshCaptcha();
      return;
    }

    try {
      const { notification } = await registerUser({
        username: document.getElementById("signup-username").value,
        firstName: document.getElementById("signup-first-name").value,
        lastName: document.getElementById("signup-last-name").value,
        email: document.getElementById("signup-email").value,
        password: document.getElementById("signup-password").value,
        confirmPassword: document.getElementById("signup-password-confirm").value,
        acceptTerms: document.getElementById("signup-terms").checked,
      });
      signupForm.reset();
      refreshCaptcha();
      showAuthMessage(signupError, "");
      const successText = notification.sent
        ? notification.method === "github"
          ? "تم إرسال طلب التسجيل. ستصلك رسالة على بريد GitHub المرتبط بحسابك للموافقة."
          : "تم إرسال طلب التسجيل. ستصل موافقة إلى بريد المسؤول، وستُبلَّغ عند التفعيل."
        : `تم حفظ طلب التسجيل. ${notification.note || "سيوافق المسؤول من داخل التطبيق."}`;
      showAuthMessage(signupSuccess, successText, false);
      switchAuthPanel("login");
    } catch (error) {
      showAuthMessage(signupError, error.message);
      refreshCaptcha();
    }
  });

  refreshCaptcha();

  return {
    showLogin() {
      document.body.classList.add("auth-body");
      loginView?.classList.remove("hidden");
      appView?.classList.add("hidden");
      switchAuthPanel("login");
    },
    showApp() {
      document.body.classList.remove("auth-body");
      loginView?.classList.add("hidden");
      appView?.classList.remove("hidden");
    },
    logout() {
      sessionStorage.removeItem(AUTH_KEY);
      setStoredUser(null);
      this.showLogin();
    },
    isAdmin: () => isAdmin(getStoredUser()),
    listPendingUsers,
  };
}

export { isAdmin, listPendingUsers };
