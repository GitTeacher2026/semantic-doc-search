import {
  getCurrentUser,
  getVaultPassword,
  handleApprovalFromUrl,
  handleResetFromUrl,
  initAuthPage,
  isAuthenticated,
} from "./auth-page.js";
import { startApp } from "./app.js?v=20260830-img";

async function main() {
  const resetToken = handleResetFromUrl();
  await handleApprovalFromUrl();

  const auth = initAuthPage({
    async onLoginSuccess(user) {
      auth.showApp();
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
      await startApp({ user, auth });
      return;
    }
  }

  auth.showLogin();
}

main();
