# AGENTS.md

## Project Goal
Build a demo-ready web prototype for an AI-assisted automotive design workflow focused on the first stage: Curate / Diverge.

The core concept:
- The designer captures inspiration from the real world.
- AI structures it into reusable visual ingredients.
- The designer remains the director.
- ComfyUI is a background engine, not the user-facing interface.

Positioning:
- This is a "designer + AI" workflow, not a "driver + AI" workflow.
- AI supports capture, organization, clustering, and visual translation.
- AI does not replace taste, judgment, or design authorship.

Recommended framing:
- "The designer captures meaning from the world. AI helps structure it into reusable design material."

## Repo Convention
- This file lives at the repo root and is the source of truth for implementation scope and workflow behavior until broader project documentation exists.
- Keep decisions aligned with this document unless the user explicitly changes scope.

## Demo Scope

### Build for real
- browser camera input
- image capture
- drag / crop region selection
- floating asset cards in a canvas-like workspace
- simple cluster animation
- one real ComfyUI extraction / reinterpretation flow

### Fake or simplify
- automatic internet inspiration gathering
- deep semantic clustering
- sophisticated visual ontology
- advanced multimodal reasoning
- any smart-glasses hardware integration beyond interaction simulation

## Core UX Flow
1. Show a context card, e.g. "Elements that make the driver feel safe while driving"
2. Allow camera capture from browser
3. After each capture, add the image as a floating asset on the board
4. Allow the user to drag-select a region from an image
5. Convert selected regions into smaller floating ingredient assets
6. Assign mocked or lightweight semantic labels
7. Support a `Cluster` action that groups assets with a simple animation
8. Support an `Extract` action that sends selected cluster data to the backend
9. Trigger one ComfyUI workflow
10. Display returned output as extracted shape / texture / pattern boards

## Product Priorities
1. Demo reliability
2. Clear and elegant UX
3. Modular implementation
4. Fast iteration
5. Easy local setup

## Architecture Principles
- Prefer a modern web stack suitable for a polished local demo.
- Keep architecture simple and modular.
- ComfyUI must be isolated behind a service layer or backend integration boundary.
- n8n is optional orchestration, not a hard dependency for core functionality.
- The frontend must stay designer-centric and avoid exposing backend complexity.
- Use practical defaults instead of asking unnecessary follow-up questions.
- Prefer polling over websocket complexity for MVP extraction status unless a stronger reason emerges.
- Use minimal, purposeful endpoints and simple storage/session handling.

## Frontend Guidance
- The UI should feel presentation-ready for an interview demo.
- Avoid placeholder-looking layouts.
- Keep interaction minimal, smooth, and understandable.
- The board should feel spatial and visual, not like a CRUD dashboard.
- The interface should feel more like a moodboard + workbench than a generic AI tool.
- Use clean typography, strong spacing, and restrained visual styling.
- Keep technical infrastructure invisible from the primary user experience.

Expected UI components:
- context card
- camera capture panel
- image review surface or modal
- drag-to-crop gesture overlay
- floating asset board
- label chips
- cluster trigger / controls
- cluster zones or soft grouping containers
- extract panel
- extracted results strip or board
- optional mocked AI side feed

## Backend / ComfyUI Guidance
- Keep endpoints minimal and purposeful.
- Use mock data where specified.
- Make ComfyUI integration replaceable and well isolated.
- If ComfyUI is unavailable, provide a clearly marked fallback path for demo reliability.
- The first MVP should call ComfyUI at one point only: after clustering, when the designer selects a cluster and asks the system to translate it into reusable visual ingredients.
- Do not use ComfyUI for semantic labeling or clustering.
- Use one stable, pre-tested workflow for image-to-image reinterpretation.
- Good extraction modes for the demo are:
  - `shape`
  - `texture`
  - `pattern`
- The output should be framed as translated ingredient boards, not final design proposals.
- Pre-generated fallback outputs are acceptable if they keep the demo stable and the live path remains isolated.

## Interaction And Data Model Defaults
Use simple, explicit state and naming. Expected concepts:
- `contextPrompt`: the active design framing prompt
- `asset`: a captured image or cropped child ingredient
- `assetList`: all board assets with spatial metadata
- `cropMetadata`: crop bounds, parent asset reference, and interaction state
- `labels`: lightweight semantic tags attached to assets
- `cluster`: a lightweight grouping of assets
- `clusterAssignments`: deterministic or rule-based mapping of assets to groups
- `extractionMode`: selected mode such as `shape`, `texture`, or `pattern`
- `extract`: the action that sends selected cluster context to the backend
- `generatedOutputs`: returned result cards for extracted visual ingredients
- `visual ingredients`: returned shape / texture / pattern outputs
- `constraintSettings`: UI-level extraction controls

Implementation defaults:
- Asset positioning can be simple x/y placement with z-order.
- Crop creation may happen client-side for MVP.
- Labels may be mocked, semi-real, or rule-based.
- Clustering may be deterministic and based on tag overlap or a simple chosen criterion.
- Store enough metadata to replay the demo reliably.
- Default generation output count is 3 (unless provider returns fewer).

## Demo Reliability Rules
- Reliability is more important than technical breadth.
- Do not add extra features beyond the approved scope.
- Limit the MVP to one polished curate-to-extract flow.
- Treat internet inspiration gathering as fake or prepared content.
- Treat semantic intelligence as lightweight assistance, not deep reasoning.
- Keep latency under control; if live extraction is slow or unstable, use a clearly isolated fallback.
- Avoid brittle dependencies in the primary demo path.

## Working Style
- Before major edits, summarize the implementation plan.
- Implement in small phases.
- After each phase, explain:
  - what was built
  - which files changed
  - how to run and test it
- Do not add extra features beyond scope.
- Do not overengineer abstractions.
- Prefer readable code over clever code.
- Add comments only where they improve clarity.
- Keep progress updates concrete and implementation-oriented.

Recommended build sequence:
1. Build the frontend shell first: context card, camera capture, floating asset board, and crop interaction.
2. Add simple local state for assets, labels, and cluster assignment so the board already feels alive before AI is connected.
3. Implement lightweight labeling and clustering using mocked or deterministic logic.
4. Add one clean cluster animation triggered by a single action.
5. Prepare one robust ComfyUI workflow for extraction and validate it separately.
6. Add a backend endpoint or optional n8n webhook that receives selected cluster payloads and calls ComfyUI.
7. Return generated images to the frontend and display them in an extracted-ingredients strip or board.
8. Polish the demo narrative: capture from the world -> organize inspiration -> cluster by intent -> translate into design material.

## Definition Of Done
The app is done when:
- it runs locally with clear setup instructions
- the Curate screen loads
- the user can access the browser camera
- the user can capture an image
- the user can drag-select a region
- captures and crops appear as floating assets
- mocked labels are shown
- clicking Cluster groups assets visually
- clicking Extract triggers one working ComfyUI-backed flow or a clearly isolated fallback
- the README explains setup, run steps, and demo usage
