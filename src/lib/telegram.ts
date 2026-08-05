export function getTelegramConfig() {
  // Try to safely access process.env (works in Node/Lovable deployments)
  const token = typeof process !== "undefined" ? process.env.TELEGRAM_BOT_TOKEN : undefined;
  const adminChatId = typeof process !== "undefined" ? process.env.TELEGRAM_ADMIN_CHAT_ID : undefined;
  return { token, adminChatId };
}

export async function sendTelegramMessage(chatId: string | number, text: string) {
  const { token } = getTelegramConfig();
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is missing. Cannot send message to Telegram.");
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("Failed to send Telegram message", e);
    return false;
  }
}
