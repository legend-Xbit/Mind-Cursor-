# Mind Cursor

طبقة عمل فوق [Cursor SDK](https://cursor.com/docs/sdk/typescript) تربط الوكيل بأدوات MCP الأخرى (Notion وVercel وGitHub وSlack وLinear وFigma وTreg وPlain) عبر إعداد واحد وواجهة واحدة.

A TypeScript work layer on `@cursor/sdk`: one registry, one CLI, and one stdio MCP server that attaches the other tools as `mcpServers` on `Agent.create` / `Agent.prompt` / `Agent.resume`.

## لماذا هذه الطبقة

Cursor يحمّل سيرفرات MCP من مصادر متعددة، والأولوية: `send` > `create` > الملفات. السيرفرات المضمّنة **لا تُحفظ** عند `Agent.resume` ويجب تمريرها من جديد. الطبقة تحل هذا:

1. تسجّل الأدوات الجاهزة فقط (token أو OAuth موجود).
2. تبني `mcpServers` بنفس شكل SDK (`http` / `sse` / `stdio`).
3. تعيد تمريرها في كل `create` و`resume`.
4. تفرّق بين فشل الإقلاع (`CursorAgentError` → خروج 1) وفشل التشغيل (`status === "error"` → خروج 2).

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
npx tsx src/cli.ts resolve
npx tsx src/cli.ts run "لخّص هذا المستودع" --runtime local
npx tsx src/cli.ts resume agent-... "حدّث سجل التغييرات"
npx tsx src/cli.ts serve
```

`serve` يشغّل سيرفر MCP محلي (`mind_list_tools`, `mind_resolve_mcp`, `mind_run_agent`, `mind_resume_agent`). ملف `.cursor/mcp.json` يربطه بهذا المشروع مع Notion وVercel وGitHub وSlack.

## من الكود

```typescript
import { createMindCursor } from "mind-cursor";

const layer = createMindCursor({ runtime: "local" });
const result = await layer.send("Find the bug in src/auth.ts");
if (result.status === "error") process.exit(2);
```

`Agent.prompt` عبر `layer.prompt()` للطلقة الواحدة. `layer.send()` للبث والمتابعة. السحابة: `{ runtime: "cloud" }` مع `MIND_CURSOR_REPO_URL` أو `cloud.repos` في `mind-cursor.config.json`.

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

أضف سيرفرات خاصة تحت `customServers` في الإعداد. على السحابة تُحذف `cwd` من إعدادات stdio لأن SDK يرفضها.

## ملاحظات SDK

- حدّد `local` أو `cloud` صراحة. بدون أحدهما يختار SDK المحلي بصمت.
- `wait()` مطلوب حتى لو لم تبثّ الأحداث.
- `includeUnauthenticated: true` يرفق سيرفرات HTTP بلا توكن (إعادة استخدام OAuth من تطبيق Cursor). مفاتيح حساب الخدمة لا ترث تسجيل دخول المستخدم.
- السيرفرات المضمّنة في `send` **تستبدل** سيرفرات `create` ولا تُدمج معها.

## تطوير

```bash
npm test
npm run typecheck
```
