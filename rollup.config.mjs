import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const isProduction = process.env.BUILD === "production";

export default {
  input: "src/main.ts",
  output: {
    file: "main.js",
    format: "cjs",
    sourcemap: !isProduction,
    exports: "default"
  },
  external: ["obsidian"],
  plugins: [
    nodeResolve({ browser: true }),
    typescript({
      tsconfig: "./tsconfig.build.json",
      compilerOptions: {
        declaration: false,
        sourceMap: !isProduction
      }
    })
  ]
};
