import { createFileRoute } from "@tanstack/react-router";
import { getTelegramConfig, sendTelegramMessage } from "@/lib/telegram";
import { executeStartGDriveIngest } from "@/lib/gdrive.functions";
import { executeStartUrlIngest, executePump } from "@/lib/ingest.functions";

export const Route = createFileRoute("/api/public/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { adminChatId } = getTelegramConfig();
          const body = await request.json().catch(() => ({}));

          // Validate Telegram payload
          if (!body.message || !body.message.text || !body.message.chat) {
            return new Response("OK", { status: 200 }); // Ignore silently
          }

          const chatId = body.message.chat.id;
          const text = body.message.text.trim();

          // Security check
          if (adminChatId && String(chatId) !== String(adminChatId)) {
            console.warn(`Unauthorized Telegram access attempt from Chat ID: ${chatId}`);
            return new Response("OK", { status: 200 });
          }

          // Extract URL
          const urlMatch = text.match(/https?:\/\/[^\s]+/);
          if (!urlMatch) {
            await sendTelegramMessage(chatId, "Send me a direct video link or a Google Drive link, and I will auto-download it.");
            return new Response("OK", { status: 200 });
          }

          const url = urlMatch[0];
          const isGDrive = url.includes("drive.google.com") || url.includes("drive.usercontent.google.com");

          await sendTelegramMessage(chatId, "⏳ Scanning link...");

          let result;
          try {
            if (isGDrive) {
              result = await executeStartGDriveIngest(url, null);
              await sendTelegramMessage(chatId, `✅ <b>Success!</b> Found ${result.importedCount} videos in Google Drive folder.\n\nThey have been added to the queue and will begin downloading automatically.`);
            } else {
              result = await executeStartUrlIngest(url, undefined, null);
              await sendTelegramMessage(chatId, `✅ <b>Success!</b> Video added to queue and will begin downloading automatically.`);
              result = { jobs: [{ jobId: result.jobId }] }; // normalize for auto-pump loop
            }

            // Attempt to kickstart the pump in the background for auto-download
            // We use Promise.resolve().then() to avoid blocking the webhook response,
            // though Cloudflare might kill it after a few seconds.
            if (result.jobs && result.jobs.length > 0) {
              const jobs = result.jobs;
              Promise.resolve().then(async () => {
                for (const job of jobs) {
                  try {
                    await executePump(job.jobId);
                  } catch (e) {
                    console.error("Auto-pump error", e);
                  }
                }
              });
            }

          } catch (e: any) {
            await sendTelegramMessage(chatId, `❌ <b>Error:</b>\n<pre>${e.message || String(e)}</pre>`);
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
