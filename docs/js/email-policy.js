const SYSTEM_ADMIN_ID = "admin-default";
const SYSTEM_ADMIN_USERNAME = "admin";

export const ALLOWED_REGISTRATION_DOMAINS = [
  "pm.me",
  "proton.me",
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
];

export function isSystemAdminAccount(user) {
  return user?.id === SYSTEM_ADMIN_ID || user?.username === SYSTEM_ADMIN_USERNAME;
}

export function isAllowedRegistrationEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const match = normalized.match(/^[^\s@]+@([^\s@]+)$/);
  if (!match) return false;
  return ALLOWED_REGISTRATION_DOMAINS.includes(match[1]);
}

export function registrationEmailErrorMessage() {
  return `يُسمح بالتسجيل فقط ببريد من: ${ALLOWED_REGISTRATION_DOMAINS.map((d) => `@${d}`).join("، ")}.`;
}
