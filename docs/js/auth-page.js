import { VAULT_PASSWORD } from "./config.js";
import {
  authenticateUser,
  getStoredUser,
  isAdmin,
  listPendingUsers,
  processApprovalAction,
  registerUser,
  requestPasswordReset,
  resetPasswordWithToken,
  setStoredUser,
} from "./auth-service.js";

const AUTH_KEY = "docshelf_auth";

const captchaState = {
  signup: { answer: 0, labelId: "captcha-label", inputId: "signup-captcha" },
  forgot: { answer: 0, labelId: "forgot-captcha-label", inputId: "forgot-captcha" },
  reset: { answer: 0, labelId: "reset-captcha-label", inputId: "reset-captcha" },
};

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
  const panels = ["login", "signup", "forgot", "reset"];
  for (const name of panels) {
    document.getElementById(`${name}-panel`)?.classList.toggle("hidden", panel !== name);
  }
}

function refreshCaptcha(kind = "signup") {
  const config = captchaState[kind];
  if (!config) return;
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  config.answer = a + b;
  const label = document.getElementById(config.labelId);
  if (label) label.textContent = `كم يساوي ${a} + ${b}؟`;
  const input = document.getElementById(config.inputId);
  if (input) input.value = "";
}

function validateCaptcha(kind, value) {
  const config = captchaState[kind];
  return Number(value) === config?.answer;
}

export function handleResetFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const token = params.get("token");
  if (action !== "reset-password" || !token) return null;
  window.history.replaceState({}, "", window.location.pathname);
  return token;
}

export async function handleApprovalFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const token = params.get("token");
  if (!action || !token || action === "reset-password") return null;
  if (action !== "approve" && action !== "reject") return null;

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

function clearAuthMessages() {
  showAuthMessage(document.getElementById("login-error"), "");
  showAuthMessage(document.getElementById("login-pending-notice"), "", false);
  showAuthMessage(document.getElementById("signup-error"), "");
  showAuthMessage(document.getElementById("signup-success"), "", false);
  showAuthMessage(document.getElementById("forgot-error"), "");
  showAuthMessage(document.getElementById("forgot-success"), "", false);
  showAuthMessage(document.getElementById("reset-error"), "");
  showAuthMessage(document.getElementById("reset-success"), "", false);
}

export function initAuthPage({ onLoginSuccess }) {
  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app-view");
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const forgotForm = document.getElementById("forgot-form");
  const resetForm = document.getElementById("reset-form");
  const loginError = document.getElementById("login-error");
  const loginPendingNotice = document.getElementById("login-pending-notice");
  const signupError = document.getElementById("signup-error");
  const signupSuccess = document.getElementById("signup-success");
  const forgotError = document.getElementById("forgot-error");
  const forgotSuccess = document.getElementById("forgot-success");
  const resetError = document.getElementById("reset-error");
  const resetSuccess = document.getElementById("reset-success");
  const showSignupBtn = document.getElementById("show-signup");
  const showLoginBtn = document.getElementById("show-login");
  const showForgotBtn = document.getElementById("show-forgot");
  const forgotToLoginBtn = document.getElementById("forgot-to-login");
  const resetToLoginBtn = document.getElementById("reset-to-login");
  const refreshCaptchaBtn = document.getElementById("refresh-captcha");
  const refreshForgotCaptchaBtn = document.getElementById("refresh-forgot-captcha");
  const refreshResetCaptchaBtn = document.getElementById("refresh-reset-captcha");
  const resetTokenInput = document.getElementById("reset-token");

  function goToLogin() {
    clearAuthMessages();
    switchAuthPanel("login");
  }

  showSignupBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    clearAuthMessages();
    switchAuthPanel("signup");
    refreshCaptcha("signup");
  });

  showLoginBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    goToLogin();
  });

  showForgotBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    clearAuthMessages();
    switchAuthPanel("forgot");
    refreshCaptcha("forgot");
  });

  forgotToLoginBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    goToLogin();
  });

  resetToLoginBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    goToLogin();
  });

  refreshCaptchaBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    refreshCaptcha("signup");
  });

  refreshForgotCaptchaBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    refreshCaptcha("forgot");
  });

  refreshResetCaptchaBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    refreshCaptcha("reset");
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
      showAuthMessage(loginPendingNotice, "", false);
      await onLoginSuccess(user);
    } catch (error) {
      showAuthMessage(loginError, error.message);
    }
  });

  forgotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const captchaValue = document.getElementById("forgot-captcha").value;
    if (!validateCaptcha("forgot", captchaValue)) {
      showAuthMessage(forgotError, "إجابة التحقق غير صحيحة.");
      refreshCaptcha("forgot");
      return;
    }

    try {
      const result = await requestPasswordReset(
        document.getElementById("forgot-identifier").value
      );
      forgotForm.reset();
      refreshCaptcha("forgot");
      showAuthMessage(forgotError, "");
      showAuthMessage(forgotSuccess, result.message, !result.sent);
      if (!result.sent) refreshCaptcha("forgot");
    } catch (error) {
      showAuthMessage(forgotError, error.message);
      refreshCaptcha("forgot");
    }
  });

  resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const captchaValue = document.getElementById("reset-captcha").value;
    if (!validateCaptcha("reset", captchaValue)) {
      showAuthMessage(resetError, "إجابة التحقق غير صحيحة.");
      refreshCaptcha("reset");
      return;
    }

    try {
      const result = await resetPasswordWithToken(
        resetTokenInput?.value,
        document.getElementById("reset-password").value,
        document.getElementById("reset-password-confirm").value
      );
      resetForm.reset();
      refreshCaptcha("reset");
      showAuthMessage(resetError, "");
      showAuthMessage(
        resetSuccess,
        `تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن باسم @${result.username}.`,
        false
      );
      const banner = document.getElementById("auth-action-banner");
      if (banner) {
        banner.classList.remove("hidden", "auth-error");
        banner.classList.add("auth-success");
        banner.textContent = "تم تغيير كلمة المرور بنجاح. سجّل دخولك الآن.";
      }
      setTimeout(() => goToLogin(), 2500);
    } catch (error) {
      showAuthMessage(resetError, error.message);
      refreshCaptcha("reset");
    }
  });

  signupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const captchaValue = Number(document.getElementById("signup-captcha").value);
    if (!validateCaptcha("signup", captchaValue)) {
      showAuthMessage(signupError, "إجابة التحقق غير صحيحة.");
      refreshCaptcha("signup");
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
      refreshCaptcha("signup");
      showAuthMessage(signupError, "");
      showAuthMessage(signupSuccess, "", false);

      const pendingNotice =
        "تم إنشاء حسابك بنجاح. طلبك بانتظار موافقة المسؤول — لا يمكنك تسجيل الدخول حتى يتم التفعيل. سنُرسل لك بريداً عند الموافقة.";
      const noticeText = notification.sent
        ? notification.method === "github"
          ? `${pendingNotice} تم إخطار المسؤول عبر GitHub.`
          : pendingNotice
        : `${pendingNotice} ${notification.note || "سيوافق المسؤول من داخل التطبيق."}`;

      const banner = document.getElementById("auth-action-banner");
      if (banner) {
        banner.classList.remove("hidden", "auth-error");
        banner.classList.add("auth-success");
        banner.textContent = noticeText;
      }
      showAuthMessage(loginPendingNotice, noticeText, false);

      switchAuthPanel("login");
    } catch (error) {
      showAuthMessage(signupError, error.message);
      refreshCaptcha("signup");
    }
  });

  refreshCaptcha("signup");

  return {
    showLogin() {
      document.body.classList.add("auth-body");
      loginView?.classList.remove("hidden");
      appView?.classList.add("hidden");
      switchAuthPanel("login");
    },
    showResetPassword(token) {
      document.body.classList.add("auth-body");
      loginView?.classList.remove("hidden");
      appView?.classList.add("hidden");
      clearAuthMessages();
      if (resetTokenInput) resetTokenInput.value = token;
      switchAuthPanel("reset");
      refreshCaptcha("reset");
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
