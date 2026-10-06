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
];

export default config;
