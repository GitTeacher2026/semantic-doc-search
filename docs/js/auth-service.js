import {
  ADMIN_EMAIL,
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

  if (user.status === "suspended") {
    throw new Error("تم تعليق حسابك. تواصل مع المسؤول.");
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

function resetPasswordLink(token) {
  return approvalLink("reset-password", token);
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

async function sendWeb3Form(payload) {
  if (!WEB3FORMS_ACCESS_KEY) return { ok: false, error: "missing_key" };
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_ACCESS_KEY,
        botcheck: false,
        ...payload,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { ok: true };
    return {
      ok: false,
      error: data.message || data.body?.message || `HTTP ${res.status}`,
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
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

function buildApprovalLinks(pendingUser) {
  return {
    approveUrl: approvalLink("approve", pendingUser.approvalToken),
    rejectUrl: approvalLink("reject", pendingUser.approvalToken),
  };
}

function buildApprovalMessage(pendingUser) {
  const { approveUrl, rejectUrl } = buildApprovalLinks(pendingUser);
  return [
    "طلب تسجيل جديد في مخزن الوثائق",
    "",
    `الاسم: ${pendingUser.firstName} ${pendingUser.lastName}`,
    `اسم المستخدم: ${pendingUser.username}`,
    `البريد: ${pendingUser.email}`,
    `التاريخ: ${new Date(pendingUser.createdAt).toLocaleString("ar-EG")}`,
    "",
    "✅ للموافقة على العضو:",
    approveUrl,
    "",
    "❌ لرفض الطلب:",
    rejectUrl,
    "",
    `أو سجّل دخولك كمسؤول (${ADMIN_EMAIL}) ووافق من لوحة التحكم داخل التطبيق.`,
  ].join("\n");
}

export async function sendApprovalRequestEmail(pendingUser) {
  const { approveUrl, rejectUrl } = buildApprovalLinks(pendingUser);
  const message = buildApprovalMessage(pendingUser);
  const subject = `طلب موافقة تسجيل: ${pendingUser.username}`;

  const web3 = await sendWeb3Form({
    subject,
    from_name: "مخزن الوثائق",
    name: `${pendingUser.firstName} ${pendingUser.lastName}`,
    email: pendingUser.email,
    replyto: pendingUser.email,
    username: pendingUser.username,
    signup_email: pendingUser.email,
    approve_link: approveUrl,
    reject_link: rejectUrl,
    "Approve (موافقة)": approveUrl,
    "Reject (رفض)": rejectUrl,
    message,
  });
  if (web3.ok) {
    return { sent: true, method: "email" };
  }

  if (await sendGitHubIssueNotification(
    `[Signup] Approve user: ${pendingUser.username}`,
    message
  )) {
    return {
      sent: true,
      method: "github",
      note: web3.error
        ? `تعذّر Web3Forms: ${web3.error}. تم إنشاء GitHub Issue كبديل.`
        : "تم إنشاء تنبيه GitHub Issue.",
    };
  }

  return {
    sent: false,
    method: "none",
    note: web3.error
      ? `تعذّر إرسال البريد: ${web3.error}`
      : "تعذّر إرسال البريد. وافق من لوحة التحكم داخل التطبيق.",
  };
}

export async function sendUserDecisionEmail(user, approved) {
  const message = approved
    ? `مرحباً ${user.firstName},\n\nتمت الموافقة على حسابك في مخزن الوثائق. يمكنك تسجيل الدخول الآن.\n\n${SITE_URL}`
    : `مرحباً ${user.firstName},\n\nنعتذر، لم تتم الموافقة على طلب تسجيلك في مخزن الوثائق.`;

  const subject = approved ? "تمت الموافقة على حسابك" : "تم رفض طلب التسجيل";

  const web3 = await sendWeb3Form({
    subject,
    from_name: "مخزن الوثائق",
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    message,
  });
  return web3.ok;
}

function findApprovedUser(db, identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  return db.users.find(
    (item) =>
      item.username?.toLowerCase() === normalized ||
      item.email?.toLowerCase() === normalized
  );
}

async function sendPasswordResetEmail(user, resetToken) {
  const resetUrl = resetPasswordLink(resetToken);
  const message = [
    `مرحباً ${user.firstName},`,
    "",
    "تلقّينا طلباً لإعادة تعيين كلمة المرور في مخزن الوثائق.",
    "",
    "لتعيين كلمة مرور جديدة، افتح الرابط التالي (صالح لمدة ساعة واحدة):",
    resetUrl,
    "",
    "إذا لم تطلب ذلك، تجاهل هذه الرسالة.",
  ].join("\n");

  const web3 = await sendWeb3Form({
    subject: "إعادة تعيين كلمة المرور — مخزن الوثائق",
    from_name: "مخزن الوثائق",
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    replyto: user.email,
    reset_link: resetUrl,
    "Reset link": resetUrl,
    message,
  });

  if (web3.ok) return { sent: true, method: "email" };

  if (
    await sendGitHubIssueNotification(
      `[Password Reset] ${user.username}`,
      message
    )
  ) {
    return { sent: true, method: "github" };
  }

  return {
    sent: false,
    method: "none",
    note: web3.error || "تعذّر إرسال البريد.",
  };
}

export async function requestPasswordReset(identifier) {
  const { db, sha } = await loadUsersDbWithSha();
  const user = findApprovedUser(db, identifier);
  const genericMessage =
    "إذا كان البريد أو اسم المستخدم مسجّلاً لدينا، ستصلك رسالة تحتوي رابط إعادة التعيين. تحقق من صندوق الوارد والرسائل غير المرغوبة.";

  if (!user || user.status !== "approved") {
    return { sent: true, message: genericMessage };
  }

  const resetToken = crypto.randomUUID().replace(/-/g, "");
  user.resetToken = resetToken;
  user.resetExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await saveUsersDb(db, sha);

  const notification = await sendPasswordResetEmail(user, resetToken);
  if (!notification.sent) {
    return {
      sent: false,
      message: notification.note || "تعذّر إرسال البريد. حاول مرة أخرى لاحقاً.",
    };
  }

  return { sent: true, message: genericMessage };
}

export async function resetPasswordWithToken(token, password, confirmPassword) {
  const nextPassword = String(password || "");
  const confirm = String(confirmPassword || "");
  if (nextPassword.length < 8) {
    throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
  }
  if (nextPassword !== confirm) {
    throw new Error("كلمتا المرور غير متطابقتين.");
  }

  const { db, sha } = await loadUsersDbWithSha();
  const user = db.users.find((item) => item.resetToken === token);
  if (!user) {
    throw new Error("رابط إعادة التعيين غير صالح أو منتهٍ.");
  }
  if (!user.resetExpiresAt || new Date(user.resetExpiresAt) < new Date()) {
    delete user.resetToken;
    delete user.resetExpiresAt;
    await saveUsersDb(db, sha);
    throw new Error("انتهت صلاحية الرابط. اطلب رابطاً جديداً من صفحة نسيت كلمة المرور.");
  }

  user.passwordHash = await hashPassword(nextPassword);
  delete user.resetToken;
  delete user.resetExpiresAt;
  await saveUsersDb(db, sha);

  return {
    username: user.username,
    email: user.email,
  };
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

function sanitizeMember(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role || "member",
    status: user.status || "approved",
    createdAt: user.createdAt,
    approvedAt: user.approvedAt,
  };
}

function assertAdminActor(actor) {
  if (!isAdmin(actor)) throw new Error("غير مصرح لك بهذا الإجراء.");
}

function findMember(db, memberId) {
  const user = db.users.find((item) => item.id === memberId);
  if (!user) throw new Error("المستخدم غير موجود.");
  return user;
}

function guardProtectedMember(user, actor) {
  if (user.id === "admin-default" || user.username === "admin") {
    throw new Error("لا يمكن تعديل حساب المسؤول الرئيسي.");
  }
  if (actor && user.id === actor.id) {
    throw new Error("لا يمكنك تنفيذ هذا الإجراء على حسابك الحالي.");
  }
}

export async function listMembers() {
  const { db } = await loadUsersDbWithSha();
  return db.users.map(sanitizeMember);
}

export async function deleteMember(memberId, actor) {
  assertAdminActor(actor);
  const { db, sha } = await loadUsersDbWithSha();
  const user = findMember(db, memberId);
  guardProtectedMember(user, actor);
  db.users = db.users.filter((item) => item.id !== memberId);
  await saveUsersDb(db, sha);
  return sanitizeMember(user);
}

export async function setMemberStatus(memberId, status, actor) {
  assertAdminActor(actor);
  if (!["approved", "suspended"].includes(status)) {
    throw new Error("حالة غير صالحة.");
  }
  const { db, sha } = await loadUsersDbWithSha();
  const user = findMember(db, memberId);
  guardProtectedMember(user, actor);
  user.status = status;
  await saveUsersDb(db, sha);
  return sanitizeMember(user);
}

export async function setMemberRole(memberId, role, actor) {
  assertAdminActor(actor);
  if (!["admin", "member"].includes(role)) throw new Error("دور غير صالح.");
  const { db, sha } = await loadUsersDbWithSha();
  const user = findMember(db, memberId);
  guardProtectedMember(user, actor);
  if (role === "member" && user.role === "admin") {
    const adminCount = db.users.filter(
      (item) => item.role === "admin" && item.status !== "suspended"
    ).length;
    if (adminCount <= 1) throw new Error("يجب أن يبقى مسؤول واحد على الأقل.");
  }
  user.role = role;
  await saveUsersDb(db, sha);
  return sanitizeMember(user);
}

export async function resendPendingSignupEmails() {
  const pending = await listPendingUsers();
  if (!pending.length) {
    return { sent: 0, total: 0, message: "لا توجد طلبات معلّقة." };
  }
  let sent = 0;
  let lastError = "";
  for (const user of pending) {
    const result = await sendApprovalRequestEmail(user);
    if (result.sent && result.method === "email") sent += 1;
    else if (result.note) lastError = result.note;
  }
  return {
    sent,
    total: pending.length,
    message:
      sent > 0
        ? `تم إرسال ${sent} بريد إلى amanyak267@gmail.com. تحقق من صندوق الوارد والرسائل غير المرغوبة.`
        : lastError || "تعذّر إرسال البريد.",
  };
}

export function normalizeUsers(data) {
  return normalizeUsersDb(data);
}
