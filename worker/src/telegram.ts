const BASE = 'https://api.telegram.org/bot';

async function call(token: string, method: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Telegram ${method} failed: ${text}`);
  }
}

export function sendMessage(token: string, chatId: number, text: string, forceReply = false): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (forceReply) body.reply_markup = { force_reply: true, input_field_placeholder: 'Escribe tu pregunta...' };
  return call(token, 'sendMessage', body);
}

export function sendMenu(
  token: string,
  chatId: number,
  text: string,
  buttons: Array<Array<{ text: string; callback_data?: string; url?: string }>>
): Promise<void> {
  return call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  });
}

export function editMenu(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  buttons: Array<Array<{ text: string; callback_data?: string; url?: string }>>
): Promise<void> {
  return call(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  });
}

export function answerCallback(token: string, callbackQueryId: string, text?: string): Promise<void> {
  return call(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

export function deleteMessage(token: string, chatId: number, messageId: number): Promise<void> {
  return call(token, 'deleteMessage', { chat_id: chatId, message_id: messageId });
}
