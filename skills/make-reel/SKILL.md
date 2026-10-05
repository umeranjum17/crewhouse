---
name: make-reel
description: Turn a folder of screenshots or images into a short demo video (mp4) with ffmpeg. Use for any demo, promo or teaser video request.
says: Turn photos and screenshots into a short video
---

# Make a reel

1. Collect inputs: list the images in the given folder (png, jpg, webp), sorted by name. If none were given, ask once; if there is still nothing, render a title card only.
2. Plan: 3 to 8 scenes, about 3 to 4 seconds each, total 15 to 40 seconds unless asked otherwise. Pick the frame from the stills: 1080x1920 (portrait) when most are taller than wide, such as phone screenshots, else 1920x1080. Use that one size for every scene and card.
3. Render each still whole, never cropped and never on black: the still fitted inside the frame with a small margin, over a blurred copy of itself that fills the rest, then a slow zoom (Ken Burns) that stays inside the margin. Read one frame (no `-loop`); `d` makes the 3.5 s. Portrait:
   `ffmpeg -y -i in.png -filter_complex "[0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:2,eq=brightness=-0.06[bg];[0]scale=994:1766:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,scale=2160:-2,zoompan=z='min(zoom+0.0006,1.06)':d=105:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,format=yuv420p" scene1.mp4`
   Landscape: the same with `1920:1080`, `1766:994`, `3840:-2` and `s=1920x1080`.
4. Join scenes with short crossfades (`xfade=transition=fade:duration=0.6`), or concat if there is one scene. A title or end card joins with a straight cut (`concat`), never a fade: the first screen lands whole, never half-dissolved under the title.
5. Title or end card: `ffmpeg -f lavfi -i color=c=0xF7F4EF:s=1080x1920:d=2.5 -vf "drawtext=text='Title':fontcolor=0x1E1A16:fontsize=96:x=(w-tw)/2:y=(h-th)/2" card.mp4` (`s=1920x1080` for landscape). If drawtext wants a font, `fc-match -f '%{file}' 'DejaVu Sans:bold'` prints one to pass as `fontfile=`.
6. Output: render straight to `files/<slug>.mp4` (no copying afterwards), H.264, `-pix_fmt yuv420p -movflags +faststart`, silent.
7. Check it with `ffprobe` (duration, resolution) and look at three frames (start, middle, end, `-ss <t> -frames:v 1`) before delivering: every still whole, no black bars.
