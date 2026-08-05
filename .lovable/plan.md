# Reliable VLC playback for unsupported audio

## Goal
Keep normal browser playback unchanged, but replace the confusing “Open original” link with a safe one-click VLC handoff for files whose Dolby/DTS/TrueHD audio cannot be decoded by browsers.

## Changes
- Add a public playlist endpoint that returns a tiny `.m3u` file pointing to the existing byte-range stream; the 26–28 GB video is streamed directly and is not downloaded first.
- Add an **Open in VLC** action to the player’s no-audio notice. It downloads the playlist with the video title and shows simple instructions if the browser cannot launch VLC automatically.
- Add **Copy stream link** as a fallback for VLC’s “Open Network Stream” screen.
- Remove the misleading “Open original” behavior, which currently just opens the same browser-incompatible stream in another tab.
- Preserve uploads, video files, thumbnails, watch progress, seeking, and the existing streaming endpoint.

## Technical notes
- Browsers cannot decode AC3/EAC3/DTS/TrueHD audio merely by changing MIME headers; actual in-browser support would require transcoding infrastructure. The VLC handoff provides immediate full audio without re-encoding or reducing quality.
- Validate video IDs and playlist filenames, and emit the absolute HTTPS stream URL from the request origin.
- Verify endpoint headers/content and the watch-page interaction in the live preview.
