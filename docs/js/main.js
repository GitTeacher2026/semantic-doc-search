import {
  getCurrentUser,
  getVaultPassword,
  handleApprovalFromUrl,
  initAuthPage,
  isAuthenticated,
} from "./auth-page.js";
import { startApp } from "./app.js";

async function main() {
  await handleApprovalFromUrl();

  const auth = initAuthPage({
    async onLoginSuccess(user) {
      auth.showApp();
      await startApp({ user, auth });
    },
  });

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
