import type { SDKMessage } from "@cursor/sdk";

export function assistantTextFromMessage(message: SDKMessage): string {
  if (message.type !== "assistant") {
    return "";
  }
  const chunks: string[] = [];
  for (const block of message.message.content) {
    if (block.type === "text") {
      chunks.push(block.text);
    }
  }
  return chunks.join("");
}

export async function writeAssistantStream(
  stream: AsyncIterable<SDKMessage>,
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
): Promise<void> {
  for await (const event of stream) {
    const text = assistantTextFromMessage(event);
    if (text) {
      write(text);
    }
  }
}
