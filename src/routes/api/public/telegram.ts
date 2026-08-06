import { createFileRoute } from "@tanstack/react-router";
import { getTelegramConfig, sendTelegramMessage, telegramWebhookSecret } from "@/lib/telegram";
import { executeStartGDriveIngest } from "@/lib/gdrive.functions";
import { executeStartUrlIngest, executePump } from "@/lib/ingest.functions";

export const Route = createFileRoute("/api/public/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { adminChatId } = getTelegramConfig();

          // Telegram echoes the secret we registered with setWebhook.
          const expected = await telegramWebhookSecret();
          const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
          if (expected && provided !== expected) {
            return new Response("Unauthorized", { status: 401 });
          }

          const body = await request.json().catch(() => ({} as any));
          const message = body.message ?? body.edited_message;
          if (!message?.text || !message?.chat) return new Response("OK", { status: 200 });

          const chatId = message.chat.id;
          const text = String(message.text).trim();

          if (adminChatId && String(chatId) !== String(adminChatId)) {
            console.warn(`Unauthorized Telegram chat: ${chatId}`);
            return new Response("OK", { status: 200 });
          }

          if (/^\/(start|help)/i.test(text)) {
            await sendTelegramMessage(
              chatId,
              `👋 <b>GANDU NETFLIX bot</b>\n\nSend me:\n• a direct video link (.mkv/.mp4/…)\n• a Google Drive file or folder link\n\nI download it on the server and add it to your library automatically.\n\nYour chat ID: <code>${chatId}</code>`,
            );
            return new Response("OK", { status: 200 });
          }

          const urlMatch = text.match(/https?:\/\/[^\s]+/);
          if (!urlMatch) {
            await sendTelegramMessage(chatId, "Send me a direct video link or a Google Drive link and I'll take it from here.");
            return new Response("OK", { status: 200 });
          }

          const url = urlMatch[0];
          const isGDrive = url.includes("drive.google.com") || url.includes("drive.usercontent.google.com");

          await sendTelegramMessage(chatId, "⏳ Scanning link…");

          let jobs: { jobId: string }[] = [];
          try {
            if (isGDrive) {
              const result = await executeStartGDriveIngest(url, null);
              jobs = result.jobs;
              await sendTelegramMessage(
                chatId,
                `✅ Queued <b>${result.importedCount}</b> video(s) from Google Drive. Downloading now…`,
              );
            } else {
              const result = await executeStartUrlIngest(url, undefined, null);
              jobs = [{ jobId: result.jobId }];
              await sendTelegramMessage(chatId, `✅ Queued <b>${result.totalBytes ? Math.round(result.totalBytes / 1e9 * 10) / 10 + " GB" : "video"}</b>. Downloading now…`);
            }
          } catch (e: any) {
            await sendTelegramMessage(chatId, `❌ <b>Error:</b>\n<pre>${(e?.message || String(e)).slice(0, 500)}</pre>`);
            return new Response("OK", { status: 200 });
          }

          // Kick the first pump immediately; the cron worker carries the rest.
          if (jobs.length) {
            try {
              await executePump(jobs[0]!.jobId);
            } catch (e) {
              console.error("Auto-pump error", e);
            }
          }

          return new Response("OK", { status: 200 });
        } catch (e) {
          console.error("Telegram webhook error", e);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
