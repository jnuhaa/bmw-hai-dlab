import { useEffect, useRef } from "react";

type SphereAtmosphereProps = {
  pointerDrift: { x: number; y: number };
  isClustered: boolean;
};

export function SphereAtmosphere({
  pointerDrift,
  isClustered,
}: SphereAtmosphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let animationFrameId = 0;
    let startTime = performance.now();

    const particles = Array.from({ length: 24 }, (_, index) => ({
      angle: (index / 24) * Math.PI * 2,
      radius: 0.24 + (index % 5) * 0.085,
      size: index % 4 === 0 ? 2.2 : 1.2,
      speed: 0.09 + (index % 6) * 0.012,
      alpha: 0.08 + (index % 5) * 0.02,
    }));

    const resizeCanvas = () => {
      const bounds = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(bounds.width * window.devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(bounds.height * window.devicePixelRatio));
      context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    const render = (now: number) => {
      const elapsed = (now - startTime) / 1000;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const centerX = width / 2;
      const centerY = height / 2;

      context.clearRect(0, 0, width, height);

      const gradient = context.createRadialGradient(
        centerX + pointerDrift.x * 40,
        centerY + pointerDrift.y * 26,
        width * 0.05,
        centerX,
        centerY,
        width * 0.48,
      );
      gradient.addColorStop(0, "rgba(249, 245, 237, 0.11)");
      gradient.addColorStop(0.45, "rgba(184, 151, 110, 0.09)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      context.strokeStyle = isClustered
        ? "rgba(255, 255, 255, 0.1)"
        : "rgba(255, 255, 255, 0.06)";
      context.lineWidth = 1;

      [0.26, 0.38, 0.5].forEach((ratio, index) => {
        context.beginPath();
        context.ellipse(
          centerX,
          centerY,
          width * ratio,
          height * (ratio * 0.55),
          Math.sin(elapsed * 0.18 + index) * 0.12,
          0,
          Math.PI * 2,
        );
        context.stroke();
      });

      particles.forEach((particle, index) => {
        const angle = particle.angle + elapsed * particle.speed;
        const orbitalScale = isClustered ? 0.86 : 1;
        const x =
          centerX +
          Math.cos(angle) * width * particle.radius * orbitalScale +
          pointerDrift.x * (10 + index);
        const y =
          centerY +
          Math.sin(angle * 1.2) * height * particle.radius * 0.62 * orbitalScale +
          pointerDrift.y * (8 + index * 0.4);

        context.beginPath();
        context.fillStyle = `rgba(245, 241, 234, ${particle.alpha})`;
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();
      });

      animationFrameId = window.requestAnimationFrame(render);
    };

    animationFrameId = window.requestAnimationFrame(render);

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isClustered, pointerDrift.x, pointerDrift.y]);

  return <canvas ref={canvasRef} className="sphere-atmosphere" aria-hidden="true" />;
}
