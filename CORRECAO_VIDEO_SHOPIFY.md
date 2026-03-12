# Shopify video black bars: final fix when CSS does not work

If none of the CSS attempts work, the black bars are usually **burned into the source video file**.
In this case, Shopify/iframe CSS cannot truly remove them — you must crop/re-export the video.

## 1) Quick diagnosis (2 minutes)

1. Download your original video file from Shopify Files.
2. Open it locally (VLC/QuickTime) full-screen.
3. If black bars are visible there too, they are part of the video pixels.

If bars are baked into the file, no selector (`object-fit`, iframe scaling, aspect-ratio) can fully "recover" lost image area.

---

## 2) Correct fix: upload a properly exported video

### Recommended export settings

- Horizontal hero video: **1920x1080** (16:9)
- Vertical hero video: **1080x1920** (9:16)
- Codec: H.264
- Avoid adding canvas/background bars in editor/export tool

---

## 3) Fast crop with FFmpeg (if you only have a letterboxed file)

### A) Remove top/bottom bars from a 16:9 file (example)

```bash
ffmpeg -i input.mp4 -vf "crop=1920:800:0:140" -c:a copy output-cropped.mp4
```

Adjust crop values to your real file.

### B) Force center-crop to 9:16 (mobile-first)

```bash
ffmpeg -i input.mp4 -vf "crop=ih*9/16:ih" -c:a copy output-9x16.mp4
```

### C) Force center-crop to 16:9 (desktop-first)

```bash
ffmpeg -i input.mp4 -vf "crop=iw:iw*9/16" -c:a copy output-16x9.mp4
```

Upload the new file and use it in the Video section.

---

## 4) Minimal `video.liquid` hardening (still needed)

For Shopify-hosted `<video>` in your existing section, keep this:

```liquid
{{
  section.settings.video
  | video_tag:
    image_size: '1100x',
    autoplay: true,
    loop: section.settings.enable_video_looping,
    controls: true,
    muted: true,
    playsinline: true
}}
```

And mobile CSS:

```css
@media screen and (max-width: 749px) {
  .video-section__media,
  .video-section__poster,
  .video-section__media video {
    margin: 0 !important;
    width: 100% !important;
    height: 100% !important;
    display: block;
  }

  .video-section__media {
    overflow: hidden;
    aspect-ratio: 9 / 16; /* switch to 16 / 9 for horizontal videos */
  }

  .video-section__media video {
    object-fit: cover;
  }
}
```

---

## 5) Important reality check for iframe videos (YouTube/Vimeo)

- `object-fit` does not apply to iframe.
- You can only simulate crop with scale/position.
- If the source itself already has bars, iframe CSS will not truly remove them.

---

## 6) Why this is the most likely root cause in your case

You reported that multiple CSS approaches did not change the result at all.
That behavior is typical when bars are encoded in the source media itself (not a layout issue).
