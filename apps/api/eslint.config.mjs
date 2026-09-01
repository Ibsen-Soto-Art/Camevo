import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [tseslint.configs.recommended],
    plugins: { "import-x": importX },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    settings: {
      "import-x/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      /**
       * Regla de arquitectura de docs/05-estructura-repositorio.md: la
       * comunicación entre climate/policy y el motor es unidireccional.
       * climate/policy no puede importar de engine/* ni de simulation/*
       * (evita además un ciclo, ya que simulation SÍ importa de climate).
       */
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/climate/**/*",
              from: "./src/engine/**/*",
              message: "climate/policy no debe importar de engine/* (ver docs/05-estructura-repositorio.md).",
            },
            {
              target: "./src/climate/**/*",
              from: "./src/simulation/**/*",
              message: "climate/policy no debe importar de simulation/* (evita un ciclo: simulation ya importa de climate).",
            },
          ],
        },
      ],
    },
  },
);
