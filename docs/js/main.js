import {
  getCurrentUser,
  getVaultPassword,
  handleApprovalFromUrl,
  handleResetFromUrl,
  initAuthPage,
  isAuthenticated,
} from "./auth-page.js";
import { initTheme } from "./theme.js";

const APP_MODULE_URL = "./app.js?v=20260901x";

initTheme();

async function loadApp() {
  const module = await import(APP_MODULE_URL);
  return module.startApp;
}

async function main() {
  const resetToken = handleResetFromUrl();
  await handleApprovalFromUrl();

  const auth = initAuthPage({
    async onLoginSuccess(user) {
      auth.showApp();
      const startApp = await loadApp();
      await startApp({ user, auth });
    },
  });

  if (resetToken) {
    auth.showResetPassword(resetToken);
    return;
  }

  if (isAuthenticated()) {
    const user = getCurrentUser();
    if (user) {
      auth.showApp();
      const startApp = await loadApp();
      await startApp({ user, auth });
      return;
    }
  }

  auth.showLogin();
}

main();
