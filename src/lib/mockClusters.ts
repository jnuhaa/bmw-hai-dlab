import type { BoardAsset, OrbPlacement } from "../types/assets";

export type ClusterId = "protective" | "comfort" | "detail";

export type ClusterZone = {
  id: ClusterId;
  title: string;
  subtitle: string;
  accent: "amber" | "sage" | "steel";
  labelX: number;
  labelY: number;
  ringInset: number;
};

type ClusterLayout = {
  placements: Record<string, OrbPlacement>;
  assignments: Record<string, ClusterId>;
  zones: ClusterZone[];
};

const clusterZones: ClusterZone[] = [
  {
    id: "protective",
    title: "Protective Layers",
    subtitle: "shelter, support, enclosure",
    accent: "amber",
    labelX: 32,
    labelY: 14,
    ringInset: 4,
  },
  {
    id: "comfort",
    title: "Comfort Gradients",
    subtitle: "surface calm, light, atmosphere",
    accent: "sage",
    labelX: 74,
    labelY: 46,
    ringInset: 15,
  },
  {
    id: "detail",
    title: "Directional Details",
    subtitle: "contours, apertures, rhythm",
    accent: "steel",
    labelX: 36,
    labelY: 80,
    ringInset: 24,
  },
];

const clusterKeywords: Record<ClusterId, string[]> = {
  protective: [
    "protective",
    "support",
    "supportive",
    "secure",
    "shelter",
    "cocoon",
    "enclosure",
    "shield",
    "contained",
    "safe",
  ],
  comfort: [
    "soft",
    "calm",
    "quiet",
    "surface",
    "texture",
    "glow",
    "gradient",
    "ambient",
    "reflection",
    "material",
    "comfort",
  ],
  detail: [
    "contour",
    "arc",
    "band",
    "detail",
    "transition",
    "rhythm",
    "edge",
    "opening",
    "aperture",
    "vertical",
    "framing",
  ],
};

function getClusterIdForAsset(asset: BoardAsset): ClusterId {
  const haystack = `${asset.title} ${asset.labels.join(" ")}`.toLowerCase();
  const scores: Record<ClusterId, number> = {
    protective: 0,
    comfort: 0,
    detail: 0,
  };

  (Object.keys(clusterKeywords) as ClusterId[]).forEach((clusterId) => {
    clusterKeywords[clusterId].forEach((keyword) => {
      if (haystack.includes(keyword)) {
        scores[clusterId] += 1;
      }
    });
  });

  const rankedClusters = (Object.entries(scores) as Array<[ClusterId, number]>).sort(
    (left, right) => right[1] - left[1],
  );

  if (rankedClusters[0][1] > 0) {
    return rankedClusters[0][0];
  }

  if (asset.kind === "crop") {
    return "detail";
  }

  if (asset.kind === "captured") {
    return "protective";
  }

  return "comfort";
}

function getPlacementForClusterAsset(
  clusterId: ClusterId,
  index: number,
  total: number,
  asset: BoardAsset,
): OrbPlacement {
  const spread = total <= 1 ? 0 : (index / Math.max(total - 1, 1) - 0.5) * 44;
  const wobble = ((index % 2 === 0 ? 1 : -1) * 6) / Math.max(total, 1);
  const baseScale = asset.kind === "crop" ? 0.92 : asset.kind === "captured" ? 1.08 : 0.88;

  if (clusterId === "protective") {
    return {
      azimuth: spread,
      elevation: -26 + (index % 3) * 7,
      depth: 0.82 - (index % 4) * 0.08,
      scale: baseScale,
      lane: "surface",
      phase: index * 0.12,
    };
  }

  if (clusterId === "comfort") {
    return {
      azimuth: spread * 0.9,
      elevation: -2 + ((index % 3) - 1) * 7,
      depth: 0.7 - (index % 4) * 0.06,
      scale: baseScale * 0.96,
      lane: "inner",
      phase: index * 0.12 + 0.2,
    };
  }

  return {
    azimuth: spread + wobble + 10,
    elevation: 20 + (index % 3) * 6,
    depth: 0.76 - (index % 4) * 0.07,
    scale: baseScale * 0.9,
    lane: asset.kind === "crop" ? "halo" : "surface",
    phase: index * 0.12 + 0.4,
  };
}

export function getMockClusterLayout(assets: BoardAsset[]): ClusterLayout {
  const assignments = Object.fromEntries(
    assets.map((asset) => [asset.id, getClusterIdForAsset(asset)]),
  ) as Record<string, ClusterId>;

  const groupedAssets: Record<ClusterId, BoardAsset[]> = {
    protective: [],
    comfort: [],
    detail: [],
  };

  assets.forEach((asset) => {
    groupedAssets[assignments[asset.id]].push(asset);
  });

  const placements: Record<string, OrbPlacement> = {};

  clusterZones.forEach((zone) => {
    groupedAssets[zone.id].forEach((asset, index, clusterAssets) => {
      placements[asset.id] = getPlacementForClusterAsset(
        zone.id,
        index,
        clusterAssets.length,
        asset,
      );
    });
  });

  return {
    placements,
    assignments,
    zones: clusterZones,
  };
}
