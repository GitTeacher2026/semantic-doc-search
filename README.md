# مخزن الوثائق

تطبيق ويب عربي لرفع ملفات PDF وOffice والنصوص والصور، تصنيفها تلقائياً حسب المشروع/الموضوع، والبحث الفوري عبر المحتوى باستخدام BM25.

**المستودع الحالي:** [GitTeacher2026/semantic-doc-search](https://github.com/GitTeacher2026/semantic-doc-search)  
**الموقع:** https://gitteacher2026.github.io/semantic-doc-search/

## الميزات

- صفحة تسجيل دخول قبل الوصول إلى أي وظيفة
- واجهة عربية كاملة مع دعم RTL
- رفع PDF وOffice ونصوص **والصور** (OCR: Puter AI · PaddleOCR · Tesseract)
- تخزين سحابي مشفّر على **GitHub** فقط
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

### 4) نشر الموقع

1. **Settings → Pages → Source:** GitHub Actions
2. **Actions → Deploy GitHub Pages → Re-run all jobs**
3. افتح https://gitteacher2026.github.io/semantic-doc-search/

## استخراج النص من الصور (OCR)

أربعة أوضاع — اختر من القائمة فوق منطقة الرفع:

| المحرك | المفتاح | الملاحظات |
|--------|---------|-----------|
| **Puter AI** (افتراضي في الوضع التلقائي) | لا يحتاج مفتاح | سريع — AWS/Mistral OCR عبر [Puter.js](https://docs.puter.com/AI/img2txt/) |
| **PaddleOCR** | لا يحتاج مفتاح | محلي في المتصفح — دقة عالية للعربية عبر [ppu-paddle-ocr](https://www.npmjs.com/package/ppu-paddle-ocr) |
| **Tesseract** | لا يحتاج مفتاح | محلي بالكامل — احتياطي موثوق |

**الوضع التلقائي:** Puter → PaddleOCR → Tesseract عند الفشل.

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
docs/js/storage.js        # تخزين مشفّر عبر GitHub API
docs/js/ocr.js            # OCR (Puter AI · PaddleOCR · Tesseract)
.github/workflows/pages.yml
data/browser-store.enc.json
data/users.json
```

## ملاحظات أمنية

- التوكنات تُدمج في `docs/js/config.js` عند النشر (مطلوب لعمل GitHub API من المتصفح). لا تشارك رابط `config.js` علناً.
- إذا تسرّب التوكن، أنشئ توكناً جديداً وحدّث `DOCSHELF_GITHUB_TOKEN` ثم أعد النشر.
