/** API-owned display projection for the existing chat page; raw Seller data is never a UI contract. */
export function projectOzonChatMessage(row: any) {
  if (!row || !Array.isArray(row.data) || row.data.some((part: unknown) => typeof part !== 'string')) {
    throw new Error('OZON 聊天消息格式已变化');
  }
  const type = row.user?.type;
  const sender = type === 'Seller' ? 'Seller' : type === 'Customer' ? 'Customer' : 'System';
  const text = row.data.join('\n');
  // Keep Markdown as plain text. Only an explicit image result becomes a URL,
  // never HTML or arbitrary JavaScript supplied by a message.
  let image: { url: string } | undefined;
  if (row.is_image) {
    const match = text.match(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/);
    const candidate = match?.[1] ?? (text.startsWith('https://') ? text : undefined);
    if (candidate) { try { const url = new URL(candidate); if (!url.username && !url.password) image = { url: url.href }; } catch { /* show text */ } }
  }
  return { message_id: row.message_id, created_at: row.created_at, is_read: row.is_read,
    sender, data: { text, ...(image ? { image } : {}) } };
}
