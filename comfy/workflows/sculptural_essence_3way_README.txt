Sculptural Essence — 3-way API workflow

Structure (matches interior_uxui_3way_api.json)
Same node graph: LoadImage → VAEEncode → 3× (CLIP + KSampler) → VAEDecode → ImageScaleBy → SaveImage. Outputs use filename_prefix sculptural_essence/…

Prompts (different from Interior UX/UI)
This file keeps the earlier “sculptural / glass lab / design study” CLIP set: white laboratory void, glassmorphism slabs, cobalt-on-white, tactile CMF and iridescent glass, high-key ethereal mood board — not the dark “digital immersive installation” gallery language in interior_uxui_3way_api.json.

Use Interior UX/UI preset when you want reactive floor mesh, LED gallery void, and subtle silhouettes; use Sculptural Essence for the brighter, more abstract product-visualization direction.

Node map
- 1 Checkpoint, 2 LoadImage, 3 VAE encode
- 4–6 positive CLIP, 7–9 negative CLIP
- 10–12 KSampler, 13–15 VAEDecode, 19–21 ImageScaleBy, 16–18 SaveImage

Backend
Embedded CLIP text is preserved when this workflow is active (same injection rule as interior_uxui_3way_api.json).
