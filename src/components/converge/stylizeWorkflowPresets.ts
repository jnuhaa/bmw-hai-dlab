/** Converge Stylize: automotive workflow JSON presets (files under `comfy/workflows/`). */
export type StylizeWorkflowPreset = {
  id: string;
  name: string;
  /** Basename only; server resolves under `comfy/workflows/`. */
  workflowFile: string;
  /** Merged into the positive prompt on the server. */
  automotiveContext: string;
  /** When set, Stylize runs two sequential Comfy passes (cinematic + angles) and returns two images. */
  dualOutput?: "cinematic_angles";
  /** Visuals for footer workflow cards (aligned with Curate Create gallery). */
  paletteA?: string;
  paletteB?: string;
  thumbnailUrl?: string;
};

export const STYLIZE_WORKFLOW_PRESETS: StylizeWorkflowPreset[] = [
  {
    id: "stylize-automotive-exterior",
    name: "Exterior",
    workflowFile: "stylize-automotive-exterior-api.json",
    automotiveContext:
      "Must read as a real automobile exterior: full passenger-vehicle body (hood, roof, doors, bumpers, glazed side glass, wheel arches). Clear three-quarter front, three-quarter rear, or side profile—recognizable car silhouette, production or concept car. Visible headlamps, tail lamps, wheels with tires, body panels and shutlines. Natural perspective (not ultra-wide); wheels elliptical and touching ground. Automotive design studio or motor-show lighting; reflective floor or neutral studio backdrop. Photorealistic or high-end clay/render look—NOT abstract sculpture, NOT furniture, NOT architecture model, NOT graphic poster or pattern art.",
    paletteA: "#ebe8e4",
    paletteB: "#f4f2ef",
    thumbnailUrl: "/workflow-thumbnails/thumbnail_1.png",
  },
  {
    id: "stylize-automotive-interior",
    name: "Interior",
    workflowFile: "stylize-automotive-interior-api.json",
    automotiveContext:
      "Must read as a real car cabin interior: passenger compartment with instrument panel, center stack, seats, door panels, steering wheel in correct context, console and footwell. Every major form should read as automotive trim, seating, or controls—not random decor. Seating rows and cabin volume visible; materials as automotive trim (leather, molded plastic, metal trim, soft-touch surfaces). Wide cabin shot or natural driver-eye perspective—believable IP layout and HMI zones. NOT a generic living room, office lounge, or abstract interior; NOT unrelated product; NOT exterior-only vehicle shot.",
    paletteA: "#f7ece6",
    paletteB: "#fff7f2",
    thumbnailUrl: "/workflow-thumbnails/thumbnail_2.png",
  },
  {
    id: "stylize-automotive-cockpit",
    name: "Cockpit",
    workflowFile: "stylize-automotive-cockpit-api.json",
    automotiveContext:
      "Driver-centric POV with forward field of view; legible instrumentation, HUD, and HMI glass layers; tactile control zones and depth layering; refractive highlights on displays; night-drive or controlled studio cockpit mood; clarity over clutter; premium UX visualization with cinematic contrast and soft bloom where appropriate.",
    paletteA: "#e7f6f2",
    paletteB: "#f6fffc",
    thumbnailUrl: "/workflow-thumbnails/thumbnail_3.png",
  },
  {
    id: "stylize-automotive-render",
    name: "Render",
    workflowFile: "stylize-automotive-render-api.json",
    automotiveContext:
      "High-end 3D product visualization: tangible materials, crisp panel definition, believable CMF (metal, glass, soft trim), controlled reflections, studio or gallery lighting. Concept-car or show-car presentation quality—readable proportions and dimensions, premium OEM design render—not a casual photo or illustration.",
    dualOutput: "cinematic_angles",
    paletteA: "#e8eaed",
    paletteB: "#f2f4f7",
    thumbnailUrl: "/workflow-thumbnails/thumbnail_1.png",
  },
];
