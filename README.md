# مخزن الوثائق

تطبيق ويب عربي لرفع ملفات PDF وOffice والنصوص والصور، تصنيفها تلقائياً حسب المشروع/الموضوع، والبحث الفوري عبر المحتوى باستخدام BM25 (بدون تحميل نموذج ذكاء اصطناعي).

## الميزات

- صفحة تسجيل دخول قبل الوصول إلى أي وظيفة
- واجهة عربية كاملة مع دعم RTL
- رفع ملفات PDF ونصية وOffice (Word وExcel وPowerPoint) **والصور** (استخراج نص عبر Google AI — مثل Google Lens)
- دعم أسماء الملفات العربية
- مستكشف ملفات منظم حسب التصنيف ونوع الملف
- تصنيف تلقائي حسب تداخل الكلمات المفتاحية
- بحث فوري BM25 (نسخة Streamlit ونسخة GitHub Pages)
- **تخزين سحابي على Google Drive** — الملفات تُحفظ في مجلدات حسب التصنيف على حساب amanyak267@gmail.com

## بيانات الدخول

| الحقل | القيمة |
|-------|--------|
| اسم المستخدم | `admin` |

كلمة مرور المسؤول تُدار عبر `data/users.json` (نسخة GitHub Pages) أو متغيرات البيئة (نسخة Streamlit):

```bash
export DOCSHELF_USERNAME=admin
export DOCSHELF_PASSWORD=your_password
```

## التخزين السحابي (Google Drive)

نسخة GitHub Pages تحفظ الملفات على **Google Drive** في مجلد `مخزن الوثائق`، داخل مجلدات فرعية حسب **التصنيف** الذي يختاره النظام عند الفهرسة. الفهرس المشفّر (`docshelf-index.enc.json`) يُحفظ في نفس المجلد الجذري.

### إعداد Google Drive (مرة واحدة)

1. افتح [Google Cloud Console](https://console.cloud.google.com/) وسجّل الدخول بحساب **amanyak267@gmail.com**
2. أنشئ مشروعاً جديداً (أو اختر مشروعاً موجوداً)
3. من **APIs & Services** → **Library**، فعّل **Google Drive API**
4. من **APIs & Services** → **OAuth consent screen**:
   - اختر **External**
   - أكمل اسم التطبيق والبريد الداعم
   - من **Scopes** → **Add or Remove Scopes** وأضف:
     - `.../auth/drive.file` (Google Drive)
     - `.../auth/userinfo.email` (See your primary Google Account email address)
   - من **Test users** → **Add users** → أضف: `amanyak267@gmail.com`
   - (اختياري للاستخدام الشخصي) اضغط **Publish app** إذا استمر الرفض
5. من **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**:
   - نوع التطبيق: **Web application**
   - **Authorized JavaScript origins** (مهم جداً):
     - `https://amany-moh-sy.github.io`
   - لا تستخدم Client Secret في هذا المشروع — المطلوب **Client ID** فقط
6. انسخ **Client ID** (ينتهي بـ `.apps.googleusercontent.com`)
7. في GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - الاسم: `GOOGLE_CLIENT_ID`
   - القيمة: الصق Client ID كاملاً بدون مسافات
8. أعد تشغيل workflow النشر: **Actions** → **Deploy GitHub Pages** → **Re-run all jobs**
9. بعد النشر، افتح الموقع واضغط **Hard refresh** (Ctrl+Shift+R)

**إذا ظهر `Error 403: access_denied`:**
- التطبيق في وضع **Testing** ولم تُضف `amanyak267@gmail.com` في **Test users**
- أو لم تُضف Scopes المطلوبة في شاشة الموافقة (drive.file + email)
- أو سجّلت الدخول بحساب Google آخر غير `amanyak267@gmail.com`
- الحل: أضف الحساب في Test users، أو انشر التطبيق **Publish app**، ثم جرّب مرة أخرى

**إذا ظهر `Error 401: invalid_client`:**
- الـ Client ID غير موجود في Google أو لم يُنشر بعد في الموقع
- تأكد أن السرّ اسمه بالضبط `GOOGLE_CLIENT_ID` وليس Client Secret
- تأكد أن origin `https://amany-moh-sy.github.io` مضاف في OAuth client
- تأكد أنك أعدت نشر GitHub Pages بعد إضافة السرّ

عند أول تسجيل دخول بعد الإعداد الصحيح، سيُطلب ربط Google Drive بحساب **amanyak267@gmail.com**. الملفات تُرفع تلقائياً إلى:

```
مخزن الوثائق/
  ├── إدارة ومشاريع/
  ├── مالية ومحاسبة/
  ├── docshelf-index.enc.json
  └── ...
```

> **ملاحظة:** إذا لم يُضبط `GOOGLE_CLIENT_ID`، يعود التطبيق إلى التخزين المحلي أو GitHub (إن وُجد `DOCSHELF_GITHUB_TOKEN`).

### استخراج النص من الصور (Google AI / Gemini)

بدلاً من OCR المحلي البطيء، تُرسل الصور إلى **Google Gemini Vision** (نفس تقنية Google Lens) لاستخراج النص بسرعة.

1. افتح [Google AI Studio](https://aistudio.google.com/apikey) وسجّل الدخول بحساب Google
2. اضغط **Create API key** — المفاتيح الجديدة تبدأ بـ **`AQ.`** (المفاتيح القديمة بـ **`AIzaSy`**)
3. في GitHub: **Settings** → **Secrets and variables** → **Actions** → أضف سراً باسم **`GEMINI_API_KEY`** (بالضبط)
4. أعد تشغيل workflow **Deploy GitHub Pages** (Actions → Re-run all jobs) — إضافة السر وحده لا يكفي
5. حدّث الموقع تحديثاً قوياً: **Ctrl+Shift+R**

بدون `GEMINI_API_KEY` لن يعمل رفع الصور (باقي أنواع الملفات تعمل طبيعياً).

## التشغيل المحلي (Streamlit)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py --server.port 8512 --server.address 0.0.0.0
```

ثم افتح http://127.0.0.1:8512

## النشر على GitHub Pages

يتم نشر النسخة الثابتة العربية من مجلد `docs/` تلقائياً عبر GitHub Actions.

### 1) إنشاء حساب GitHub (إن لم يكن لديك)

أنشئ حساباً مجانياً على https://github.com/signup

### 2) إنشاء المستودع ورفع الكود

```bash
# تثبيت GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh -y

# تسجيل الدخول
gh auth login

# إنشاء المستودع ورفع الكود
gh repo create semantic-doc-search --public --source=. --remote=github --push
```

### 3) تفعيل GitHub Pages (خطوة إلزامية — مرة واحدة)

> **إذا فشل الـ workflow بخطأ `Get Pages site failed` / `Not Found` على `configure-pages@v5`،**
> فهذا يعني أن GitHub Pages **غير مُفعَّل بعد** في المستودع. لا يمكن للـ workflow تفعيله تلقائياً.

**الطريقة الأسهل (من المتصفح):**

1. افتح المستودع على GitHub
2. **Settings** → **Pages**
3. تحت **Build and deployment** → **Source**
4. اختر **GitHub Actions** (وليس *Deploy from a branch*)
5. أعد تشغيل الـ workflow: **Actions** → **Deploy GitHub Pages** → **Re-run all jobs**

**أو عبر GitHub CLI:**

```bash
gh api repos/:owner/semantic-doc-search/pages -X POST -f build_type=workflow
```

(استبدل `:owner` باسم مستخدمك، مثلاً `joseph-goodman`.)

### 4) عنوان الموقع

بعد نجاح الـ workflow، سيكون الموقع متاحاً على:

`https://<اسم-المستخدم>.github.io/semantic-doc-search/`

## هيكل المشروع

```
app.py                    # واجهة Streamlit العربية مع تسجيل الدخول
src/auth.py               # بوابة تسجيل الدخول
src/document_store.py     # رفع، تصنيف، فهرس BM25
docs/                     # نسخة ثابتة للنشر على GitHub Pages
docs/js/storage.js        # تخزين سحابي مشفّر عبر GitHub API
.github/workflows/pages.yml
uploads/                  # الملفات المرفوعة (Streamlit)
data/                     # البيانات الوصفية + فهرس BM25 + التخزين المشفّر للمتصفح
```

## ملاحظات

- **GitHub Pages** يستضيف النسخة الثابتة في `docs/` مع تخزين سحابي مشفّر في المستودع.
- **Streamlit** يتطلب خادماً Python ويُستخدم للتطوير المحلي أو النشر على Streamlit Cloud.
- المستندات على GitHub Pages تُحذف فقط عبر زر **حذف** داخل التطبيق.
