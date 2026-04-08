# Comfy extraction tuning (DreamShaper / SD1.5)

Tune generation without editing workflow JSON by setting variables in `.env` (see also [`.env.example`](../.env.example)).

## KSampler (img2img strength and quality)

Applied to every `KSampler` in the active workflow (three branches in the bundled 3-way graphs).

| Variable | Effect |
|----------|--------|
| `COMFYUI_STEPS` or `COMFYUI_SAMPLER_STEPS` | Sampling steps. Use one number for all branches, or three comma-separated values (e.g. `32,30,34`). |
| `COMFYUI_CFG` or `COMFYUI_SAMPLER_CFG` | Classifier-free guidance scale. Same single vs triple pattern. |
| `COMFYUI_DENOISE` or `COMFYUI_SAMPLER_DENOISE` | Img2img denoise 0–1. Lower values stay closer to the source capture (often less “real-world” drift). |
| `COMFYUI_SAMPLER_NAME` | e.g. `euler`, `dpmpp_2m` |
| `COMFYUI_SAMPLER_SCHEDULER` | e.g. `normal`, `karras` |

Change one axis at a time when iterating (see [ComfyUI tips](https://comfyuiweb.com/posts/essential-comfyui-tips-and-tricks)).

## Optional LoRA (node `50` in bundled workflows)

Bundled [`sculptural_essence_3way_api.json`](../comfy/workflows/sculptural_essence_3way_api.json) and [`interior_uxui_3way_api.json`](../comfy/workflows/interior_uxui_3way_api.json) include a `LoraLoader` on the checkpoint. If `COMFYUI_LORA_NAME` is **unset**, the server removes that node and wires the checkpoint directly (no LoRA file required).

| Variable | Effect |
|----------|--------|
| `COMFYUI_LORA_NAME` | Filename in `ComfyUI/models/loras` (e.g. `my_style.safetensors`). |
| `COMFYUI_LORA_STRENGTH_MODEL` | Default `0.85` |
| `COMFYUI_LORA_STRENGTH_CLIP` | Default `0.85` |

## Depth ControlNet (optional workflow)

[`sculptural_essence_3way_controlnet_depth_api.json`](../comfy/workflows/sculptural_essence_3way_controlnet_depth_api.json) adds depth ControlNet on top of the sculptural graph. It expects:

- `ControlNetLoader` with SD1.5 depth weights (default `control_v11f1p_sd15_depth.pth` in `models/controlnet`).
- A depth preprocessor node (default class `Zoe-DepthMapPreprocessor`). That class usually comes from the **comfyui_controlnet_aux** (or similar) custom node pack; if your Comfy install errors on queue, install the pack via ComfyUI-Manager or swap node `28` in the JSON to a depth preprocessor available on your machine.

| Variable | Effect |
|----------|--------|
| `COMFYUI_CONTROLNET_NAME` | Override control net filename (e.g. another SD1.5 depth model). |
| `COMFYUI_CONTROLNET_STRENGTH` | Strength on each `ControlNetApply` node (default in JSON: `0.65`). |
| `COMFYUI_CONTROLNET_LOADER_NODE_ID` | Optional fixed node id for the loader. |
| `COMFYUI_CONTROLNET_APPLY_NODE_IDS` | Optional comma-separated ids; if unset, all `ControlNetApply` / `ControlNetApplyAdvanced` nodes get the strength. |

Point the app at this file via the Curate preset (`constraintSettings.workflowFile`) or `COMFYUI_WORKFLOW_PATH`.

## Flux profile (future)

See [`comfy-flux-profile.md`](comfy-flux-profile.md). The extraction server logs `workflowFamily` (`COMFYUI_WORKFLOW_FAMILY`, default `sd15`). A full Flux graph is host-specific and not bundled here.
