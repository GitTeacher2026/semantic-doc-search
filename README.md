# مخزن الوثائق

تطبيق ويب عربي لرفع ملفات PDF وOffice والنصوص، تصنيفها تلقائياً حسب المشروع/الموضوع، والبحث الفوري عبر المحتوى باستخدام BM25 (بدون تحميل نموذج ذكاء اصطناعي).

## الميزات

- صفحة تسجيل دخول قبل الوصول إلى أي وظيفة
- واجهة عربية كاملة مع دعم RTL
- رفع ملفات PDF ونصية وOffice (Word وExcel وPowerPoint)
- دعم أسماء الملفات العربية
- مستكشف ملفات منظم حسب التصنيف ونوع الملف
- تصنيف تلقائي حسب تداخل الكلمات المفتاحية
- بحث فوري BM25 (نسخة Streamlit ونسخة GitHub Pages)
- **تخزين سحابي مشترك** على GitHub Pages — المستندات تبقى محفوظة عبر جميع المتصفحات

## بيانات الدخول الافتراضية

| الحقل | القيمة |
|-------|--------|
| اسم المستخدم | `admin` |
| كلمة المرور | `docshelf2024` |

لتغييرها في Streamlit:

```bash
export DOCSHELF_USERNAME=your_user
export DOCSHELF_PASSWORD=your_password
```

## التخزين السحابي (GitHub Pages)

نسخة GitHub Pages تحفظ المستندات في ملف مشفّر داخل المستودع (`data/browser-store.enc.json`). المحتوى مشفّر بكلمة مرور الدخول، ويُشارك بين جميع المتصفحات والأجهزة.

### إعداد التخزين السحابي (مرة واحدة)

1. أنشئ **Personal Access Token** من GitHub:
   - **Settings** → **Developer settings** → **Personal access tokens**
   - الصلاحيات المطلوبة: `repo` (أو صلاحية الكتابة على محتوى المستودع فقط)
2. أضف الرمز كسرّ في المستودع:
   - **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - الاسم: `DOCSHELF_GITHUB_TOKEN`
   - القيمة: رمز PAT الذي أنشأته
3. أعد تشغيل workflow النشر: **Actions** → **Deploy GitHub Pages** → **Re-run**

بعد ذلك، عند رفع ملفات من أي متصفح، تُحفظ في المستودع وتظهر في جميع المتصفحات بعد تسجيل الدخول.

> **ملاحظة:** Streamlit يحفظ الملفات محلياً على الخادم في مجلد `uploads/` ولا يحتاج هذا الإعداد.

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
