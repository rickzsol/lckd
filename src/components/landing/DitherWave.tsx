"use client";

// DitherWave, React Bits Pro (licensed). Do not redistribute outside this project.
// Adapted for next/typescript: three from npm, static-frame support via `animate`.

import { useEffect, useRef } from "react";
import * as THREE from "three";

type Quality = "low" | "medium" | "high";

interface DitherWaveProps {
  width?: number | string;
  height?: number | string;
  speed?: number;
  intensity?: number;
  scale?: number;
  downScale?: number;
  opacity?: number;
  maxFPS?: number;
  quality?: Quality;
  pauseWhenOffscreen?: boolean;
  animate?: boolean;
  timeOffset?: number;
  primaryColor?: string;
  secondaryColor?: string;
  tertiaryColor?: string;
  className?: string;
  children?: React.ReactNode;
}

const VERTEX_SHADER = "void main() { gl_Position = vec4(position, 1.0); }";

const FRAGMENT_SHADER = `
  #define COLOR_COUNT 3
  uniform float iTime; uniform vec2 iResolution;
  uniform float uSpeed; uniform float uIntensity; uniform float uScale; uniform float uDownScale; uniform float uOpacity;
  uniform vec3 uColor1; uniform vec3 uColor2; uniform vec3 uColor3;
  vec3 colors[COLOR_COUNT];
  void setupColorPalette() { colors[0] = uColor1; colors[1] = uColor2; colors[2] = uColor3; }
  float Bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
  #define Bayer4(a)   (Bayer2(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer8(a)   (Bayer4(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer16(a)  (Bayer8(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer32(a)  (Bayer16(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer64(a)  (Bayer32(0.5 * (a)) * 0.25 + Bayer2(a))
  vec3 applyDitheredColor(float value, vec2 pixelCoord) {
    float paletteIndex = clamp(value, 0.0, 1.0) * float(COLOR_COUNT - 1);
    vec3 colorA = vec3(0.0); vec3 colorB = vec3(0.0);
    for (int i = 0; i < COLOR_COUNT; i++) {
      if (float(i) == floor(paletteIndex)) {
        colorA = colors[i];
        if (i < COLOR_COUNT - 1) { colorB = colors[i + 1]; } else { colorB = colorA; }
        break;
      }
    }
    float ditherValue = Bayer64(pixelCoord * 0.25);
    float blendAmount = float(fract(paletteIndex) > ditherValue);
    return mix(colorA, colorB, blendAmount);
  }
  float flowField(vec2 p, float t) { return sin(p.x + sin(p.y + t * 0.1)) * sin(p.y * p.x * 0.1 + t * 0.2); }
  vec2 computeField(vec2 p, float t) {
    vec2 ep = vec2(0.05, 0.0); vec2 result = vec2(0.0);
    for (int i = 0; i < 20; i++) {
      float t0 = flowField(p, t);
      float t1 = flowField(p + ep.xy, t);
      float t2 = flowField(p + ep.yx, t);
      vec2 gradient = vec2((t1 - t0), (t2 - t0)) / ep.xx;
      vec2 tangent = vec2(-gradient.y, gradient.x);
      p += tangent * 0.5 + gradient * 0.005;
      p.x += sin(t * 0.25) * 0.1;
      p.y += cos(t * 0.25) * 0.1;
      result = gradient;
    }
    return result;
  }
  void main() {
    setupColorPalette();
    vec2 uv = gl_FragCoord.xy / iResolution.xy - 0.5;
    uv.x *= iResolution.x / iResolution.y;
    float animTime = iTime * uSpeed;
    vec2 p = uv * uScale;
    vec2 field = computeField(p, animTime);
    float colorValue = clamp(length(field) * uIntensity, 0.0, 1.0);
    vec3 finalColor = applyDitheredColor(colorValue, gl_FragCoord.xy / uDownScale);
    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0, g: 0, b: 0 };
}

export default function DitherWave({
  width = "100%",
  height = "100%",
  speed = 1.0,
  intensity = 1.0,
  scale = 6.0,
  downScale = 0.5,
  opacity = 1.0,
  maxFPS = 60,
  quality = "medium",
  pauseWhenOffscreen = true,
  animate = true,
  timeOffset = 0,
  primaryColor = "#0B0D0C",
  secondaryColor = "#155C3B",
  tertiaryColor = "#2BD17E",
  className,
  children,
}: DitherWaveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isAnimated = animate && !reducedMotion;

    const color1 = hexToRgb(primaryColor);
    const color2 = hexToRgb(secondaryColor);
    const color3 = hexToRgb(tertiaryColor);

    const rect = container.getBoundingClientRect();
    const actualWidth = Math.max(rect.width, 2);
    const actualHeight = Math.max(rect.height, 2);

    const qualitySettings: Record<Quality, { pixelRatio: number; antialias: boolean }> = {
      low: { pixelRatio: 1, antialias: false },
      medium: { pixelRatio: Math.min(window.devicePixelRatio, 2), antialias: true },
      high: { pixelRatio: Math.min(window.devicePixelRatio, 3), antialias: true },
    };
    const settings = qualitySettings[quality] ?? qualitySettings.medium;

    const renderer = new THREE.WebGLRenderer({
      antialias: settings.antialias,
      alpha: true,
      powerPreference: "high-performance",
      stencil: false,
      depth: false,
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x000000, 0);
    const pixelRatio = settings.pixelRatio;
    renderer.setSize(actualWidth, actualHeight, false);
    renderer.setPixelRatio(pixelRatio);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector2(actualWidth * pixelRatio, actualHeight * pixelRatio) },
      uSpeed: { value: speed },
      uIntensity: { value: intensity },
      uScale: { value: scale },
      uDownScale: { value: downScale },
      uOpacity: { value: opacity },
      uColor1: { value: new THREE.Vector3(color1.r, color1.g, color1.b) },
      uColor2: { value: new THREE.Vector3(color2.r, color2.g, color2.b) },
      uColor3: { value: new THREE.Vector3(color3.r, color3.g, color3.b) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));

    let observer: IntersectionObserver | null = null;
    if (pauseWhenOffscreen) {
      observer = new IntersectionObserver(
        (entries) => {
          isVisibleRef.current = entries[0].isIntersecting;
        },
        { threshold: 0 }
      );
      observer.observe(container);
    }

    const frameInterval = 1000 / maxFPS;
    const renderFrame = (currentTime: number) => {
      rafRef.current = requestAnimationFrame(renderFrame);
      if (!startTimeRef.current) {
        startTimeRef.current = currentTime;
        lastFrameTimeRef.current = currentTime;
      }
      const elapsed = currentTime - lastFrameTimeRef.current;
      if (elapsed < frameInterval) return;
      lastFrameTimeRef.current = currentTime - (elapsed % frameInterval);
      if (pauseWhenOffscreen && !isVisibleRef.current) return;
      uniforms.iTime.value = timeOffset + (currentTime - startTimeRef.current) * 0.001;
      renderer.render(scene, camera);
    };

    if (isAnimated) {
      rafRef.current = requestAnimationFrame(renderFrame);
    } else {
      uniforms.iTime.value = timeOffset;
      renderer.render(scene, camera);
    }

    const handleResize = () => {
      const r = container.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      uniforms.iResolution.value.set(r.width * pixelRatio, r.height * pixelRatio);
      if (!isAnimated) renderer.render(scene, camera);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      startTimeRef.current = 0;
      if (observer) observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [
    speed,
    intensity,
    scale,
    downScale,
    primaryColor,
    secondaryColor,
    tertiaryColor,
    opacity,
    quality,
    maxFPS,
    pauseWhenOffscreen,
    animate,
    timeOffset,
  ]);

  const widthStyle = typeof width === "number" ? `${width}px` : width;
  const heightStyle = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", overflow: "hidden", width: widthStyle, height: heightStyle }}
    >
      {children && (
        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            inset: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
