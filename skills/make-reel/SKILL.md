---
name: make-reel
description: Turn a folder of screenshots or images into a short demo video (mp4) with ffmpeg. Use for any demo, promo or teaser video request.
---

# Make a reel

1. Collect inputs: list the images in the given folder (png, jpg, webp), sorted by name. If none were given, ask once; if there is still nothing, render a title card only.
2. Plan: 3 to 8 scenes, about 3 to 4 seconds each, total 15 to 40 seconds unless asked otherwise.
3. Render each still with a slow zoom (Ken Burns) at 1920x1080, 30 fps:
   `ffmpeg -y -loop 1 -t 3.5 -i in.png -vf "scale=3840:-2,zoompan=z='min(zoom+0.0008,1.12)':d=105:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30,format=yuv420p" scene1.mp4`
4. Join scenes with short crossfades (`xfade=transition=fade:duration=0.6`), or concat if there is one scene.
5. Title or end card: `ffmpeg -f lavfi -i color=c=0xF7F4EF:s=1920x1080:d=2.5 -vf "drawtext=text='Title':fontcolor=0x1E1A16:fontsize=96:x=(w-tw)/2:y=(h-th)/2" card.mp4`.
6. Output: `files/<slug>.mp4`, H.264, `-pix_fmt yuv420p -movflags +faststart`, silent.
7. Check it with `ffprobe` (duration, resolution) before delivering.
