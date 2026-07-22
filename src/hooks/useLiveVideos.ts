import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to realtime changes on the videos table and invalidate the
 * provided query keys so any list on screen updates the moment a video
 * is uploaded, edited, or deleted from anywhere.
 */
export function useLiveVideos(keys: string[][]) {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("videos-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "videos" },
        () => {
          for (const k of keys) qc.invalidateQueries({ queryKey: k });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
