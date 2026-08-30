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

  if (lower.includes("too large") || lower.includes("size")) {
    return "الملف كبير جداً لحفظه في GitHub. جرّب Google Drive للصور أو ملفاً أصغر.";
  }

  return text || `خطأ GitHub (${status || "غير معروف"})`;
}
