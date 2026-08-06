// Telegram bot helpers. Calls go through the Lovable connector gateway when the
// Telegram connector is linked; a raw bot token is still supported as a fallback.

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

export function getTelegramConfig() {
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  return {
    token: env.TELEGRAM_BOT_TOKEN,
    connectionKey: env.TELEGRAM_API_KEY,
    lovableKey: env.LOVABLE_API_KEY,
    adminChatId: env.TELEGRAM_ADMIN_CHAT_ID,
  };
}

export function telegramConfigured() {
  const c = getTelegramConfig();
  return Boolean(c.token || (c.connectionKey && c.lovableKey));
}

/** Low-level Bot API call — gateway first, bot token as fallback. */
export async function telegramCall(method: string, payload: Record<string, unknown>) {
  const { token, connectionKey, lovableKey } = getTelegramConfig();

  if (connectionKey && lovableKey) {
    const res = await fetch(`${GATEWAY}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${lovableKey}`,
        "x-connection-api-key": connectionKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`Telegram gateway ${method} failed [${res.status}]: ${body}`);
      return { ok: false, body };
    }
    return { ok: true, body };
  }

  if (!token) {
    console.warn("Telegram is not configured (no connector and no TELEGRAM_BOT_TOKEN).");
    return { ok: false, body: "not_configured" };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) console.error(`Telegram ${method} failed [${res.status}]: ${body}`);
  return { ok: res.ok, body };
}

export async function sendTelegramMessage(chatId: string | number, text: string) {
  const r = await telegramCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  return r.ok;
}

/** Shared secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token. */
export async function telegramWebhookSecret(): Promise<string | null> {
  const { connectionKey, token } = getTelegramConfig();
  const base = connectionKey || token;
  if (!base) return null;
  const bytes = new TextEncoder().encode(`telegram-webhook:${base}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let s = "";
  const b = new Uint8Array(digest);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
