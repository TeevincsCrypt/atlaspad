import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unknown-property": "off",
    },
  },
  {
    // The world renderer drives an imperative three.js scene (uniforms, GPU buffers, data textures) from
    // useFrame and GSAP timelines; mutating those objects is the intended API. The app does not use the
    // React Compiler, whose assumptions these rules encode.
    files: ["src/components/world/**"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
