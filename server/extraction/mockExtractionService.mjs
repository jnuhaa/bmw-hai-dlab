import path from "node:path";

const INTERIOR_UXUI_WORKFLOW_BASENAME = "interior_uxui_3way_api.json";

const workflowPalettes = {
  shape: {
    background: "#5f4f37",
    accent: "#d8b684",
    soft: "#f2e6d5",
  },
  texture: {
    background: "#3b5453",
    accent: "#a9c2bb",
    soft: "#e5efec",
  },
  pattern: {
    background: "#3a495d",
    accent: "#a9b8cd",
    soft: "#edf2f7",
  },
};

const DIRECTION_SEQUENCE = [
  {
    id: "spatial",
    label: "Spatial",
    workflowType: "shape",
    title: "Spatial",
    caption: "spatial exploration",
    tags: ["volumetric rhythm", "contour hierarchy"],
  },
  {
    id: "tactile",
    label: "Tactile",
    workflowType: "texture",
    title: "Tactile",
    caption: "tactile exploration",
    tags: ["tactile grain", "surface modulation"],
  },
  {
    id: "experiential",
    label: "Experiential",
    workflowType: "pattern",
    title: "Experiential",
    caption: "ethereal cinematic mood study",
    tags: ["atmospheric cadence", "emotional tone"],
  },
];

const INTERIOR_UXUI_DIRECTION_SEQUENCE = [
  {
    id: "interface",
    label: "Interface",
    workflowType: "shape",
    title: "Interface",
    caption: "surfaces as responsive UI and projection",
    tags: ["responsive surface", "projection UI"],
  },
  {
    id: "installation",
    label: "Installation",
    workflowType: "texture",
    title: "Installation",
    caption: "room-scale immersive environment",
    tags: ["immersive volume", "enveloping light"],
  },
  {
    id: "wearable",
    label: "Wearable",
    workflowType: "pattern",
    title: "Wearable",
    caption: "body-proximate light and gesture",
    tags: ["body scale", "gesture proximity"],
  },
];

function getDirectionSequenceForWorkflow(workflowFile) {
  const base = path.basename(String(workflowFile ?? "").trim());
  if (base === INTERIOR_UXUI_WORKFLOW_BASENAME) {
    return INTERIOR_UXUI_DIRECTION_SEQUENCE;
  }
  return DIRECTION_SEQUENCE;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function toDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createMockBoardImage({ title, caption, tags, workflowType, index, sourceImageUrl }) {
  const palette = workflowPalettes[workflowType] ?? workflowPalettes.shape;
  const sourceImage = escapeAttribute(sourceImageUrl ?? "");
  const sourceLayerMarkup = sourceImage
    ? `
      <image
        href="${sourceImage}"
        x="${64 + index * 10}"
        y="${70 + index * 6}"
        width="${620 - index * 16}"
        height="${292 - index * 8}"
        preserveAspectRatio="xMidYMid slice"
        opacity="${0.38 + index * 0.08}"
        filter="url(#source-filter-${index})"
        clip-path="url(#source-mask-${index})"
      />`
    : "";
  const chipMarkup = tags
    .slice(0, 3)
    .map(
      (tag, tagIndex) => `
        <g transform="translate(${48 + tagIndex * 164} 320)">
          <rect width="148" height="32" rx="16" fill="rgba(255,255,255,0.09)" />
          <text x="74" y="21" text-anchor="middle" font-size="12" fill="${palette.soft}" font-family="IBM Plex Sans, sans-serif">
            ${escapeHtml(tag)}
          </text>
        </g>`,
    )
    .join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
      <defs>
        <linearGradient id="surface-${index}" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="${palette.background}" />
          <stop offset="100%" stop-color="#10161d" />
        </linearGradient>
        <filter id="source-filter-${index}">
          <feGaussianBlur stdDeviation="${2.6 + index * 1.2}" />
          <feColorMatrix
            type="matrix"
            values="
              1.18 0 0 0 -0.06
              0 1.1 0 0 -0.06
              0 0 1.22 0 -0.08
              0 0 0 1 0"
          />
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude="1" exponent="${0.78 + index * 0.06}" offset="0"/>
            <feFuncG type="gamma" amplitude="1" exponent="${0.8 + index * 0.05}" offset="0"/>
            <feFuncB type="gamma" amplitude="1" exponent="${0.84 + index * 0.05}" offset="0"/>
          </feComponentTransfer>
        </filter>
        <clipPath id="source-mask-${index}">
          <rect x="42" y="42" width="636" height="336" rx="26" />
        </clipPath>
      </defs>
      <rect width="720" height="420" rx="34" fill="url(#surface-${index})" />
      ${sourceLayerMarkup}
      <circle cx="${170 + index * 120}" cy="${88 + index * 28}" r="116" fill="rgba(255,255,255,0.06)" />
      <circle cx="${536 - index * 96}" cy="${128 + index * 40}" r="82" fill="rgba(255,255,255,0.07)" />
      <rect x="42" y="42" width="636" height="336" rx="26" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
      <text x="48" y="82" font-size="12" letter-spacing="2.5" fill="rgba(255,255,255,0.58)" font-family="IBM Plex Sans, sans-serif">
        ${escapeHtml(caption.toUpperCase())}
      </text>
      <text x="48" y="146" font-size="40" fill="${palette.soft}" font-family="Iowan Old Style, Palatino Linotype, serif">
        ${escapeHtml(title)}
      </text>
      <text x="48" y="188" font-size="18" fill="rgba(255,255,255,0.72)" font-family="IBM Plex Sans, sans-serif">
        ${escapeHtml(tags.join(" • "))}
      </text>
      <path d="M86 262 C164 196 260 194 326 252 S494 312 580 242" fill="none" stroke="${palette.accent}" stroke-width="16" stroke-linecap="round" />
      <path d="M112 238 C184 286 248 290 316 242 S450 194 534 254" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="10" stroke-linecap="round" />
      ${chipMarkup}
    </svg>`;

  return toDataUrl(svg);
}

export async function extractWithMockProvider(payload, options = {}) {
  const seedTags = Array.from(new Set(payload.labels ?? [])).slice(0, 6);
  const derivedTags = seedTags.length > 0 ? seedTags : ["sculptural cue", "material cadence"];
  const generatedAt = new Date().toISOString();
  const directionSequence = getDirectionSequenceForWorkflow(payload.constraintSettings?.workflowFile);

  return {
    provider: "mock",
    fallbackReason: options.fallbackReason,
    generatedOutputs: directionSequence.map((direction, index) => ({
      id: `${payload.sourceAssetId}-mock-${Date.now()}-${index + 1}`,
      title: direction.title,
      caption: direction.caption,
      tags: Array.from(new Set([direction.label, ...direction.tags, ...derivedTags])).slice(0, 4),
      parentAssetId: payload.sourceAssetId,
      directionId: direction.id,
      directionLabel: direction.label,
      generation: {
        provider: "mock",
        generatedAt,
        workflowType: direction.workflowType,
      },
      imageUrl: createMockBoardImage({
        title: direction.title,
        caption: `${payload.contextText || "Curate"} / ${direction.label}`,
        tags: Array.from(new Set([direction.label, ...derivedTags])).slice(0, 3),
        workflowType: direction.workflowType,
        index,
        sourceImageUrl: payload.sourceImageUrl,
      }),
    })),
  };
}
