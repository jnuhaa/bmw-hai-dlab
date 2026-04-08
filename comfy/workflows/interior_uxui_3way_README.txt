Interior UX/UI — restructured 3-way workflow

Why this differs from sculptural_essence_3way_api.json
- Sculptural = single CLIP per branch, euler sampler, high-key white/glass/lab language (embedded prompts).
- Interior = SHARED identity clip (node 22) merged via ConditioningCombine with each branch (nodes 23–25), so every output is anchored as “night interactive installation” before branch specifics apply.
- Interior uses dpmpp_2m + karras, higher CFG, higher denoise than sculptural defaults — pushes cinematic translation away from the source and from white-studio looks.

Graph additions
- 22 CLIPTextEncode: GLOBAL INSTALLATION IDENTITY (fixed in JSON; not overwritten by app injection).
- 23–25 ConditioningCombine: identity + branch (spatial / tactile / experiential).
- KSampler positives now feed from 23–25, not raw 4–6.

Injection (app)
- Nodes 4–6 still receive dynamic Spatial/Tactile/Experiential text when not in embedded-only mode; nodes 7–9 negatives; node 22 stays file-locked unless you edit JSON.

If Comfy errors on ConditioningCombine
- Your Comfy build must include core Conditioning nodes. Comfy Cloud usually does. If not, fall back to merging prompt text manually in 4–6 only (older single-CLIP graph).
