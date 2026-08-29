import {
  ADMIN_EMAIL,
  GITHUB_BRANCH,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_TOKEN,
  SITE_URL,
  WEB3FORMS_ACCESS_KEY,
} from "./config.js";
import { hashPassword } from "./file-lock.js";
import { loadUsersDbWithSha, normalizeUsersDb, saveUsersDb } from "./users-store.js";

const USER_SESSION_KEY = "docshelf_user";

export function getStoredUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(user));
  else sessionStorage.removeItem(USER_SESSION_KEY);
}

export function isAdmin(user) {
  return user?.role === "admin" || user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

export async function authenticateUser(username, password) {
  const { db } = await loadUsersDbWithSha();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const user = db.users.find(
    (item) =>
      item.username?.toLowerCase() === normalizedUsername ||
      item.email?.toLowerCase() === normalizedUsername
  );

  if (!user) {
    throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash) {
    throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
  }

  if (user.status !== "approved") {
    throw new Error("حسابك بانتظار موافقة المسؤول. ستصلك رسالة عند التفعيل.");
  }

  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role || "member",
  };
}

function validateSignupInput(input) {
  const username = String(input.username || "").trim();
  const firstName = String(input.firstName || "").trim();
  const lastName = String(input.lastName || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const confirmPassword = String(input.confirmPassword || "");

  if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) {
    throw new Error("اسم المستخدم: 3–24 حرفاً (حروف، أرقام، . _ -).");
  }
  if (!firstName || !lastName) {
    throw new Error("الاسم الأول واسم العائلة مطلوبان.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("أدخل بريداً إلكترونياً صالحاً.");
  }
  if (password.length < 8) {
    throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
  }
  if (password !== confirmPassword) {
    throw new Error("كلمتا المرور غير متطابقتين.");
  }
  if (!input.acceptTerms) {
    throw new Error("يجب الموافقة على شروط الاستخدام.");
  }

  return { username, firstName, lastName, email, password };
}

export async function registerUser(input) {
  const data = validateSignupInput(input);
  const { db, sha } = await loadUsersDbWithSha();

  const usernameTaken = [...db.users, ...db.pending].some(
    (item) => item.username?.toLowerCase() === data.username.toLowerCase()
  );
  if (usernameTaken) throw new Error("اسم المستخدم مستخدم بالفعل.");

  const emailTaken = [...db.users, ...db.pending].some(
    (item) => item.email?.toLowerCase() === data.email
  );
  if (emailTaken) throw new Error("البريد الإلكتروني مسجل بالفعل.");

  const approvalToken = crypto.randomUUID().replace(/-/g, "");
  const pendingUser = {
    id: crypto.randomUUID(),
    username: data.username,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    passwordHash: await hashPassword(data.password),
    approvalToken,
    createdAt: new Date().toISOString(),
  };

  db.pending.push(pendingUser);
  await saveUsersDb(db, sha);
  const notification = await sendApprovalRequestEmail(pendingUser);
  return { pendingUser, notification };
}

function approvalLink(action, token) {
  const base = SITE_URL.replace(/\/$/, "");
  return `${base}/?action=${action}&token=${encodeURIComponent(token)}`;
}

async function sendWeb3Form(payload) {
  if (!WEB3FORMS_ACCESS_KEY) return false;
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ access_key: WEB3FORMS_ACCESS_KEY, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.success;
  } catch {
    return false;
  }
}

async function sendGitHubIssueNotification(title, body) {
  if (!GITHUB_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

function buildApprovalMessage(pendingUser) {
  const approveUrl = approvalLink("approve", pendingUser.approvalToken);
  const rejectUrl = approvalLink("reject", pendingUser.approvalToken);
  return [
    "طلب تسجيل جديد في مخزن الوثائق",
    "",
    `الاسم: ${pendingUser.firstName} ${pendingUser.lastName}`,
    `اسم المستخدم: ${pendingUser.username}`,
    `البريد: ${pendingUser.email}`,
    `التاريخ: ${new Date(pendingUser.createdAt).toLocaleString("ar-EG")}`,
    "",
    "للموافقة، افتح الرابط التالي:",
    approveUrl,
    "",
    "للرفض:",
    rejectUrl,
    "",
    `أو سجّل دخولك كمسؤول (${ADMIN_EMAIL}) ووافق من لوحة التحكم داخل التطبيق.`,
  ].join("\n");
}

async function triggerSignupEmailWorkflow() {
  if (!GITHUB_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/notify-signup.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: GITHUB_BRANCH,
          inputs: { force_all_pending: "true" },
        }),
      }
    );
    return res.status === 204;
  } catch {
    return false;
  }
}

export async function sendApprovalRequestEmail(pendingUser) {
  const message = buildApprovalMessage(pendingUser);
  const subject = `طلب موافقة تسجيل: ${pendingUser.username}`;

  if (await sendWeb3Form({
    subject,
    from_name: "مخزن الوثائق",
    email: ADMIN_EMAIL,
    message,
  })) {
    return { sent: true, method: "email" };
  }

  const workflowTriggered = await triggerSignupEmailWorkflow();

  if (await sendGitHubIssueNotification(
    `[Signup] Approve user: ${pendingUser.username}`,
    message
  )) {
    return {
      sent: true,
      method: workflowTriggered ? "github-workflow" : "github",
      note: workflowTriggered
        ? "تم إرسال طلب بريد إلى GitHub Actions. تحقق من صندوق الوارد خلال دقيقة."
        : "تم إنشاء تنبيه GitHub Issue. فعّل إشعارات البريد في GitHub أو أضف سر Gmail في المستودع.",
    };
  }

  if (workflowTriggered) {
    return {
      sent: true,
      method: "github-workflow",
      note: "تم إرسال طلب بريد عبر GitHub Actions. تحقق من صندوق الوارد خلال دقيقة.",
    };
  }

  return {
    sent: false,
    method: "none",
    note: "تعذّر إرسال البريد. أضف MAIL_USERNAME و MAIL_PASSWORD في إعدادات المستودع (Gmail App Password).",
  };
}

export async function sendUserDecisionEmail(user, approved) {
  const message = approved
    ? `مرحباً ${user.firstName},\n\nتمت الموافقة على حسابك في مخزن الوثائق. يمكنك تسجيل الدخول الآن.\n\n${SITE_URL}`
    : `مرحباً ${user.firstName},\n\nنعتذر، لم تتم الموافقة على طلب تسجيلك في مخزن الوثائق.`;

  const subject = approved ? "تمت الموافقة على حسابك" : "تم رفض طلب التسجيل";

  if (await sendWeb3Form({
    subject,
    from_name: "مخزن الوثائق",
    email: user.email,
    message,
  })) {
    return true;
  }

  if (approved) {
    await sendGitHubIssueNotification(
      `[Approved] User ${user.username} can now log in`,
      `تمت الموافقة على ${user.firstName} ${user.lastName} (${user.email}).\n\nأبلغ المستخدم بأنه يمكنه تسجيل الدخول الآن.`
    );
  }

  return false;
}

export async function processApprovalAction(action, token) {
  const { db, sha } = await loadUsersDbWithSha();
  const index = db.pending.findIndex((item) => item.approvalToken === token);
  if (index < 0) throw new Error("رابط الموافقة غير صالح أو منتهٍ.");

  const pending = db.pending[index];
  if (action === "reject") {
    db.pending.splice(index, 1);
    await saveUsersDb(db, sha);
    await sendUserDecisionEmail(pending, false);
    return { type: "reject", user: pending };
  }

  if (action !== "approve") throw new Error("إجراء غير معروف.");

  const approvedUser = {
    id: pending.id,
    username: pending.username,
    firstName: pending.firstName,
    lastName: pending.lastName,
    email: pending.email,
    passwordHash: pending.passwordHash,
    role: "member",
    status: "approved",
    createdAt: pending.createdAt,
    approvedAt: new Date().toISOString(),
  };

  db.pending.splice(index, 1);
  db.users.push(approvedUser);
  await saveUsersDb(db, sha);
  await sendUserDecisionEmail(approvedUser, true);
  return { type: "approve", user: approvedUser };
}

export async function approvePendingUser(pendingId) {
  const { db, sha } = await loadUsersDbWithSha();
  const pending = db.pending.find((item) => item.id === pendingId);
  if (!pending) throw new Error("طلب التسجيل غير موجود.");
  return processApprovalAction("approve", pending.approvalToken);
}

export async function rejectPendingUser(pendingId) {
  const { db, sha } = await loadUsersDbWithSha();
  const pending = db.pending.find((item) => item.id === pendingId);
  if (!pending) throw new Error("طلب التسجيل غير موجود.");
  return processApprovalAction("reject", pending.approvalToken);
}

export async function listPendingUsers() {
  const { db } = await loadUsersDbWithSha();
  return db.pending;
}

export async function resendPendingSignupEmails() {
  return triggerSignupEmailWorkflow();
}

export function normalizeUsers(data) {
  return normalizeUsersDb(data);
}
