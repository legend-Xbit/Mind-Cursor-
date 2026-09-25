# Mind Cursor

طبقة عمل فوق [Cursor SDK](https://cursor.com/docs/sdk/typescript) تربط الوكيل بأدوات MCP الأخرى (Notion وVercel وGitHub وSlack وLinear وFigma وTreg وPlain) عبر إعداد واحد وواجهة واحدة.

A TypeScript work layer on `@cursor/sdk`: one registry, one CLI, and one stdio MCP server that attaches the other tools as `mcpServers` on `Agent.create` / `Agent.prompt` / `Agent.resume`.

## لماذا هذه الطبقة

Cursor يحمّل سيرفرات MCP من مصادر متعددة، والأولوية: `send` > `create` > الملفات. السيرفرات المضمّنة **لا تُحفظ** عند `Agent.resume` ويجب تمريرها من جديد. الطبقة تحل هذا:

1. تسجّل الأدوات الجاهزة فقط (token أو OAuth موجود).
2. تبني `mcpServers` بنفس شكل SDK (`http` / `sse` / `stdio`).
3. تعيد تمريرها في كل `create` و`resume`.
4. تفرّق بين فشل الإقلاع (`CursorAgentError` → خروج 1) وفشل التشغيل (`status === "error"` → خروج 2، `status === "cancelled"` → خروج 3).

## تثبيت

يتطلب Node.js 22.13+ ومفتاحاً من [Cursor Dashboard → API Keys](https://cursor.com/dashboard).

```bash
npm install
export CURSOR_API_KEY="cursor_..."
# اختياري — كل أداة تُرفق عندما يتوفر مفتاحها
export NOTION_API_KEY=...
export VERCEL_TOKEN=...
export GITHUB_TOKEN=...
```

انسخ `.env.example` واملأ ما تستخدمه. بدون مفتاح تبقى الأداة في حالة `needs_auth` أو `needs_config` ولا تُرفق.

## CLI

```bash
npx tsx src/cli.ts list
npx tsx src/cli.ts list --json
npx tsx src/cli.ts resolve
npx tsx src/cli.ts run "لخّص هذا المستودع" --runtime local
npx tsx src/cli.ts resume agent-... "حدّث سجل التغييرات"
npx tsx src/cli.ts serve
```

`serve` يشغّل سيرفر MCP محلي (`mind_list_tools`, `mind_resolve_mcp`, `mind_layer_info`, `mind_run_agent`, `mind_resume_agent`). ملف `.cursor/mcp.json` يربطه بهذا المشروع مع Notion وVercel وGitHub وSlack.

مخرجات `list` و`resolve` (والأدوات المقابلة في MCP) **محجوبة افتراضياً**: قيم الرؤوس (headers)، `CLIENT_SECRET`، ومتغيرات env تظهر كأسماء مفاتيح فقط (`headerKeys`, `envKeys`, `authKeys`) لا كقيم. مرّر `--reveal-secrets` لـ`list`/`resolve` لطباعة القيم الخام عند الحاجة الفعلية (يطبع تحذيراً على stderr).

### مصدر الإعداد والثقة

- `MIND_CURSOR_CONFIG=<path>` أو `--config <path>` يحدّدان ملف الإعداد صراحةً. غيابهما يجعل الطبقة تبحث عن `./mind-cursor.config.json` في مجلد العمل تلقائياً ("discovered").
- مسار صريح (`--config` أو `MIND_CURSOR_CONFIG`) مفقود يوقف التنفيذ برسالة خطأ واضحة بدل التراجع الصامت للقيم الافتراضية. مسار "discovered" مفقود يمر بصمت (لا إعداد = القيم الافتراضية).
- `config.customServers` من ملف **discovered** (غير محدَّد صراحةً) **غير موثوق افتراضياً**: أوامره (stdio) وروابطه (http) لا تُرفق، لأن `mind-cursor` قد يُشغَّل داخل أي مستودع مستنسَخ فيحاول ذلك المستودع تشغيل أوامره الخاصة. مرّر `--trust-config` أو `MIND_CURSOR_TRUST_CONFIG=1` لتوثيقها، أو أشر لملف الإعداد صراحةً عبر `--config`/`MIND_CURSOR_CONFIG` (يُعتبر التحديد الصريح توثيقاً تلقائياً).

## من الكود

```typescript
import { createMindCursor } from "mind-cursor";

const layer = createMindCursor({ runtime: "local" });
const result = await layer.send("Find the bug in src/auth.ts");
if (result.status === "cancelled") process.exit(3);
if (result.status !== "finished") process.exit(2);
```

`Agent.prompt` عبر `layer.prompt()` للطلقة الواحدة. `layer.send()` للبث والمتابعة. Inspect-only helpers (`tools()`, `mcpServers()`, `catalog()`) do not require `CURSOR_API_KEY`. السحابة: `{ runtime: "cloud" }` مع `MIND_CURSOR_REPO_URL` أو `cloud.repos` في `mind-cursor.config.json` — missing both is a startup error on **create**. `resume` of an existing `bc-*` agent does not require repos. `send()` returns a redacted `tools` catalog (ids/status and non-secret server metadata) and forwards `error` from `run.wait()` when the run fails. An explicit `MIND_CURSOR_CONFIG` / `configPath` that does not exist is a startup error (the default `mind-cursor.config.json` may be omitted).

الملف `mind-cursor.config.json` فيه الملفات الشخصية `local-dev` و`ci` و`cloud-pr`.

## أدوات مضمّنة

| id | MCP | الحالة بدون مفتاح |
| --- | --- | --- |
| `notion` | `https://mcp.notion.com/mcp` | needs_auth |
| `vercel` | `https://mcp.vercel.com` | needs_auth |
| `github` | `https://api.githubcopilot.com/mcp/` | needs_auth |
| `slack` | `https://mcp.slack.com/mcp` | needs_auth |
| `linear` | `https://mcp.linear.app/mcp` | needs_auth |
| `figma` | `https://mcp.figma.com/mcp` | needs_auth (OAuth) |
| `treg` | `TREG_MCP_URL` | needs_config |
| `plain` | `PLAIN_MCP_URL` | needs_config |

أضف سيرفرات خاصة تحت `customServers` في الإعداد (راجع "مصدر الإعداد والثقة" أعلاه لشرط التوثيق). They attach automatically unless listed in `disabled`; `enabled` filters built-in presets only, so you do not need to add a custom id there. على السحابة تُحذف `cwd` من إعدادات stdio لأن SDK يرفضها. `local.cwd` (عند تحديده) يُحسَب نسبةً لمجلد ملف الإعداد، لا مجلد العمل الحالي. Empty URL or stdio command after `${ENV}` expansion is `needs_config`; an empty Authorization header after expansion is `needs_auth`.

## ملاحظات SDK

- حدّد `local` أو `cloud` صراحة. بدون أحدهما يختار SDK المحلي بصمت.
- `wait()` مطلوب حتى لو لم تبثّ الأحداث.
- `includeUnauthenticated: true` يرفق سيرفرات HTTP بلا توكن (إعادة استخدام OAuth من تطبيق Cursor). مفاتيح حساب الخدمة لا ترث تسجيل دخول المستخدم.
- السيرفرات المضمّنة في `send` **تستبدل** سيرفرات `create` ولا تُدمج معها.

## أوامر Slash (اتفاقيات)

الملفات في `commands/` تتبع نفس هيكل [اتفاقيات أوامر Vercel](commands/_conventions.md): Preflight، Plan، Commands، Verification، Summary، Next Steps. الملفات التي تبدأ بـ `_` وثائق وصفية وليست أوامر.

| أمر | وظيفة |
| --- | --- |
| `/list` | عرض حالة محولات MCP |
| `/status` | فحص صحة الطبقة |
| `/run` | تشغيل وكيل Cursor مع الأدوات الجاهزة |
| `/serve` | تشغيل سيرفر MCP عبر stdio |

```bash
npm run validate:commands
npm test
npm run typecheck
```
