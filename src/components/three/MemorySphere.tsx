import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import type { CurateGroupHub } from "../../lib/curateSphereGrouping";
import type { BoardAsset } from "../../types/assets";

type MemorySphereSettings = {
  radius: number;
  friction: number;
  minVelocity: number;
  sensitivity: number;
};

type MemorySphereProps = {
  assets: BoardAsset[];
  settings: MemorySphereSettings;
  onSelectAsset?: (asset: BoardAsset) => void;
  /** Fired when pointer enters/leaves a card (asset id or null). */
  onHoverAssetChange?: (assetId: string | null) => void;
  selectedAssetId?: string | null;
  /** Curate tab: cluster center labels (CSS3D), pointer-events none. */
  groupHubs?: CurateGroupHub[];
  /** Increment to reset camera distance and sphere drag rotation to defaults (e.g. after restoring layout). */
  viewportResetNonce?: number;
};

type SphereObjectEntry = {
  asset: BoardAsset;
  object: CSS3DObject;
  element: HTMLDivElement;
  isFresh: boolean;
};

type LinkVisual = {
  parentAssetId: string;
  parentObject: CSS3DObject;
  childObject: CSS3DObject;
  line: THREE.Line;
  lineGeometry: THREE.BufferGeometry;
  lineMaterial: THREE.LineBasicMaterial;
  parentNode: THREE.Mesh;
  childNode: THREE.Mesh;
  childGlow: THREE.Mesh;
};

type PlacementTarget = {
  id: string;
  x: number;
  y: number;
  z: number;
  scale: number;
};

function getSpawnPosition(asset: BoardAsset) {
  if (asset.entryMotion === "phone") {
    return { x: -560, y: 180, z: 1180 };
  }

  if (asset.entryMotion === "crop") {
    return { x: 0, y: 260, z: 1100 };
  }

  return { x: 560, y: -160, z: 1180 };
}

function createReferenceImage(asset: BoardAsset) {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 450;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  const palettes = {
    sand: ["#f3ede6", "#bd9b71", "#524133"],
    mist: ["#eef3f7", "#92a6b4", "#3b4853"],
    olive: ["#e5ecd8", "#80906a", "#374236"],
    slate: ["#edf2f7", "#9aaac2", "#3a4857"],
    captured: ["#ffffff", "#d6d7da", "#45484d"],
    ingredient: ["#f7f8fb", "#bfd0e2", "#48596c"],
  } as const;

  const [highlight, middle, shadow] = palettes[asset.tone];
  const gradient = context.createLinearGradient(0, 0, 600, 450);
  gradient.addColorStop(0, highlight);
  gradient.addColorStop(0.55, middle);
  gradient.addColorStop(1, shadow);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 600, 450);

  context.fillStyle = "rgba(255,255,255,0.16)";
  context.beginPath();
  context.arc(160, 150, 120, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(255,255,255,0.28)";
  context.lineWidth = 16;
  context.beginPath();
  context.moveTo(80, 300);
  context.bezierCurveTo(180, 180, 300, 190, 470, 320);
  context.stroke();

  return canvas.toDataURL("image/png");
}

function applyCardPresentation(
  element: HTMLDivElement,
  asset: BoardAsset,
  options: {
    selectedAssetId?: string | null;
  },
) {
  element.className = [
    "memory-sphere__card",
    `memory-sphere__card--${asset.kind}`,
    options.selectedAssetId === asset.id ? "memory-sphere__card--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const image = element.querySelector("img") ?? document.createElement("img");
  image.src = asset.imageUrl ?? createReferenceImage(asset);
  image.alt = asset.title;
  if (!image.parentElement) {
    element.appendChild(image);
  }
}

function createCardElement(
  asset: BoardAsset,
  options: {
    onSelectAsset?: (asset: BoardAsset) => void;
    selectedAssetId?: string | null;
  },
) {
  const element = document.createElement("div");
  applyCardPresentation(element, asset, options);

  if (options.onSelectAsset) {
    element.onclick = () => options.onSelectAsset?.(asset);
  }

  return element;
}

function positionFromPlacement(asset: BoardAsset, sphereRadius: number) {
  const placement = asset.orbPlacement;
  const azimuth = THREE.MathUtils.degToRad(placement.azimuth);
  const elevation = THREE.MathUtils.degToRad(placement.elevation);
  const laneOffset =
    placement.lane === "inner"
      ? -sphereRadius * 0.14
      : placement.lane === "halo"
        ? sphereRadius * 0.12
        : 0;
  const radialDistance = sphereRadius * placement.depth + laneOffset;

  const x = radialDistance * Math.sin(azimuth) * Math.cos(elevation);
  const y = radialDistance * Math.sin(elevation);
  const z = radialDistance * Math.cos(azimuth) * Math.cos(elevation);

  return { x, y, z };
}

function disposeMesh(mesh: THREE.Mesh) {
  if (mesh.geometry instanceof THREE.BufferGeometry) {
    mesh.geometry.dispose();
  }

  const { material } = mesh;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }

  material.dispose();
}

function disposeLinkVisual(linkGroup: THREE.Group, visual: LinkVisual) {
  gsap.killTweensOf(visual.lineMaterial);
  gsap.killTweensOf(visual.childGlow.scale);
  linkGroup.remove(visual.line);
  linkGroup.remove(visual.parentNode);
  linkGroup.remove(visual.childNode);
  linkGroup.remove(visual.childGlow);
  visual.lineGeometry.dispose();
  visual.lineMaterial.dispose();
  disposeMesh(visual.parentNode);
  disposeMesh(visual.childNode);
  disposeMesh(visual.childGlow);
}

function getAdaptiveScaleFactor(assetCount: number) {
  const overflow = Math.max(0, assetCount - 10);
  return Math.max(0.68, 1 - overflow * 0.012);
}

function relaxProjectedTargets(targets: PlacementTarget[]) {
  if (targets.length < 2) {
    return targets;
  }

  const relaxed = targets.map((target) => ({ ...target }));
  const iterations = 8;
  const baseMinSpacingPx = 132;
  const cameraDistance = 2200;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let leftIndex = 0; leftIndex < relaxed.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < relaxed.length; rightIndex += 1) {
        const left = relaxed[leftIndex];
        const right = relaxed[rightIndex];

        const leftProjectionScale = cameraDistance / Math.max(620, cameraDistance - left.z);
        const rightProjectionScale = cameraDistance / Math.max(620, cameraDistance - right.z);

        const leftScreenX = left.x * leftProjectionScale;
        const leftScreenY = left.y * leftProjectionScale;
        const rightScreenX = right.x * rightProjectionScale;
        const rightScreenY = right.y * rightProjectionScale;

        const deltaX = rightScreenX - leftScreenX;
        const deltaY = rightScreenY - leftScreenY;
        const distance = Math.hypot(deltaX, deltaY);
        const desiredDistance = baseMinSpacingPx * ((left.scale + right.scale) * 0.5);

        if (distance >= desiredDistance) {
          continue;
        }

        const normalX = distance > 0.0001 ? deltaX / distance : ((leftIndex + rightIndex) % 2 === 0 ? 1 : -1);
        const normalY = distance > 0.0001 ? deltaY / distance : 0;
        const overlap = desiredDistance - distance;
        const averageProjectionScale = (leftProjectionScale + rightProjectionScale) * 0.5;
        const worldAdjustment = (overlap * 0.5) / Math.max(0.35, averageProjectionScale);

        left.x -= normalX * worldAdjustment;
        left.y -= normalY * worldAdjustment;
        right.x += normalX * worldAdjustment;
        right.y += normalY * worldAdjustment;
      }
    }
  }

  relaxed.forEach((target) => {
    target.x = THREE.MathUtils.clamp(target.x, -1320, 1320);
    target.y = THREE.MathUtils.clamp(target.y, -920, 920);
  });

  return relaxed;
}

type HubEntry = {
  id: string;
  object: CSS3DObject;
  element: HTMLDivElement;
};

export function MemorySphere({
  assets,
  settings,
  onSelectAsset,
  onHoverAssetChange,
  selectedAssetId,
  groupHubs,
  viewportResetNonce = 0,
}: MemorySphereProps) {
  const webglContainerRef = useRef<HTMLDivElement>(null);
  const cssContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cssRendererRef = useRef<CSS3DRenderer | null>(null);
  const sphereGroupRef = useRef<THREE.Group | null>(null);
  const linkGroupRef = useRef<THREE.Group | null>(null);
  const settingsRef = useRef(settings);
  const onSelectAssetRef = useRef(onSelectAsset);
  const onHoverAssetChangeRef = useRef(onHoverAssetChange);
  const selectedAssetIdRef = useRef(selectedAssetId);
  const objectEntriesRef = useRef<SphereObjectEntry[]>([]);
  const linkVisualsRef = useRef<LinkVisual[]>([]);
  const hubEntriesRef = useRef<HubEntry[]>([]);
  const dragStateRef = useRef({
    isDragging: false,
    targetRotation: { x: 0, y: 0 },
    currentRotation: { x: 0, y: 0 },
    velocity: { x: 0, y: 0.002 },
    previousMouse: { x: 0, y: 0 },
  });

  settingsRef.current = settings;
  onSelectAssetRef.current = onSelectAsset;
  onHoverAssetChangeRef.current = onHoverAssetChange;
  selectedAssetIdRef.current = selectedAssetId;

  useEffect(() => {
    if (viewportResetNonce === 0) {
      return;
    }

    const camera = cameraRef.current;
    if (camera) {
      camera.position.z = 2200;
    }

    dragStateRef.current.targetRotation = { x: 0, y: 0 };
    dragStateRef.current.currentRotation = { x: 0, y: 0 };
    dragStateRef.current.velocity = { x: 0, y: 0.002 };
  }, [viewportResetNonce]);

  useEffect(() => {
    const webglContainer = webglContainerRef.current;
    const cssContainer = cssContainerRef.current;

    if (!webglContainer || !cssContainer) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      1,
      5000,
    );
    camera.position.z = 2200;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    webglContainer.appendChild(renderer.domElement);

    const cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    cssContainer.appendChild(cssRenderer.domElement);

    const sphereGroup = new THREE.Group();
    scene.add(sphereGroup);
    const linkGroup = new THREE.Group();
    linkGroup.renderOrder = 2;
    sphereGroup.add(linkGroup);

    const shellGeometry = new THREE.SphereGeometry(720, 48, 48);
    const shellMaterial = new THREE.MeshBasicMaterial({
      color: 0x8e8e8e,
      transparent: true,
      opacity: 0.028,
      wireframe: true,
    });
    const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);
    scene.add(shellMesh);

    const starCount = 260;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(starCount * 3);
    for (let index = 0; index < starCount; index += 1) {
      const stride = index * 3;
      const distance = 900 + Math.random() * 900;
      const phi = Math.acos(1 - 2 * Math.random());
      const theta = Math.random() * Math.PI * 2;
      particlePositions[stride] = distance * Math.sin(phi) * Math.cos(theta);
      particlePositions[stride + 1] = distance * Math.sin(phi) * Math.sin(theta);
      particlePositions[stride + 2] = distance * Math.cos(phi);
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xa3a3a3,
      transparent: true,
      opacity: 0.14,
      size: 2.2,
      sizeAttenuation: true,
    });
    const particleField = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleField);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    cssRendererRef.current = cssRenderer;
    sphereGroupRef.current = sphereGroup;
    linkGroupRef.current = linkGroup;

    let frameId = 0;

    const loop = () => {
      frameId = window.requestAnimationFrame(loop);

      const dragState = dragStateRef.current;

      if (!dragState.isDragging) {
        dragState.velocity.x *= settingsRef.current.friction;
        dragState.velocity.y *= settingsRef.current.friction;

        if (Math.abs(dragState.velocity.x) < settingsRef.current.minVelocity) {
          dragState.velocity.x =
            Math.sign(dragState.velocity.x || 1) * settingsRef.current.minVelocity;
        }

        if (Math.abs(dragState.velocity.y) < settingsRef.current.minVelocity) {
          dragState.velocity.y =
            Math.sign(dragState.velocity.y || 1) * settingsRef.current.minVelocity;
        }

        dragState.targetRotation.x += dragState.velocity.x;
        dragState.targetRotation.y += dragState.velocity.y;
      }

      dragState.currentRotation.x +=
        (dragState.targetRotation.x - dragState.currentRotation.x) * 0.1;
      dragState.currentRotation.y +=
        (dragState.targetRotation.y - dragState.currentRotation.y) * 0.1;

      sphereGroup.rotation.x = dragState.currentRotation.x;
      sphereGroup.rotation.y = dragState.currentRotation.y;
      shellMesh.rotation.x = dragState.currentRotation.x * 0.18;
      shellMesh.rotation.y = dragState.currentRotation.y * 0.18;
      particleField.rotation.y += 0.00035;

      const selectedAssetIdValue = selectedAssetIdRef.current;
      const pulse = (Math.sin(performance.now() * 0.0042) + 1) / 2;
      linkVisualsRef.current.forEach((visual) => {
        const linePositions = visual.lineGeometry.getAttribute("position");
        const sourcePosition = visual.parentObject.position;
        const childPosition = visual.childObject.position;
        linePositions.setXYZ(0, sourcePosition.x, sourcePosition.y, sourcePosition.z);
        linePositions.setXYZ(1, childPosition.x, childPosition.y, childPosition.z);
        linePositions.needsUpdate = true;

        visual.parentNode.position.copy(sourcePosition);
        visual.childNode.position.copy(childPosition);
        visual.childGlow.position.copy(childPosition);

        const isSelectedPath =
          Boolean(selectedAssetIdValue) && selectedAssetIdValue === visual.parentAssetId;
        visual.lineMaterial.opacity = isSelectedPath ? 0.74 : 0.32;
        const glowScale = isSelectedPath ? 1.1 + pulse * 0.35 : 0.9 + pulse * 0.2;
        visual.childGlow.scale.set(glowScale, glowScale, glowScale);
        const glowMaterial = visual.childGlow.material;
        if (!Array.isArray(glowMaterial)) {
          glowMaterial.opacity = isSelectedPath ? 0.34 : 0.2;
        }
      });

      objectEntriesRef.current.forEach(({ object }) => {
        object.lookAt(camera.position);
      });
      hubEntriesRef.current.forEach(({ object }) => {
        object.lookAt(camera.position);
      });

      renderer.render(scene, camera);
      cssRenderer.render(scene, camera);
    };

    const handleMouseDown = (event: MouseEvent) => {
      dragStateRef.current.isDragging = true;
      dragStateRef.current.previousMouse = { x: event.clientX, y: event.clientY };
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStateRef.current.isDragging) {
        return;
      }

      const deltaX =
        (event.clientX - dragStateRef.current.previousMouse.x) *
        settingsRef.current.sensitivity;
      const deltaY =
        (event.clientY - dragStateRef.current.previousMouse.y) *
        settingsRef.current.sensitivity;

      dragStateRef.current.velocity.y = deltaX;
      dragStateRef.current.velocity.x = deltaY;
      dragStateRef.current.targetRotation.y += deltaX;
      dragStateRef.current.targetRotation.x += deltaY;
      dragStateRef.current.previousMouse = { x: event.clientX, y: event.clientY };
    };

    const handleMouseUp = () => {
      dragStateRef.current.isDragging = false;
    };

    const handleWheel = (event: WheelEvent) => {
      camera.position.z = Math.min(3000, Math.max(50, camera.position.z + event.deltaY));
    };

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      cssRenderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("resize", handleResize);

    frameId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("resize", handleResize);

      objectEntriesRef.current.forEach(({ element, object }) => {
        element.onclick = null;
        sphereGroup.remove(object);
      });
      objectEntriesRef.current = [];
      hubEntriesRef.current.forEach(({ object, element }) => {
        sphereGroup.remove(object);
        element.remove();
      });
      hubEntriesRef.current = [];
      linkVisualsRef.current.forEach((visual) => disposeLinkVisual(linkGroup, visual));
      linkVisualsRef.current = [];

      sphereGroup.clear();
      scene.remove(shellMesh);
      scene.remove(particleField);
      shellGeometry.dispose();
      shellMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      cssRenderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const sphereGroup = sphereGroupRef.current;
    if (!sphereGroup) {
      return;
    }

    const entryMap = new Map(objectEntriesRef.current.map((entry) => [entry.asset.id, entry]));
    const nextEntries: SphereObjectEntry[] = [];

    assets.forEach((asset) => {
      const existingEntry = entryMap.get(asset.id);
      if (existingEntry) {
        existingEntry.asset = asset;
        applyCardPresentation(existingEntry.element, asset, {
          selectedAssetId: selectedAssetIdRef.current,
        });
        existingEntry.element.style.opacity = "1";
        existingEntry.element.style.filter = "blur(0px)";
        existingEntry.element.classList.remove("memory-sphere__card--ingesting");
        existingEntry.element.onclick = () => onSelectAssetRef.current?.(asset);
        nextEntries.push(existingEntry);
        entryMap.delete(asset.id);
        return;
      }

      const element = createCardElement(asset, {
        selectedAssetId: selectedAssetIdRef.current,
        onSelectAsset: (selectedAsset) => onSelectAssetRef.current?.(selectedAsset),
      });
      const object = new CSS3DObject(element);
      const spawn = getSpawnPosition(asset);
      object.position.set(spawn.x, spawn.y, spawn.z);
      object.scale.set(0.24, 0.24, 0.24);
      element.style.opacity = "0.16";
      element.style.filter = "blur(12px)";
      element.classList.add("memory-sphere__card--ingesting");
      sphereGroup.add(object);
      nextEntries.push({ asset, object, element, isFresh: true });
    });

    entryMap.forEach(({ object, element }) => {
      sphereGroup.remove(object);
      element.remove();
    });

    objectEntriesRef.current = nextEntries;

    const linkGroup = linkGroupRef.current;
    if (linkGroup) {
      linkVisualsRef.current.forEach((visual) => disposeLinkVisual(linkGroup, visual));
      linkVisualsRef.current = [];

      const nextEntryById = new Map(nextEntries.map((entry) => [entry.asset.id, entry]));
      const nextLinkVisuals: LinkVisual[] = [];

      assets.forEach((asset) => {
        if (asset.kind !== "generated" || !asset.parentAssetId) {
          return;
        }

        const parentEntry = nextEntryById.get(asset.parentAssetId);
        const childEntry = nextEntryById.get(asset.id);
        if (!parentEntry || !childEntry) {
          return;
        }

        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(6, 3));
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0xf37921,
          transparent: true,
          opacity: 0,
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        line.renderOrder = 2;

        const parentNode = new THREE.Mesh(
          new THREE.SphereGeometry(5, 14, 14),
          new THREE.MeshBasicMaterial({
            color: 0xf37921,
            transparent: true,
            opacity: 0.38,
          }),
        );
        parentNode.renderOrder = 3;

        const childNode = new THREE.Mesh(
          new THREE.SphereGeometry(6.5, 16, 16),
          new THREE.MeshBasicMaterial({
            color: 0xf37921,
            transparent: true,
            opacity: 0.58,
          }),
        );
        childNode.renderOrder = 3;

        const childGlow = new THREE.Mesh(
          new THREE.SphereGeometry(12, 18, 18),
          new THREE.MeshBasicMaterial({
            color: 0xf37921,
            transparent: true,
            opacity: 0.14,
          }),
        );
        childGlow.renderOrder = 2;

        linkGroup.add(line);
        linkGroup.add(parentNode);
        linkGroup.add(childNode);
        linkGroup.add(childGlow);

        const visual: LinkVisual = {
          parentAssetId: asset.parentAssetId,
          parentObject: parentEntry.object,
          childObject: childEntry.object,
          line,
          lineGeometry,
          lineMaterial,
          parentNode,
          childNode,
          childGlow,
        };
        nextLinkVisuals.push(visual);

        gsap.to(lineMaterial, {
          opacity: selectedAssetIdRef.current === asset.parentAssetId ? 0.74 : 0.32,
          duration: 0.64,
          ease: "power2.out",
        });
      });

      linkVisualsRef.current = nextLinkVisuals;
    }

    const adaptiveScaleFactor = getAdaptiveScaleFactor(nextEntries.length);
    const rawTargets = nextEntries.map((entry) => {
      const targetPosition = positionFromPlacement(entry.asset, settings.radius);
      const placementScale =
        typeof entry.asset.orbPlacement.scale === "number" ? entry.asset.orbPlacement.scale : 1;

      return {
        id: entry.asset.id,
        x: targetPosition.x,
        y: targetPosition.y,
        z: targetPosition.z,
        scale: Math.max(0.58, placementScale * adaptiveScaleFactor),
      };
    });
    const relaxedTargets = relaxProjectedTargets(rawTargets);
    const targetById = new Map(relaxedTargets.map((target) => [target.id, target]));

    nextEntries.forEach((entry) => {
      const target = targetById.get(entry.asset.id);
      if (!target) {
        return;
      }
      const tx = target.x;
      const ty = target.y;
      const tz = target.z;
      const targetScale = target.scale;

      const isFresh = entry.isFresh;

      gsap.killTweensOf(entry.object.position);
      gsap.killTweensOf(entry.object.scale);
      gsap.killTweensOf(entry.element);

      if (isFresh) {
        const midX = tx * 0.42;
        const midY = ty * 0.34 + (entry.asset.entryMotion === "crop" ? 120 : 90);
        const midZ = tz + 240;

        const ingress = gsap.timeline({
          onComplete: () => {
            entry.element.classList.remove("memory-sphere__card--ingesting");
          },
        });

        ingress.to(entry.object.position, {
          x: midX,
          y: midY,
          z: midZ,
          duration: 0.55,
          ease: "power2.out",
        });

        ingress.to(
          entry.object.position,
          {
            x: tx,
            y: ty,
            z: tz,
            duration: 1.05,
            ease: "expo.out",
          },
          "<",
        );

        ingress.to(
          entry.object.scale,
          {
            x: targetScale * 1.12,
            y: targetScale * 1.12,
            z: targetScale * 1.12,
            duration: 0.62,
            ease: "power2.out",
          },
          0,
        );

        ingress.to(
          entry.object.scale,
          {
            x: targetScale,
            y: targetScale,
            z: targetScale,
            duration: 0.5,
            ease: "power2.out",
          },
          ">-0.08",
        );

        ingress.to(
          entry.element,
          {
            opacity: 1,
            filter: "blur(0px)",
            duration: 0.88,
            ease: "power2.out",
          },
          0.06,
        );
      } else {
        gsap.to(entry.object.position, {
          x: tx,
          y: ty,
          z: tz,
          duration: 0.55,
          ease: "power2.out",
        });

        gsap.to(entry.object.scale, {
          x: targetScale,
          y: targetScale,
          z: targetScale,
          duration: 0.4,
          ease: "power2.out",
        });

        gsap.to(entry.element, {
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.32,
          ease: "power2.out",
        });
        entry.element.classList.remove("memory-sphere__card--ingesting");
      }

      entry.isFresh = false;
    });

    nextEntries.forEach(({ element, asset }) => {
      element.onpointerenter = () => {
        onHoverAssetChangeRef.current?.(asset.id);
      };
    });
  }, [assets, selectedAssetId, settings.radius]);

  useEffect(() => {
    const sphereGroup = sphereGroupRef.current;
    if (!sphereGroup) {
      return;
    }

    hubEntriesRef.current.forEach(({ object, element }) => {
      sphereGroup.remove(object);
      element.remove();
    });
    hubEntriesRef.current = [];

    const hubs = groupHubs ?? [];
    if (hubs.length === 0) {
      return;
    }

    for (const hub of hubs) {
      const element = document.createElement("div");
      const variant = hub.variant ?? "category";
      let scale = 0.78;

      if (variant === "origin") {
        element.className = "memory-sphere__hub memory-sphere__hub--origin";
        if (hub.imageUrl) {
          const img = document.createElement("img");
          img.className = "memory-sphere__hub-thumb";
          img.src = hub.imageUrl;
          img.alt = "";
          element.appendChild(img);
          const caption = document.createElement("span");
          caption.className = "memory-sphere__hub-caption section-label";
          caption.textContent = hub.label;
          element.appendChild(caption);
        } else {
          const fallback = document.createElement("span");
          fallback.className = "section-label memory-sphere__hub-label memory-sphere__hub-label--category";
          fallback.textContent = hub.label;
          element.appendChild(fallback);
        }
        scale = 0.52;
      } else {
        element.className = "memory-sphere__hub memory-sphere__hub--category";
        const label = document.createElement("span");
        label.className = "section-label memory-sphere__hub-label memory-sphere__hub-label--category";
        label.textContent = hub.label;
        element.appendChild(label);
        scale = 0.78;
      }

      const object = new CSS3DObject(element);
      object.position.set(hub.position.x, hub.position.y, hub.position.z);
      object.scale.set(scale, scale, scale);
      sphereGroup.add(object);
      hubEntriesRef.current.push({ id: hub.id, object, element });
    }

    return () => {
      hubEntriesRef.current.forEach(({ object, element }) => {
        sphereGroup.remove(object);
        element.remove();
      });
      hubEntriesRef.current = [];
    };
  }, [groupHubs]);

  return (
    <>
      <div ref={webglContainerRef} className="memory-sphere__webgl" />
      <div ref={cssContainerRef} className="memory-sphere__css3d" />
    </>
  );
}
