# مخزن الوثائق

تطبيق ويب عربي لرفع ملفات PDF وOffice والنصوص والصور، تصنيفها تلقائياً حسب المشروع/الموضوع، والبحث الفوري عبر المحتوى باستخدام BM25.

**المستودع الحالي:** [GitTeacher2026/semantic-doc-search](https://github.com/GitTeacher2026/semantic-doc-search)  
**الموقع:** https://gitteacher2026.github.io/semantic-doc-search/

## الميزات

- صفحة تسجيل دخول قبل الوصول إلى أي وظيفة
- واجهة عربية كاملة مع دعم RTL
- رفع PDF وOffice ونصوص **والصور** (OCR اختياري عبر Puter AI من صفحة الملفات)
- **مستكشف ملفات** منفصل (شبكة/قائمة، تصفح حسب المصدر والتصنيف، بحث وترتيب)
- تخزين مشفّر على **GitHub** أو **Google Drive** أو **MEGA** أو **OneDrive** أو محلياً
- بحث فوري BM25 مع خيارات متقدمة ووضع داكن

## بيانات الدخول

| الحقل | القيمة |
|-------|--------|
| اسم المستخدم | `admin` |
| البريد الإداري | `reagon.gm@pm.me` |

## إعداد الأسرار في GitHub (مرة واحدة)

افتح المستودع → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### 1) `DOCSHELF_GITHUB_TOKEN` (مطلوب)

يسمح للتطبيق بحفظ المستندات في `data/browser-store.enc.json`.

1. سجّل الدخول كـ **GitTeacher2026**
2. [Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
3. **Generate new token**
   - Repository access: **Only select repositories** → `semantic-doc-search`
   - Permissions:
     - **Contents**: Read and write *(required for login, password reset, document save)*
     - **Metadata**: Read-only
     - **Issues**: Read and write *(optional — fallback notifications)*
4. انسخ التوكن (يظهر مرة واحدة فقط)
5. في المستودع: Secret باسم **`DOCSHELF_GITHUB_TOKEN`** → الصق التوكن

### 2) `DOCSHELF_VAULT_PASSWORD` (اختياري)

كلمة مرور فك تشفير المستندات. إذا لم تُضف، يُستخدم الافتراضي `docshelf2024`.  
**لا تغيّرها** إن كنت تنقل بيانات قديمة مشفّرة بنفس القيمة.

### 3) `WEB3FORMS_ACCESS_KEY` (اختياري — إشعارات التسجيل)

يرسل بريداً للمسؤول عند تسجيل مستخدم جديد.

1. افتح https://web3forms.com
2. سجّل بحسابك (يمكن استخدام **reagon.gm@pm.me**)
3. أنشئ نموذجاً جديداً
4. انسخ **Access Key** (شكلها UUID مثل `69fd75eb-0aad-4952-98df-ca4ac06f734d`)
5. في المستودع: Secret باسم **`WEB3FORMS_ACCESS_KEY`**
6. أعد تشغيل **Deploy GitHub Pages**

> الإشعارات تُرسل أيضاً من المتصفح عند التسجيل إذا كان المفتاح مضبوطاً في `config.js` بعد النشر.

### 4) `GOOGLE_CLIENT_ID` (اختياري — Google Drive)

راجع قسم **التخزين** أدناه لخطوات إنشاء OAuth Client ID.

### 5) `ONEDRIVE_CLIENT_ID` (اختياري — OneDrive)

راجع قسم **التخزين** أدناه لخطوات تسجيل التطبيق في Azure.

### 6) نشر الموقع

1. **Settings → Pages → Source:** GitHub Actions
2. **Actions → Deploy GitHub Pages → Re-run all jobs**
3. افتح https://gitteacher2026.github.io/semantic-doc-search/

## التخزين

اختر **مكان التخزين** فوق منطقة الرفع:

| المصدر | الإعداد | الملاحظات |
|--------|---------|-----------|
| **GitHub** | `DOCSHELF_GITHUB_TOKEN` | فهرس مشفّر في المستودع — يعمل تلقائياً |
| **Google Drive** | `GOOGLE_CLIENT_ID` + تسجيل دخول | ملفات وفهرس في مجلد «مخزن الوثائق» |
| **MEGA** | بريد وكلمة مرور في الواجهة | لا يحتاج Secret — جلسة المتصفح فقط |
| **OneDrive** | `ONEDRIVE_CLIENT_ID` + تسجيل دخول | ملفات وفهرس في مجلد «مخزن الوثائق» |
| **محلي** | لا شيء | `localStorage` فقط — بدون مزامنة |

### إعداد Google Drive

1. [Google Cloud Console](https://console.cloud.google.com/) → مشروع جديد → **APIs & Services** → **OAuth consent screen**
2. أضف `reagon.gm@pm.me` كـ Test user (أو انشر التطبيق)
3. **Credentials** → **Create OAuth Client ID** → نوع **Web application**
4. **Authorized JavaScript origins:** `https://gitteacher2026.github.io`
5. **Authorized redirect URIs:** `https://gitteacher2026.github.io/semantic-doc-search/`
6. فعّل **Google Drive API**
7. انسخ **Client ID** → Secret باسم **`GOOGLE_CLIENT_ID`**
8. أعد تشغيل **Deploy GitHub Pages**

### إعداد OneDrive

1. [Azure Portal](https://portal.azure.com/) → **App registrations** → **New registration**
2. **Redirect URI:** Single-page application → `https://gitteacher2026.github.io/semantic-doc-search/`
3. **API permissions:** Microsoft Graph → Delegated → `Files.ReadWrite`, `User.Read`
4. انسخ **Application (client) ID** → Secret باسم **`ONEDRIVE_CLIENT_ID`**
5. أعد تشغيل **Deploy GitHub Pages**

> يجب تسجيل الدخول بحساب **`reagon.gm@pm.me`** لـ Google Drive و OneDrive.

## استخراج النص من الصور (OCR)

محرك واحد — **Puter AI** عبر [Puter.js](https://docs.puter.com/AI/img2txt/).

**الاستخدام:** افتح صورة من المكتبة → **استخراج نص** → **استخراج النص**. إذا وُجد رمز Puter في `docs/js/config.js` (`PUTER_AUTH_TOKEN`) أو في سر GitHub `PUTER_AUTH_TOKEN`، يتصل Puter تلقائياً دون خطوة يدوية.

**تسجيل يدوي (اختياري):**
1. الصق **رمز API** من [puter.com/dashboard](https://puter.com/dashboard#account) في حقل كلمة المرور، ثم اضغط **الاتصال بـ Puter**
2. أو اترك كلمة المرور فارغة واضغط **الاتصال** لفتح نافذة تسجيل Puter

## سلة المهملات

- الملفات المحذوفة تبقى 30 يوماً ثم تُحذف تلقائياً.
- يمكن **استعادة** ملف واحد أو **حذفه نهائياً**.
- زر **إفراغ السلة نهائياً** يحذف كل الملفات في السلة دفعة واحدة.

## ربط Cursor بالمستودع الجديد

```bash
git remote set-url origin https://github.com/GitTeacher2026/semantic-doc-search.git
git push -u origin main
```

إذا رُفض الدفع بسبب commit أولي في GitHub:

```bash
git push -u origin main --force
```

## التشغيل المحلي (Streamlit)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py --server.port 8512 --server.address 0.0.0.0
```

## هيكل المشروع

```
docs/                     # نسخة GitHub Pages
docs/js/storage.js        # تخزين مشفّر (GitHub · Drive · MEGA · OneDrive)
docs/js/ocr.js            # OCR (Puter AI)
.github/workflows/pages.yml
data/browser-store.enc.json
data/users.json
```

## ملاحظات أمنية

- التوكنات تُدمج في `docs/js/config.js` عند النشر (مطلوب لعمل GitHub API من المتصفح). لا تشارك رابط `config.js` علناً.
- إذا تسرّب التوكن، أنشئ توكناً جديداً وحدّث `DOCSHELF_GITHUB_TOKEN` ثم أعد النشر.
