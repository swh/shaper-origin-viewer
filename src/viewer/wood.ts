import { Color, type MeshStandardMaterial } from "three";
import type { Species } from "./species";

/**
 * Inject a procedural wood-grain pattern into a MeshStandardMaterial via
 * `onBeforeCompile`. The grain is computed in world-space, so the same rings
 * appear on the board's top, the floor of every cut, and the vertical walls
 * between them — giving you free visual depth-cueing for the cuts without
 * lifting a finger.
 *
 * Algorithm: distance from a virtual pith line offset below the board, plus
 * fbm noise distortion so rings aren't perfect circles, plus a fine
 * longitudinal grain. Sin-based rings are smoothstep'd into bands; bands mix
 * between the species' light and dark colours.
 */
export function applyWoodGrain(material: MeshStandardMaterial, species: Species): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrainLight = { value: new Color(species.light) };
    shader.uniforms.uGrainDark = { value: new Color(species.dark) };
    shader.uniforms.uRingScale = { value: species.ringScale };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vGrainPosition;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vGrainPosition = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vGrainPosition;
uniform vec3 uGrainLight;
uniform vec3 uGrainDark;
uniform float uRingScale;

// Hash without sine (Dave Hoskins / Shadertoy).
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.yzx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

float woodGrain(vec3 p) {
  // Pith axis runs along X. Offset the pith below+behind the board so we get
  // mostly-parallel rings rather than tight concentric ones.
  vec2 across = p.yz - vec2(-180.0, 40.0);
  float r = length(across);
  // Organic distortion. Amplitude must stay small relative to the ring
  // spacing or rings dissolve into noise — see uRingScale below (~1.5–3 mm).
  r += 1.2 * fbm3(p * 0.09);
  float rings = sin(r * (3.14159 / uRingScale));
  float band = smoothstep(0.15, 0.85, rings);
  // High-frequency grain along the axis adds visible "pores".
  float fine = noise3(p * vec3(0.45, 0.05, 0.05));
  // Range compressed to roughly [0.16, 0.74] so even at the ring peak we
  // never go fully to the species' dark colour — keeps overall contrast
  // gentle while leaving the pattern legible.
  return clamp(band * 0.4 + (fine - 0.5) * 0.18 + 0.25, 0.0, 1.0);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
diffuseColor.rgb = mix(uGrainLight, uGrainDark, woodGrain(vGrainPosition));`,
      );
  };
  material.needsUpdate = true;
}
