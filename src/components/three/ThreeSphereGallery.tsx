import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import * as THREE from "three";
import type { BoardAsset } from "../../types/assets";

export type SphereGallerySettings = {
  radius: number;
  itemGap: number;
  aspectRatio: number;
  autoSpin: boolean;
  spinSpeed: number;
  dragSensitivity: number;
  scrollEnabled: boolean;
};

type GalleryStats = {
  velocity: number;
  fps: number;
};

type ThreeSphereGalleryProps = {
  assets: BoardAsset[];
  settings: SphereGallerySettings;
  introNonce: number;
  onSelectAsset?: (asset: BoardAsset) => void;
  onStatsChange?: (stats: GalleryStats) => void;
  onReady?: () => void;
};

async function loadAssetTexture(loader: THREE.TextureLoader, asset: BoardAsset) {
  if (!asset.imageUrl) {
    return createReferenceTexture(asset);
  }

  try {
    const texture = await loader.loadAsync(asset.imageUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch (error) {
    console.warn("[gallery] Falling back to reference texture for asset", asset.id, error);
    return createReferenceTexture(asset);
  }
}

function createReferenceTexture(asset: BoardAsset) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  const palettes = {
    sand: ["#f4ede3", "#b99467", "#5e4735"],
    mist: ["#eef4f5", "#9fb3bd", "#44515a"],
    olive: ["#e3ead6", "#8b9d72", "#3f4d42"],
    slate: ["#f0f4f8", "#96a7bd", "#3f4f63"],
    captured: ["#ffffff", "#d9d9d9", "#4b4b4b"],
    ingredient: ["#f7f7f7", "#c2d1df", "#435466"],
  } as const;

  const [highlight, middle, shadow] = palettes[asset.tone];
  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, highlight);
  gradient.addColorStop(0.5, middle);
  gradient.addColorStop(1, shadow);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  context.fillStyle = "rgba(255,255,255,0.18)";
  context.beginPath();
  context.arc(170, 140, 120, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(255,255,255,0.28)";
  context.lineWidth = 16;
  context.beginPath();
  context.moveTo(118, 334);
  context.bezierCurveTo(182, 232, 298, 230, 388, 312);
  context.stroke();

  context.fillStyle = "rgba(255,255,255,0.88)";
  context.font = "600 42px Inter, system-ui, sans-serif";
  context.fillText(asset.title, 44, 76, 420);

  context.fillStyle = "rgba(255,255,255,0.62)";
  context.font = "500 18px Inter, system-ui, sans-serif";
  context.fillText(asset.labels.slice(0, 2).join(" • "), 44, 110, 420);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getTargetPosition(asset: BoardAsset, radius: number) {
  const azimuth = (asset.orbPlacement.azimuth * Math.PI) / 180;
  const elevation = (asset.orbPlacement.elevation * Math.PI) / 180;
  const laneMultiplier =
    asset.orbPlacement.lane === "halo"
      ? 1.18
      : asset.orbPlacement.lane === "inner"
        ? 0.82
        : 1;
  const targetRadius = radius * laneMultiplier;

  return new THREE.Vector3(
    targetRadius * Math.cos(elevation) * Math.sin(azimuth),
    targetRadius * Math.sin(elevation),
    targetRadius * Math.cos(elevation) * Math.cos(azimuth),
  );
}

function getMeshScale(asset: BoardAsset) {
  if (asset.size === "large") {
    return 1.18;
  }

  if (asset.size === "small") {
    return 0.78;
  }

  return 0.96;
}

export function ThreeSphereGallery({
  assets,
  settings,
  introNonce,
  onSelectAsset,
  onStatsChange,
  onReady,
}: ThreeSphereGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sphereGroupRef = useRef<THREE.Group | null>(null);
  const meshesRef = useRef<Array<{ asset: BoardAsset; mesh: THREE.Mesh }>>([]);
  const settingsRef = useRef(settings);
  const onSelectAssetRef = useRef(onSelectAsset);
  const onStatsChangeRef = useRef(onStatsChange);
  const onReadyRef = useRef(onReady);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const dragStateRef = useRef({
    isDragging: false,
    moved: false,
    previousMouse: { x: 0, y: 0 },
    targetRotation: { x: 0, y: 0 },
    currentRotation: { x: 0, y: 0 },
    pointerDown: { x: 0, y: 0 },
  });

  settingsRef.current = settings;
  onSelectAssetRef.current = onSelectAsset;
  onStatsChangeRef.current = onStatsChange;
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      1000,
    );
    camera.position.z = 18;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "3D inspiration sphere");
    container.appendChild(renderer.domElement);

    const sphereGroup = new THREE.Group();
    scene.add(sphereGroup);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(8, 10, 16);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xc7d4ff, 0.55);
    rimLight.position.set(-10, -4, -8);
    scene.add(rimLight);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    sphereGroupRef.current = sphereGroup;

    let frameId = 0;
    let lastFrameTime = performance.now();

    const render = (time: number) => {
      frameId = window.requestAnimationFrame(render);

      const dragState = dragStateRef.current;
      dragState.currentRotation.x +=
        (dragState.targetRotation.x - dragState.currentRotation.x) * 0.1;
      dragState.currentRotation.y +=
        (dragState.targetRotation.y - dragState.currentRotation.y) * 0.1;

      sphereGroup.rotation.x = dragState.currentRotation.x;
      sphereGroup.rotation.y = dragState.currentRotation.y;

      if (settingsRef.current.autoSpin && !dragState.isDragging) {
        dragState.targetRotation.y += settingsRef.current.spinSpeed;
      }

      const delta = time - lastFrameTime;
      lastFrameTime = time;

      if (onStatsChangeRef.current) {
        onStatsChangeRef.current({
          velocity: Math.abs(dragState.targetRotation.y - dragState.currentRotation.y) * 100,
          fps: delta > 0 ? 1000 / delta : 60,
        });
      }

      renderer.render(scene, camera);
    };

    frameId = window.requestAnimationFrame(render);

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    const handlePointerDown = (event: PointerEvent) => {
      dragStateRef.current.isDragging = true;
      dragStateRef.current.moved = false;
      dragStateRef.current.previousMouse = { x: event.clientX, y: event.clientY };
      dragStateRef.current.pointerDown = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current.isDragging) {
        return;
      }

      const deltaX =
        (event.clientX - dragStateRef.current.previousMouse.x) *
        0.002 *
        settingsRef.current.dragSensitivity;
      const deltaY =
        (event.clientY - dragStateRef.current.previousMouse.y) *
        0.002 *
        settingsRef.current.dragSensitivity;

      dragStateRef.current.targetRotation.y += deltaX;
      dragStateRef.current.targetRotation.x += deltaY;
      dragStateRef.current.previousMouse = { x: event.clientX, y: event.clientY };

      if (
        Math.abs(event.clientX - dragStateRef.current.pointerDown.x) > 4 ||
        Math.abs(event.clientY - dragStateRef.current.pointerDown.y) > 4
      ) {
        dragStateRef.current.moved = true;
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const wasDragging = dragStateRef.current.isDragging;
      const moved = dragStateRef.current.moved;
      dragStateRef.current.isDragging = false;

      if (!wasDragging || moved || !onSelectAssetRef.current) {
        return;
      }

      const bounds = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const intersects = raycasterRef.current.intersectObjects(
        meshesRef.current.map(({ mesh }) => mesh),
        false,
      );

      const selectedMesh = intersects[0]?.object;
      if (!(selectedMesh instanceof THREE.Mesh)) {
        return;
      }

      const match = meshesRef.current.find(({ mesh }) => mesh === selectedMesh);
      if (match?.asset.kind === "captured") {
        onSelectAssetRef.current(match.asset);
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (!settingsRef.current.scrollEnabled) {
        return;
      }

      dragStateRef.current.targetRotation.y += event.deltaY * 0.0005;
      dragStateRef.current.targetRotation.x += event.deltaX * 0.0004;
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("wheel", handleWheel);

      meshesRef.current.forEach(({ mesh }) => {
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose());
        } else {
          mesh.material.dispose();
        }
      });

      sphereGroup.clear();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const currentSphereGroup = sphereGroupRef.current;
    if (!currentSphereGroup) {
      return;
    }

    let cancelled = false;

    async function rebuildGallery() {
      const sphereGroup = currentSphereGroup!;
      const loader = new THREE.TextureLoader();

      try {
        meshesRef.current.forEach(({ mesh }) => {
          sphereGroup.remove(mesh);
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => material.dispose());
          } else {
            mesh.material.dispose();
          }
        });
        meshesRef.current = [];

        const meshEntries = await Promise.all(
          assets.map(async (asset) => {
            const texture = await loadAssetTexture(loader, asset);

            const geometry = new THREE.PlaneGeometry(
              settings.itemGap * getMeshScale(asset),
              (settings.itemGap / settings.aspectRatio) * getMeshScale(asset),
            );

            const material = new THREE.MeshStandardMaterial({
              map: texture,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 0,
              metalness: 0.08,
              roughness: 0.78,
            });

            const mesh = new THREE.Mesh(geometry, material);
            const finalPosition = getTargetPosition(asset, settings.radius);

            mesh.position.copy(finalPosition);
            mesh.lookAt(new THREE.Vector3(0, 0, 0));
            mesh.userData.finalPosition = finalPosition.clone();
            mesh.userData.finalScale = asset.orbPlacement.scale;

            if (asset.entryMotion === "phone") {
              mesh.position.set(settings.radius * 2.1, settings.radius * 1.2, settings.radius * 0.8);
            } else if (asset.entryMotion === "crop") {
              mesh.position.set(0, 0, settings.radius * 0.35);
            } else if (asset.entryMotion === "desktop") {
              mesh.position.set(-settings.radius * 2, settings.radius * 1.1, settings.radius * 0.7);
            } else {
              mesh.position.set(
                (Math.random() - 0.5) * settings.radius * 3,
                (Math.random() - 0.5) * settings.radius * 3,
                (Math.random() - 0.5) * settings.radius * 3,
              );
            }

            mesh.scale.set(0.0001, 0.0001, 0.0001);
            return { asset, mesh };
          }),
        );

        if (cancelled) {
          meshEntries.forEach(({ mesh }) => {
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((material) => material.dispose());
            } else {
              mesh.material.dispose();
            }
          });
          return;
        }

        meshEntries.forEach(({ mesh }) => sphereGroup.add(mesh));
        meshesRef.current = meshEntries;

        meshEntries.forEach(({ asset, mesh }, index) => {
          const finalPosition = mesh.userData.finalPosition as THREE.Vector3;
          gsap.to(mesh.position, {
            x: finalPosition.x,
            y: finalPosition.y,
            z: finalPosition.z,
            duration: 1.5,
            delay: index * 0.01,
            ease: "expo.out",
          });

          gsap.to(mesh.scale, {
            x: asset.orbPlacement.scale,
            y: asset.orbPlacement.scale,
            z: asset.orbPlacement.scale,
            duration: 1,
            delay: index * 0.01 + 0.2,
            ease: "back.out(1.7)",
          });

          gsap.to(mesh.material, {
            opacity: 1,
            duration: 1,
            delay: index * 0.01 + 0.3,
          });
        });
      } finally {
        window.setTimeout(() => {
          if (!cancelled) {
            onReadyRef.current?.();
          }
        }, 300);
      }
    }

    void rebuildGallery();

    return () => {
      cancelled = true;
    };
  }, [
    assets,
    introNonce,
    settings.aspectRatio,
    settings.itemGap,
    settings.radius,
  ]);

  return <div ref={containerRef} className="three-sphere-canvas" />;
}
