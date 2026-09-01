const SYSTEM_ADMIN_ID = "admin-default";
const SYSTEM_ADMIN_USERNAME = "admin";

export function isSystemAdminAccount(user) {
  return user?.id === SYSTEM_ADMIN_ID || user?.username === SYSTEM_ADMIN_USERNAME;
}

export function isAllowedRegistrationEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const match = normalized.match(/^[^\s@]+@([^\s@]+)$/);
  if (!match) return false;
  const domain = match[1];
  return domain === "proton.me" || domain === "pm.me";
}

export function registrationEmailErrorMessage() {
  return "يُسمح بالتسجيل فقط ببريد Proton (@proton.me أو @pm.me).";
}
