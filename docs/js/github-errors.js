export function isGitHubShaConflict(error) {
  const status = Number(error?.status || 0);
  const text = String(error?.message || "").toLowerCase();
  return (
    status === 409 ||
    status === 422 && text.includes("does not match") ||
    text.includes("does not match") ||
    text.includes("update is not a fast forward") ||
    text.includes("reference does not exist") ||
    text.includes("conflict")
  );
}

export function formatGitHubApiError(message, status) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();

  if (status === 401 || lower.includes("bad credentials")) {
    return [
      "فشل الاتصال بـ GitHub: مفتاح DOCSHELF_GITHUB_TOKEN غير صالح أو منتهٍ.",
      "أنشئ Personal Access Token جديداً (صلاحية repo) من github.com/settings/tokens",
      "ثم حدّث السر في GitHub → Settings → Secrets → DOCSHELF_GITHUB_TOKEN",
      "وأعد تشغيل workflow «Deploy GitHub Pages».",
    ].join(" ");
  }

  if (status === 403 || lower.includes("resource not accessible")) {
    return "رفض GitHub الطلب: تأكد أن التوكن يملك صلاحية الكتابة على المستودع (repo).";
  }

  if (lower.includes("too large") || lower.includes("size") || lower.includes("larger than")) {
    return "الملف كبير جداً لحفظه في GitHub. جرّب ملفاً أصغر أو قلّل عدد المرفقات.";
  }

  if (isGitHubShaConflict({ message: text, status })) {
    return "تعارض في حفظ المستندات — يُعاد المحاولة تلقائياً. إن تكرّر الخطأ، حدّث الصفحة ثم حاول مرة أخرى.";
  }

  return text || `خطأ GitHub (${status || "غير معروف"})`;
}
