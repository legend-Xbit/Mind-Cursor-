import type { ToolPreset } from "../types.ts";

/**
 * Built-in MCP endpoints for the tools this layer orchestrates.
 * URLs are the official hosted servers as of the Cursor / vendor docs.
 */
export const TOOL_PRESETS: readonly ToolPreset[] = [
  {
    id: "notion",
    title: "Notion",
    description: "Pages, databases, search, and durable notes in the connected workspace.",
    category: "knowledge",
    docsUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
    defaultUrl: "https://mcp.notion.com/mcp",
    urlEnv: "NOTION_MCP_URL",
    tokenEnv: ["NOTION_API_KEY"],
  },
  {
    id: "vercel",
    title: "Vercel",
    description: "Projects, deployments, logs, and docs for the connected Vercel team.",
    category: "deploy",
    docsUrl: "https://vercel.com/docs/agent-resources/vercel-mcp",
    defaultUrl: "https://mcp.vercel.com",
    urlEnv: "VERCEL_MCP_URL",
    tokenEnv: ["VERCEL_TOKEN"],
  },
  {
    id: "github",
    title: "GitHub",
    description: "Repos, issues, PRs, and Actions through the official GitHub MCP.",
    category: "scm",
    docsUrl: "https://github.com/github/github-mcp-server",
    defaultUrl: "https://api.githubcopilot.com/mcp/",
    urlEnv: "GITHUB_MCP_URL",
    tokenEnv: ["GITHUB_TOKEN"],
  },
  {
    id: "slack",
    title: "Slack",
    description: "Channels, search, and messaging through Slack's hosted MCP.",
    category: "comms",
    docsUrl: "https://docs.slack.dev/ai/slack-mcp-server",
    defaultUrl: "https://mcp.slack.com/mcp",
    urlEnv: "SLACK_MCP_URL",
    tokenEnv: ["SLACK_BOT_TOKEN"],
  },
  {
    id: "linear",
    title: "Linear",
    description: "Issues, projects, and cycles through Linear's hosted MCP.",
    category: "scm",
    docsUrl: "https://linear.app/docs/mcp",
    defaultUrl: "https://mcp.linear.app/mcp",
    urlEnv: "LINEAR_MCP_URL",
    tokenEnv: ["LINEAR_API_KEY"],
  },
  {
    id: "figma",
    title: "Figma",
    description: "File content and design context. Prefer OAuth credentials from the Cursor app.",
    category: "knowledge",
    docsUrl: "https://developers.figma.com/docs/figma-mcp-server",
    defaultUrl: "https://mcp.figma.com/mcp",
    urlEnv: "FIGMA_MCP_URL",
    oauth: {
      clientIdEnv: "FIGMA_CLIENT_ID",
      clientSecretEnv: "FIGMA_CLIENT_SECRET",
      scopes: ["file_content:read"],
    },
  },
  {
    id: "treg",
    title: "Treg",
    description: "Live SEO, SERP, enrichment, and team-owned tools. Set TREG_MCP_URL.",
    category: "data",
    urlEnv: "TREG_MCP_URL",
    tokenEnv: ["TREG_API_KEY"],
  },
  {
    id: "plain",
    title: "Plain",
    description: "Support threads, customers, and help-center content. Set PLAIN_MCP_URL.",
    category: "support",
    urlEnv: "PLAIN_MCP_URL",
    tokenEnv: ["PLAIN_API_KEY"],
  },
] as const;

export const PRESET_IDS = TOOL_PRESETS.map((preset) => preset.id);

export function getPreset(id: string): ToolPreset | undefined {
  return TOOL_PRESETS.find((preset) => preset.id === id);
}
